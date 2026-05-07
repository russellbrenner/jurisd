# auslaw-mcp - Claude Code Project Instructions

## Project Overview

MCP server for Australian/NZ legal research. Searches AustLII and jade.io, retrieves full-text judgments, formats AGLC4 citations.

## Build & Test

```bash
npm run build          # TypeScript compile
npm test               # All tests (unit + integration + perf; integration hits live services)
npx vitest run src/test/unit/  # Unit tests only (fast, no network)
npm run lint           # ESLint (flat config via eslint.config.mjs)
npm run lint:fix       # Auto-fix lint issues
```

- Always run `npm run build` before pushing (CI runs on push)
- Unit tests must all pass before committing; integration/perf test failures from network timeouts are acceptable
- ESLint uses flat config (`eslint.config.mjs`), NOT legacy `.eslintrc`

## When auslaw-mcp returns a Cloudflare 403

The server self-heals in the common case. On 401/403 from an AustLII endpoint it runs `scripts/refresh-austlii-cookie.mjs`, which decrypts the cookies the user's Chrome currently holds for `.austlii.edu.au` (from Chrome's SQLite cookie store), writes them to `.env`, reloads `process.env`, and retries the failing request once. Whenever Chrome's stored cookies are fresher than the server's `.env`, the retry succeeds and the model never sees the 403.

The refresh is throttled to once per 30 seconds (per server process) and coalesces concurrent tool calls so they share one refresh attempt.

### When the model sees an error

The visible failure mode is the *afterRefresh* error:

> `"AustLII returned 403 ... even after the server refreshed cookies from Chrome's cookie store. To recover: open https://www.austlii.edu.au/ in Chrome, type any query into the search box, and submit it..."`

This means Chrome's stored cookies are also stale, OR Cloudflare has flagged the machine's IP and is rejecting cookies regardless of freshness. The error message tells the user exactly what to do: **open the AustLII homepage in Chrome and submit a real search through the form**. That action triggers Cloudflare to issue fresh cookies more reliably than any programmatic navigation. Once the user sees the search results, the model retries the original tool call and the server picks up the new cookies on the next request.

If `mcp__Claude_in_Chrome__*` is available you *can* offer to drive that navigation yourself, but be honest with the user about its limitations: form submission via JS may or may not trigger Cloudflare's full challenge cycle — the most reliable path is the user clicking through manually.

### What we tried and abandoned

We previously experimented with auto-nudging Chrome via `open -a "Google Chrome" <search-url>` to force a fresh Cloudflare challenge. It doesn't reliably work: Cloudflare scores Chrome's existing fingerprint highly enough to pass without issuing fresh cookies, AustLII's `/cgi-bin/sinosrch.cgi` returns 410 Gone for direct URL navigation (no Referer), and aggressive testing flags the machine's IP. A real form submission from the user's hand is the ground-truth working recovery.

### Don't

- Don't paste cookies manually. The server's auto-refresh from Chrome's DB handles most cases.
- Don't use `chrome-devtools` MCP — it spawns an isolated Chrome with no fingerprint, Cloudflare loops indefinitely.
- Don't drive Chrome to a `/cgi-bin/sinosrch.cgi` URL via `open` or `mcp__Claude_in_Chrome__navigate` and assume cookies will refresh. They typically won't (returns 410 Gone, Cloudflare passes through). Have the user submit the form themselves.

The `AUSTLII_USER_AGENT` in `.env` does **not** need refreshing on each cookie rotation as long as the user's Chrome version doesn't change. If Chrome auto-updates and refreshes start failing despite Chrome having fresh cookies, capture the new UA via `mcp__Claude_in_Chrome__javascript_tool` running `navigator.userAgent` and update `AUSTLII_USER_AGENT` in `.env`.

## Key Architecture

- `src/index.ts` - MCP server, 10 tool registrations
- `src/services/jade-gwt.ts` - GWT-RPC protocol: `proposeCitables` (search), `avd2Request` (fetch), citator, strong names, GWT encoding
- `src/services/jade.ts` - jade.io integration: `searchJade`, `resolveArticle`, `searchCitingCases`, bridge section resolution
- `src/services/austlii.ts` - AustLII search with authority-based ranking
- `src/services/citation.ts` - AGLC4 formatting, validation, pinpoints
- `src/services/fetcher.ts` - Document retrieval (HTML, PDF, OCR, jade.io GWT-RPC)
- `docs/jade-gwt-protocol.md` - GWT-RPC reverse-engineering documentation

