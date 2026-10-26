# 純雲端部署：GitHub Actions → Cloudflare Workers + D1 + Qdrant

本專案不需要本機安裝 Node.js、Wrangler，也不需要本機設定檔或伺服器。所有安裝、型別檢查、測試、D1 schema migration、Worker 部署都在 **GitHub-hosted Actions runner** 執行。Worker 服務、資料庫與向量資料都在雲端。

> `wrangler.example.toml` 是可公開提交的通用範例；正式的 `wrangler.toml` 僅在 GitHub Actions runner 裡由範例和 GitHub Variable 暫時產生，不會提交到 repository。

## 架構與執行階段

- GitHub：唯一程式碼來源與 CI/CD，`main` 分支。
- GitHub Actions `CI`：離線型別檢查與單元測試，不需任何 Cloudflare 金鑰。
- GitHub Actions `Deploy Cloudflare Worker`：雲端 runner 執行驗證、建立暫存 `wrangler.toml`、在遠端 D1 套用 migration、部署 Worker 並設定 Worker Secrets。
- Cloudflare Workers：公開搜尋網頁、JSON API、Streamable HTTP `/mcp`、受 Bearer Token 保護的 `/internal/ingest`。
- Cloudflare D1：文章與 chunk 等關聯資料；Workers AI：Embedding。
- Qdrant Cloud：向量儲存與搜尋。
- GitHub Actions `Refresh blog index`：每兩天觸發匯入與歷史回填，無需使用者電腦開機。

## 第 1 步：在 Cloudflare Dashboard 建立 D1

1. 進入 Cloudflare Dashboard → Storage & databases → D1 SQL database。
2. 建立資料庫，名稱：`pulipuli-blog-knowledge`。
3. 複製建立後顯示的 **Database ID**（UUID）。

這個 ID 不是 API 金鑰，不會授權第三方存取；但為了讓公開 repo 可被 Fork 重用，此專案把每位部署者自己的 ID 存在 GitHub Actions Variable，而不是寫死在 Git。

## 第 2 步：建立 Qdrant Cloud 叢集

1. 登入 Qdrant Cloud，建立免費叢集。
2. 保存 **Cluster Endpoint**（Qdrant REST API，通常為 `https://<cluster-host>:6333`）和 API Key，稍後填入 GitHub Secrets，而不是 GitHub 程式碼或 Issue。請保留端點提供的 `https://` 與 `:6333`，不要填叢集管理後台網址。
3. 選擇 collection 名稱，例如 `pulipuli_blog_chunks`，稍後加入 GitHub Variable `QDRANT_COLLECTION`。
4. 不需要手動建立 collection：第一次匯入時 Worker 會依 embedding 的實際向量維度建立 collection。

## 第 3 步：Cloudflare API Token / Account ID

1. 在 Cloudflare Dashboard 找到 Account ID。
2. 開啟 Cloudflare 帳號的 API Tokens 頁面，建立 **專用、限縮本帳號** 的部署 Token。首次透過 `wrangler deploy` 建立新 Worker，需 Workers 產品層級 **Admin**；若 Worker 已存在才可縮減為該 Worker 的 **Editor**。另需授予操作 D1 migrations 所需的 D1 讀寫權限。請依 Cloudflare 當下介面選取對應的權限，切勿使用 Global API Key。
3. 建議不要使用 Global API Key，也不要把 Token 填在任何 Git 追蹤的檔案。

