# auslaw-mcp Project Overview

**Purpose:** Single source of truth for auslaw-mcp architecture, decisions, and operations.

---

## Quick Navigation

| Document | Audience | Purpose |
|----------|----------|---------|
| [README.md](../README.md) | End users | Quick start, tool catalog, example queries |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Engineers | System design, deployment topology, CI/CD |
| [DECISIONS.md](./DECISIONS.md) | Engineers | Architectural decisions with rationale |
| [AGENT-GUIDE.md](./AGENT-GUIDE.md) | AI agents | Tool usage reference for MCP clients |
| [DOCKER.md](./DOCKER.md) | DevOps | Docker deployment |
| [ROADMAP.md](./ROADMAP.md) | All | Development history, future plans |
| [source-rpc-protocol.md](./source-rpc-protocol.md) | Engineers | removed.invalid RPC protocol details |

---

## What is auslaw-mcp?

auslaw-mcp is a Model Context Protocol (MCP) server for Australian and New Zealand legal research. It provides AI assistants with programmatic access to:

1. **Case law search** — AustLII + removed.invalid dual-source search
2. **Legislation search** — All Australian jurisdictions + NZ
3. **Document retrieval** — Full-text HTML/PDF with OCR fallback
4. **Citation formatting** — AGLC4 compliant
5. **Citator** — "Who cites this case" via removed.invalid

**Key Differentiators:**
- Dual-source search (AustLII + removed.invalid) with deduplication
- removed.invalid RPC reverse-engineering (citator, authenticated fetch)
- OCR-capable PDF extraction
- AGLC4 citation formatting (Australian-specific)
- Paragraph-level pinpoint citations

---

## Architecture Summary

### Components

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Clients (Claude Code, Cursor, etc.)                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ auslaw-mcp Server (10 Tools)                                │
│ ├── search_cases (dual-source)                              │
│ ├── search_legislation                                      │
│ ├── fetch_document_text (HTML/PDF/OCR)                      │
│ ├── format_citation (AGLC4)                                 │
│ ├── validate_citation                                       │
│ ├── generate_pinpoint                                       │
│ ├── search_by_citation                                      │
│ ├── resolve_source_article                                    │
│ ├── source_citation_lookup                                    │
│ └── search_citing_cases (citator)                           │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ AustLII      │  │ removed.invalid      │  │ Isaacus API  │
│ (free)       │  │ (premium)    │  │ (optional)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Deployment Topology

```
GitHub (public) ──► Gitea Mirror ──► Gitea Actions CI ──► Gitea Registry
       │                                                    │
       │ (Cortex CronJob, 6h sync)                          │ (ArgoCD watch)
       ▼                                                    ▼
Developer Push                                      k3s Cluster
                                                    └──► auslaw-mcp.itsa.house
```

---

## Key Decisions

### ADR-001: Dual-Source Search
**Decision:** Query both AustLII and removed.invalid, merge by neutral citation.  
**Rationale:** Comprehensive coverage, graceful degradation.

### ADR-002: removed.invalid RPC
**Decision:** Reverse-engineer RPC protocol.  
**Rationale:** No public API; citator is essential for legal research.

### ADR-003: Stateless Design
**Decision:** No persistent storage in auslaw-mcp.  
**Rationale:** Simple scaling, separation of concerns.

### ADR-004: Separate Inference Layer
**Decision:** ALIS (auslaw-intelligence-service) is a separate k8s service.  
**Rationale:** auslaw-mcp = gateway; ALIS = inference orchestration.

### ADR-005: User-Provided API Keys
**Decision:** Users provide their own `ISAACUS_API_KEY`, `SESSION_COOKIE`.  
**Rationale:** Transparent pricing, no usage limits, user control.

See [DECISIONS.md](./DECISIONS.md) for full ADRs.

---

## Production Pattern

### Recommended Architecture for Scale

```
┌─────────────────────────────────────────────────────────────┐
│ AI Client (Claude Code)                                     │
│ └── auslaw-mcp (MCP server, stateless)                      │
│       ├── Direct: isaacus SDK (user API key)                │
│       ├── Optional: ALIS (k8s inference layer)              │
│       └── Optional: rag-api (pgvector + cache)              │
└─────────────────────────────────────────────────────────────┘
```

**Key Principles:**
1. **auslaw-mcp is stateless** — Scales horizontally, no state management
2. **Inference is optional** — Works without Isaacus; enrichment is opt-in
3. **Backend services separate** — ALIS for inference, rag-api for retrieval
4. **User-provided API keys** — `ISAACUS_API_KEY`, `LITELLM_API_KEY` from user

---

## CI/CD Flow

