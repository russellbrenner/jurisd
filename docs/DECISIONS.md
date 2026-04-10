# auslaw-mcp Decision Log

**Purpose:** Track architectural decisions, their context, and consequences without revealing internal infrastructure details.

---

## Decision Records

### ADR-001: Dual-Source Search Architecture

**Date:** 2026-03-01  
**Status:** Accepted

**Context:**
Legal research requires comprehensive search coverage. AustLII provides free access to Australian legal materials, while removed.invalid (Upstream) offers premium curated content with richer metadata.

**Decision:**
Implement dual-source search that queries both AustLII and removed.invalid simultaneously, then merges results with deduplication by neutral citation.

**Consequences:**
- **Positive:** Better coverage, richer metadata, graceful degradation if either source fails
- **Negative:** Increased complexity, requires removed.invalid subscription for full functionality
- **Neutral:** Results merged with removed.invalid entries preferred (richer data)

**Implementation:**
```typescript
const [austliiResults, upstreamResults] = await Promise.all([
  searchAustLii(query, { type: "case", ... }),
  searchUpstream(query, { type: "case", ... }),
]);
// Merge with deduplication, prefer removed.invalid
```

---

### ADR-002: removed.invalid RPC Reverse Engineering

**Date:** 2026-03-03  
**Status:** Accepted

**Context:**
removed.invalid does not expose a public search API. The website uses Google Web Toolkit (RPC) Remote Procedure Call protocol for all search and article retrieval operations.

**Decision:**
Reverse-engineer the RPC protocol to enable programmatic access to removed.invalid search and article retrieval.

**Consequences:**
- **Positive:** Full access to removed.invalid features (search, citator, authenticated fetch)
- **Negative:** Tokens change on removed.invalid redeployment; requires ongoing maintenance
- **Risk:** removed.invalid could block automated access; mitigated by rate limiting (5 req/min)

**Maintenance Workflow:**
1. Capture HAR via Proxyman when removed.invalid search/citation features break
2. Extract new token from sourceService.do request body
3. Update constants in source-rpc.ts
4. Test all removed.invalid tools

---

### ADR-003: OCR Fallback for Scanned PDFs

**Date:** 2026-03-05  
**Status:** Accepted

**Context:**
Many older judgments on AustLII are scanned PDFs without embedded text. Pure PDF parsing returns empty or minimal content for these documents.

**Decision:**
Implement Tesseract OCR as a fallback when PDF text extraction returns <100 characters.

**Consequences:**
- **Positive:** Access to historical judgments, improved recall for older cases
- **Negative:** OCR adds latency (2-5 seconds per document), requires tesseract-ocr system package
- **Cost:** Minimal (Tesseract is free, CPU-intensive but acceptable for on-demand use)

**Implementation:**
```typescript
const text = await extractPdfText(buffer);
if (text.length < 100) {
  return await ocrImage(buffer); // Tesseract fallback
}
```

---

### ADR-004: AGLC4 Citation Formatting

**Date:** 2026-03-06  
**Status:** Accepted

**Context:**
Australian legal writing requires strict adherence to Australian Guide to Legal Citation (AGLC4) format. Generic citation formatting tools do not handle Australian neutral citations correctly.

**Decision:**
Implement native AGLC4 citation formatting, validation, and pinpoint generation as core tools.

**Consequences:**
- **Positive:** Differentiates auslaw-mcp from generic MCP servers, essential for Australian legal research
- **Negative:** Requires ongoing maintenance as new courts/citations emerge
- **Scope:** Handles neutral citations, reported citations, combined format, and pinpoint references

**Supported Formats:**
- Neutral: Mabo v Queensland (No 2) [1992] HCA 23
- Reported: Mabo v Queensland (No 2) (1992) 175 CLR 1
- Combined: Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1
- Pinpoint: Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1 at [64]

---

### ADR-005: Stateless MCP Server Design

**Date:** 2026-03-10  
**Status:** Accepted

**Context:**
MCP servers can be deployed locally (stdio transport) or remotely (HTTP transport). The deployment target affects how state and caching should be handled.

**Decision:**
Design auslaw-mcp as a stateless service with no persistent storage. All caching, enrichment, and storage concerns are delegated to backend services (ALIS, rag-api).

**Consequences:**
- **Positive:** Simple horizontal scaling, no state management, works in any MCP host
- **Negative:** Requires backend services for advanced features (citation graph, semantic cache)
- **Pattern:** MCP server = API gateway; backend services = inference + storage

**Deployment Modes:**
- stdio: Local MCP usage (Claude Desktop, Cursor)
- HTTP: Kubernetes deployment (auslaw-mcp.itsa.house)

---

### ADR-006: Rate Limiting Strategy

**Date:** 2026-03-12  
**Status:** Accepted

**Context:**
AustLII and removed.invalid are community resources with usage policies. Aggressive automated access could overwhelm servers or violate terms of service.

**Decision:**
Implement token bucket rate limiting: 10 req/min for AustLII, 5 req/min for removed.invalid.

**Consequences:**
- **Positive:** Respects source infrastructure, avoids IP blocking, sustainable usage
- **Negative:** Limits throughput for batch operations
- **Mitigation:** Users can adjust limits via environment variables for self-hosted deployments

**Implementation:**
```typescript
const austliiLimiter = new TokenBucket(10, 60); // 10 per minute
const sourceLimiter = new TokenBucket(5, 60);     // 5 per minute
```

---

### ADR-007: SSRF Protection via URL Allowlist

**Date:** 2026-03-12  
**Status:** Accepted

