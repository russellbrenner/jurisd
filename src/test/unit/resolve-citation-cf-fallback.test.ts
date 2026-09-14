import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * resolve_citation must degrade the same way search_cases does when AustLII
 * is Cloudflare-blocked (#192):
 *
 *   mode=validate  HEAD blocked -> Exa confirmation -> otherwise degraded,
 *                  never a false "Citation not found on AustLII".
 *   mode=auto      HEAD blocked -> direct citation URL (no paid search).
 *   mode=search    search blocked -> direct citation URL -> Exa -> degraded.
 */

const { searchAustLiiMock, searchExaMock, headMock } = vi.hoisted(() => ({
  searchAustLiiMock: vi.fn(),
  searchExaMock: vi.fn(),
  headMock: vi.fn(),
}));

vi.mock("../../services/austlii.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/austlii.js")>();
  return { ...actual, searchAustLii: searchAustLiiMock };
});
vi.mock("../../services/exa.js", () => ({ searchAustliiViaExaWithStatus: searchExaMock }));
vi.mock("axios", () => ({ default: { head: headMock, get: vi.fn() } }));

import { createMcpServer } from "../../server.js";
import { runCli } from "../../cli.js";
import { CloudflareBlockedError } from "../../errors.js";
import type { SearchResult } from "../../services/austlii.js";

const MABO_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html";
const CF_HEAD = { status: 403, headers: { "cf-mitigated": "challenge" } };

function exaHit(): SearchResult {
  return {
    title: "Mabo v Queensland (No 2) [1992] HCA 23",
    neutralCitation: "[1992] HCA 23",
    url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
    source: "austlii",
    discoverySource: "exa-fallback",
    type: "case",
  };
}

