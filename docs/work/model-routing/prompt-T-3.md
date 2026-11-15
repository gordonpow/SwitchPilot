你是實作者。完成任務 T-3（AC-14'：自動整理後清除畫面），不要做其他任務。T-1、T-2 已完成。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\model-routing\2-spec-phase2.md`：AC-14'、「整理後清畫面（AC-14'）」一節、「實測紀錄」，以及文末審查紀錄 **R-7、R-8（優先於前文；取消「15 秒後備」）**。

## 範圍（所有程式在 `C:\presonal_project\Switching_account\app\`）

- `resources/scripts/inject.ps1`：新增 `-CtrlKey <A-Z>`。送 Ctrl+字母：按下與放開各一筆 `KEY_EVENT`，`wVirtualKeyCode` = 大寫字母碼、`UnicodeChar` = 字母序號（L → 0x0C）、`dwControlKeyState` = 0x0008。與 `-TextB64` 互斥；字母不是 A–Z 時 exit 2。**此檔註解只能用英文**（PowerShell 5.1 以系統碼頁讀無 BOM 檔）。
- `src/core/coninject.ts`：新增 `injectCtrlKey(pid, letter)`，執行方式比照 `injectLine`。
- `src/core/config.ts`：`auto_compact.clear_screen_after: boolean`（預設 true，壞值回預設），`mergeAutoCompact` 支援。
- `src/main/controller.ts`（auto compact 段：搜尋 `maybeCompact`、`compactInFlight`）：依 R-7 實作 pendingClear：
  - 只在動作是 `/compact` 且 `injectSubmit` 回 true、且 `clear_screen_after` 為 true 時建立 `{ pid, sid, sentAt, sawBusy, ctxAtSend }`。
  - 每個 tick 重讀 sessions 檔，以 `pid` 與 `sessionId === sid` 雙重比對；程序不存在或對不上 → 移除。
  - 看到非 idle → `sawBusy = true`。`idle` 且（`sawBusy` 或 statusline 的 `context.used_percentage` 低於 `ctxAtSend`）→ 送 Ctrl+L、log「已清除 <資料夾> 的畫面」、移除。
  - 該 session 有 ts > sentAt 的 `prompt` 事件 → 移除不送。超過 600 秒 → 移除不送。
  - 送 Ctrl+L 時與其他注入串行（沿用 `compactInFlight`），且該 session 不在 live 模式「繼續」的處理中。
  - controller 透過既有可注入的 cli 依賴呼叫（比照 `injectSubmit` 的注入方式），測試用假實作。
- 設定頁「自動整理上下文」（在 `src/renderer/src/` 找對應設定頁或元件）加開關「整理後清除畫面」；動作為 `/clear` 時停用。`lib/mock-api.ts` 與型別補欄位。
- 測試：config 預設與壞值；controller：compact 後 busy→idle 送 Ctrl+L、context 下降時送、新 prompt 取消、逾時不送、程序消失移除、`injectSubmit` 失敗不建立。

## 規則

- 只改 `app/` 內的檔案，**不要在其他地方建立檔案**。只用讀檔、改檔與下列指令，不要使用其他工具或工作流程。
- `src/core/*` 不得 import electron。token 不得出現在 log。
- 測試用 `tests/helpers.ts` 的 `useTempEnv`；不得啟動真正的 PowerShell 注入或 claude（用注入的假實作）。
- 程式註解與介面文字用繁體中文（台灣用語），`inject.ps1` 用英文。
- 不要 commit，不要修改規格與 CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

兩者都要通過才算完成。

## 回報

改了哪些檔案、新增哪些測試、兩個指令的結果行、與規格不同之處。用繁體中文。
