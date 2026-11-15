# 需求：agy 帳號管理、依階段選模型與多帳號資源調度（草稿）

## 目標

使用者有多個 Claude 帳號與多個 agy（Antigravity，Google 帳號）帳號。希望在本程式中：

1. 管理 agy 帳號（登入、切換、看剩餘額度）。
2. 隨時設定 dev-workflow 各階段要用哪個供應商與模型，並設定額度用完時的備援順序。
   - 範例：需求定義用 Claude Opus；實作用 agy 的 Sonnet，agy 額度用完改用 Claude Sonnet。
3. 把多個帳號平行使用並調度資源：派工時自動挑有額度的帳號，必要時多個帳號同時跑。

## 研究結果（2026-11-13）

- agy 1.5.8 的登入存在 Windows 認證管理員 `gemini:antigravity`，內容為 JSON：`token{access_token, refresh_token, expiry, …}`、`auth_method`（consumer）、`id_token_email`。每次啟動 agy 都會從這裡讀 token，所以換掉這筆資料就能切換帳號（同 Claude 的 slot 做法）。
- agy 的額度可查（已實測）：主機 `daily-cloudcode-pa.googleapis.com`，header `User-Agent: antigravity/<版本> windows/amd64`（不帶這個 User-Agent 會回 403「no valid license」）。
  - `POST v1internal:loadCodeAssist`，body `{"metadata":{"ideType":"ANTIGRAVITY","pluginType":"GEMINI"}}` → 回傳 `cloudaicompanionProject`、`currentTier`（例：free-tier）。
  - `POST v1internal:fetchAvailableModels`，body `{}` → `models.<id>.quotaInfo.{remainingFraction, resetTime}`。
  - `POST v1internal:retrieveUserQuota`，body `{"project":<id>}` → `buckets[]`。
  - 實測當下：agy 的 `claude-sonnet-4-6`、`claude-opus-4-6-thinking` 剩約 2.6%，11/18 重置；Gemini 系列 100%。
- 非使用中 agy 帳號的 token 更新：需要 agy 內嵌的 OAuth client secret。從 binary 取出並使用它的嘗試被權限機制拒絕（Credential Exploration），因此第一期**不**由本程式 refresh agy token：非使用中帳號的額度顯示「最後一次查到的值」與重置時間，切換到該帳號後由 agy 自己 refresh。
- agy 的 binary 中有 `JETSKI_OAUTH_TOKEN` 環境變數，可能可讓單一 agy 程序使用指定 token（未驗證）。若可行，多個 agy 帳號就能同時執行，不必切換全域登入。
- Claude 可用 `CLAUDE_CONFIG_DIR` 讓單一 `claude -p` 程序使用指定帳號，因此多個 Claude 帳號也能同時執行。
- agy 的指令權限規則只接受完全相同的字串（見 dev-workflow `run-agy-impl.sh`）。

## 驗收條件（草稿，待確認）

### A. agy 帳號

- **AC-1**：「agy 帳號」區塊列出已儲存的 agy 帳號：email、是否為目前使用中、剩餘額度（各模型或整體百分比）與重置時間。
- **AC-2**：「新增 agy 帳號」：
  1. 先備份目前登入。
  2. 開一個終端機執行 `agy`，由使用者在瀏覽器完成 Google 登入。
  3. 偵測到新 email 後存成帳號，並還原原本的登入。
- **AC-3**：手動切換 agy 帳號，也就是替換 `gemini:antigravity`。切換前先把目前帳號更新過的 token 存回。
- **AC-4**：agy 剩餘額度每 5 分鐘更新一次（使用中帳號；非使用中帳號在其 access token 未過期時也查，過期則顯示最後一次的值與時間）。查詢失敗時，卡片顯示原因；每個帳號都顯示額度的最後更新時間。

### B. 依階段選模型

- **AC-5**：「模型分工」設定頁，每個階段可設定一個有順序的備援清單，每一項為「供應商＋模型（＋可選的帳號範圍；第一期只有 agy 生效，Claude 一律用目前帳號）」。
  - 階段：需求定義、規格、規格審查、實作、實作審查／驗證、查資料、文件草稿。
  - 供應商：Claude（Opus／Sonnet／Haiku）、agy（列出 `agy models` 的模型）。
