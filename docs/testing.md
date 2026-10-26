# Automated Testing and CI

Core tests do not require Cloudflare, Qdrant, or any API keys. CI does not trigger production ingestion, write to the production D1 database, or consume Workers AI quota.

## Running Tests Locally (Optional for Contributors)

Requirements: Node.js 22 and npm.

```bash
npm install
npm run typecheck
npm test
```

Use `npm run test:watch` during development. Tests run with Vitest, and network calls are mocked.

### Included Tests

- `tests/d1-limits.test.ts`: D1's 100-variable SQL bind limit, eight-column chunk INSERT batch sizing, and invalid parameters.
- `tests/http.test.ts`: Bearer Token handling, JSON length limits, HTTP 429 retries, canonical URLs, Unicode chunking, hashing, and UUIDs.
- `tests/feed.test.ts`: Blogger Atom and RSS parsing, tags and timestamps, same-origin pagination restrictions, and error responses.
- `tests/qdrant.test.ts`: Workers AI embedding formats, Qdrant collection creation/vector dimension validation, and result mapping.
- `tests/search.test.ts`: Keyword/semantic search, RRF hybrid ranking, duplicate chunk removal, query validation, and article lookup.
- `tests/routes.test.ts`: Search home page, health checks, search API, unauthorized ingestion, CORS, and missing articles.

## GitHub Actions

- Workflow: `.github/workflows/ci.yml`.
- Triggers: Pushes to `main`, pull requests, and manual workflow dispatch.
- Steps: `npm install` → `npm run typecheck` → `npm test`.
- Permissions: Read-only repository access; no Cloudflare or Qdrant Secrets are required.

A `package-lock.json` has not been committed yet, so CI uses `npm install`. Adding a lockfile and changing CI to `npm ci` would improve reproducibility.

## Integration Checks Still Required Before Production Use

These are offline unit tests and do not replace real cloud integration checks. After deployment, verify:

1. Actual Workers AI embedding output and the Qdrant collection's vector dimension.
2. D1 migrations, historical backfill, failed-fetch retries, and cursor resumption.
3. `/mcp` Streamable HTTP initialization and ChatGPT calls to `search_articles` and `get_article`.
4. `ingest.yml` Secret configuration, scheduled execution, and initial backfill.
