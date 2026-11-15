你是實作者。完成任務 T-1（模型分工 skill 設定引導與功能開關）。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\skill-setup\1-requirements.md`
3. `C:\presonal_project\Switching_account\docs\work\skill-setup\2-spec.md`（文末「審查紀錄」R-1～R-8 **優先於前文**）

## 範圍（所有程式在 `C:\presonal_project\Switching_account\app\`）

照規格實作全部內容，除了 README 與 `skills/model-routing/SKILL.md`（已完成，不要改）：

- `scripts/build-scripts.mjs`：複製內附 skill。
- 新檔 `src/core/skillsetup.ts`。
- `src/core/config.ts`：`routing_enabled`。
- `src/main/controller.ts`：`routingSetup` 狀態、`checkRoutingSetup`、`installSkill`、`uninstallSkill`、`routing_enabled`、可注入依賴（`findAgy`、`readBundledSkill`）。
- `src/shared/types.ts`、`src/preload/index.ts`、`src/main/index.ts`（IPC 註冊）、`src/renderer/src/lib/mock-api.ts`。
- `src/scripts/switcher-run.ts`：關閉時直接 delegate（R-4）。
- renderer：新元件 `src/renderer/src/components/RoutingSetupCard.tsx`；設定「模型分工」頁加開關、卡片、關閉時詢問移除 skill；`NavSidebar` 隱藏「派工」；App 層頁面守衛（R-5）。
- 文字：介面用 `src/shared/i18n/ui.ts`（`uiZh`／`uiEn` 都要加），controller 的 log／錯誤用 `src/shared/i18n/main.ts`。**不要寫死中文或英文字串**；含變數用 `{參數}`。
- 測試：照規格「驗證」與 R-2、R-4、R-7、R-8。新測試檔可用 `tests/skillsetup.test.ts`，controller 與 switcher-run 的測試加在既有檔案。

## 既有慣例（照做）

- 讀既有元件的寫法（`useT()`、`act()`、shadcn 元件在 `src/renderer/src/components/ui/`、確認對話框用 `AlertDialog`）。
- 新增 IPC 照既有 `installIntegration` 的寫法（types 的 `Api` 與 `IPC` 常數、preload、main `ipcMain.handle`）。
- 寫檔用 `storage.writeFileAtomic`／`writeJsonAtomic`；路徑用 `core/paths`。
- `src/core/*` 不得 import electron。switcher-run 可 import 的模組見 CLAUDE.md。

## 規則

- 只改 `app/` 內的檔案，不要在其他地方建立檔案。只用讀檔、改檔與下列指令，不要使用其他工具或工作流程。不新增 npm 套件。
- 測試用 `tests/helpers.ts` 的 `useTempEnv`；不得碰真實 `~/.claude`、不得啟動真正的 agy。
- 程式註解用繁體中文（台灣用語）。不要 commit，不要改規格、README、CLAUDE.md、`skills/`。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

兩者都要通過才算完成。邊做邊存檔，不要等全部想完才寫。

## 回報

改了哪些檔案、新增哪些測試、兩個指令的結果行、與規格不同之處。用繁體中文。
