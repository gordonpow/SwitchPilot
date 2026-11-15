你是實作者。完成任務 T-1B（自動更新的 controller、IPC、main、renderer）。另一位實作者同時做 T-1A（`src/core/updater.ts`、`src/core/paths.ts` 的 `updatesDir()`、`src/scripts/update.ps1` 與其測試），**不要建立或修改那些檔案**；依規格中的函式簽章 import 使用。若它還沒寫好造成 typecheck 失敗，等待並重試；最後兩個指令都要通過。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\auto-update\1-requirements.md`
3. `C:\presonal_project\Switching_account\docs\work\auto-update\2-spec.md`（文末「審查紀錄」R-1～R-9 **優先於前文**）

## 範圍（所有程式在 `C:\presonal_project\Switching_account\app\`）

照規格實作全部內容：

- `src/core/config.ts`：`update_check`、`update_include_prerelease`、`update_notified_version`。
- `src/main/controller.ts`：可注入依賴、排程、狀態 `update`、`checkUpdate`／`downloadUpdate`／`applyUpdate`／`openReleasePage`、清理與 ready 還原（R-5）、狀態機（R-8）。
- `src/main/index.ts`：注入 `net.fetch`、`app.getVersion()`、`PORTABLE_EXECUTABLE_FILE`、`shell.openExternal`、quit、detached spawn。
- `src/shared/types.ts`、`src/preload/index.ts`、IPC 註冊、`src/renderer/src/lib/mock-api.ts`。
- renderer：頁面 `settings/update`（`lib/pages.ts`、設定子選單、SettingsRouter）、`NavSidebar` 紅點（含窄版）。
- 文字：介面用 `src/shared/i18n/ui.ts`（`uiZh`／`uiEn` 都要加），controller 的 log／錯誤／通知用 `src/shared/i18n/main.ts`。不寫死中文或英文字串；含變數用 `{參數}`。
- 測試：controller 部分（規格「驗證」中 controller 的項目），新檔 `tests/controller-update.test.ts`；網路一律用假 fetch，spawn／quit 用注入的假函式。

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
