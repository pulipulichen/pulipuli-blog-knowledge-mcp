# Technical specification (v0.1)

## Scope
This instance indexes Pulipuli's blog only. Keep source adapters generic so a future *separate* Facebook knowledge-base instance can reuse the framework without mixing datasets.

## Data flow
1. Scheduled GitHub Actions workflow triggers a protected Worker ingestion endpoint every 2 days.
2. Worker fetches the configured RSS/Atom feed(s), parses entries and discovers canonical URLs.
3. Fetch the actual article page and extract readable full text (do not treat RSS excerpts as full text). Respect robots.txt, throttling, retry/backoff, and source availability.
4. Normalize dates, tags, URLs and content. Upsert article metadata/full text into D1 by canonical URL; track content hash.
5. Split changed text into overlapping chunks; embed via Workers AI; upsert vectors to the external vector store using stable IDs. Delete stale chunks when articles change.
6. Public search endpoint combines D1 keyword retrieval with vector similarity; rank and deduplicate results, always return article URL and excerpts.
7. Remote MCP exposes read-only tools via HTTPS Streamable HTTP, enabling ChatGPT to query the indexed content.

## Tables (logical schema)
- articles: id, source_id, canonical_url UNIQUE, title, published_at, updated_at, tags_json, full_text, content_hash, fetched_at, status
- chunks: id, article_id, ordinal, text, content_hash, embedding_model, vector_id
- sync_runs: id, started_at, finished_at, status, scanned, inserted, updated, failed, error_summary

D1 migrations are required before deployment. Vector IDs must be deterministic (article ID + chunk ordinal + version/hash). Do not store credentials in D1.

## Public HTTP interface
- GET /api/search?q=...&limit=...&mode=hybrid|keyword|semantic
- GET /api/articles/:id
- GET /health
- POST /internal/ingest (Bearer token; never publicly writable)
- /mcp (MCP Streamable HTTP; read-only tools: search_articles, get_article)

Return structured JSON, bounded limits, source attribution, and useful error codes. Add CORS policy, rate limiting, and request-size limits. Avoid making full-text article dumps the default search response.

## Search strategy
- Keyword: D1 FTS5 (verify D1 support and Chinese tokenization; use fallback when needed).
- Semantic: multilingual embeddings through Workers AI; ensure dimensions match Qdrant collection configuration.
- Hybrid: merge ranked candidates with reciprocal rank fusion (RRF) initially; tune with real Chinese queries.
- Re-embed all chunks when changing model/dimensions. Version index metadata.

## Scheduling and idempotency
- GitHub Actions cron is not guaranteed to execute precisely; workflow runs every 2 days by checking UTC epoch-day parity or last successful sync time.
- Provide workflow_dispatch for manual refresh.
- Retry transient failures with exponential backoff and jitter; respect Retry-After.
- Persist checkpoints, enforce single active sync, and make reruns idempotent.
- Important: RSS may list only recent posts. An initial historical backfill must use sitemap/archive pagination and resume checkpoints, not RSS alone.

## Cost and limits
Validate current free-tier allowances before implementation: Workers CPU/runtime, Workers AI inference, D1 storage/queries, Qdrant vector count/storage, GitHub Actions minutes. Avoid GitHub artifacts and unnecessary container builds. If Workers cannot complete large backfills in one request, batch using queues/continuations.

## Acceptance criteria
- Two successive unchanged ingestions do not duplicate articles/chunks.
- Changed article updates full text and vector chunks.
- Historical articles can be backfilled with resumable progress.
- Chinese queries return relevant results with title/date/tags/link.
- MCP endpoint is publicly reachable over HTTPS and tools work in ChatGPT.
- Ingestion requires authentication; public search and MCP cannot mutate data.
- No secrets committed to Git.

## Open decisions
Confirm exact blog feed URL, historical post count, HTML extraction method, Workers AI model and output dimensions, Qdrant free-tier suitability, D1 Chinese search implementation, and Cloudflare deployment domain. Do not claim these are verified yet.
