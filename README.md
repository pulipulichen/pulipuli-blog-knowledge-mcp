# Pulipuli Blog Knowledge MCP

Public read-only knowledge base for https://blog.pulipuli.info/.

## Planned features
- Import RSS and historical articles; preserve title, URL, date, tags and full text.
- Automatically refresh every two days.
- Hybrid keyword + multilingual embedding search.
- Public website and remote MCP endpoint for ChatGPT.
- Free-tier-first: Cloudflare Workers, D1, Workers AI, and candidate Qdrant Cloud.

## Project documents
- [Technical specification](docs/SPEC.md)
- [Application configuration](config.example.json)
- [Environment variables](.dev.vars.example)
- [Cloudflare configuration](wrangler.toml)
- [Scheduled workflow](.github/workflows/ingest.yml)

**Status:** architecture and configuration scaffold only. The Worker, database migrations, indexing logic, website, and MCP tools are not yet implemented. Feed URL, embedding model and vector dimensions still require validation.

This repository targets Pulipuli's blog specifically; future Facebook ingestion should be a separate instance sharing reusable adapters.
