# AusLaw MCP

Model Context Protocol (MCP) server that locates Australian primary sources of law, surfaces neutral citation fallbacks, and extracts full-text content with OCR support for archival PDFs. Designed to complement StudGent-style legal workflows with portable deployment options (Node.js or container).

## Features
- Legislation and case law search prioritising Commonwealth and Victorian sources.
- Structured results with reported and neutral citation metadata.
- Full-text retrieval for HTML and PDF sources, with Tesseract OCR fallback when PDFs lack embedded text.
- Portable runtime: Node.js 20+ or Docker container image.

## Quick Start
```bash
git clone https://github.com/your-user/auslaw-mcp.git
cd auslaw-mcp
npm install
npm run dev  # hot reload for local development
```

To build for production:
```bash
npm run build
npm start
```

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

## Roadmap
- Add secondary sources (eg. LawCite) for fallback metadata
- Package Docker image with Tesseract OCR pre-installed
- Expand unit tests and integration coverage with recorded fixtures
- Add better jurisdiction filtering
- Support for more specific search parameters (date ranges, court levels, etc.)
