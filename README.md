# Pulipuli Blog Knowledge MCP

公開唯讀的部落格知識庫，資料來源為 [布丁布丁吃布丁](https://blog.pulipuli.info/)。使用 Cloudflare Workers 提供搜尋網站、JSON API 與 MCP Streamable HTTP 端點；文章中繼資料與全文存放在 D1，語意向量存放在 Qdrant Cloud，向量由 Workers AI 產生。

## 功能

- 讀取 Blogger Atom feed，依分頁游標分批回填歷史文章。
- 抓取文章實際網頁並擷取正文，不把 RSS 摘要當成全文。
- 遵守 `robots.txt`，支援請求重試、節流與失敗文章重試。
- D1 保存標題、網址、日期、標籤、全文與內容雜湊；內容改變時更新向量索引。
- 提供關鍵字、語意與混合搜尋；混合搜尋以 Reciprocal Rank Fusion 合併排名。
- 提供 `/mcp` 唯讀工具 `search_articles` 與 `get_article`，可加入支援 Streamable HTTP 的 MCP 用戶端。
- GitHub Actions 每兩天觸發同步，初次回填可在多個 Worker 請求間續跑。

## 測試與 CI

GitHub Actions CI 會自動在雲端使用 Node.js 22 執行。下列指令僅供其他開發者選用，本專案使用者**不必在本機操作**：

```bash
npm install
npm run typecheck
npm test
```

GitHub Actions [CI](.github/workflows/ci.yml) 在推送 `main`、提出 Pull Request 或手動啟動時執行型別檢查與離線單元測試；完整範圍及限制請見 [測試指南](docs/testing.md)。
## 快速開始（100% 雲端，無需本機環境）

1. 在 Cloudflare Dashboard 建立 D1：`pulipuli-blog-knowledge`，複製 Database ID。
2. 在 Qdrant Cloud 建立叢集，取得 Cluster URL 與 API Key。
3. 在 GitHub Repository → Settings → Secrets and variables → Actions 設定：
   - **Variables**：`D1_DATABASE_ID`、`QDRANT_COLLECTION`（例如 `pulipuli_blog_chunks`）。
   - **Secrets**：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`INGEST_TOKEN`、`QDRANT_URL`、`QDRANT_API_KEY`。
4. 到 GitHub → Actions → **Deploy Cloudflare Worker** → **Run workflow**。GitHub 的雲端 runner 會自行安裝 Node.js / Wrangler、通過測試、套用遠端 D1 migration 並部署 Worker，完全不需要本機設定。
5. 部署成功後將 Worker 的 `https://<worker-host>/internal/ingest` 設為 GitHub Secret `INGEST_URL`，手動執行一次 **Refresh blog index** 開始匯入。
6. 初次部署驗證完成後，可設定 GitHub Variable `ENABLE_AUTO_DEPLOY=true`，讓 `main` 的 CI 通過後自動部署。

> 正式 `wrangler.toml` 只會由 GitHub Actions 在暫時性 runner 上從 `wrangler.example.toml` 產生；本專案**不需要本機安裝、Clone 或部署**。

詳細操作與 Secret 權限請見 [純雲端部署指南](docs/deployment.md)、[設定存放位置](docs/configuration.md)。

## 路由

- `GET /`：部落格搜尋頁。
- `GET /api/search?q=...&limit=...&mode=hybrid|keyword|semantic`：搜尋文章。
- `GET /api/articles/:id`：讀取一篇文章的完整索引文字。
- `GET /health`：Worker 與 D1 健康狀態。
- `POST /internal/ingest`：以 Bearer Token 保護的分批同步入口。
- `/mcp`：唯讀 MCP Streamable HTTP endpoint。

## 設定檔與機密

- `wrangler.example.toml`、`config.example.json`、`.dev.vars.example` 是可公開的範例。
- 正式 D1 UUID 放在 GitHub Actions Variable `D1_DATABASE_ID`，GitHub runner 產生被忽略的 `wrangler.toml`。
- `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`INGEST_TOKEN`、`QDRANT_URL`、`QDRANT_API_KEY` 放在 GitHub Actions Secrets；部署 Workflow 會同步必要的 Worker Secrets。
- `QDRANT_COLLECTION` 與 `ENABLE_AUTO_DEPLOY` 放在 GitHub Actions Variables，`INGEST_URL` 放在 GitHub Actions Secret。

## 架構文件

- [技術規格](docs/SPEC.md)
- [設定存放位置](docs/configuration.md)
- [部署與首次回填](docs/deployment.md)

## 限制

Cloudflare、Workers AI、D1、GitHub Actions 與 Qdrant 的方案額度會改變；部署者需在各平台確認目前額度。關鍵字檢索使用 D1 子字串比對，適合這個部落格的中文查詢起步，之後可依資料量調整索引策略。
