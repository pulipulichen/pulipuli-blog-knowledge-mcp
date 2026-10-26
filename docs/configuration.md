# Configuration locations / 設定存放位置

本文件說明部署與執行 `pulipuli-blog-knowledge-mcp` 時，各種設定應放在哪裡。**不要把正式環境的密碼、API Token 或私鑰提交到 GitHub。**

## 1. GitHub repository：可公開、版本控管的設定

- `wrangler.toml`：Cloudflare Worker 名稱、入口、相容性日期、Cron Trigger、D1/AI binding 等部署設定；只放可公開的 binding 名稱與資源 ID，不放金鑰。
- `wrangler.toml.example`：可複製的部署範例（如果正式使用 `wrangler.toml`，範例與正式檔要明確區分）。
- `.dev.vars.example`：本機 Secrets 的欄位名稱與假值。
- `.github/workflows/`：部署與定期任務工作流程；不直接寫入密碼。
- 本文件：記錄設定來源、名稱、用途與修改方式。

> `wrangler.toml` 是 Wrangler 部署設定，不是私密儲存區。若同名 vars 同時在 Dashboard 與 Wrangler 設定，部署可能覆寫 Dashboard 的值。

## 2. Cloudflare Worker Secrets：正式環境機密

例如外部向量資料庫 API Key、管理介面驗證用 Token、第三方 API Token。使用 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets 建立 **Secret**，或執行：

```bash
npx wrangler secret put VECTOR_DATABASE_API_KEY
```

名稱僅為範例，應以程式實際讀取的環境變數為準。Secrets 不寫進 `wrangler.toml`、README、Actions YAML 或程式碼。

## 3. Cloudflare Worker Variables：非機密執行設定

例如 RSS URL、Embedding 模型名稱、批次處理筆數。可放在 `wrangler.toml` 的 `[vars]`，**或**由 Dashboard 維護，避免同一設定由兩邊管理。建議以 Git 版本控管為主，除非需要由 Dashboard 手動修改。

## 4. Cloudflare D1：執行期間可變的應用程式設定

若未來要做管理介面，RSS 來源清單、同步偏好、模型選擇等可存入 D1 的設定資料表，修改時不必重新部署。**D1 不應存放明文 API Key。** 管理介面需先有身分驗證與授權。

注意：每兩天同步一次的實際排程應由 Cloudflare Cron Trigger（或 GitHub Actions 排程）管理，單純修改 D1 中的 `SYNC_INTERVAL_DAYS` 不會自動變更 Cron 排程。

## 5. 本機開發：`.dev.vars`

將本機機密放在專案根目錄的 `.dev.vars`，並確認 `.gitignore` 忽略它。只提交 `.dev.vars.example`（使用假值）。若採用 `.env`，也應加入 `.gitignore`。不要將本機金鑰複製到 GitHub。

## 6. GitHub Actions Secrets：僅供 CI/CD 使用

若部署流程需要 GitHub Actions 使用部署憑證，請放在 GitHub Repository → Settings → Secrets and variables → Actions → Secrets（例如 `CLOUDFLARE_API_TOKEN`）。非機密值可放 Actions Variables。Actions Secrets 與 Cloudflare Worker Secrets 是不同儲存位置：前者供工作流程使用，後者供 Worker 執行時使用。

## 7. 建議的設定歸屬與變更流程

- **部署拓樸／binding／Cron**：修改 GitHub `wrangler.toml`，經部署生效。
- **正式機密**：修改 Cloudflare Worker Secrets；若由 CI 部署，確認不會被設定流程覆蓋。
- **本機機密**：修改不追蹤的 `.dev.vars`。
- **CI 部署憑證**：修改 GitHub Actions Secrets。
- **未來的動態設定**：透過有權限控管的管理介面寫入 D1。

## 8. 上線前檢查

1. `git status` 確認沒有 `.dev.vars`、`.env`、私鑰或金鑰檔被追蹤。
2. 確認所有正式機密都已設定於正確環境。
3. 確認 Cron 排程與實際部署一致；若需要每兩天更新，避免誤以為一般「每隔兩天」Cron 表達式必然等於固定 48 小時。
4. 確認公開查詢 API 不暴露管理功能或 Secrets。
5. 不在日誌、錯誤訊息或前端 JavaScript 回傳 Secrets。

本文件描述**建議的設定管理規範**；實際變數名稱、部署方式及已建立的 Cloudflare 資源，仍須依程式實作確認。
