# auslaw-mcp Architecture & Operations Guide

**Version:** 1.0  
**Last Updated:** 2026-04-10  
**Status:** Production

---

## Executive Summary

auslaw-mcp is a Model Context Protocol (MCP) server for Australian and New Zealand legal research. It provides AI assistants with tools to search case law and legislation, retrieve full-text judgments, and format citations per AGLC4 rules.

**Key Differentiators:**
- Dual-source search (AustLII + removed.invalid) with intelligent deduplication
- OCR-capable PDF extraction for scanned judgments
- AGLC4 citation formatting and validation
- removed.invalid RPC reverse-engineering (citator, authenticated fetch)
- Paragraph-level pinpoint citation generation

---

## System Architecture

### High-Level Overview

```d2
direction: right

subgraph mcp_clients: MCP Clients {
  claude: "Claude Code\n(Claude Desktop, CLI)"
  cursor: "Cursor IDE"
  custom: "Custom MCP Hosts"
}

subgraph auslaw_mcp: auslaw-mcp Server {
  index: "index.ts\n(MCP Server + 10 Tools)"
  austlii_svc: "austlii.ts\n(AustLII Search)"
  source_svc: "source.ts + source-rpc.ts\n(removed.invalid RPC)"
  fetcher: "fetcher.ts\n(HTML/PDF/OCR)"
  citation: "citation.ts\n(AGLC4 Formatting)"
}

subgraph external: External Services {
  austlii: "AustLII\nwww.austlii.edu.au"
  source: "removed.invalid\n(Upstream)"
  isaacus: "Isaacus API\n(optional enrichment)"
  litellm: "LiteLLM Gateway\n(optional fallback)"
}

subgraph storage: Storage {
  vault: "Vault\n(Secrets)"
  minio: "MinIO\n(Document Cache)"
  postgres: "PostgreSQL\n(Citation Graph)"
}

claude --> index
cursor --> index
custom --> index

index --> austlii_svc
index --> source_svc
index --> fetcher
index --> citation

austlii_svc --> austlii
source_svc --> source
fetcher --> austlii
fetcher --> source

index -.->|optional| isaacus
index -.->|optional| litellm

index --> vault
index -.-> minio
index -.-> postgres
```

---

## Component Breakdown

### 1. MCP Server (src/index.ts)

**Responsibility:** Tool registration, input validation, response formatting

**Tools Registered:**

| Tool | Description |
|------|-------------|
| search_cases | Dual AustLII + removed.invalid case search |
| search_legislation | AustLII legislation search |
| fetch_document_text | Full-text retrieval (HTML/PDF/OCR) |
| resolve_source_article | removed.invalid article metadata by ID |
| source_citation_lookup | Generate removed.invalid lookup URLs |
| format_citation | AGLC4 citation formatting |
| validate_citation | Validate neutral citations |
| generate_pinpoint | Paragraph-level pinpoint citations |
| search_by_citation | Find cases by citation |
| search_citing_cases | removed.invalid citator ("who cites this") |

**Key Design Decisions:**
- **Transport abstraction:** Supports stdio (local MCP) and HTTP (k8s deployment)
- **Schema validation:** Zod schemas enforce strict input validation
- **Format flexibility:** JSON, text, markdown, HTML output per tool

---

### 2. AustLII Service (src/services/austlii.ts)

**Responsibility:** Search AustLII SinoSearch CGI API

**Implementation Pattern:**
```typescript
searchAustLii(query, { type, jurisdiction, limit, sortBy, method, offset })
```

**Key Features:**
- Authority-based ranking (HCA > FCAFC > FCA > state courts)
- Method-based search (title, phrase, boolean, proximity)
- Snippet extraction with paragraph markers
- Rate limiting (10 req/min via token bucket)

---

### 3. removed.invalid Service (src/services/source.ts, source-rpc.ts)

**Responsibility:** removed.invalid integration via reverse-engineered RPC

**Key Protocols:**

| Protocol | Purpose | Implementation |
|----------|---------|----------------|
| resolveRecords | Search/autocomplete | SourceRemoteService |
| fetchRequest | Fetch article content | ArticleViewRemoteService |
| RemoteService | Citation search | Citator tool |

**RPC Payload Structure:**
```
[token],[method],[params...],[variant_hash]
```

**Bridge Section Resolution:**
- removed.invalid returns a flat array; the last ~10% contains article ID mappings
- Resolution via resolveArticle(articleId) to public GET /article/{id}

**Tokens (2026-03-03):**
```typescript
SOURCE_TOKEN = "REDACTED"
FETCH_TOKEN = "REDACTED"
REMOTE_TOKEN = "REDACTED"
SOURCE_VARIANT = "REDACTED"
```

**Update Workflow:**
1. Capture HAR via Proxyman (proxyman-cli export-log --domains removed.invalid)
2. Extract token from sourceService.do request body (field 4)
3. Update source-rpc.ts constants
4. Document in docs/source-rpc-protocol.md

