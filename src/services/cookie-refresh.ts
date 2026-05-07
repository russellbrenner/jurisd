/**
 * Self-healing AUSTLII_COOKIE refresh.
 *
 * When AustLII returns 403 (Cloudflare bot challenge), this module spawns
 * `scripts/refresh-austlii-cookie.mjs` which decrypts whatever cookies the
 * user's Chrome has cached for `.austlii.edu.au` and writes them to `.env`.
 * The newly-written values are then loaded into `process.env` so subsequent
 * requests pick them up without a server restart.
 *
 * In the common case Chrome's cookie store is fresher than the server's `.env`
 * (Chrome rotates cookies in the background as the user browses), so this
 * succeeds silently and the model never sees the 403.
 *
 * If Chrome's stored cookies are *also* stale, the script still produces a
 * value but the retried request will 403 again — at which point the caller
 * should surface the "persistent" error message asking the user to open
 * AustLII in Chrome (which causes Chrome to acquire fresh cookies).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/services/cookie-refresh.js → dist/services → dist → project root
const PROJECT_ROOT = path.dirname(path.dirname(HERE));
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "refresh-austlii-cookie.mjs");
const ENV_PATH = path.join(PROJECT_ROOT, ".env");

// Coalesce concurrent refresh requests — many tool calls may all 403 at once
// during expiry, but we only want to run the script (and trigger a Keychain
// access) one time across them.
let refreshInFlight: Promise<boolean> | null = null;

// Hard floor between successful refreshes: if the script already succeeded
// recently, the cookie just got refreshed and another retry won't help —
// emit the persistent error instead. Prevents thrashing.
const REFRESH_THROTTLE_MS = 30_000;
let lastSuccessfulRefreshAt = 0;

/**
 * Attempts to refresh AUSTLII_COOKIE by running the refresh script and
 * reloading `.env` into `process.env`.
 *
 * @returns `true` if the script ran successfully and process.env was updated
 *          with a (potentially) new AUSTLII_COOKIE value; `false` if the
 *          script is missing, exited non-zero, threw, or was throttled.
 */
export async function tryRefreshAustliiCookie(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  // Throttle: if we just refreshed, refusing to refresh again forces the
  // caller down the persistent-error path (which prompts the user to open
  // Chrome) rather than spinning on a stale Chrome cookie store.
  if (Date.now() - lastSuccessfulRefreshAt < REFRESH_THROTTLE_MS) {
    return false;
  }

  refreshInFlight = doRefresh();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function doRefresh(): Promise<boolean> {
  if (!existsSync(SCRIPT_PATH)) {
    return false;
  }
  try {
    await execFileAsync("node", [SCRIPT_PATH], {
      timeout: 15_000,
      // Inherit our env so the script sees HOME etc.
      env: process.env,
    });
  } catch {
    return false;
  }

  // Reload .env into process.env so the new AUSTLII_COOKIE is visible to
  // subsequent requests in this process. dotenv's `override` would also work
  // but we re-implement it inline so we don't pull behaviour we don't want.
  if (existsSync(ENV_PATH)) {
    try {
      const parsed = parseEnv(readFileSync(ENV_PATH, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        process.env[key] = value;
      }
    } catch {
      // .env malformed — refresh script claimed success but something is off.
      // Don't poison process.env; treat as failure.
      return false;
    }
  }

  lastSuccessfulRefreshAt = Date.now();
  return true;
}

/**
 * Marker error: an AustLII 401/403 that *persisted* through a successful
 * cookie refresh and a retry. Caller should surface the "open Chrome to
 * refresh AustLII's cookies in the user's browser" message — no further
 * server-side recovery is possible.
 */
export class AustliiPersistentAuthError extends Error {
  constructor(public readonly status: number) {
    super(`AustLII persistent ${status} after cookie refresh`);
    this.name = "AustliiPersistentAuthError";
  }
}

/**
 * Wraps an async operation (typically an axios call) so a 401/403 response
 * triggers one cookie-refresh attempt followed by one retry.
 *
 * Three terminal states:
 *  1. Initial call succeeds → returns its result.
 *  2. Initial 401/403 → refresh runs and succeeds → retry succeeds → returns
 *     retry's result.
 *  3. Initial 401/403 → refresh runs → retry *also* 401/403 → throws
 *     {@link AustliiPersistentAuthError} so callers can emit the
 *     "afterRefresh" guidance message.
 *  4. Initial 401/403 → refresh did NOT run (script missing, throttled,
 *     keychain denied) → original axios error propagates so callers can
 *     emit the "firstTry" guidance message.
 *  5. Non-Cloudflare errors propagate as-is, no refresh attempted.
 */
export async function withCookieRefreshRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isAustliiAuthError(err)) throw err;
    const refreshed = await tryRefreshAustliiCookie();
    if (!refreshed) throw err;
    try {
      return await fn();
    } catch (retryErr) {
      if (isAustliiAuthError(retryErr)) {
        const status = (retryErr as { response?: { status?: number } }).response?.status ?? 403;
        throw new AustliiPersistentAuthError(status);
      }
      throw retryErr;
    }
  }
}

function isAustliiAuthError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { response?: { status?: number }; isAxiosError?: boolean };
  if (e.isAxiosError !== true) return false;
  return e.response?.status === 401 || e.response?.status === 403;
}