參考 Cloudflare 官方文件：[GitHub Actions CI/CD](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 與 [Workers 權限](https://developers.cloudflare.com/workers/authorization/workers/)。

## 第 4 步：在 GitHub 設定 Repository Variables / Secrets

進入本 repository → **Settings → Secrets and variables → Actions**。

### Variables（非機密）

- `D1_DATABASE_ID`：剛建立的 D1 UUID。
- `QDRANT_COLLECTION`：例如 `pulipuli_blog_chunks`。
- `ENABLE_AUTO_DEPLOY`：初次設定可不填，或填 `false`；首次手動部署成功後，設為 `true` 以便後續 `main` 分支 CI 通過即自動部署。

### Secrets（不公開）

- `CLOUDFLARE_API_TOKEN`：專用部署 API Token。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID（也可公開，但此流程統一儲存在 Secrets）。
- `INGEST_TOKEN`：至少 32 bytes 隨機產生的 Bearer Token，供 Worker 的 `/internal/ingest` 使用。
- `QDRANT_URL`：Qdrant cluster URL（包含 `https://`）。
- `QDRANT_API_KEY`：Qdrant API Key。

Secrets 由 GitHub Actions 部署步驟寫入 Cloudflare Worker Secrets。除了初始在 GitHub Dashboard 設定，不需要手工進入 Cloudflare Worker 重新鍵入。

**重要：** `INGEST_TOKEN` 不要貼在對話或公開 repo；正式 Worker 和 GitHub 排程會使用同一個 GitHub Secret。

## 第 5 步：純雲端首次部署

1. 確認 [CI](../.github/workflows/ci.yml) 已通過。
2. 在 GitHub repository → **Actions → Deploy Cloudflare Worker → Run workflow**，選擇 `main` 手動執行。
3. 工作流程依序執行：Node.js 22 安裝與測試、D1 ID 檢查、動態產生 `wrangler.toml`、遠端 `wrangler d1 migrations apply DB --remote`、`wrangler deploy`、Worker Secrets 同步。
4. 到該次 Workflow logs 取得 `*.workers.dev` 公開網址（若使用自己的網域則採相應網址），開啟 `https://<worker-host>/health` 應回傳 `status: ok` 和 `database: ok`。
5. 首次部署完成後可把 `ENABLE_AUTO_DEPLOY` 設成 `true`。此後主分支 **push 所觸發的 CI 成功** 才會觸發自動部署；Pull Request 的 CI 不會使用正式部署憑證，避免部署未審核分支。

注意：此 workflow 會修改**遠端正式 D1**，請在合併資料庫 schema migration 前先審核變更及備份策略。

## 第 6 步：設定兩天一次的文章同步

GitHub Repository → Settings → Secrets and variables → Actions：

- 保留上面的 `INGEST_TOKEN` Secret（部署和同步流程共用同一個值）。
- 新增 `INGEST_URL` Secret：`https://<worker-host>/internal/ingest`。

到 GitHub Actions → **Refresh blog index** → Run workflow，手動啟動首次匯入（初次請勿選擇重設回填）。工作流程每次分批呼叫 Worker，使用 D1 游標接續歷史文章。定期排程在每天 02:17 UTC 檢查日期奇偶，每兩天執行一次；GitHub Actions 排程時間可能延遲。

## 第 7 步：驗證網站與 ChatGPT MCP

- `GET https://<worker-host>/`：搜尋網頁。
- `GET https://<worker-host>/health`：Worker / D1 健康檢查。
- `GET https://<worker-host>/api/search?q=Cloudflare&mode=keyword`：先測關鍵字搜尋。
- `https://<worker-host>/mcp`：在支援 Streamable HTTP 的 MCP 用戶端新增此端點，測試 `search_articles` 和 `get_article`。

確認完整回填成功後，再檢查語意／混合搜尋與 Workers AI / Qdrant 配額。

## 安全與額度

- GitHub 公開倉庫只能包含範例及非機密程式碼；API Token、向量資料庫金鑰和同步 Token 必須在 GitHub Secrets。
- 產生的 `wrangler.toml` 在 GitHub 暫時性 runner 中生成並由 `.gitignore` 忽略，**不需要任何本機操作**。
- Cloudflare Workers、Workers AI、D1、Qdrant Cloud 與 GitHub Actions 的免費額度會變動；首次回填需分批驗證。
- `npm run dev` 與 `.dev.vars.example` 只保留給其他開發者選用，**不是本專案部署的必要步驟**。
