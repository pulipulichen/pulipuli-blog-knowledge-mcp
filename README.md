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

使用 Node.js 22，可在沒有 Cloudflare / Qdrant 金鑰的情況下執行：

```bash
npm install
npm run typecheck
npm test
```

GitHub Actions [CI](.github/workflows/ci.yml) 在推送 `main`、提出 Pull Request 或手動啟動時執行型別檢查與離線單元測試；完整範圍及限制請見 [測試指南](docs/testing.md)。
## 快速開始

1. 安裝 Node.js 與 npm，複製 `wrangler.example.toml` 為 `wrangler.toml`，填入 D1 Database ID。`wrangler.toml`、`.dev.vars` 已加入 `.gitignore`。
2. 安裝相依套件：`npm install`。
3. 建立 Cloudflare D1，並把 Database ID 填入本機 `wrangler.toml`：

   ```bash
   npx wrangler d1 create pulipuli-blog-knowledge
   ```

4. 在本機建立 `.dev.vars`，參考 `.dev.vars.example` 填入 Ingestion Token 與 Qdrant 設定。
5. 建立資料表並部署：

   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

6. 在 GitHub Repository Secrets 設定 `INGEST_URL` 與 `INGEST_TOKEN`，啟用 Actions 後即可排程同步。初次索引會自動依 Workers AI 回傳的向量長度建立 Qdrant collection。

完整 Cloudflare、Qdrant、GitHub Secrets 與 ChatGPT MCP 設定步驟請見 [部署指南](docs/deployment.md) 和 [設定存放位置](docs/configuration.md)。

## 路由

- `GET /`：部落格搜尋頁。
- `GET /api/search?q=...&limit=...&mode=hybrid|keyword|semantic`：搜尋文章。
- `GET /api/articles/:id`：讀取一篇文章的完整索引文字。
- `GET /health`：Worker 與 D1 健康狀態。
- `POST /internal/ingest`：以 Bearer Token 保護的分批同步入口。
- `/mcp`：唯讀 MCP Streamable HTTP endpoint。

## 設定檔與機密

- `wrangler.example.toml`、`config.example.json`、`.dev.vars.example` 是可公開的範例。
- 正式 Worker 的 D1 binding 與非機密執行設定放在本機 `wrangler.toml` 或 Cloudflare Dashboard Variables。
- Worker 的 `INGEST_TOKEN`、`QDRANT_URL`、`QDRANT_API_KEY` 使用 Cloudflare Worker Secrets；本機開發值放在未追蹤的 `.dev.vars`。
- GitHub Actions 使用 Repository Secrets 保存 `INGEST_URL` 與相同的 `INGEST_TOKEN`。

## 架構文件

- [技術規格](docs/SPEC.md)
- [設定存放位置](docs/configuration.md)
- [部署與首次回填](docs/deployment.md)

## 限制

Cloudflare、Workers AI、D1、GitHub Actions 與 Qdrant 的方案額度會改變；部署者需在各平台確認目前額度。關鍵字檢索使用 D1 子字串比對，適合這個部落格的中文查詢起步，之後可依資料量調整索引策略。
