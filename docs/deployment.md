# Cloud-Only Deployment: GitHub Actions → Cloudflare Workers + D1 + Qdrant

This project does not require local Node.js or Wrangler installation, local configuration files, or a self-hosted server. Installation, type checking, tests, D1 schema migrations, and Worker deployment all run on **GitHub-hosted Actions runners**. The Worker, relational database, and vector store are entirely cloud-hosted.

> `wrangler.example.toml` is a public, version-controlled template. The production `wrangler.toml` is temporarily generated from that template and a GitHub Variable on the GitHub Actions runner; it is never committed to the repository.

## Architecture and Execution Stages

- **GitHub:** Single source of truth for code and CI/CD, using the `main` branch.
- **GitHub Actions – CI:** Offline type checking and unit tests; no Cloudflare credentials required.
- **GitHub Actions – Deploy Cloudflare Worker:** Runs validation, generates a temporary `wrangler.toml`, applies remote D1 migrations, deploys the Worker, and configures Worker Secrets.
- **Cloudflare Workers:** Serves the public search site, JSON API, Streamable HTTP `/mcp`, and Bearer-token-protected `/internal/ingest` endpoint.
- **Cloudflare D1:** Stores relational data for articles and chunks. **Workers AI:** Generates embeddings.
- **Qdrant Cloud:** Stores and searches vectors.
- **GitHub Actions – Refresh blog index:** Triggers ingestion and historical backfill every two days without requiring a user's computer to remain on.

## Step 1: Create D1 in the Cloudflare Dashboard

1. Open Cloudflare Dashboard → Storage & databases → D1 SQL database.
2. Create a database named `pulipuli-blog-knowledge`.
3. Copy its **Database ID** (UUID).

This ID is not an API key and does not itself grant access. The project nevertheless stores it as a GitHub Actions Variable instead of hard-coding it into Git so that public forks can use their own D1 databases.

## Step 2: Create a Qdrant Cloud Cluster

1. Sign in to Qdrant Cloud and create a free-tier cluster.
2. Save its **Cluster Endpoint** (the Qdrant REST API address, typically `https://<cluster-host>:6333`) and **API Key**. You will put these in GitHub Secrets, not in repository files or issues. Preserve the provided `https://` and `:6333`, and do not use the cluster management console URL.
3. Choose a collection name such as `pulipuli_blog_chunks`. You will set it later as the GitHub Variable `QDRANT_COLLECTION`.
4. You do **not** need to create the collection manually. The Worker creates it during initial ingestion using the embedding model's actual vector dimension.

## Step 3: Obtain a Cloudflare API Token and Account ID

1. Find your Account ID in the Cloudflare Dashboard.
2. Open your Cloudflare account's API Tokens page and create a **dedicated token scoped to the relevant account**. Creating a new Worker with `wrangler deploy` requires Workers product-level **Admin** permission; once the Worker exists, permissions can be narrowed to **Editor** for that Worker. Grant the D1 read/write permissions needed to run database migrations. Follow the permissions exposed by the current Cloudflare UI, and do not use a Global API Key.
3. Keep the token out of all Git-tracked files.

For authoritative guidance, see Cloudflare's [GitHub Actions CI/CD](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/) documentation.

## Step 4: Configure GitHub Repository Variables and Secrets

In this repository, navigate to **Settings → Secrets and variables → Actions**.

### Variables (Non-Secret)

- `D1_DATABASE_ID`: UUID of the D1 database created above.
- `QDRANT_COLLECTION`: For example, `pulipuli_blog_chunks`.
- `ENABLE_AUTO_DEPLOY`: Leave unset or `false` initially. After the first manual deployment succeeds, set `true` to deploy automatically following successful `main` branch CI runs.

### Secrets (Private)

- `CLOUDFLARE_API_TOKEN`: Dedicated deployment API token.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID (not inherently secret, but stored consistently with the other CI/CD credentials).
- `INGEST_TOKEN`: Cryptographically random Bearer Token of at least 32 bytes, used to protect `/internal/ingest`.
- `QDRANT_URL`: Qdrant cluster URL, including `https://`.
- `QDRANT_API_KEY`: Qdrant API Key.

The deployment workflow uploads the required GitHub Secrets as Cloudflare Worker Secrets. There is no need to manually re-enter those values in the Cloudflare Worker configuration.

**Important:** Do not paste `INGEST_TOKEN` into chats or public repositories. The production Worker and the scheduled GitHub workflow must use the same Secret.

## Step 5: Perform the Initial Cloud Deployment

1. Confirm that [CI](../.github/workflows/ci.yml) has passed.
2. Go to GitHub repository → **Actions → Deploy Cloudflare Worker → Run workflow** and manually select `main`.
3. The workflow runs Node.js 22 setup and tests, verifies the D1 ID, generates `wrangler.toml`, applies remote `wrangler d1 migrations apply DB --remote`, runs `wrangler deploy`, and synchronizes Worker Secrets.
4. Find the public `*.workers.dev` address in the workflow logs (or use your custom domain). Opening `https://<worker-host>/health` should return `status: ok` and `database: ok`.
5. Optionally set `ENABLE_AUTO_DEPLOY=true` after the initial deployment. Only **successful CI runs triggered by pushes to the main branch** should initiate automatic deployment. Pull-request CI does not use production deployment credentials, preventing deployments from unreviewed branches.

