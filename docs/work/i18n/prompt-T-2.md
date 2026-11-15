你是實作者。完成任務 T-2（renderer 介面字串改成多國語言），不要做其他任務。T-1（`src/shared/i18n/`、`useT()`、`LangContext`）已完成。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\i18n\2-spec.md`（審查紀錄優先）
3. `C:\presonal_project\Switching_account\app\src\shared\i18n\index.ts`、`ui.ts`、`src\renderer\src\lib\i18n.ts`（T-1 的成果，照它的用法）

## 範圍（`C:\presonal_project\Switching_account\app\`）

- 只改 `src/renderer/src/**`（`lib/mock-api.ts` 的假資料內容不必翻）與 `src/shared/i18n/ui.ts`。
- 把畫面上所有中文（標籤、按鈕、標題、說明、提示、placeholder、tooltip、aria-label、toast、確認對話框、空狀態）改成 `t('鍵')`，在 `ui.ts` 的 `uiZh` 放原文、`uiEn` 放英文。
  - 元件內用 `const t = useT()`；非元件的函式（如 `lib/format.ts`）直接 import `t`。
  - 模組層級的常數陣列改存鍵，渲染時才翻譯。
  - 含變數的字串用 `{參數}`：`t('overview.resetAt', { time })`。不要把字串拆成幾段拼接。
  - 英文用簡短的介面慣用語：Overview、Accounts、Dispatch、Event log、Settings、General、Account switching、Auto compact、Model routing、Claude Code integration、Switch to this account、Browser login、Save current login、Install integration、Remove integration。
- 不改邏輯、樣式、class。不改程式註解。
- 不改 `src/main`、`src/core`、`src/scripts`、`src/shared/i18n/main.ts`、`src/shared/i18n/index.ts`（另一個任務正在改）。

## 完成條件

- 在 `src/renderer/src` 中，除了註解與 `mock-api.ts`，不再有中文字串。
- 既有測試通過（renderer 測試若斷言中文，在 zh-TW 下仍成立）。

## 規則

- 只改上述檔案；不要在其他地方建立檔案。只用讀檔、改檔與下列指令，不要使用其他工具或工作流程。不新增 npm 套件。
- 程式註解用繁體中文（台灣用語）。不要 commit，不要改規格與 CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

## 回報

改了哪些檔案、新增多少鍵、兩個指令的結果行、刻意保留中文的地方與原因。用繁體中文。