## jade.io GWT-RPC

The jade.io integration uses reverse-engineered GWT-RPC (Google Web Toolkit Remote Procedure Call). Key concepts:

- **Strong names** change on jade.io redeployment; update from HAR captures (see below)
- **proposeCitables** = search/autocomplete endpoint (JadeRemoteService)
- **avd2Request** = fetch judgment content (ArticleViewRemoteService)
- **LeftoverRemoteService** = citation search ("who cites this article") - implemented as `search_citing_cases` tool
- **Bridge section** = last ~10% of proposeCitables flat array; contains record-ID/article-ID pairs
- **Citable IDs** = internal IDs in 2M-10M range (different from article IDs 100-2M); input to citator
- **`.concat()` responses** = GWT splits arrays >32768 elements via `.concat()` join; `parseGwtConcatResponse()` handles this
- Article IDs are resolved via public GET to `jade.io/article/{id}` (no session cookie needed)

### Strong name updates

When jade.io redeploys, the GWT strong names (type hashes) change. To update:
1. Capture a HAR from jade.io (see Proxyman workflow below)
2. Find the `jadeService.do` POST requests
3. Extract the new strong name from the request body (field 4 in the pipe-delimited GWT-RPC payload)
4. Update constants in `src/services/jade-gwt.ts`: `JADE_STRONG_NAME`, `AVD2_STRONG_NAME`, `LEFTOVER_STRONG_NAME`, `JADE_PERMUTATION`
5. Update `docs/jade-gwt-protocol.md`

## Proxyman Debug Workflow

Proxyman captures HTTPS traffic from Chrome for jade.io reverse engineering. CLI at:
`/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli`

### Commands

```bash
PCLI=/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli

# Clear session (start fresh capture)
$PCLI clear-session

# Export jade.io traffic as HAR
$PCLI export-log --mode domains --domains 'jade.io' --format har --output /tmp/jade-capture.har

# Export all traffic as HAR
$PCLI export-log --format har --output /tmp/all-traffic.har

# Export flows after a specific flow ID (incremental capture)
$PCLI export-log --format har --since <flow-id> --output /tmp/incremental.har
```

### Typical capture workflow

1. `$PCLI clear-session` - clear previous flows
2. Interact with jade.io in Chrome (search, click article, trigger "cited by", etc.)
3. `$PCLI export-log --mode domains --domains 'jade.io' --format har -o /tmp/jade-capture.har`
4. Parse the HAR with node to extract GWT-RPC request/response bodies

### HAR parsing helper

```javascript
const har = JSON.parse(require("fs").readFileSync("/tmp/jade-capture.har", "utf-8"));
const entries = har.log.entries.filter(e => e.request.url.includes("jadeService.do"));
entries.forEach((e, i) => {
  const body = e.request.postData?.text || "";
  const service = body.match(/JadeRemoteService|ArticleViewRemoteService|LeftoverRemoteService/)?.[0] || "unknown";
  console.log(`${i}: ${service}  respLen=${e.response.content?.text?.length || 0}`);
});
```

## Credentials

- `JADE_SESSION_COOKIE`: 1Password vault `avtgkjcqwia6tzg2swwrzuan44`, item `jvpdjofjrm7srts4kowdjol5dq`, field `credential`
- Retrieve via MCP: `mcp__agent-tools__op_get_secret(vault_id, item_id, "credential")`
- Cookie contains `IID`, `alcsessionid`, `cf_clearance`; expires periodically

## Testing Notes

- Fixtures in `src/test/fixtures/` - static GWT-RPC responses for deterministic unit tests
- Integration tests in `src/test/scenarios.test.ts` hit live AustLII/jade.io; flaky due to network
- Performance tests in `src/test/performance/` have generous timeouts but still flake under load
- The `parseProposeCitablesResponse` near-descriptor article ID offsets do NOT generalise across all responses; the bridge section + `resolveArticle` validation is the reliable path
