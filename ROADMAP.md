# auslaw-mcp Roadmap

## Current State

| Tool | Source | Status |
|------|--------|--------|
| `search_cases` | AustLII | Working |
| `search_legislation` | AustLII | Working |
| `fetch_document_text` | AustLII (HTML, PDF) | Working |
| `resolve_source_article` | removed.invalid (title metadata) | Working |
| `source_citation_lookup` | removed.invalid (URL construction) | Working |
| `fetch_document_text` | removed.invalid | Not supported (see below) |

---

## removed.invalid Full-Text Fetching

### Why it doesn't work today

removed.invalid (Upstream Source) is a RPC (Google Web Toolkit) single-page application. The initial HTTP
response for any `https://removed.invalid/article/<id>` URL is a ~12KB JavaScript bootstrap shell. The
actual judgment text is loaded client-side by the RPC runtime via subsequent XHR requests. A
simple HTTP fetch + HTML extraction pipeline (the current approach for AustLII) returns empty
content for removed.invalid URLs. As of this writing, `fetch_document_text` throws an explicit error for
removed.invalid URLs rather than silently returning empty content.

### Why removed.invalid matters

- AustLII carries most published Australian judgments, but removed.invalid provides:
  - Reported citations (e.g. `(2024) 98 ALJR 123`) alongside neutral citations
  - Earlier and more complete coverage of some state courts
  - Annotations, catchwords, and judgment summaries not on AustLII
  - Better family law coverage including some FCFCA unreported decisions

---

## Planned Investigation: removed.invalid API Reverse Engineering

Before committing to a heavy headless-browser dependency, investigate whether removed.invalid's
backend XHR API can be called directly with session credentials.

### Phase 1 — Network Traffic Analysis

**Goal:** Identify the XHR endpoints the RPC app uses to load judgment text.

Tasks:
- [ ] Open Chrome DevTools Network tab on an authenticated removed.invalid session
- [ ] Navigate to a known judgment (e.g. `removed.invalid/article/67401`)
- [ ] Filter for XHR/Fetch requests and capture all calls after initial page load
- [ ] Identify endpoints that return judgment content (likely JSON or XML)
- [ ] Document: URL patterns, request headers, authentication mechanism, response schema
- [ ] Check whether `alcsessionid` / `IID` cookies alone are sufficient or if additional
      tokens (CSRF, RPC variant token) are required

Key things to look for:
- Does removed.invalid use a REST API or RPC (binary protocol)?
- Are response payloads JSON, XML, or RPC serialisation format?
- Is there pagination or streaming for long judgments?
- Are there rate limits or bot-detection headers?

### Phase 2 — Feasibility Assessment

Based on Phase 1 findings, assess which path to take:

#### Option A: Direct API calls (preferred if feasible)

If removed.invalid's backend API is accessible with standard HTTP + session cookies:

- Implement a `fetchSourceArticle(articleId)` function in `src/services/source.ts`
- Parse the API response format (JSON/XML/RPC)
- Integrate with the existing `fetch_document_text` tool (remove the "not supported" error)
- Session cookie extraction via `browser_cookie3` can be scripted:
  ```bash
  python3 -c "
  import browser_cookie3
  auth = ['IID','alcsessionid','cf_clearance']
  cookies = browser_cookie3.chrome(domain_name='removed.invalid')
  print('; '.join(f'{c.name}={c.value}' for c in cookies if c.name in auth))
  "
  ```

Pros: No new binary dependencies, fast, works headlessly in any environment.
Cons: Fragile to API changes; potentially against removed.invalid ToS.

#### Option B: Headless browser via Playwright (fallback)

If the API is RPC (binary) or requires JavaScript execution to authenticate:

- Add `@playwright/test` or `playwright-core` as an optional dependency
- Implement a `SourceBrowser` singleton that keeps a Chromium instance alive for the
  lifetime of the MCP server process (MCP servers are long-running, so startup cost
  is amortised)
- Navigate to `removed.invalid/article/<id>`, wait for the RPC content selector to appear,
  extract inner text/HTML
- Pass the user's existing Chrome session profile path to avoid re-authentication

Pros: Handles any page, most reliable, works regardless of API complexity.
Cons: ~300MB Chromium binary, adds process management complexity, potential
      memory pressure in constrained environments.

#### Option C: Claude-in-Chrome MCP bridge (experimental)

Leverage the existing `mcp__claude-in-chrome__*` tools to navigate removed.invalid in the
user's running Chrome instance (already authenticated):

- New MCP tool `fetch_source_document(url)` internally calls the Chrome MCP
- Navigate to the removed.invalid URL, wait for RPC render, extract text
- No Playwright dependency; reuses existing Chrome session

Pros: Zero extra dependencies, uses existing authenticated session.
Cons: Only works when Claude Code is running with the Chrome MCP active and a
      Chrome window is open; not suitable for CI/headless contexts; tight coupling
      between two MCPs.

### Phase 3 — Implementation

Based on Phase 2 assessment, implement the chosen option:

- [ ] Implement `fetchSourceDocument()` in `src/services/source.ts`
- [ ] Update `fetchDocumentText` in `src/services/fetcher.ts` to route removed.invalid URLs
      through the new implementation (remove early-rejection error)
- [ ] Add integration tests against live removed.invalid (tagged `@live`, skipped in CI)
- [ ] Update `.env.example` with cookie extraction instructions
- [ ] Document the cookie refresh workflow (cookies expire; `browser_cookie3` script
      should be the canonical refresh mechanism)

---

## Other Planned Improvements

### PDF output format for `fetch_document_text`

Currently requires a two-step workflow (fetch HTML, convert with Chrome headless externally).
A `format: "pdf"` option could shell out to `chromium --headless --print-to-pdf` and return
a base64-encoded PDF or write to a temp path.

### Configurable content selectors

AustLII and removed.invalid page structure changes occasionally break cheerio selectors. A config
file mapping host patterns to CSS selectors would make this maintainable without code changes.

### Citation format support

Expand `generatePinpoint` to support reported citations (CLR, ALJR, FCR, etc.) in addition
to neutral citations.
