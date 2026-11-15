你是實作者。完成任務 T-1（多國語言的基礎架構），不要做 T-2、T-3。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\i18n\1-requirements.md`
3. `C:\presonal_project\Switching_account\docs\work\i18n\2-spec.md`（含文末審查紀錄，審查結論優先）

## 範圍（所有程式在 `C:\presonal_project\Switching_account\app\`）

1. 新增 `src/shared/i18n/index.ts`、`ui.ts`、`main.ts`，照規格「字典與 `t()`」一節。
   - `ui.ts`、`main.ts` 這次只放 T-1 用到的鍵（設定頁語言選項、系統匣「開啟視窗」「結束」、tooltip、視窗標題、`continue_prompt` 預設值不需鍵）。T-2、T-3 會補其他鍵。
   - 匯出 `defaultContinuePrompt(lang)`（`'繼續'`／`'continue'`）與 `BUILTIN_CONTINUE_PROMPTS = ['繼續', 'continue']`。
2. `src/core/config.ts`：`language` 欄位（預設 `'auto'`，壞值回 `'auto'`）；`continue_prompt` 依規格（值是內建預設之一或無效 → 目前語言預設）。新增 `validateLanguage(v)`。
3. `src/shared/types.ts`：`AppConfig.language`、`AppConfigPatch.language`、`AppState.language`。
4. `src/main/controller.ts`：只改這幾處：
   - 建構時（讀完 cfg 後）`setLanguage(resolveLanguage(cfg.language))`。
   - `setConfig` 支援 `language`（壞值 `fail(..., 'INVALID')`）；語言改變時 `setLanguage`，若 `continue_prompt` 為內建預設之一則換成新語言預設。
   - `getState()` 加 `language: getLanguage()`。
   - 其他字串**不要動**（T-3 的工作）。
5. `src/main/index.ts`：在建立 `Controller` 前 `setSystemLocales(app.getPreferredSystemLanguages())`；視窗標題、系統匣選單、通知標題用 `t()`；push 狀態時語言和上次不同 → 重建系統匣選單、`mainWin.setTitle(...)`。`src/main/trayPolicy.ts` 的 `trayTooltip` 用 `t()`。
6. renderer：
   - `src/renderer/src/lib/i18n.ts`：`LangContext`、`useT()`（讀 context 並回傳 `t`）。
   - `App.tsx`：有 state 時 `setLanguage(state.language)`、設 `document.documentElement.lang`（`zh-Hant-TW`／`en`），以 `LangContext.Provider` 包住畫面。
   - 設定「一般」頁（`src/renderer/src/pages/settings/SettingsPages.tsx`）加「語言」下拉，選項 `auto`、`zh-TW`（顯示「繁體中文」）、`en`（顯示「English」），呼叫既有的 setConfig。
   - `src/renderer/src/lib/mock-api.ts` 補欄位讓它能編譯。
   - 其他介面字串**不要動**（T-2 的工作）。
7. `vitest.config.ts`：`env: { CLAUDE_SWITCHER_LANG: 'zh-TW' }`。
8. 測試（新檔 `tests/i18n.test.ts`，必要時改 `tests/config.test.ts`）：
   - `normalizeLocale`：zh-TW、zh-HK、zh-MO、zh-Hant-TW、zh-CN、en-US、ja-JP、空字串。
   - `resolveLanguage`：明確設定優先於環境變數；`auto` 用環境變數。
   - `t()`：參數取代、缺參數保留 `{x}`、未知鍵回傳鍵名。
   - 字典：ui 與 main 各自兩語言鍵一致、`{參數}` 集合一致、沒有空字串、ui 與 main 鍵不重複。
   - config：`language` 預設與壞值；`continue_prompt` 為 `'繼續'` 且語言 en → `'continue'`；自訂值 `'請繼續'` 不變；空字串不變。
   - controller：`setConfig({ language: 'en' })` 後 `getState().language === 'en'`，`continue_prompt` 由 `'繼續'` 變 `'continue'`；測試結束還原 `setLanguage('zh-TW')`。

## 規則

- 只改 `app/` 內的檔案，不要在其他地方建立檔案。只用讀檔、改檔與下列指令，不要使用其他工具或工作流程。
- `src/core/*`、`src/shared/*` 不得 import electron。不新增 npm 套件。
- 測試用 `tests/helpers.ts` 的 `useTempEnv`。
- 程式註解用繁體中文（台灣用語）。不要 commit，不要改規格與 CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

兩者都要通過才算完成。

## 回報

改了哪些檔案、新增哪些測試、兩個指令的結果行、與規格不同之處。用繁體中文。