- **AC-6**：設定存成 `~/.claude-switcher/routing.json`。dev-workflow skill 改為在派工前讀這個檔，依清單選擇執行者。
- **AC-7**：提供預設值：需求定義、規格用 Claude Opus；實作用 agy Sonnet，備援為 Claude Sonnet；審查用 Claude Sonnet；查資料、文件草稿用 Claude Haiku。

### C. 資源調度

- **AC-8**：提供指令 `switcher-run --role <階段> --prompt <檔> --out <檔> [--cwd <目錄>]`，給 dev-workflow 呼叫。它依 routing 清單挑第一個「有額度的供應商與帳號」執行，並回報實際使用的模型與帳號。
- **AC-9**：執行中遇到額度錯誤時，標記該帳號用完（到重置時間），改用清單中的下一項重跑同一個提示，並在結果中註明。
- **AC-10**：多個任務同時派出時，分散到不同帳號（每個帳號同時最多 N 個任務，N 可設定）。Claude 以 `CLAUDE_CONFIG_DIR` 隔離；agy 以 `JETSKI_OAUTH_TOKEN` 隔離，若驗證不可行就退回「同一時間只用一個 agy 帳號」。
- **AC-11**：GUI 顯示目前執行中的派工：階段、供應商、模型、帳號、開始時間、狀態。

### D. 自動整理上下文（使用者 2026-11-13 加入第一期）

研究：Claude Code 2.1.32x 傳給 statusline 的 JSON 含 `context_window.{total_input_tokens, total_output_tokens, context_window_size, current_usage, used_percentage, remaining_percentage}`。Claude Code 沒有讓外部程式執行 `/compact` 的介面，所以改用已實測的 console 輸入（`coninject.injectSubmit`）送進該 claude 的輸入框。

- **AC-12**：statusline 腳本記錄每個 session 的上下文用量（`used_percentage`、`total_input_tokens`、`context_window_size`），「Claude CLI」清單每列顯示上下文百分比。
- **AC-13**：自動整理在以下條件**全部**成立時，對該 session 送出設定的動作：
  1. 功能開啟，且該 session 的資料夾在套用範圍內（預設全部）。
  2. 回合已結束：最新事件是 `Stop`，且 Claude 的 sessions 檔 `status` 為 `idle`。
  3. 有新的 prompt：上一次整理之後，該 session 有新的 `UserPromptSubmit` 事件。沒有新 prompt 就不處理。
  4. 上下文超過門檻：門檻可設為百分比（預設 60%）或 token 數。
  5. 等待期間沒有新動靜：回合結束後等待設定的秒數（預設 20 秒），期間沒有新事件，且狀態仍為 `idle`，才送出。
- **AC-14**：動作可選 `/compact`（預設，保留摘要）或 `/clear`（完全清除）。送出後記錄該 session 的整理時間，並在事件紀錄寫「已在 <資料夾> 執行 /compact（上下文 N%）」。
- **AC-15**：設定項目：開關（預設關）、門檻類型與數值、動作、等待秒數、套用資料夾清單（空白代表全部）。live 模式中正要送「繼續」的 session 不做整理。

## 不做的範圍

- 不在本程式中自動執行整個 dev-workflow（需求→實作→驗證的編排仍由 Claude Code 主導，本程式只提供設定與派工執行）。
- 不支援 Claude 與 agy 以外的供應商。
- 不處理 agy IDE（Antigravity 編輯器）的登入，只處理 CLI。

## 限制與風險

- agy 的登入格式、額度 API 都不是公開介面，agy 更新可能失效。
- 同時使用多個帳號規避額度可能違反 Anthropic 與 Google 的服務條款，由使用者自行評估。
- 只用繁體中文或英文；token 不得出現在 log 或畫面。

## 建議分期

1. **第一期**：A（agy 帳號：登入、切換、額度；使用者選方案 1：不 refresh 非使用中帳號的 token）＋ B（模型分工設定與 dev-workflow 讀取）＋ AC-8、AC-9（單一任務的挑選與備援）＋ D（自動整理上下文）。
2. **第二期**：AC-10、AC-11（多帳號同時執行與派工畫面）。