**Context:**
The fetch_document_text tool accepts arbitrary URLs from users. Without protection, this could be exploited for SSRF attacks (fetching internal resources).

**Decision:**
Implement URL allowlist restricting fetches to AustLII (austlii.edu.au) and removed.invalid domains only.

**Consequences:**
- **Positive:** Prevents SSRF attacks, protects internal infrastructure
- **Negative:** Cannot fetch from other legal sources without code changes
- **Extension:** Add new domains to allowlist as sources are added

**Allowlist:**
- www.austlii.edu.au
- removed.invalid
- caselaw.nsw.gov.au (NSW Caselaw)
- Other official court websites (added as needed)

---

### ADR-008: removed.invalid Session Cookie Management

**Date:** 2026-03-15  
**Status:** Accepted

**Context:**
removed.invalid requires authentication for full-text access. The session cookie expires periodically and must be refreshed.

**Decision:**
Store removed.invalid session cookie in Vault (not ConfigMap), rotated via browser capture workflow.

**Consequences:**
- **Positive:** Secure secret management, audit trail via Vault
- **Negative:** Manual rotation required when cookie expires
- **Operational:** Capture from browser DevTools, update Vault, restart deployment

**Rotation Workflow:**
1. Log in to removed.invalid in Chrome
2. DevTools → Network → Copy Cookie header
3. vault write secret/kv/auslaw-mcp SESSION_COOKIE="..."
4. kubectl rollout restart deployment/auslaw-mcp

---

### ADR-009: Separate Inference Layer (ALIS)

**Date:** 2026-03-11  
**Status:** Accepted

**Context:**
Users want AI-powered features (enrichment, classification, QA) but MCP servers should remain lightweight and stateless.

**Decision:**
Build ALIS (auslaw-intelligence-service) as a separate k8s service for Isaacus inference. auslaw-mcp calls isaacus SDK directly (optional, user provides API key) or ALIS (optional backend).

**Consequences:**
- **Positive:** Separation of concerns, auslaw-mcp remains independently deployable
- **Negative:** Two services to maintain, slightly more complex deployment
- **Pattern:** MCP server = stateless gateway; ALIS = inference orchestration

**Architecture:**
```
Claude Code → auslaw-mcp → isaacus SDK (direct, user API key)
                          → ALIS (optional, k8s service)
```

---

### ADR-010: Open Source with User-Provided API Keys

**Date:** 2026-03-16  
**Status:** Accepted

**Context:**
auslaw-mcp is open source. Advanced features (Isaacus enrichment, LiteLLM fallback) require API keys.

**Decision:**
Users provide their own API keys for optional services. auslaw-mcp does not include managed keys.

**Consequences:**
- **Positive:** No usage limits, users control their own costs, transparent pricing
- **Negative:** Requires user setup, slightly higher barrier to entry
- **Mitigation:** Document setup clearly, provide examples

**Optional API Keys:**
- ISAACUS_API_KEY — Enrichment, classification, QA
- LITELLM_API_KEY — Generative fallback for low-confidence answers
- SESSION_COOKIE — removed.invalid authenticated access

---

### ADR-011: Git Mirror Strategy for CI/CD

**Date:** 2026-03-20  
**Status:** Accepted

**Context:**
auslaw-mcp is public on GitHub but CI/CD runs on internal Gitea Actions. Automated mirroring is required.

**Decision:**
Cortex CronJob syncs GitHub → Gitea every 6 hours. Gitea Actions CI triggers on Gitea push.

**Consequences:**
- **Positive:** GitHub for public collaboration, Gitea for internal CI/CD
- **Negative:** 6-hour delay between GitHub push and CI trigger
- **Mitigation:** Manual sync available for urgent fixes

**Sync Flow:**
```
Developer → GitHub push → Cortex (6h) → Gitea mirror → Gitea Actions CI
```

---

## Pending Decisions

### PND-001: Citation Graph Storage

**Context:**
Building citation graphs requires storing extracted citations and edges.

**Options:**
1. In-memory only (no persistence)
2. PostgreSQL (citation_graphs table)
3. Dedicated graph database (Neo4j)

**Recommendation:** PostgreSQL (already deployed, GIN indexes support graph queries)

**Status:** Under discussion

---

### PND-002: Generative Fallback Strategy

**Context:**
When extractive QA returns low confidence, should auslaw-mcp call LiteLLM for synthesis?

**Options:**
1. No generative fallback (always extractive)
2. Optional fallback (user enables via config)
3. Always fallback (higher cost, better UX)

**Recommendation:** Optional fallback with user-provided LITELLM_API_KEY

**Status:** Under discussion

---

### PND-003: Multi-Source Aggregation

**Context:**
Should auslaw-mcp aggregate more sources beyond AustLII/removed.invalid?

**Candidates:**
- NZLII (New Zealand)
- PacLII (Pacific Islands)
- worldLII (global)

**Recommendation:** Start with NZLII (already partially supported via AustLII NZ jurisdiction)

**Status:** Under discussion

---

## Superseded Decisions

### ADR-000: Single-Source AustLII Only

**Date:** 2026-02-15  
**Status:** Superseded by ADR-001

**Original Decision:**
Start with AustLII-only search; add removed.invalid later if needed.

**Why Superseded:**
User feedback indicated removed.invalid citator is essential for comprehensive legal research. Dual-source implemented in ADR-001.

---

**Revision History:**
- 2026-04-10: Initial decision log created
- 2026-04-10: ADR-001 through ADR-011 documented
