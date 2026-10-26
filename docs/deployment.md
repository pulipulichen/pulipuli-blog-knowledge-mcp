# 部署與首次回填

本專案部署在 Cloudflare Workers，D1 儲存文章，Workers AI 產生多語 embedding，Qdrant Cloud 儲存向量。定期同步由 GitHub Actions 發起；Worker 每次處理有限篇數並保存分頁游標，工作流程會持續呼叫直到當次回填完成。

## 1. 建立本機設定與 D1

```bash
git clone https://github.com/pulipulichen/pulipuli-blog-knowledge-mcp.git
cd pulipuli-blog-knowledge-mcp
npm install
cp wrangler.example.toml wrangler.toml
npx wrangler d1 create pulipuli-blog-knowledge
```

把 `wrangler d1 create` 輸出的 `database_id` 填入本機 `wrangler.toml`。範例檔中的 Worker Variables 已設為部落格 feed、`@cf/baai/bge-m3` 與 900 字元 chunk；可依需要調整。

## 2. 建立 Qdrant Cloud collection credentials

建立 Qdrant Cloud cluster，取得 cluster URL 與 API Key。collection 不必手動建立；首次成功匯入文章時，Worker 會讀取 Workers AI 回傳的向量長度並建立 cosine collection。若變更 embedding 模型而向量長度不同，需使用新的 collection，避免混用不同維度。

## 3. 建立 Worker Secrets 與套用 D1 migration

```bash
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put QDRANT_URL
npx wrangler secret put QDRANT_API_KEY
npx wrangler secret put QDRANT_COLLECTION
npm run db:migrate:remote
npm run deploy
```

`INGEST_TOKEN` 請使用長且隨機的值，例如 `openssl rand -hex 32` 產生後，再貼入 Wrangler 提示。Secrets 不要放在 `wrangler.toml` 或提交到 GitHub。

部署完成後可檢查：

```bash
curl https://<worker-host>/health
```

## 4. 設定 GitHub Actions

在 repo 的 Settings → Secrets and variables → Actions 新增 `INGEST_URL` 與 `INGEST_TOKEN`。`INGEST_URL` 填入完整的 `https://<worker-host>/internal/ingest`；`INGEST_TOKEN` 使用與 Worker Secret 相同的值。

Workflow 每天 02:17 UTC 啟動，透過日期奇偶檢查只在隔日執行；GitHub Actions 排程可能延遲。第一次執行會從 Blogger Atom feed 開始回填，透過 feed 的 `rel=next` 或 `start-index` 分頁續跑。後續執行只掃描最新 feed 頁面。你也可以在 Actions 手動執行並選擇重新開始完整回填。

## 5. 加入 ChatGPT

在支援遠端 MCP 的用戶端加入 Worker 的 `/mcp` HTTPS URL。伺服器提供唯讀工具：

- `search_articles`：依關鍵字、語意或混合方式搜尋，回傳文章標題、日期、標籤、摘要與網址。
- `get_article`：依搜尋結果 ID 或 canonical URL 讀取已索引全文。

## 本機開發

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

編輯 `.dev.vars` 填入開發用 Qdrant 設定與 Token；`wrangler.toml` 的 D1 ID 可使用 `wrangler d1 create` 建立的同一個資料庫，或本機 Wrangler 指定的本機資料庫。`npm run dev` 預設在 `http://localhost:8787` 啟動。

## 用途與額度

Cloudflare Workers、Workers AI、D1、GitHub Actions 與 Qdrant Cloud 的免費額度與限制會變動。初次回填會消耗抓取、D1 寫入、embedding 與向量儲存額度；請在各平台確認目前方案與用量。
