# 需求：以 Electron 重寫帳號切換器（多帳號用量總覽）

## 目標

把 Python／tkinter 版的 Claude 帳號切換器改寫成 Electron + React + Vite + Tailwind CSS + shadcn/ui，介面現代、好看；並能一次看到所有帳號的 5 小時／7 天用量。程式不再使用 Python。

## 使用者決定（2026-11-13）

- 架構：Electron + React + Vite + Tailwind CSS + shadcn/ui；設計參考 `npx ui-skills`。
- 不使用 Python；現有 Python 版保留到新版完成。
- 多帳號用量：用 Claude Code `/usage` 所用的 API（`api.anthropic.com/api/oauth/usage`），未使用中帳號的 token 過期時由本程式自動 refresh。
- 登入：保留「新增帳號（瀏覽器登入）」；瀏覽器可選 Chrome 無痕／Edge InPrivate／預設（先前提議，併入本次）。

## 驗收條件

功能沿用 Python 版（`docs/work/account-switcher/1-requirements.md` AC-1～AC-9、`docs/work/google-login/1-requirements.md` AC-1～AC-6），以下為新版必須全部滿足的條件：

- **AC-1** 帳號卡片：每個帳號一張卡片，顯示名稱、email、使用中標籤、5 小時與 7 天用量進度條（百分比與重置時間）、資料更新時間；可切換、重新命名、刪除（確認對話框；使用中不可刪）。
- **AC-2** 多帳號用量：所有帳號（含未使用中）的用量自動更新（預設每 2 分鐘，可手動重新整理）；未使用中帳號 token 快過期時自動 refresh 並存回；refresh 失敗的帳號卡片顯示「需要重新登入」與「重新登入」按鈕。使用中帳號不由本程式 refresh。
- **AC-3** 新增帳號：瀏覽器登入（Chrome 無痕／Edge InPrivate／預設，選擇會記住），不影響目前登入；以及「儲存目前登入的帳號」。
- **AC-4** 手動切換：同 Python 版 AC-3（先寫回目前 token、替換憑證與 `oauthAccount`、驗證）；有託管中的 claude 時詢問是否一併重啟。
- **AC-5** 啟動託管：選資料夾後在 Windows Terminal 啟動 claude（可選 `--continue`）；顯示託管中視窗數。
- **AC-6** 自動切換：同 Python 版 AC-7（門檻預設 95%、等回合結束、`rate_limit` hook 立即、逾時中止）；選下一個帳號時跳過已標記用完或 API 用量已達門檻的帳號。
- **AC-7** 全部用完：不切換，顯示通知與最早重置時間。
- **AC-8** 整合安裝／移除：同 Python 版 AC-9；statusline 與 hook 改用 Node 腳本執行。
- **AC-9** 資料相容：沿用 `%USERPROFILE%\.claude-switcher` 與 Python 版相同的 slot／config／usage／events／runs 檔案格式，Python 版存的帳號在新版直接可用。
- **AC-10** 外觀：深色主題（跟隨系統亦可）、shadcn/ui 元件、lucide 圖示；視窗最小 900×640 可正常排版；事件紀錄可捲動。
- **AC-11** 交付：`npm run dev` 可開發執行；`npm run package` 產生可攜式 Windows `.exe`。

## 不做的範圍

- macOS／Linux。
- 移除 Python 版（新版驗收後另行處理）。
- 自動更新、安裝程式（只做可攜式 exe）。

## 限制

- 介面文字、註解、文件只用繁體中文（台灣用語）或英文。
- Node 需升級到 22 LTS（Vite／Tailwind 新版需要 20.19 以上）。
- statusline／hook／runner／登入時的 BROWSER 腳本以系統的 `node` 執行；安裝整合時複製到 `%USERPROFILE%\.claude-switcher\bin\`，路徑不隨 exe 位置改變。
- 用量 API 與 token refresh 是未公開介面，可能隨 Claude Code 改版失效；失效時退回 statusline 資料，不得影響切換功能。
- token 只送往 `api.anthropic.com` 與 `platform.claude.com`，不得記錄到 log。
