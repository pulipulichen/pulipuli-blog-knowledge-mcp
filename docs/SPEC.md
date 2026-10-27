# Technical Specification

## Scope

This deployment indexes only Pulipuli Blog. The source adapter remains reusable, but a future Facebook knowledge base will be deployed separately to keep the datasets isolated.

## Architecture and Data Flow

1. GitHub Actions invokes a Worker ingestion endpoint protected by a Bearer Token every two days.
2. The Worker reads Blogger's summary JSON feed, follows `rel=next` and `start-index` pagination, and stores the backfill cursor in D1. Configured Blogger Atom URLs and existing cursors are adapted without resetting the offset; generic Atom and RSS feeds remain supported.
3. The Worker checks `robots.txt` before fetching actual article pages and extracting their body text. RSS excerpts are not treated as full text.
4. Using the canonical URL as the unique key, the Worker upserts each article's title, URL, dates, tags, full text, and content hash into D1.
5. When an article changes, it is chunked again. Cloudflare Workers AI `@cf/baai/bge-m3` generates multilingual embeddings, which are stored in Qdrant Cloud. The Qdrant collection is created on the first write using the actual vector size.
6. The public search endpoint retrieves candidates through D1 substring matching and Qdrant semantic search. Hybrid mode combines rankings with Reciprocal Rank Fusion (RRF).
7. `/mcp` exposes the read-only `search_articles` and `get_article` tools over Streamable HTTP.

## Database Tables

- `articles`: Source ID, canonical URL, title, dates, tags, full text, content hash, fetch timestamp, and status.
- `chunks`: Article ID, sequence number, text, content hash, embedding model, and Qdrant vector ID.
- `sync_runs`: Per-batch status, counters, and error summaries.
- `sync_state`: Historical backfill completion status and resumable feed cursor.
- `sync_lock`: Prevents concurrent ingestion batches.
- `failed_articles`: Articles whose fetching or indexing failed and require delayed retries.

Migrations are stored in `migrations/`. Article IDs are derived from canonical URLs. Vector IDs are derived from the article ID, content hash, embedding model, and chunk sequence number. This makes repeated runs idempotent and allows old vectors to be safely replaced when the embedding model changes.

## HTTP Interface

- `GET /api/search?q=...&limit=...&mode=hybrid|keyword|semantic`
- `GET /api/articles/:id`
- `GET /health`
- `POST /internal/ingest` (Bearer Token; supports `{"reset": true}` to restart the historical backfill)
- `/mcp` (Streamable HTTP; read-only tools)

Search results include article ID, title, URL, date, tags, excerpt, and score. Only `get_article` and the article API return full text. Public endpoints limit input length, result counts, and request rates per Worker isolate. For production deployments with high traffic, configure WAF Rate Limiting in your Cloudflare zone as well.

## Search

- **Keyword:** D1 `instr` substring matching; supports Chinese queries without spaces between words.
- **Semantic:** Workers AI creates query embeddings used for Qdrant vector search.
- **Hybrid:** Reciprocal Rank Fusion combines keyword and semantic rankings and deduplicates articles.
- **Embedding model changes:** If the new model produces a different vector dimension, Qdrant collection validation rejects writes. Create a new collection and rebuild the index instead.

## Scheduling and Retries

- The GitHub Actions workflow is scheduled daily and uses UTC day-number parity to gate execution to every other day. Manual runs can synchronize or reset the backfill at any time.
- Each Worker request processes at most 10 articles with no more than 2 concurrent fetches. The workflow repeatedly invokes the Worker until that synchronization run completes.
- The cursor advances only after article-body extraction, vector upsert, and D1 upsert succeed. Per-article failures are recorded for delayed retries.
- Upstream HTTP 408, 425, 429, and 5xx responses, as well as network failures, are retried with exponential backoff, respecting `Retry-After`.
- `/internal/ingest` uses a 120-second D1 lease with a 30-second renewal heartbeat to prevent overlapping batches. Ownership is checked before committing articles and checkpoints; cleanup is conditional on the lease token. Upserts use canonical URLs and stable IDs for idempotency.

## Security and Quotas

- Never commit Worker Secrets, Qdrant API keys, or ingestion tokens to Git.
- Search, MCP, and article-read operations are read-only. Writes are available only through the authenticated ingestion endpoint.
- Qdrant credentials are used only in the server-side Worker environment.
- Free-tier quotas can change, and there is no guarantee that historical backfills will always remain free. Check current Workers, Workers AI, D1, Qdrant, and GitHub Actions limits before deployment.

## Implementation Limitations

- Initial backfilling depends on Blogger feed pagination. A sitemap or archive adapter may be needed if the source later removes historical feed pages.
- Body extraction currently prioritizes standard HTML `article` and `main` elements, Blogger `.post-body`, and `.entry-content` selectors. Unusual templates may need additional rules.
- D1 keyword search currently scans article text, which is suitable for validating a personal-blog-sized dataset. Consider FTS5 or an external full-text search engine as volume increases.
