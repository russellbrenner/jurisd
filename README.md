# AusLaw MCP

Model Context Protocol (MCP) server for Australian legal research. Searches AustLII for case law and legislation, retrieves full-text judgements with paragraph numbers preserved, and supports OCR for scanned PDFs.

**Status**: ✅ Working MVP | 🚧 [Improving search relevance](https://github.com/russellbrenner/auslaw-mcp/issues/2)

## Features

### Current Capabilities
- ✅ **Case law search**: Natural language queries (e.g., "negligence duty of care")
- ✅ **Legislation search**: Find Australian Commonwealth and State legislation
- ✅ **Primary sources only**: Filters out journal articles and commentary
- ✅ **Citation extraction**: Extracts neutral citations like `[2025] HCA 26`
- ✅ **Paragraph preservation**: Keeps `[N]` paragraph numbers for pinpoint citations
- ✅ **Multiple formats**: JSON, text, markdown, or HTML output
- ✅ **Document retrieval**: Full text from HTML and PDF sources
- ✅ **OCR support**: Tesseract OCR fallback for scanned PDFs

### Limitations & Roadmap
- 🚧 **Search relevance**: Currently sorts by date; case name searches need relevance sorting ([#2](https://github.com/russellbrenner/auslaw-mcp/issues/2))
- 🔜 **Multi-source**: Will add removed.invalid for reported judgements
- 🔜 **Page numbers**: Will extract page numbers from reported versions
- 🔜 **Authority ranking**: Will prioritise reported over unreported judgements

See [ROADMAP.md](docs/ROADMAP.md) for detailed development plans.

## Quick Start
```bash
git clone https://github.com/russellbrenner/auslaw-mcp.git
cd auslaw-mcp
npm install
npm run dev  # hot reload for local development
```

To build for production:
```bash
npm run build
npm start
```

## Running Tests
The project includes comprehensive integration tests covering real-world legal search scenarios:

```bash
npm test
```

Test scenarios include:
1. **Negligence and duty of care** - Personal injury law searches
2. **Contract disputes** - Commercial law and breach of contract
3. **Constitutional law** - High Court constitutional matters
4. **Employment law** - Unfair dismissal and workplace relations
5. **Property and land law** - Native title and land rights disputes

Tests validate:
- Results are properly formatted with required fields
- Only primary sources are returned (no journal articles)
- Recent cases are prioritized
- Document fetching works for returned URLs

## MCP Registration
Configure your MCP-compatible client (eg. Claude Desktop, Cursor) to launch the compiled server.

For Claude Desktop, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "auslaw-mcp": {
      "command": "node",
      "args": ["/path/to/auslaw-mcp/dist/index.js"]
    }
  }
}
```

Replace `/path/to/auslaw-mcp` with the actual path to your installation.

## Available Tools

Once registered, the following tools are available:

### search_cases
Search Australian case law using natural language queries.

**Parameters:**
- `query` (required): Search query in natural language (eg. "negligence duty of care", "Mabo")
- `jurisdiction` (optional): Filter by jurisdiction: "cth", "vic", "federal", "other"
- `limit` (optional): Maximum number of results (1-50, default 10)
- `format` (optional): Output format: "json", "text", "markdown", "html" (default "json")

**Example:**
```json
{
  "query": "negligence duty of care",
  "jurisdiction": "cth",
  "limit": 5
}
```

### search_legislation
Search Australian legislation.

**Parameters:** Same as `search_cases`

**Example:**
```json
{
  "query": "Privacy Act",
  "limit": 10
}
```

### fetch_document_text
Fetch full text from a legislation or case URL. Supports HTML and PDF with OCR fallback for scanned PDFs.

**Parameters:**
- `url` (required): URL of the document to fetch
- `format` (optional): Output format: "json", "text", "markdown", "html" (default "json")

**Example:**
```json
{
  "url": "http://classic.austlii.edu.au/cgi-bin/disp.pl/au/cases/cth/HCA/1984/84.html"
}
```

## Features Implemented
- ✅ AustLII search integration with HTML parsing for cases and legislation
- ✅ Natural language query support (eg. "negligence duty of care")
- ✅ Document text extraction for HTML documents
- ✅ PDF text extraction with OCR fallback for scanned documents (requires Tesseract)
- ✅ Neutral citation and jurisdiction extraction
- ✅ Multiple output formats (JSON, text, markdown, HTML)

## Contributing

See [AGENTS.md](AGENTS.md) for AI agent instructions and development guidelines.

**Key principles**:
- Primary sources only (no journal articles)
- Citation accuracy is paramount
- All tests must pass before committing
- Real-world testing (hits live AustLII)

## Project Structure

```
src/
├── index.ts              # MCP server & tool registration
├── services/
│   ├── austlii.ts       # AustLII search integration
│   └── fetcher.ts       # Document text retrieval
├── utils/
│   └── formatter.ts     # Output formatting
└── test/
    └── scenarios.test.ts # Integration tests
```

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) and [Issue #2](https://github.com/russellbrenner/auslaw-mcp/issues/2) for detailed development plans.

**Next priorities**:
1. Fix search relevance for case name queries
2. Add removed.invalid integration for reported judgements
3. Extract page numbers for pinpoint citations
4. Implement authority-based result ranking

## License

MIT
