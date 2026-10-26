# 設定存放位置

本文件列出 `pulipuli-blog-knowledge-mcp` 各設定值的實際存放位置。密碼、API Token 與私鑰不可提交到 GitHub。

## Repo 內可公開的範例

- `wrangler.example.toml`：Worker 入口、相容性日期、D1/AI binding，以及公開的部落格 feed URL、模型名稱、批次大小等設定。D1 Database ID 是佔位符。
- `config.example.json`：系統設定與目前實作行為的摘要，供閱讀與規劃使用；Worker 執行時以環境變數為準。
- `.dev.vars.example`：本機機密欄位名稱與假值。
- `.github/workflows/ingest.yml`：定期呼叫 Worker 的流程，不直接存放 Token。

以上範例可以放在公開 GitHub repo。範例中的網誌網址是公開 RSS，其他非機密設定也不會授予任何帳號權限。

## 本機 Cloudflare 設定

從 repo 根目錄複製範本：

```bash
cp wrangler.example.toml wrangler.toml
```

把 `database_id` 換成 `wrangler d1 create pulipuli-blog-knowledge` 回傳的真實 ID。`wrangler.toml` 已列在 `.gitignore`，因此本機資源 ID 和自訂部署設定不會被提交。若你選擇將不含機密的正式 Wrangler 設定交由 Git 管理，可移除該忽略規則後再提交。

`[vars]` 放非機密的執行設定，包括：

- `BLOG_FEED_URL`、`BLOG_BASE_URL`：RSS/Atom feed 與部落格網址。
- `EMBEDDING_MODEL`：Workers AI 模型。預設 `@cf/baai/bge-m3`。
- `MAX_ARTICLES_PER_REQUEST`、`FEED_PAGE_SIZE`、`INGEST_CONCURRENCY`、`REQUEST_DELAY_MS`：分批大小與抓取節流。
- `CHUNK_SIZE_CHARS`、`CHUNK_OVERLAP_CHARS`：向量切塊參數。
- `SEARCH_MAX_RESULTS`：搜尋預設上限。

也可以在 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets 管理非機密 Variables。不要同時用 Wrangler 與 Dashboard 維護同一個值，避免部署時覆寫。

## 正式環境機密：Cloudflare Worker Secrets

在 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets 建立 Secret，或從終端機逐一輸入：

```bash
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put QDRANT_URL
npx wrangler secret put QDRANT_API_KEY
npx wrangler secret put QDRANT_COLLECTION
```

`INGEST_TOKEN` 保護 `/internal/ingest`；Qdrant 設定只由 Worker 伺服器端使用。公開搜尋與 MCP 工具不會回傳這些值。Qdrant collection 在首次成功寫入時，會依 Workers AI 回傳的 embedding 長度自動建立。

## 本機開發機密：`.dev.vars`

```bash
cp .dev.vars.example .dev.vars
```

編輯 `.dev.vars` 填入本機 Worker 測試用的 Token、Qdrant URL 與 API Key。`.dev.vars` 已被 `.gitignore` 忽略；不要把它改名後提交，也不要將正式機密放在 `wrangler.toml`。

## GitHub Actions Secrets

前往 GitHub Repository → Settings → Secrets and variables → Actions，新增：

- `INGEST_URL`：部署後 Worker 的完整同步網址，例如 `https://<worker-host>/internal/ingest`。
- `INGEST_TOKEN`：必須與 Cloudflare Worker Secret `INGEST_TOKEN` 相同。

GitHub Actions Secrets 供排程工作使用；Cloudflare Worker Secrets 供 Worker 執行時使用，需在兩處各自設定。

## 由程式讀取的環境變數

- Wrangler Variables：`BLOG_FEED_URL`、`BLOG_BASE_URL`、`EMBEDDING_MODEL`、`MAX_ARTICLES_PER_REQUEST`、`FEED_PAGE_SIZE`、`INGEST_CONCURRENCY`、`REQUEST_DELAY_MS`、`CHUNK_SIZE_CHARS`、`CHUNK_OVERLAP_CHARS`、`SEARCH_MAX_RESULTS`。
- Wrangler bindings：`DB`（D1）、`AI`（Workers AI）。
- Worker Secrets／本機 `.dev.vars`：`INGEST_TOKEN`、`QDRANT_URL`、`QDRANT_API_KEY`、`QDRANT_COLLECTION`。

## 上線檢查

1. `git status` 不應顯示 `.dev.vars` 或 `wrangler.toml`。
2. Cloudflare Worker 已建立 D1 binding、AI binding，且 D1 migration 已套用。
3. Worker Secret 與 GitHub Actions Secret 的 `INGEST_TOKEN` 完全一致。
4. GitHub Actions 的 `INGEST_URL` 指向已部署的 `/internal/ingest`。
5. `/health`、`/api/search` 與 `/mcp` 可由公開 HTTPS 網址連線；只有帶 Token 的 POST 才能啟動同步。
