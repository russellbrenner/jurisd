# AI Agent Instructions for AusLaw MCP

This document provides guidance for AI agents (Claude Code, Cursor, etc.) working on this project.

## Project Overview

**AusLaw MCP** is a Model Context Protocol (MCP) server that searches Australian legal databases (AustLII, removed.invalid) and retrieves full-text judgements with citation support. It's designed for legal research workflows requiring primary source authorities.

**Primary users**: Legal researchers, law students, lawyers conducting case research
**Key requirement**: Always return the most authoritative, relevant version of legal materials

## Architecture

```
src/
├── index.ts              # MCP server setup & tool registration
├── services/
│   ├── austlii.ts       # AustLII search integration
│   └── fetcher.ts       # Document text retrieval (HTML/PDF/OCR)
├── utils/
│   └── formatter.ts     # Result formatting (JSON/text/markdown/html)
└── test/
    └── scenarios.test.ts # Real-world integration tests
```

## Core Principles

### 1. Primary Sources Only
- **NEVER** return journal articles, commentary, or secondary sources
- **ALWAYS** filter URLs containing `/journals/`
- Focus: Cases from `/cases/` and legislation from `/legis/`

### 2. Citation Accuracy
- Extract and preserve neutral citations: `[2025] HCA 26`
- Preserve paragraph numbers in `[N]` format
- Future: Extract page numbers for reported citations

### 3. Search Quality
- **Current issue**: Date sorting returns recent cases that cite older authorities
- **Goal**: Return the ACTUAL case being searched for
- See [Issue #2](https://github.com/russellbrenner/auslaw-mcp/issues/2) for improvement plan

### 4. Real-World Testing
- Tests hit live AustLII API (non-deterministic)
- Validate with actual legal queries (e.g., "negligence duty of care")
- Test scenarios in `src/test/scenarios.test.ts` must pass

## Development Guidelines

### When Adding Features

1. **Check existing issues**: See GitHub Issues for planned work
2. **Update tests**: Add test scenarios for new functionality
3. **Maintain filtering**: Ensure journal articles remain excluded
4. **Preserve structure**: Keep paragraph numbers intact in text extraction
5. **Update docs**: Modify README.md and ROADMAP.md as needed

### Code Style

- **TypeScript strict mode**: All code must type-check with `npm run build`
- **Error handling**: Wrap network calls in try/catch with descriptive errors
- **Interfaces first**: Define TypeScript interfaces before implementation
- **No magic strings**: Use enums/constants for repeated values

### Testing Requirements

Every PR must include:
- ✅ TypeScript compilation passes (`npm run build`)
- ✅ All tests pass (`npm test`)
- ✅ New tests for new features
- ✅ Tests validate real behaviour (not static mocks)

### Search Implementation Notes

**Current AustLII search** (`src/services/austlii.ts`):
- Uses `https://classic.austlii.edu.au/cgi-bin/sinosrch.cgi`
- Parameters: `method=boolean`, `query=...`, `meta=/austlii`, `view=date`
- Parses `<ol><li>` result structure with Cheerio
- **Known issue**: `view=date` breaks relevance for case name searches

**Document fetching** (`src/services/fetcher.ts`):
- Handles HTML, PDF, and OCR fallback (Tesseract)
- Extracts text while preserving `[N]` paragraph markers
- **Limitation**: Page numbers from reported judgements not extracted

## Common Tasks

### Adding a New Search Source

```typescript
// 1. Create new service file
// src/services/source.ts
export async function searchUpstream(
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  // Implementation
}

// 2. Update search to merge sources
const [austliiResults, upstreamResults] = await Promise.all([
  searchAustLii(query, options),
  searchUpstream(query, options),
]);

// 3. Deduplicate by citation
const merged = deduplicateResults([...austliiResults, ...upstreamResults]);

// 4. Add tests
it("should merge results from multiple sources", async () => {
  // Test implementation
});
```

### Improving Text Extraction

```typescript
// When adding new structural preservation:
function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

  // Preserve paragraph numbers
  $('[class*="para"]').each((_, el) => {
    const paraNum = $(el).attr('data-para-num');
    if (paraNum) {
      $(el).prepend(`[${paraNum}] `);
    }
  });

  // Extract preserving structure
  return $('body').text();
}
```

### Adding Search Parameters

```typescript
// 1. Update SearchOptions interface
export interface SearchOptions {
  jurisdiction?: "cth" | "vic" | "federal" | "other";
  limit?: number;
  type: "case" | "legislation";
  sortBy?: "relevance" | "date" | "auto"; // NEW
}

// 2. Update Zod schema in index.ts
const searchCasesShape = {
  query: z.string().min(1),
  jurisdiction: jurisdictionEnum.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  sortBy: z.enum(["relevance", "date", "auto"]).optional(), // NEW
};

// 3. Implement in search function
if (options.sortBy === "relevance") {
  searchUrl.searchParams.set("view", "relevance");
} else {
  searchUrl.searchParams.set("view", "date");
}
```

## Known Issues & Workarounds

### Issue: Search returns citing cases, not target case
**Workaround**: Currently none; see [Issue #2](https://github.com/russellbrenner/auslaw-mcp/issues/2)
**Fix in progress**: Add relevance sorting and title matching

### Issue: Page numbers lost in extraction
**Workaround**: Use paragraph numbers for pinpoints
**Fix planned**: Parse page markers from reported judgement HTML

### Issue: No deduplication across sources
**Workaround**: Currently only one source (AustLII)
**Fix planned**: Citation-based deduplication in Phase 2

## Resources

- **AustLII Search Help**: https://www.austlii.edu.au/austlii/help/search.html
- **MCP Specification**: https://modelcontextprotocol.io/
- **Project Roadmap**: `docs/ROADMAP.md`
- **Test Coverage**: Run `npm test` to see real-world scenarios

## Critical Reminders

⚠️ **NEVER commit without building**: Run `npm run build` before committing
⚠️ **NEVER skip tests**: All tests must pass before pushing
⚠️ **ALWAYS preserve paragraph numbers**: They're critical for citations
⚠️ **NEVER include journal articles**: Primary sources only

## Getting Help

- Check `docs/ROADMAP.md` for planned features
- Review existing issues on GitHub
- Run tests to understand expected behaviour
- Check test scenarios for usage examples

---

**Remember**: This is a legal research tool. Accuracy and authority of sources are paramount. When in doubt, prioritise returning the most authoritative version of a judgement over returning more results.
