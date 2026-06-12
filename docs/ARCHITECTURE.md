# jurisd Architecture Guide

**Version:** 1.0  
**Last Updated:** 2026-04-10

---

## Executive Summary

jurisd is a Model Context Protocol (MCP) server for Australian and New Zealand legal research.

**Key Features:**

- Dual-source search (AustLII + removed.invalid)
- OCR-capable PDF extraction
- AGLC4 citation formatting
- removed.invalid citator integration

---

## System Architecture

```
┌─────────────────────────────────────────┐
│ MCP Clients (Claude Code, Cursor, etc.) │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ jurisd Server (10 Tools)            │
│ ┌─────────────────────────────────────┐ │
│ │ search_cases, search_legislation    │ │
│ │ fetch_document_text, format_citation│ │
│ │ validate_citation, generate_pinpoint│ │
│ │ search_by_citation, search_citing_  │ │
│ │ resolve_source_article, source_citation_│ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
        │           │           │
        ▼           ▼           ▼
   ┌────────┐  ┌────────┐  ┌──────────┐
   │AustLII │  │ removed.invalid│  │Isaacus   │
   │(free)  │  │(premium)│  │(optional)│
   └────────┘  └────────┘  └──────────┘
```

---

## Components

### 1. MCP Server

**Tools:**
| Tool | Description |
|------|-------------|
| search_cases | Dual AustLII + removed.invalid case search |
| search_legislation | AustLII legislation search |
| fetch_document_text | Full-text retrieval (HTML/PDF/OCR) |
| format_citation | AGLC4 citation formatting |
| validate_citation | Validate neutral citations |
| generate_pinpoint | Paragraph-level pinpoint citations |
| search_by_citation | Find cases by citation |
| resolve_source_article | removed.invalid article metadata by ID |
| source_citation_lookup | Generate removed.invalid lookup URLs |
| search_citing_cases | removed.invalid citator |

### 2. AustLII Service

- Searches AustLII SinoSearch CGI API
- Authority-based ranking (HCA > FCAFC > FCA > state courts)
- Rate limiting: 10 req/min

### 3. removed.invalid Service

- RPC reverse-engineering
- Protocols: resolveRecords (search), fetchRequest (fetch), RemoteService (citator)
- Rate limiting: 5 req/min

### 4. Document Fetcher

- HTML: Cheerio parse
- PDF: pdf-parse + Tesseract OCR fallback
- Extracts paragraphs for pinpoint citations

### 5. Citation Service

- AGLC4 formatting
- Validates against AustLII
- Generates pinpoint citations

---

## Deployment

### Local Development

```bash
git clone https://github.com/russellbrenner/jurisd.git
cd jurisd
npm install
npm run dev
```

### Docker

```bash
docker build -t jurisd .
docker run --rm -it jurisd
```

### HTTP Transport

For remote deployment, set `MCP_TRANSPORT=http`:

```bash
MCP_TRANSPORT=http npm start
# Listens on port 3000
```

---

## Configuration

| Variable            | Default     | Description                |
| ------------------- | ----------- | -------------------------- |
| AUSTLII_SEARCH_BASE | AustLII URL | Search endpoint            |
| AUSTLII_TIMEOUT     | 60000       | Request timeout (ms)       |
| OCR_LANGUAGE        | eng         | Tesseract language         |
| SESSION_COOKIE | —           | removed.invalid auth cookie        |
| MCP_TRANSPORT       | stdio       | stdio or http              |
| ISAACUS_API_KEY     | —           | Isaacus API key (optional) |

---

## Testing

```bash
npm test                        # All tests
npx vitest run src/test/unit/   # Unit only (fast, no network)
```

---

## Security

- **SSRF Protection:** URL allowlist (AustLII, removed.invalid only)
- **Rate Limiting:** Token bucket per source
- **Secrets:** Never commit cookies or API keys

---

## See Also

- [README.md](../README.md) — Quick start, tool catalog
- [AGENT-GUIDE.md](./AGENT-GUIDE.md) — Agent usage guide
- [DOCKER.md](./DOCKER.md) — Docker deployment
- [ROADMAP.md](./ROADMAP.md) — Development history
- [source-rpc-protocol.md](./source-rpc-protocol.md) — RPC details

---

**License:** MIT
