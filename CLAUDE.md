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

The server self-heals — you almost never need to do anything. On 401/403 from an AustLII endpoint, `auslaw-mcp` automatically:

1. Runs `scripts/refresh-austlii-cookie.mjs` to decrypt the cookies Chrome currently holds for `.austlii.edu.au` and writes them to `.env`.
2. Reloads `.env` into `process.env` so the new cookie takes effect immediately (no server restart needed).
3. Retries the failing request once.

In the common case Chrome's cookie store is fresher than the server's `.env` — Chrome rotates Cloudflare cookies in the background as the user browses — so the retry succeeds and the model never sees the 403 at all.

### When the model *does* see an error

Two distinct messages, with different appropriate responses:

**`"AustLII returned 403 ... auto-refresh from Chrome's cookie store didn't recover it ... open https://www.austlii.edu.au/ in Chrome"`** (the *afterRefresh* variant — refresh ran but Chrome's stored cookies are also stale). Do this:

1. If `mcp__Claude_in_Chrome__*` tools are available in your session, navigate the user's Chrome to `https://www.austlii.edu.au/`:
   ```
   mcp__Claude_in_Chrome__navigate(url="https://www.austlii.edu.au/", tabId=<any tab>)
   ```
   Then read `document.title`. If it contains `"moment"` (Cloudflare challenge page), wait 5 seconds and check again — Cloudflare normally self-resolves silently for the user's normal Chrome. Repeat up to ~3 times. Once the title is anything else (e.g. `"Australasian Legal Information Institute"`), Chrome's cookie store has fresh values.
2. Retry the original tool call. The server will run its own refresh again on the next 403 and pick up Chrome's freshly-rotated cookies.
3. If `Claude in Chrome` isn't connected (`mcp__Claude_in_Chrome__list_connected_browsers` returns `[]`), ask the user to open `https://www.austlii.edu.au/` in their Chrome and tell you when the page loads. Then retry.

**`"AustLII returned 403 ... auto-refresh wasn't able to run (refresh script missing or Keychain access denied)"`** (the *firstTry* variant — the server's auto-refresh path failed before it could even try to recover). Do this:

- Check that `scripts/refresh-austlii-cookie.mjs` exists in the project root — if missing, the deploy is incomplete.
- If present, the macOS Keychain prompt was likely denied. Tell the user to re-run `node scripts/refresh-austlii-cookie.mjs` manually from a terminal, click "Always Allow" on the Keychain dialog, then retry the tool call.

### Don't

- Don't ask the user to manually paste cookies unless both of the above paths have failed. The whole point of this design is to eliminate the manual paste loop.
- Don't try `chrome-devtools` MCP for cookie refresh — it spawns its own Chrome instance with a fresh fingerprint that Cloudflare flags as bot-y, and even manual challenge clicks tend to loop. Use `Claude in Chrome` (which goes through the user's normal browser) or fall back to asking the user.
- Don't navigate the user's Chrome unless responding to the *afterRefresh* error. Routine queries don't need it.

The `AUSTLII_USER_AGENT` in `.env` does **not** need refreshing on each cookie rotation as long as the user's Chrome version doesn't change. If Chrome auto-updates and refreshes start failing with cookie-bound errors despite a successful run, capture the new UA via `mcp__Claude_in_Chrome__javascript_tool` running `navigator.userAgent` and update `AUSTLII_USER_AGENT` in `.env` to match.

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
