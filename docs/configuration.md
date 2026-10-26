# 設定存放位置（純雲端）

本專案只透過 **GitHub + GitHub Actions + Cloudflare Dashboard + Qdrant Cloud** 維護正式環境。使用者不需要本機 Clone、不需要安裝 Wrangler，也不需要保留任何本機 `wrangler.toml`。

## 公開 GitHub repository（可追蹤）

- `wrangler.example.toml`：Cloudflare Worker、D1 / AI binding 與非機密執行設定，`database_id` 是佔位符。
- `config.example.json`：程式執行設定的公開參考範例。
- `.dev.vars.example`：僅供其他開發者選用本機開發，**正式部署不使用**。
- `.github/workflows/ci.yml`：推送／PR 時的型別檢查與單元測試。
- `.github/workflows/deploy.yml`：首次手動部署、可選擇 main CI 成功後自動部署；在 GitHub runner 暫時產生設定檔、執行遠端 D1 migration、部署 Worker 並同步 Secrets。
- `.github/workflows/ingest.yml`：每兩天匯入文章與續跑歷史回填。

公開 repo 不應儲存任何真正的 Token。即使 D1 UUID 不是機密，本專案仍採用 GitHub Variable，讓 Fork 可使用各自的 D1。

## GitHub Actions Variables（非機密）

GitHub Repository → Settings → Secrets and variables → Actions → **Variables**：

- `D1_DATABASE_ID`（必填）：Cloudflare D1 資料庫的 UUID。
- `QDRANT_COLLECTION`（必填）：Qdrant collection 名稱，例如 `pulipuli_blog_chunks`。
- `ENABLE_AUTO_DEPLOY`（可選）：`true` 才允許 `main` 推送導致 CI 成功後自動部署；首次部署前維持空白或 `false`。

部署時，GitHub Actions 把 `D1_DATABASE_ID` 注入 `wrangler.example.toml` 的佔位符，產生暫時性的 `wrangler.toml`。此檔被 `.gitignore` 忽略，僅存在於該次 GitHub runner。

## GitHub Actions Secrets（機密）

GitHub Repository → Settings → Secrets and variables → Actions → **Secrets**：

- `CLOUDFLARE_API_TOKEN`（必填）：限制於此帳號、授予 Worker 建立／部署及 D1 migration 權限的專用 API Token。
- `CLOUDFLARE_ACCOUNT_ID`（必填）：Cloudflare Account ID（本身不是密碼，沿用 Cloudflare CI/CD Secret 慣例）。
- `INGEST_TOKEN`（必填）：用於保護文章匯入 API 的隨機長 Token。此值由部署 Workflow 同步進 Worker Secret，也用於定期匯入 Workflow。
- `QDRANT_URL`（必填）：Qdrant Cluster Endpoint，包含 `https://`，例如 `https://example.aws.cloud.qdrant.io:6333`。
- `QDRANT_API_KEY`（必填）：Qdrant Cloud API Key。
- `INGEST_URL`（第一次部署完成後填入）：`https://<worker-host>/internal/ingest`，供 `Refresh blog index` 使用。

上述 Secret 都只在 GitHub 設定畫面輸入，不要提交至程式碼或對話。

## Cloudflare Worker（執行時）

正式 Worker 運行時的設定來源如下：

- **D1 binding `DB`、AI binding `AI`**：由 `wrangler.example.toml` 與部署時替換的 Database ID 定義。
- **公開 Variables**：`BLOG_FEED_URL`、`BLOG_BASE_URL`、`EMBEDDING_MODEL`、`MAX_ARTICLES_PER_REQUEST`、`FEED_PAGE_SIZE`、`INGEST_CONCURRENCY`、`REQUEST_DELAY_MS`、`CHUNK_SIZE_CHARS`、`CHUNK_OVERLAP_CHARS`、`SEARCH_MAX_RESULTS`，定義在公開的 `wrangler.example.toml`。
- **Worker Secrets**：`INGEST_TOKEN`、`QDRANT_URL`、`QDRANT_API_KEY`、`QDRANT_COLLECTION`，由 GitHub Actions 部署同步。請勿同時在 Cloudflare Dashboard 人工維護同名值，避免下次部署覆寫。

## 無本機操作的部署順序

1. Cloudflare Dashboard 建立 D1，Qdrant Cloud 建立叢集。
2. GitHub Actions Variables / Secrets 填齊必要值。
3. GitHub → Actions → **Deploy Cloudflare Worker** → **Run workflow**。
4. Workflow 在 GitHub runner 執行單元測試、D1 遠端 migration、Worker 部署與 Secrets 同步。
5. Worker 的 `/health` 驗證成功後，設定 `INGEST_URL`。
6. GitHub → Actions → **Refresh blog index** → **Run workflow** 開始首次索引。
7. 如有需要，設定 `ENABLE_AUTO_DEPLOY=true`；之後正常推送到 main 且 CI 成功時自動部署。

正式部署操作請見 [部署指南](deployment.md)。本機開發僅是其他貢獻者的**選用流程**，不是主架構的一部分。
