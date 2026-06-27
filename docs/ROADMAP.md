# Feature Development Roadmap

## Current State Analysis

### What Works Well

- Fetches case law and legislation from AustLII
- Filters out journal articles (primary sources only)
- Extracts neutral citations and jurisdictions
- Preserves paragraph numbers in `[N]` format
- Handles HTML and digital-text PDF documents
- Offline local-data-module recall: provision lookup, Act structure, citation graph, semantic search

### Current Limitations

#### 1. **Search Quality**

- **Problem**: A bare case-name query (e.g. "Donoghue v Stevenson") can return recent cases that merely cite it rather than the case itself.
- **Root cause**: Date-first sorting prioritises recent cases over relevance.
- **Mitigation**: Smart query detection switches case-name queries to relevance sorting (delivered, Phase 1 below).

#### 2. **Single Live Source**

- **Current**: Live search is AustLII only.
- **Impact**: Reported (page-numbered) versions of judgments are not always available from the live layer; the offline data modules and OALC fallback fill structural and full-text gaps where coverage exists.

#### 3. **Paragraph vs Page Numbers**

- **Current**: `[N]` paragraph markers are preserved from AustLII HTML.
- **Issue**: Page numbers from reported judgments are not present in AustLII's unreported text.
- **Impact**: Pinpoints are paragraph-based; reported-page pinpoints require the reported version.

## Implementation Status

### Phase 1: Search Relevance (COMPLETED)

- Smart query detection: case names ("X v Y", "Re X", citations) vs topic searches
- `sortBy` parameter: `auto` (default), `relevance`, `date`
- Title-match boost: prioritises exact case-name matches
- Auto mode: case-name queries → relevance; topic queries → date

### Phase 2: Reported Citation Extraction (COMPLETED)

- Reported-citation extraction from AustLII results (CLR, ALR, ALJR, etc.)
- `reportedCitation` field on `SearchResult`

### Phase 3: Paragraph Block Extraction and Pinpoint Citations (COMPLETED)

- `ParagraphBlock` interface (`number`, `text`, optional `pageNumber`)
- `paragraphs` field on `FetchResponse`, populated from `[N]` markers in AustLII HTML
- Pinpoint generation: locate a paragraph by number or phrase, return `at [N]`

### Phase 4: Authority-Based Result Ranking (COMPLETED)

- `calculateAuthorityScore()` with court-hierarchy scoring (HCA > FCAFC > FCA > state SC, etc.)
- Reported-citation bonus
- Secondary sort by authority score on case-name queries

### Phase 5: AGLC4 Citation Service (COMPLETED)

- `parseCitation()`, `formatAGLC4()`, `validateCitation()` (HEAD-check against AustLII), pinpoint generation
- `REPORTERS` registry and `COURT_TO_AUSTLII_PATH` map in constants

### Phase 6: Security Hardening (COMPLETED)

- `assertFetchableUrl()` — SSRF protection: HTTPS-only, AustLII host allowlist
- Token-bucket rate limiter: 10 req/min for AustLII
- All hardcoded constants sourced from `config.ts`

### Phase 7: Local Data Modules (COMPLETED)

- Layer-1 offline recall over installed parquet data modules (DuckDB over parquet, metadata-only in RSS)
- Tools: `get_provision`, `get_act_structure`, `find_citing`, `semantic_search_local`, `list_data_modules`
- Local query embedding (bge-small, offline, no key) via optional `@huggingface/transformers`
- Operator-driven module install (`jurisd fetch-module`) with manifest validation + sha256 verification

## Future Work

- Related-case and related-legislation suggestions from the local citation graph
- Additional data-module coverage as the `jurisd-data` publishing repo lands its first releases

## Testing Requirements

Each phase includes:

1. **Unit tests** for new parsing/ranking logic
2. **Integration tests** with real judgments (live AustLII)
3. **Performance tests** to keep search responsive

## Success Metrics

1. **Search accuracy**: a case-name query returns the named case, not later cases citing it
2. **Pinpoint accuracy**: paragraph pinpoints like `[2025] HCA 26 at [42]`
3. **Offline floor**: local-module recall answers with no key and no network
