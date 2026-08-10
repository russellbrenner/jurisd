#!/usr/bin/env node
// Release install/run smoke test.
//
// release.yml's `verify` job builds, lints, tests, and `npm pack`s the
// tarball -- but never actually installs it and runs the result, so a
// packaging regression (missing `files` entry, broken bin shebang, an
// optionalDependency that silently fails to resolve, ...) would only be
// caught by a user after publish. This script closes that gap: it packs the
// tarball, installs it into an isolated npm prefix exactly the way a real
// `npm install -g jurisd` user would, then drives the installed binary
// through representative CLI commands, the stdio MCP handshake, and the HTTP
// transport's /health + JSON-RPC surface. Exits non-zero on any failure so it
// can gate CI and, eventually, the release workflow.
//
// Usage:
//   node scripts/release-smoke.mjs
//
// Env:
//   SKIP_BUILD=1   reuse the existing dist/ (faster local iteration; CI
//                  always does a full build)

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function log(msg) {
  console.log(`[release-smoke] ${msg}`);
}

// All failure paths throw; only main()'s top-level .catch() calls
// process.exit(), so every `finally` (temp-dir cleanup, child-process
// teardown) always runs first. Calling process.exit() from deep inside a
// try/finally skips pending finally blocks entirely -- that was the bug that
// left multi-hundred-MB temp installs and orphaned HTTP servers behind on
// every failed run.
function fail(msg) {
  throw new Error(msg);
}

function run(cmd, args, opts = {}) {
  log(`+ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (res.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${res.status}`);
  return res;
}

// Bind port 0 to get an OS-assigned free port, rather than guessing from a
// fixed range (which can collide with concurrent jobs or a leaked prior run).
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function waitForHealth(port, child, timeoutMs, stderrRef) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    // Abort immediately (rather than waiting out the full timeout) if the
    // server process dies before /health ever answers.
    const onExit = (code) => {
      reject(new Error(`server exited (code ${code}) before /health responded\n--- stderr ---\n${stderrRef.value}`));
    };
    child.once("exit", onExit);

    const settle = (fn, arg) => {
      child.off("exit", onExit);
      fn(arg);
    };

    const tick = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) return settle(resolve);
      } catch {
        // server not up yet
      }
      if (Date.now() > deadline) {
        return settle(reject, new Error(`timed out waiting for /health\n--- stderr ---\n${stderrRef.value}`));
      }
      setTimeout(tick, 500);
    };
    void tick();
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!exited) child.kill("SIGKILL");
}

async function httpSmoke(bin) {
  const port = await findFreePort();
  const child = spawn(bin, [], {
    env: { ...process.env, MCP_TRANSPORT: "http", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Drain stdout even though we never inspect it -- an unread pipe fills once
  // the server writes past its OS buffer (~64KB) and blocks the child until
  // something reads it, which without this would hang the whole job.
  child.stdout.resume();
  const stderrRef = { value: "" };
  child.stderr.on("data", (d) => (stderrRef.value += d.toString()));

  try {
    await waitForHealth(port, child, 20000, stderrRef);
    log("OK: /health responded");

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "release-smoke", version: "0.0.0" },
        },
      }),
    });
    const text = await res.text();
    if (!res.ok || !text.includes('"serverInfo"')) {
      fail(`HTTP MCP initialize failed (${res.status}): ${text}\n--- stderr ---\n${stderrRef.value}`);
    }
    log("OK: HTTP MCP initialize responded");
  } finally {
    await stopChild(child);
  }
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "jurisd-release-smoke-"));
  const prefix = join(workDir, "prefix");

  try {
    if (!process.env.SKIP_BUILD) {
      run("npm", ["run", "clean"]);
      run("npm", ["run", "build"]);
    }

    const packRes = spawnSync(
      "npm",
      ["pack", "--json", "--pack-destination", workDir],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (packRes.status !== 0) fail(`npm pack exited ${packRes.status}: ${packRes.stderr}`);
    const [{ filename: tarball }] = JSON.parse(packRes.stdout);
    log(`packed ${tarball}`);

    run("npm", ["install", "-g", join(workDir, tarball), "--prefix", prefix]);

    const bin = join(prefix, "bin", "jurisd");

    // --- CLI smoke: representative offline commands, checked for exit code
    // and that they actually printed something on the stream jurisd uses for
    // that kind of output (most CLI output here goes to stderr; see cli.ts).
    const cliChecks = [
      { args: ["--help"], mustExit: 0, expectOutputOn: "stderr" },
      { args: ["help", "commands"], mustExit: 0, expectOutputOn: "stderr" },
      { args: ["list-modules"], mustExit: 0, expectOutputOn: "stderr" },
      { args: ["list-data-modules", "--format", "text"], mustExit: 0, expectOutputOn: "stdout" },
      {
        args: [
          "format-citation",
          "Mabo v Queensland (No 2)",
          "--neutral-citation",
          "[1992] HCA 23",
          "--format",
          "text",
        ],
        mustExit: 0,
        expectOutputOn: "stdout",
      },
      { args: ["bogus-command"], mustExit: 2, expectOutputOn: "stderr" },
    ];
    for (const { args, mustExit, expectOutputOn } of cliChecks) {
      const res = spawnSync(bin, args, { encoding: "utf8" });
      const context = () =>
        `jurisd ${args.join(" ")}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`;
      if (res.status !== mustExit) {
        fail(`exited ${res.status}, expected ${mustExit}\n${context()}`);
      }
      if (!res[expectOutputOn]?.trim()) {
        fail(`expected non-empty ${expectOutputOn}\n${context()}`);
      }
    }
    log(`OK: ${cliChecks.length} CLI commands behaved as expected`);

    // --- stdio MCP handshake against the installed binary. Let it use its
    // own default tool count (kept in sync with the server by a dedicated
    // test) rather than overriding it here, so that default is what's
    // actually exercised.
    run("node", [join(ROOT, "scripts/docker-handshake.mjs"), "--", bin]);

    // --- HTTP transport: /health + MCP initialize.
    await httpSmoke(bin);

    log("RELEASE SMOKE OK: packed tarball installs and runs (CLI, stdio MCP, HTTP MCP)");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[release-smoke] FAILED: ${err.stack ?? String(err)}`);
  process.exit(1);
});
