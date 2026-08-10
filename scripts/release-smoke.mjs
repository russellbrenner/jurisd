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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Keep in sync with the "registers exactly N tools" assertion in
// src/test/unit/tool-surface.test.ts.
const EXPECT_TOOLS = 12;

function log(msg) {
  console.log(`[release-smoke] ${msg}`);
}

function fail(msg) {
  console.error(`[release-smoke] FAILED: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  log(`+ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (res.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${res.status}`);
  return res;
}

function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) return resolve();
      } catch {
        // server not up yet
      }
      if (Date.now() > deadline) return reject(new Error("timed out waiting for /health"));
      setTimeout(tick, 500);
    };
    void tick();
  });
}

async function httpSmoke(bin) {
  const port = 3100 + Math.floor(Math.random() * 500);
  const child = spawn(bin, [], {
    env: { ...process.env, MCP_TRANSPORT: "http", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  try {
    await waitForHealth(port, 20000);
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
      fail(`HTTP MCP initialize failed (${res.status}): ${text}\n--- stderr ---\n${stderr}`);
    }
    log("OK: HTTP MCP initialize responded");
  } finally {
    child.kill("SIGTERM");
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

    // --- CLI smoke: representative offline commands, checked for exit code.
    const cliChecks = [
      { args: ["--help"], mustExit: 0 },
      { args: ["help", "commands"], mustExit: 0 },
      { args: ["list-modules"], mustExit: 0 },
      { args: ["list-data-modules", "--format", "text"], mustExit: 0 },
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
      },
      { args: ["bogus-command"], mustExit: 2 },
    ];
    for (const { args, mustExit } of cliChecks) {
      const res = spawnSync(bin, args, { encoding: "utf8" });
      if (res.status !== mustExit) {
        fail(
          `jurisd ${args.join(" ")} exited ${res.status}, expected ${mustExit}\n` +
            `--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
        );
      }
    }
    log(`OK: ${cliChecks.length} CLI commands behaved as expected`);

    // --- stdio MCP handshake against the installed binary.
    run("node", [join(ROOT, "scripts/docker-handshake.mjs"), "--", bin], {
      env: { ...process.env, EXPECT_TOOLS: String(EXPECT_TOOLS) },
    });

    // --- HTTP transport: /health + MCP initialize.
    await httpSmoke(bin);

    log("RELEASE SMOKE OK: packed tarball installs and runs (CLI, stdio MCP, HTTP MCP)");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err.stack ?? String(err)));
