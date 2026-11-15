# 需求：Claude Code 多帳號切換器（GUI）

## 目標

讓擁有兩個以上 Claude 訂閱帳號的使用者，在一個帳號的 5 小時或每週額度用完時，透過 GUI 一鍵（或自動）切換到另一個帳號，並在同一個專案資料夾用 `claude --continue` 接著原本的對話繼續做。

## 使用者決定（2026-11-13）

- 技術：Python 3.13 + tkinter（之後可用 PyInstaller 打包成 .exe）。
- 自動切換：GUI 在 Windows Terminal 啟動並託管 `claude`；偵測到額度用完時，自動結束、換帳號、用 `claude --continue` 在同一資料夾重開。
- 用量顯示：安裝 statusline 腳本，把 Claude Code 傳來的 `rate_limits` 寫入檔案給 GUI 讀取。

## 驗收條件

- **AC-1** 帳號清單：GUI 列出所有已儲存的帳號（名稱、email、是否為目前使用中）。
- **AC-2** 新增帳號：使用者按「儲存目前登入的帳號」並輸入名稱後，目前的 `~/.claude/.credentials.json` 與 `~/.claude.json` 的 `oauthAccount` 會存成一個 slot；清單出現該帳號。
- **AC-3** 手動切換：在清單選一個帳號按「切換」後，先把目前的憑證寫回目前帳號的 slot，再把所選帳號的憑證寫入 `~/.claude/.credentials.json`、更新 `~/.claude.json` 的 `oauthAccount`；之後新開的 `claude` 使用新帳號（`/status` 顯示新 email）。
- **AC-4** 刪除帳號：可刪除 slot（需確認對話框）；不能刪除目前使用中的帳號。
- **AC-5** 用量顯示：statusline 腳本安裝後，GUI 顯示目前帳號的 5 小時與 7 天用量百分比與重置時間；資料超過一定時間未更新時顯示「資料過舊」。
- **AC-6** 啟動託管：使用者在 GUI 選一個專案資料夾按「啟動 claude」，GUI 在 Windows Terminal 開啟 `claude`（工作目錄為該資料夾）。
- **AC-7** 自動切換：託管中的 `claude` 額度用完（或用量達使用者設定門檻，預設 95%）時，GUI 自動：結束該 `claude` 視窗、切換到下一個「未用完」的帳號、在同一資料夾以 `claude --continue` 重開；GUI 的事件紀錄顯示這次切換。
- **AC-8** 全部用完：所有帳號都用完時不切換，GUI 顯示通知與最早的重置時間。
- **AC-9** 安裝／移除整合：GUI 有按鈕安裝或移除整合設定；只改 `~/.claude/settings.json` 的 `statusLine` 欄位與本程式加入的 hook 項目（`Stop`、`StopFailure`），其他設定原樣保留，修改前先備份。（2026-11-13 修訂：加入 hook，使用者已確認）

## 不做的範圍

- 不支援 macOS／Linux（macOS 憑證在 Keychain）。
- 不託管 VS Code 擴充套件、桌面版 Claude app 或 claude.ai 網頁的對話。
- 不加密 slot 檔（與原本 `.credentials.json` 同等保護：只存在使用者目錄）。
- 不做打包成 .exe（之後再說）。

## 限制

- 介面文字、註解只用繁體中文（台灣用語）或英文。
- 只用 Python 標準函式庫。
- 寫入憑證檔要原子化（先寫暫存檔再取代），避免 Claude Code 讀到一半的檔案。
- 風險告知：使用多帳號繞過用量限制可能違反 Anthropic 使用條款，README 需註明。