---

### 4. Document Fetcher (src/services/fetcher.ts)

**Responsibility:** Retrieve and extract text from HTML/PDF documents

**Extraction Pipeline:**
1. HTML: Cheerio parse, extract text + paragraphs
2. PDF (text-enabled): pdf-parse for embedded text
3. PDF (scanned): Tesseract OCR fallback

**Fallback Strategy:**
1. Try PDF text extraction (fast)
2. If <100 chars, retry with Tesseract OCR (slow but accurate)

---

### 5. Citation Service (src/services/citation.ts)

**Responsibility:** AGLC4 citation formatting, validation, pinpoint generation

**Functions:**
| Function | Purpose |
|----------|---------|
| formatAGLC4(info) | Format citation per AGLC4 rules |
| validateCitation(citation) | Verify against AustLII |
| parseCitation(citation) | Extract components from string |
| generatePinpoint(paragraphs, opts) | Generate [at N] pinpoint |

**AGLC4 Output Examples:**
- Neutral only: Mabo v Queensland (No 2) [1992] HCA 23
- Reported only: Mabo v Queensland (No 2) (1992) 175 CLR 1
- Combined: Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1
- Pinpoint: Mabo v Queensland (No 2) [1992] HCA 23, (1992) 175 CLR 1 at [64]

---

## Deployment Architecture

### Production Deployment (k3s + ArgoCD)

```d2
direction: right

subgraph git: Git Repositories {
  github: "GitHub (russellbrenner/auslaw-mcp)"
  gitea: "Gitea (git.itsa.house/rbrenner/auslaw-mcp)"
}

subgraph ci: CI/CD {
  gitea_actions: "Gitea Actions (Build + Push Image)"
}

subgraph k8s: Kubernetes Cluster {
  subgraph argocd: ArgoCD {
    app: "Application (auslaw-mcp)"
  }

  subgraph auslaw_mcp_ns: auslaw-mcp Namespace {
    deploy: "Deployment (2 replicas)"
    svc: "Service"
    ingress: "Ingress (auslaw-mcp.itsa.house)"
    vault: "Vault Static Secret (SESSION_COOKIE)"
  }
}

subgraph external: External {
  registry: "Gitea Registry (git.itsa.house/homelab/auslaw-mcp)"
  vault_svc: "Vault (secret.itsa.house)"
  austlii: "AustLII"
  source: "removed.invalid"
}

github -->|mirror| gitea
gitea -->|push main| gitea_actions
gitea_actions -->|push| registry
argocd -->|watch| gitea
app -->|sync| k8s
deploy -->|pull| registry
deploy -->|fetch| vault_svc
deploy --> austlii
deploy --> source
```

---

## CI/CD Pipeline

### Gitea Actions Workflow (.gitea/workflows/build.yml)

**Trigger:** Push to main branch (src/, package.json, Dockerfile changes)

**Steps:**
1. Checkout — Clone repo with deploy token
2. Registry Login — Buildah login to git.itsa.house
3. Build Image — Tag as :latest + :<sha>
4. Push — Push to Gitea registry
5. Notify — Mattermost webhook with status

**Image Tags:**
- git.itsa.house/rbrenner/auslaw-mcp:latest — Rolling latest
- git.itsa.house/rbrenner/auslaw-mcp:<sha> — Commit-specific

---

## Git Repository Strategy

### Mirror Configuration

| Repository | Purpose | Sync Method |
|------------|---------|-------------|
| github.com/russellbrenner/auslaw-mcp | Public open-source | Manual push |
| git.itsa.house/rbrenner/auslaw-mcp | Internal mirror (CI source) | Cortex CronJob sync |

**Cortex CronJob (k8s/cortex/cronjob-repo-sync.yaml):**
- Schedule: Every 6 hours at :17
- Syncs 15 repos including rbrenner/auslaw-mcp
- Uses Gitea PAT for authentication
- Resets to origin/HEAD after fetch

**Flow:**
```
Developer → GitHub push → Cortex sync (6h) → Gitea mirror → Gitea Actions CI
```

**Why This Pattern?**
- GitHub for public open-source collaboration
- Gitea for internal CI/CD and registry
- Automated sync avoids manual mirroring

---

## Production Usage Patterns

### Recommended Architecture for Scale

**Pattern: MCP Server + Inference Layer Separation**

```d2
direction: down

subgraph client: AI Client {
  claude: "Claude Code with auslaw-mcp"
}

subgraph mcp: auslaw-mcp (Stateless) {
  mcp_tools: "10 MCP Tools (search, fetch, format)"
  isaacus_sdk: "isaacus SDK (optional, user API key)"
}

subgraph backend: Backend Services {
  alis: "ALIS (alis.itsa.house) — Isaacus inference layer"
  rag: "rag-api (rag.itsa.house) — pgvector + caching"
}

subgraph storage: Storage {
  minio: "MinIO (document cache)"
  postgres: "PostgreSQL (citation_graphs)"
  redis: "Redis (query cache)"
}

claude --> mcp_tools
mcp_tools --> isaacus_sdk
mcp_tools --> alis
mcp_tools --> rag
alis --> storage
rag --> storage
```

