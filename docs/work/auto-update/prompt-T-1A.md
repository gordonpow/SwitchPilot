你是實作者。完成任務 T-1A（自動更新的核心模組與替換腳本）。另一位實作者同時做 T-1B（controller、IPC、main、renderer），**不要碰那些檔案**。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\auto-update\1-requirements.md`
3. `C:\presonal_project\Switching_account\docs\work\auto-update\2-spec.md`（文末「審查紀錄」R-1～R-9 **優先於前文**）

## 範圍（所有程式在 `C:\presonal_project\Switching_accountpp\`）

只做這些檔案：
- 新檔 `src/core/updater.ts`：規格「`src/core/updater.ts`」一節＋R-6、R-7（下載網址檢查）的全部函式，簽章照規格（T-1B 會依規格呼叫它們）。`downloadAsset` 另收 `isAllowedUrl` 檢查最終網址 `res.url`。
- `src/core/paths.ts`：新增 `updatesDir()`（`appDir()/updates`）。
- 新檔 `src/scripts/update.ps1`：規格「`update.ps1`」一節＋R-1～R-4、R-9（**註解只能用英文**，PowerShell 5.1 相容，參考同目錄 `inject.ps1`）。
- 新測試 `tests/updater.test.ts`（假 fetch，ReadableStream 回應）與 `tests/update-ps1.test.ts`（以 `child_process.spawnSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File', <resources/scripts/update.ps1>, ..., '-NoLaunch'])` 在暫存目錄用假檔測；非 win32 skip）。

不要改 controller、main、preload、types、renderer、i18n 字典、config。updater 丟出的錯誤訊息用英文常數即可（controller 會再包成翻譯後的訊息）。

## 既有慣例（照做）

- 讀既有程式的寫法：controller 的依賴注入與排程（`scheduleTick`、`schedulePoll`）、`useT()`、`act()`、shadcn 元件、`AlertDialog`、IPC（照 `installIntegration`）。
- 寫檔用 `storage.writeFileAtomic`／`writeJsonAtomic`（下載串流例外：寫 `.part` 後 rename）；路徑用 `core/paths`（新增 `updatesDir()`）。
- `src/core/*` 不得 import electron。token 不得出現在 log。
- 另一項功能（模型分工 skill 引導，`routingSetup`、`routing_enabled`）剛完成，**保留它的改動**，不要覆寫。

## 規則

- 只改 `app/` 內的檔案，不要在其他地方建立檔案。只用讀檔、改檔與下列指令，不要使用其他工具或工作流程。不新增 npm 套件。
- 測試用 `tests/helpers.ts` 的 `useTempEnv`；不得對真實網路發請求、不得碰真實 exe、不得啟動真正的程式。
- 程式註解用繁體中文（台灣用語），`.ps1` 用英文。不要 commit，不要改規格、README、CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

兩者都要通過才算完成。邊做邊存檔。

## 回報

改了哪些檔案、新增哪些測試、兩個指令的結果行、與規格不同之處。用繁體中文。
