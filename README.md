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
- [Cloudflare configuration template](wrangler.example.toml)
- [Scheduled workflow](.github/workflows/ingest.yml)

## Configuration
The feed URL in `config.example.json` is `https://blog.pulipuli.info/feeds/posts/default` (Blogger Atom feed, documented by the blog). Copy `config.example.json` to `config.json` and `wrangler.example.toml` to `wrangler.toml` when implementation begins; create actual Cloudflare resources and replace placeholders first. Do not commit secrets.

**Status:** specification and configuration scaffold only; the Worker, migrations, ingestion, search website, and MCP endpoint are not yet implemented. The feed URL should be checked during implementation; embedding model and vector dimensions require validation.

This repository targets Pulipuli's blog specifically; future Facebook ingestion should be a separate instance sharing reusable adapters.
