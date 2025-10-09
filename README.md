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
Configure your MCP-compatible client (e.g. Claude Desktop, Cursor) to launch the compiled server:
```json
{
  "auslaw-mcp": {
    "command": "node",
    "args": ["/path/to/auslaw-mcp/dist/index.js"],
    "env": {}
  }
}
```

## Roadmap
- Implement AustLII search integration with robust HTML parsing.
- Add secondary sources (e.g. LawCite) for fallback metadata.
- Package Docker image with Tesseract OCR.
- Expand unit tests and integration coverage with recorded fixtures.
