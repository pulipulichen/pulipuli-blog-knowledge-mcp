# 自動化測試與 CI

本專案的核心測試不需要 Cloudflare、Qdrant 或任何 API Key。CI 不會觸發正式文章同步、不會寫入正式 D1，也不會消耗 Workers AI 額度。

## 本機執行

需求：Node.js 22 與 npm。

```bash
npm install
npm run typecheck
npm test
```

開發過程可使用 `npm run test:watch`，測試使用 Vitest，網路呼叫由 mock 取代。

### 已加入的測試

- `tests/http.test.ts`：Bearer Token、JSON 長度限制、HTTP 429 重試、canonical URL、Unicode 切塊、Hash 與 UUID。
- `tests/feed.test.ts`：Blogger Atom 和 RSS 解析、標籤與時間、同源分頁限制與錯誤回應。
- `tests/qdrant.test.ts`：Workers AI embedding 格式、Qdrant collection 建立／向量維度檢查與結果映射。
- `tests/search.test.ts`：關鍵字／語意搜尋、RRF 混合排序、重複 chunk 去重、查詢驗證與文章查詢。
- `tests/routes.test.ts`：搜尋首頁、健康檢查、搜尋 API、未授權同步、CORS 和不存在的文章。

## GitHub Actions

- 工作流程：`.github/workflows/ci.yml`
- 觸發條件：推送 `main`、Pull Request、手動執行。
- 檢查順序：`npm install` → `npm run typecheck` → `npm test`。
- 權限：唯讀 GitHub Repository；不用設定 Cloudflare 或 Qdrant Secrets。

目前尚未提交 `package-lock.json`，所以 CI 使用 `npm install`。之後應補上 lockfile，將 CI 改為 `npm ci` 以提高可重現性。

## 上線前仍需完成的整合測試

以上測試都是離線單元測試，不能取代真實雲端整合驗證。正式部署後仍需檢查：

1. Workers AI 實際 embedding 模型輸出及 Qdrant collection 向量維度。
2. D1 migration、歷史回填、抓取失敗重試與游標續跑。
3. `/mcp` Streamable HTTP 初始化及 ChatGPT 呼叫 `search_articles`、`get_article`。
4. `ingest.yml` 的 Secret 設定、定期排程和首次回填。