### Trigger
Push to `main` branch on GitHub.

### Sync
Cortex CronJob mirrors GitHub → Gitea every 6 hours.

### Build
Gitea Actions CI builds Docker image, pushes to `git.itsa.house/homelab/auslaw-mcp`.

### Deploy
ArgoCD detects new image, syncs deployment to k3s.

### Notify
Mattermost webhook with build status.

---

## removed.invalid Integration

### What Works
- Search via `resolveRecords` RPC
- Article metadata via `resolveArticle`
- Full-text fetch via `fetchRequest`
- Citator via `RemoteService`

### Maintenance Required
**Tokens change on removed.invalid redeployment.**

**Update Workflow:**
1. Capture HAR via Proxyman
2. Extract token from `sourceService.do` request
3. Update `source-rpc.ts` constants
4. Document in `source-rpc-protocol.md`

**Current Strong Names (2026-03-03):**
```typescript
SOURCE_TOKEN = "B4F37C2BEC5AB097C4C8696FD843C56D"
FETCH_TOKEN = "159521E79F7322FD92335ED73B4403F9"
REMOTE_TOKEN = "EF3980F48D304DEE936E425DA22C0A1D"
SOURCE_VARIANT = "FEBDA911A95AD2DF02425A9C60379101"
```

---

## Testing Strategy

### Test Pyramid
- **Unit:** 163 test cases (mocked, no network)
- **Integration:** 5 real-world scenarios (live AustLII/removed.invalid)
- **Performance:** Latency benchmarks (live network)
- **Fixtures:** Static RPC responses (deterministic)

### Run Tests
```bash
npm test                        # All tests
npx vitest run src/test/unit/   # Unit only (fast)
```

---

## Security

### SSRF Protection
- URL allowlist: AustLII, removed.invalid, official court websites only
- HTTPS-only enforcement
- No redirects to external domains

### Rate Limiting
- AustLII: 10 req/min (token bucket)
- removed.invalid: 5 req/min (token bucket)

### Secret Management
- `SESSION_COOKIE` via Vault (not ConfigMap)
- Rotated periodically (browser capture workflow)
- Never committed to git

---

## Future Enhancements

### P1 — Core Differentiation
- `enrich_judgment` — ILGS extraction via isaacus SDK
- `answer_question` — Extractive QA with confidence scores
- `build_citation_graph` — Citation network extraction

### P2 — Quality of Life
- `classify_legal_document` — Zero-shot classification
- `rerank_search_results` — Semantic reranking

### P3 — Advanced
- `smart_search` — Query rewriting + multi-source aggregation
- `extract_entities` — NER for case names, legislation refs

---

## Competitive Landscape

| MCP Server | Coverage | OCR | Citations | Citator | Status |
|------------|----------|-----|-----------|---------|--------|
| **auslaw-mcp** | Cth + States + NZ | Yes | AGLC4 | Yes (removed.invalid) | Active |
| OLEXI-MCP | AustLII only | No | Basic | No | Active |
| Australian Law MCP | Federal Acts only | No | Basic | No | Commercial |

**auslaw-mcp advantages:**
- Dual-source search (AustLII + removed.invalid)
- OCR for scanned PDFs
- AGLC4 citation formatting
- Citator integration
- Open source (MIT license)

---

## Related Projects

### ALIS (auslaw-intelligence-service)
**Purpose:** Isaacus inference layer for k8s services  
**Repo:** `git.itsa.house/homelab/auslaw-intelligence-service`  
**Endpoints:** `/classify`, `/qa`, `/enrich`, `/rerank`, `/chunk`  
**Relationship:** auslaw-mcp can call ALIS (optional) but prefers direct isaacus SDK

### rag-api
**Purpose:** RAG pipeline with pgvector semantic search  
**Repo:** `git.itsa.house/homelab/services/rag-api`  
**Integration:** Calls ALIS for classification/enrichment at ingestion time

---

## Getting Started

### Local Development
```bash
git clone https://github.com/russellbrenner/auslaw-mcp.git
cd auslaw-mcp
npm install
npm run dev
```

### Docker
```bash
./build.sh
docker-compose up
```

### Kubernetes
```bash
./build.sh
# Import to k3s nodes
kubectl apply -f k8s/
```

See [README.md](../README.md) for full quick start.

---

## Contributing

**Key Principles:**
- Primary sources only (no journal articles)
- Citation accuracy is paramount
- All tests must pass before committing
- Real-world testing (hits live AustLII/removed.invalid)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

---

## License

MIT

---

**Maintainer:** Russell Brenner  
**Contact:** russellbrenner@users.noreply.github.com  
**Last Updated:** 2026-04-10