async function callResolve(args: Record<string, unknown>): Promise<{
  isError: boolean;
  payload: Record<string, unknown>;
  text: string;
}> {
  const server = createMcpServer();
  const client = new Client({ name: "resolve-citation-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "resolve_citation", arguments: args });
    const content = (result.content ?? []) as Array<{ type?: string; text?: string }>;
    const text = content[0]?.type === "text" ? (content[0].text ?? "") : "";
    return {
      isError: result.isError === true,
      payload: JSON.parse(text) as Record<string, unknown>,
      text,
    };
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

describe("resolve_citation under a Cloudflare block", () => {
  beforeEach(() => {
    searchAustLiiMock.mockReset();
    searchExaMock.mockReset();
    headMock.mockReset();
    searchExaMock.mockResolvedValue({ results: [], status: "not_configured" });
  });

  describe("mode=validate", () => {
    it("reports a genuine 404 as not_found without consulting Exa", async () => {
      headMock.mockResolvedValue({ status: 404, headers: {} });
      const { isError, payload } = await callResolve({
        citation: "[9999] HCA 999",
        mode: "validate",
      });
      expect(isError).toBe(false);
      expect(payload).toMatchObject({ valid: false, status: "not_found" });
      expect(payload.degraded).toBeUndefined();
      expect(searchExaMock).not.toHaveBeenCalled();
    });

    it("confirms a blocked citation through Exa when the key is configured", async () => {
      headMock.mockResolvedValue(CF_HEAD);
      searchExaMock.mockResolvedValue({ results: [exaHit()], status: "ok" });
      const { isError, payload } = await callResolve({
        citation: "[1992] HCA 23",
        mode: "validate",
      });
      expect(isError).toBe(false);
      expect(payload).toMatchObject({
        valid: true,
        status: "found",
        canonicalCitation: "[1992] HCA 23",
        austliiUrl: MABO_URL,
        verifiedBy: "exa",
        sources: { austlii: "blocked", exa: "ok" },
      });
      // Provider state stays separate from the existence verdict.
      expect(payload.httpStatus).toBeUndefined();
      expect(searchExaMock).toHaveBeenCalledOnce();
      expect(searchExaMock.mock.calls[0]?.[0]).toBe("[1992] HCA 23");
    });

    it("returns a degraded, unverified result (not 'not found') when Exa is not configured", async () => {
      headMock.mockResolvedValue(CF_HEAD);
      const { isError, payload } = await callResolve({
        citation: "[1992] HCA 23",
        mode: "validate",
      });
      expect(isError).toBe(false);
      expect(payload).toMatchObject({
        valid: false,
        status: "blocked",
        austliiUrl: MABO_URL,
        degraded: true,
        sources: { austlii: "blocked", exa: "not_configured" },
      });
      expect(String(payload.message)).toMatch(/Cloudflare/);
      expect(String(payload.message)).not.toMatch(/not found/i);
    });

    it("treats a bare 503 bot block as blocked, and an Exa miss as unverified", async () => {
      headMock.mockResolvedValue({ status: 503, headers: {} });
      searchExaMock.mockResolvedValue({
        results: [
          {
            ...exaHit(),
            neutralCitation: "[1992] HCA 24",
            url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/24.html",
          },
        ],
        status: "ok",
      });
      const { payload } = await callResolve({ citation: "[1992] HCA 23", mode: "validate" });
      expect(payload).toMatchObject({
        valid: false,
        status: "blocked",
        degraded: true,
        sources: { austlii: "blocked", exa: "ok" },
      });
    });
  });

  describe("mode=validate when AustLII is unreachable", () => {
    it("also consults Exa and reports austlii=failed rather than 'not found'", async () => {
      headMock.mockRejectedValue(new Error("ECONNRESET"));
      const { payload } = await callResolve({ citation: "[1992] HCA 23", mode: "validate" });
      expect(payload).toMatchObject({
        valid: false,
        status: "unreachable",
        degraded: true,
        sources: { austlii: "failed", exa: "not_configured" },
      });
      expect(searchExaMock).toHaveBeenCalledOnce();

      searchExaMock.mockResolvedValue({ results: [exaHit()], status: "ok" });
      const confirmed = await callResolve({ citation: "[1992] HCA 23", mode: "validate" });
      expect(confirmed.payload).toMatchObject({
        valid: true,
        verifiedBy: "exa",
        sources: { austlii: "failed", exa: "ok" },
      });
    });
  });

  describe("mode=auto", () => {
    it("returns the direct citation URL when the AustLII check is blocked, without search or Exa", async () => {
      headMock.mockResolvedValue(CF_HEAD);
      const { isError, payload } = await callResolve({ citation: "[1992] HCA 23" });
      expect(isError).toBe(false);
      const results = payload.results as Array<Record<string, unknown>>;
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        neutralCitation: "[1992] HCA 23",
        url: MABO_URL,
        discoverySource: "citation-url",
        aglc4: "[1992] HCA 23",
      });
      expect(payload.sources).toEqual({ austlii: "blocked", austlii_direct: "ok" });
      expect(payload.degraded).toBeUndefined();
      expect(searchAustLiiMock).not.toHaveBeenCalled();
      expect(searchExaMock).not.toHaveBeenCalled();
    });

    it("returns the direct citation URL with austlii=failed when AustLII is unreachable", async () => {
      headMock.mockRejectedValue(new Error("ETIMEDOUT"));
      const { payload } = await callResolve({ citation: "[1992] HCA 23" });
      const results = payload.results as Array<Record<string, unknown>>;
      expect(results[0]).toMatchObject({ discoverySource: "citation-url", url: MABO_URL });
      expect(payload.sources).toEqual({ austlii: "failed", austlii_direct: "ok" });
      expect(searchAustLiiMock).not.toHaveBeenCalled();
    });

    it("still falls through to text search on a genuine 404", async () => {
      headMock.mockResolvedValue({ status: 404, headers: {} });
      searchAustLiiMock.mockResolvedValue([]);
      const { payload } = await callResolve({ citation: "[9999] HCA 999" });
      expect(payload).toEqual([]);
      expect(searchAustLiiMock).toHaveBeenCalledOnce();
    });

    it("does not resurrect a URL AustLII answered 404 for when the text search is blocked", async () => {
      headMock.mockResolvedValue({ status: 404, headers: {} });
      searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
      const { isError, payload } = await callResolve({ citation: "[9999] HCA 999" });
      expect(isError).toBe(false);
      expect(payload).toMatchObject({
        results: [],
        degraded: true,
        sources: { austlii: "blocked", exa: "not_configured" },
      });
      expect(payload.sources).not.toHaveProperty("austlii_direct");
      expect(searchExaMock).toHaveBeenCalledOnce();
    });

    it("keeps the direct URL fallback for a search-only query with no prior 404", async () => {
      searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
      const { payload } = await callResolve({ citation: "[2018] HCA 9", mode: "search" });
      expect(payload.sources).toEqual({ austlii: "blocked", austlii_direct: "ok" });
      expect(headMock).not.toHaveBeenCalled();
    });

    it("recovers a case-name query through Exa when AustLII search is blocked", async () => {
      searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
      searchExaMock.mockResolvedValue({ results: [exaHit()], status: "ok" });
      const { isError, payload } = await callResolve({ citation: "Mabo v Queensland" });
      expect(isError).toBe(false);
      const results = payload.results as Array<Record<string, unknown>>;
      expect(results[0]).toMatchObject({ neutralCitation: "[1992] HCA 23" });
      expect(payload.sources).toEqual({ austlii: "blocked", exa: "ok" });
      expect(headMock).not.toHaveBeenCalled();
    });
  });

  describe("mode=search", () => {
    it("returns a degraded result naming the fallback instead of throwing", async () => {
      searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
      const { isError, payload, text } = await callResolve({
        citation: "Mabo v Queensland",
        mode: "search",
      });
      expect(isError).toBe(false);
      expect(payload).toMatchObject({
        results: [],
        degraded: true,
        sources: { austlii: "blocked", exa: "not_configured" },
      });
      const warnings = payload.warnings as Array<{ code: string; message: string }>;
      expect(warnings[0]?.code).toBe("austlii_cloudflare_blocked");
      expect(text).toContain("EXA_API_KEY");
      expect(text).not.toMatch(/cf_clearance=|Cookie:/);
    });

    it("does not tell a user with a configured key to configure it", async () => {
      searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
      searchExaMock.mockResolvedValue({ results: [], status: "failed" });
      const { payload } = await callResolve({ citation: "Mabo v Queensland", mode: "search" });
      const warnings = payload.warnings as Array<{ message: string }>;
      expect(warnings[0]?.message).toMatch(/fallback failed/);
      expect(warnings[0]?.message).not.toMatch(/Configure EXA_API_KEY/);
    });

    it("resolves a neutral-citation query to its direct URL without paid search", async () => {
      searchAustLiiMock.mockRejectedValue(new CloudflareBlockedError("https://austlii", false));
      const { payload } = await callResolve({ citation: "[2018] HCA 9", mode: "search" });
      const results = payload.results as Array<Record<string, unknown>>;
      expect(results[0]).toMatchObject({ discoverySource: "citation-url" });
      expect(String(results[0]?.url)).toContain("HCA/2018/9.html");
      expect(searchExaMock).not.toHaveBeenCalled();
    });

    it("rethrows non-Cloudflare AustLII failures", async () => {
      searchAustLiiMock.mockRejectedValue(new Error("transport failed"));
      const server = createMcpServer();
      const client = new Client({ name: "resolve-citation-test", version: "0.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      try {
        const result = await client.callTool({
          name: "resolve_citation",
          arguments: { citation: "Mabo", mode: "search" },
        });
        expect(result.isError).toBe(true);
      } finally {
        await Promise.allSettled([client.close(), server.close()]);
      }
    });
  });

  describe("CLI exit code", () => {
    let written: string;
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      process.exitCode = 0;
      written = "";
      stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written += String(chunk);
        return true;
      });
      stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      stdout.mockRestore();
      stderr.mockRestore();
      process.exitCode = 0;
    });

    it("exits 4 (source unavailable) for an unverifiable validate, 0 once Exa confirms", async () => {
      headMock.mockResolvedValue(CF_HEAD);
      let handled = await runCli(["resolve-citation", "[1992] HCA 23", "--mode", "validate"]);
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(4);
      expect(JSON.parse(written) as { status: string }).toMatchObject({ status: "blocked" });

      written = "";
      searchExaMock.mockResolvedValue({ results: [exaHit()], status: "ok" });
      handled = await runCli(["resolve-citation", "[1992] HCA 23", "--mode", "validate"]);
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(written) as { valid: boolean }).toMatchObject({ valid: true });
    });
  });
});
