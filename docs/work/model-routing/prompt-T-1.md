你是實作者。完成任務 T-1 與 T-1b，不要做其他任務（T-2、T-3 不做）。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`（專案規則與不變條件）
2. `C:\presonal_project\Switching_account\docs\work\model-routing\2-spec-phase2.md`（規格）。**文末「審查紀錄」R-1～R-11 優先於前文。** 本次相關：AC-10'、AC-13'、AC-13b、「執行中登記」「routing」「switcher-run」「Claude 可用性」各節，R-2、R-3、R-4、R-5、R-6、R-9、R-10。

## 範圍（工作目錄是 `app/`）

- 新增 `src/core/dispatchlog.ts`、`src/core/claudeavail.ts`。
- 修改 `src/core/paths.ts`（`dispatchRunningDir`）、`src/core/routing.ts`（`max_concurrent_per_account`、`maxConcurrent`、`DEFAULT_ROUTING` 依 AC-13b）、`src/scripts/switcher-run.ts`（`handleAgyEntry` 鎖只保護挑選／切換／登記；登記後釋放鎖再執行 agy；finally 取消登記；額度用完換帳號依 R-2；`dispatch()` 的 claude 項先呼叫 claudeavail，依 R-9 訊息）。
- `src/main/controller.ts` 只改一處：`isBlocked` 改呼叫 `claudeavail.slotBlocked`（R-5），行為不變。其他 controller 修改屬 T-2，不要做。
- 測試：`tests/dispatchlog.test.ts`、`tests/claudeavail.test.ts`（新增）；`tests/routing.test.ts`、`tests/switcher-run.test.ts`（補案例，依規格 T-1、T-1b 列表與 R-3、R-10）。參考既有測試的寫法與 `tests/helpers.ts` 的 `useTempEnv`、`tests/fixtures/` 的假程式。

## 規則

- `src/core/*` 不得 import electron；`switcher-run` 不得 import `oauth`；`dispatchlog` 不得 import `sessions`。
- 寫檔用 `storage.writeJsonAtomic`；token 不得出現在 log、輸出、登記檔、dispatch 檔。
- 測試不得碰真實 `~/.claude`、`~/.claude-switcher`、不得對網路發請求、不得啟動真正的 agy／claude。
- 程式註解用繁體中文（台灣用語）或英文，不得用簡體中文。
- 不要 commit，不要修改規格與 CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已正確。

- `npm run typecheck`
- `npm test`

兩者都要通過才算完成。

## 回報

最後回覆：改了哪些檔案、新增哪些測試、`npm run typecheck` 與 `npm test` 的結果行（例如 `Tests 410 passed`）、與規格不同之處。用繁體中文。