**Caution:** This workflow modifies the **production remote D1 database**. Review schema migrations and backup strategies before merging database changes.

## Step 6: Configure Article Synchronization Every Two Days

Go to GitHub Repository → Settings → Secrets and variables → Actions:

- Retain the `INGEST_TOKEN` Secret configured above. Deployment and ingestion share the same value.
- Add an `INGEST_URL` Secret with the value `https://<worker-host>/internal/ingest`.

Open GitHub Actions → **Refresh blog index** → **Run workflow** to trigger the initial import manually (do not select the backfill reset option on the first run). The workflow repeatedly calls the Worker in batches and uses the D1 cursor to resume historical imports. The scheduled workflow checks UTC day parity every day at **02:17 UTC** and performs ingestion every two days. GitHub Actions scheduled runs may be delayed.

### Recovering from a Failed Backfill

- **Do not clear D1 or select `reset_backfill`** to resume a stopped import. Its checkpoint is persisted in D1.
- D1 permits at most 100 bound parameters per SQL statement. Every chunk INSERT row has 8 bound values, so each INSERT is limited to 12 chunks; this is covered by CI tests.
- The default is 1 article per request with concurrency set to 1. Due failed-article retries share this budget, rather than adding two more articles to an otherwise small request.
- Blogger `/feeds/posts/default` URLs are automatically fetched through `/feeds/posts/summary?alt=json`, preserving pagination parameters and the saved offset. Full article text is still fetched from each article's HTML page. This avoids repeatedly parsing a large full-text Atom feed within the free Worker's CPU budget; no cursor reset is required.
- GitHub Actions serializes ingest workflow runs. Active-lease HTTP 409 polls use a separate, bounded 20-minute waiting window and do not consume the 24-attempt upstream-error budget. Temporary 429/5xx responses and transport errors use capped backoff; `Retry-After` is honored up to 60 seconds per poll.
- Every upstream failure logs its response excerpt and Cloudflare `CF-Ray`, including recognizable platform errors such as 1102. A later 409 no longer hides the original 503. Persistent upstream errors and excessively long lock waits still fail the run.
- Individual article failures are stored in D1 `failed_articles` and are retried when due on later ingestion requests. Review the workflow's `failed` total and warning messages.
- After every successful batch, GitHub Actions logs each processed article's **title**, **URL**, and status (`inserted`, `updated`, `unchanged`, or `failed`). Failed entries also include a short error.
- When a 409 lock conflict occurs, GitHub Actions always prints the lock-expiry estimate, even if `progress.current` is null. When available, it also prints the last phase (`fetching_feed`, `indexing_articles`, or `retrying_article`) and article titles/URLs. This is the **last reported** work; after a Worker crash it may be stale.
- The protected `GET /internal/ingest/status` endpoint exposes the same progress for authorized checks while a request is active. Send `Authorization: Bearer <INGEST_TOKEN>`; do not put the token in a public URL or public log. No extra D1 migration is needed.
- Healthy requests renew their 120-second lease every 30 seconds. A terminated Worker normally blocks recovery for at most 2 minutes after its last renewal. A lease created by an older deployment may still need its original 15 minutes to expire once. A request that loses ownership cannot commit its checkpoint or clear its replacement's progress.
- Cursor, mode, and backfill-completion updates are saved transactionally. An article failure must be persisted before the cursor advances; a failure to save the retry record fails the batch instead.
- After updating, first run **Deploy Cloudflare Worker** on `main`, then start a **new** **Refresh blog index** run on `main` with `reset_backfill` disabled. Re-running a historical failed job uses its old revision. Existing indexed articles and the last committed cursor are retained; no D1 migration is needed for this change.

If a fresh run still reports 1102, check Cloudflare Workers invocation logs for `exceededCpu` or `exceededMemory`; an HTTP 503 alone does not establish which resource failed. Free-plan CPU limits still apply to unusually large articles. The improved response logging distinguishes these platform failures from an active ingestion lease.

## Step 7: Verify the Website and ChatGPT MCP

- `GET https://<worker-host>/`: Search website.
- `GET https://<worker-host>/health`: Worker/D1 health check.
- `GET https://<worker-host>/api/search?q=Cloudflare&mode=keyword`: Initial keyword search test.
- `https://<worker-host>/mcp`: Add this endpoint to an MCP client supporting Streamable HTTP, then test `search_articles` and `get_article`.

Once historical backfilling is complete, test semantic and hybrid searches and review Workers AI/Qdrant quota usage.

## Security and Quotas

- A public GitHub repository should contain only templates and non-secret source code. API tokens, vector database keys, and ingestion tokens must be stored in GitHub Secrets.
- The generated `wrangler.toml` exists only on a temporary GitHub runner and is ignored by `.gitignore`. **No local operations are required.**
- Free-tier quotas for Cloudflare Workers, Workers AI, D1, Qdrant Cloud, and GitHub Actions may change. Validate the initial backfill in batches.
- `npm run dev` and `.dev.vars.example` remain available for optional contributor development but are **not required for production deployment**.