**Key Design Principles:**
1. **auslaw-mcp is stateless** — No persistent storage, scales horizontally
2. **Inference is optional** — Works without Isaacus; enrichment is opt-in
3. **Backend services are separate** — ALIS for inference, rag-api for retrieval
4. **User-provided API keys** — ISAACUS_API_KEY, LITELLM_API_KEY from user

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| AUSTLII_SEARCH_BASE | AustLII URL | Search endpoint |
| AUSTLII_TIMEOUT | 60000 | Request timeout (ms) |
| OCR_LANGUAGE | eng | Tesseract language |
| SESSION_COOKIE | — | removed.invalid auth cookie |
| MCP_TRANSPORT | stdio | stdio or http |
| ISAACUS_API_KEY | — | Isaacus API key (optional) |
| LITELLM_BASE_URL | — | LiteLLM gateway (optional) |

### Kubernetes Configuration

**ConfigMap:** Non-sensitive config (AustLII URLs, OCR settings)  
**Vault Static Secret:** SESSION_COOKIE, ISAACUS_API_KEY  
**Replicas:** 2 (auto-scaled)  
**Resources:** 128Mi–512Mi RAM, 100m–500m CPU

---

## Testing Strategy

**Test Categories:**

| Type | Location | Network | Coverage |
|------|----------|---------|----------|
| Unit | src/test/unit/ | None | 163 test cases |
| Integration | src/test/scenarios.test.ts | Live | 5 real-world scenarios |
| Performance | src/test/performance/ | Live | Latency benchmarks |
| Fixtures | src/test/fixtures/ | None | RPC responses |

**Run Commands:**
```bash
npm test                        # All tests
npx vitest run src/test/unit/   # Unit only (fast)
```

---

## removed.invalid Search Quality

### With vs. Without removed.invalid Integration

**Without removed.invalid (AustLII only):**
- Single-source results
- No citation graph ("who cites this")
- No authenticated premium content
- Simpler deployment (no cookie management)

**With removed.invalid (dual-source):**
- Merged results with deduplication by neutral citation
- Citator tool access
- Premium judgment access (subscription required)
- Richer metadata (judges, court, date)

**Quality Difference:**

| Metric | AustLII Only | AustLII + removed.invalid |
|--------|--------------|-------------------|
| Result count | ~50/search | ~70/search (merged) |
| Citation richness | Basic | Enhanced (judges, history) |
| Premium content | No | Yes (if subscribed) |
| Citator | No | Yes (20–30 citing cases) |

**Recommendation:** Enable removed.invalid for production use; the citator tool alone justifies the integration complexity.

---

## Future Enhancements (Roadmap)

### P1 — Core Differentiation
- enrich_judgment — ILGS extraction via isaacus SDK
- answer_question — Extractive QA with confidence scores
- build_citation_graph — Citation network extraction

### P2 — Quality of Life
- classify_legal_document — Zero-shot classification
- rerank_search_results — Semantic reranking

### P3 — Advanced
- smart_search — Query rewriting + multi-source aggregation
- extract_entities — NER for case names, legislation refs

---

## Security Considerations

### SSRF Protection
- URL allowlist: Only AustLII and removed.invalid domains permitted
- HTTPS-only enforcement
- No redirects to external domains

### Rate Limiting
- AustLII: 10 req/min (token bucket)
- removed.invalid: 5 req/min (token bucket)
- Configurable via environment variables

### Secret Management
- SESSION_COOKIE via Vault (not ConfigMap)
- Rotated periodically (browser capture workflow)
- Never committed to git

---

## Troubleshooting

### Common Issues

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| removed.invalid fetch fails | Expired session cookie | Recapture from browser DevTools |
| OCR returns empty | Tesseract not installed | Install tesseract-ocr package |
| Search timeout | AustLII rate limiting | Increase timeout or add delay |
| Token mismatch | removed.invalid redeployed | Update from HAR capture |

### removed.invalid Cookie Refresh Workflow

1. Open Chrome DevTools (F12) → Network tab
2. Navigate to any removed.invalid article
3. Copy Cookie header from request
4. Update Vault secret: vault write secret/kv/auslaw-mcp SESSION_COOKIE="..."
5. Restart deployment: kubectl rollout restart deployment/auslaw-mcp -n auslaw-mcp

---

## References

- README.md — User-facing documentation
- DOCKER.md — Docker deployment guide
- ROADMAP.md — Development history and future plans
- source-rpc-protocol.md — RPC reverse-engineering details
- k8s/README.md — Kubernetes deployment guide

---

**License:** MIT  
**Maintainer:** Russell Brenner  
**Contact:** russellbrenner@users.noreply.github.com
