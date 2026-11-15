你是實作者。完成任務 T-3（main、core、scripts 的使用者可見字串改成多國語言），不要做其他任務。T-1（`src/shared/i18n/`）已完成。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\i18n\2-spec.md`（審查紀錄優先；「main 與 core 的使用者可見字串」一節）
3. `C:\presonal_project\Switching_account\app\src\shared\i18n\index.ts`、`main.ts`（照它的用法）

## 範圍（`C:\presonal_project\Switching_account\app\`）

- 只改 `src/main/controller.ts`、`src/core/*.ts`、`src/scripts/statusline.ts`、`src/scripts/runner.ts`、`src/shared/i18n/main.ts`，以及因此需要調整的 `tests/*`。
- 會出現在畫面、事件紀錄（`this.log`）、通知（`notify`）、`fail(...)` 錯誤、runner 視窗、statusline 的中文字串，改成 `t('鍵', 參數)`；`mainZh` 放原文、`mainEn` 放英文。
  - 含帳號名稱、email、資料夾、PID、指令等變數一律用 `{參數}`，不要拼接字串片段。
  - 英文簡短清楚，例如 `Switched: {from} → {to} ({reason})`、`All accounts are exhausted; not switching`。
- `statusline.ts`、`runner.ts`：開頭讀 `config.json` 的 `language`（用已 import 的 `storage.readJson` 與 `paths.configFile()`），`setLanguage(resolveLanguage(值))`；沒有檔案或欄位時 `resolveLanguage('auto')`。
- **不改**：`src/scripts/switcher-run.ts`、程式註解、只寫到 console 的除錯訊息（可不翻）、和伺服器回傳文字比對的字串、`config.ts` 的內建預設 `'繼續'`。
- 不改邏輯。測試斷言的中文在 zh-TW（vitest 環境變數）下應仍成立；若斷言因改用 `t()` 而改變，修測試讓它比對 `t('鍵', 參數)` 或原文。
- 新增測試：controller 在 `setLanguage('en')` 時產生的一筆事件為英文（結束還原 `'zh-TW'`）；statusline 在 `CLAUDE_SWITCHER_LANG=en`、帳號未儲存時輸出英文字樣。
- 不改 `src/renderer/**`、`src/shared/i18n/ui.ts`、`src/shared/i18n/index.ts`（另一個任務正在改）。

## 完成條件

- 上述檔案中，除了註解、console 除錯訊息、刻意保留的常數，不再有中文字串。

## 規則

- 只改上述檔案；不要在其他地方建立檔案。只用讀檔、改檔與下列指令，不要使用其他工具或工作流程。不新增 npm 套件。
- `src/core/*` 不得 import electron。token 不得出現在 log。
- 程式註解用繁體中文（台灣用語）。不要 commit，不要改規格與 CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

## 回報

改了哪些檔案、新增多少鍵、新增的測試、兩個指令的結果行、刻意保留中文的地方與原因。用繁體中文。
