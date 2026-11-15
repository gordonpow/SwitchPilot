你是實作者。完成 `C:\presonal_project\Switching_account\docs\work\earliest-reset\2-spec.md` 的全部內容。先讀 `C:\presonal_project\Switching_account\CLAUDE.md`、同目錄 `1-requirements.md` 與 `2-spec.md`。所有程式在 `C:\presonal_project\Switching_account\app\`。

- 先讀 `src/main/controller.ts` 的 `runSwitch`、`handleLiveFailures`、`continueSession`、`promptEligible`、`clearExhausted`、tick 流程，以及 `src/core/claudeavail.ts` 的 `slotBlocked`、`src/core/switchplan.ts`，照既有寫法實作。
- 介面與 log 文字用 `src/shared/i18n/ui.ts`／`main.ts`（中英都加），不寫死字串。
- 測試用 `tests/helpers.ts` 的 `useTempEnv`，照既有 controller 測試注入假依賴；不得碰真實環境、網路或真實程序。
- 程式註解用繁體中文（台灣用語）。不要 commit，不要改規格與 CLAUDE.md。
- 工作目錄 `C:\presonal_project\Switching_account\app`，PATH 需含 `C:\Program Files\nodejs`；`npm run typecheck` 與 `npm test` 都要通過（只看結果摘要行）。

回報：改了哪些檔案、新增的測試、兩個指令的結果行、與規格不同之處。繁體中文，500 字以內。
