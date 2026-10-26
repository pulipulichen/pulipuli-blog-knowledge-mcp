# 技術規格

## 範圍

此部署只索引布丁布丁吃布丁的部落格。資料來源 adapter 保持可重用；未來的 Facebook 知識庫另行部署，避免混合資料集。

## 架構與資料流

1. GitHub Actions 每兩天呼叫受 Bearer Token 保護的 Worker ingestion endpoint。
2. Worker 讀取 Blogger Atom feed，利用 `rel=next` 與 `start-index` 分頁，並把回填游標寫入 D1。
3. Worker 先檢查 `robots.txt`，再抓取文章實際網頁並擷取正文；RSS excerpt 不當作全文。
4. 以 canonical URL 為唯一鍵，將標題、網址、日期、標籤、全文與內容雜湊 upsert 到 D1。
5. 內容變更時重新切塊，使用 Cloudflare Workers AI `@cf/baai/bge-m3` 產生多語 embedding，並寫入 Qdrant Cloud。Qdrant collection 首次寫入時依實際向量長度建立。
6. 公開搜尋 endpoint 以 D1 子字串檢索與 Qdrant 語意檢索取候選，混合模式以 Reciprocal Rank Fusion 合併排名。
7. `/mcp` 使用 Streamable HTTP 暴露唯讀 `search_articles` 與 `get_article` 工具。

## 資料表

- `articles`：來源 ID、canonical URL、標題、日期、標籤、全文、內容雜湊、抓取時間與狀態。
- `chunks`：文章 ID、序號、文字、內容雜湊、embedding 模型與 Qdrant vector ID。
- `sync_runs`：每個批次的狀態、計數與錯誤摘要。
- `sync_state`：歷史回填完成狀態與可續跑 feed 游標。
- `sync_lock`：避免同時執行多個 ingestion batch。
- `failed_articles`：延遲重試無法抓取或索引的文章。

Migration 位於 `migrations/`。Article ID 由 canonical URL 衍生；向量 ID 由 Article ID、內容雜湊、embedding 模型與 chunk 序號衍生，可重複執行而不重複新增，也能在更換模型時安全替換舊向量。

## HTTP 介面

- `GET /api/search?q=...&limit=...&mode=hybrid|keyword|semantic`
- `GET /api/articles/:id`
- `GET /health`
- `POST /internal/ingest`（Bearer Token；支援 `{ "reset": true }` 重新開始歷史回填）
- `/mcp`（Streamable HTTP；唯讀工具）

搜尋結果提供文章 ID、標題、網址、日期、標籤、摘要與分數。`get_article` 與文章 API 才會回傳全文。公開端點有輸入長度、結果數量與每個 Worker isolate 的請求速率限制；正式高流量部署仍應在 Cloudflare Zone 設定 WAF Rate Limiting。

## 搜尋

- 關鍵字：D1 `instr` 子字串查詢，支援中文不切空格的查詢。
- 語意：Workers AI embedding 查詢 Qdrant 向量。
- 混合：以 Reciprocal Rank Fusion 合併關鍵字與語意排名，並按文章去重。
- 更換模型時若向量維度不一致，Qdrant collection 檢查會拒絕寫入；建立新的 collection 後再重新回填。

## 排程與重試

- GitHub Actions Workflow 每天執行一次，使用 UTC 日序奇偶作為兩天一次的 gate；手動執行可隨時同步或重設回填。
- 歷史回填每個 Worker request 最多處理 10 篇文章，最多 2 篇同時抓取；workflow 持續呼叫到該次同步完成。
- 每篇文章完成正文擷取、向量 upsert、D1 upsert 後才前進游標；文章層級失敗會記錄並延遲重試。
- 上游 408、425、429、5xx 與網路錯誤會以指數退避重試並尊重 `Retry-After`。
- `/internal/ingest` 透過 D1 lock 防止並行執行；Upsert 以 canonical URL 與穩定 ID 達到冪等。

## 安全與額度

- 不把 Worker Secrets、Qdrant API Key 或 ingestion token 寫入 Git。
- 搜尋、MCP 與文章讀取都是唯讀；寫入只透過已驗證的 ingestion endpoint。
- Qdrant credentials 僅在 Worker server-side 環境使用。
- 各平台免費額度會改變，不保證回填永久免費；部署前需確認 Workers、Workers AI、D1、Qdrant 與 GitHub Actions 當前限制。

## 實作限制

- 初次回填依賴 Blogger Atom feed 的分頁；若來源日後移除歷史 feed 頁面，需新增 sitemap/archive adapter。
- 目前正文擷取優先處理標準 HTML `article`、`main`、Blogger `.post-body` 與 `.entry-content` 選擇器；特殊版型可能需要增加規則。
- 目前 D1 關鍵字檢索會掃描文章全文，適合先驗證個人部落格規模；若資料量增加，應再評估 FTS5 / 外部全文搜尋。
