# 規格：多國語言（i18n）

需求：`1-requirements.md`（AC-1～AC-9）。

## 設計

### 字典與 `t()`（`src/shared/i18n/`，純 TS，不 import electron／node 專屬模組以外的東西）

- `index.ts`
  - `export type Lang = 'zh-TW' | 'en'`；`export type LangSetting = 'auto' | Lang`。
  - `normalizeLocale(tag: string): Lang`：小寫比對，`zh-tw`、`zh-hk`、`zh-mo`、`zh-hant*` 開頭 → `zh-TW`，其他 → `en`。
  - `systemLocales()`：環境變數 `CLAUDE_SWITCHER_LANG` 為 `zh-TW`／`en` 時回傳 `[該值]`（測試與截圖用，只取代「系統語言來源」，不覆蓋使用者明確設定）；否則回傳 `setSystemLocales()` 設定過的值；都沒有時回傳 `[Intl.DateTimeFormat().resolvedOptions().locale]`。
  - `setSystemLocales(list: string[])`：main 啟動時以 `app.getPreferredSystemLanguages()` 設定（空陣列忽略）。
  - `resolveLanguage(setting: unknown): Lang`：`'zh-TW'`／`'en'` 直接回傳；其他（含 `'auto'`、壞值）→ `normalizeLocale(systemLocales()[0] ?? '')`。
  - 模組層級目前語言：`setLanguage(l: Lang)`、`getLanguage(): Lang`，初始值 `resolveLanguage('auto')`。
  - `t(key: MessageKey, params?: Record<string, string | number>): string`：用目前語言查字典，`{name}` 以 params 取代（缺的參數保留原樣）；找不到鍵時回傳鍵名。
  - `tl(lang, key, params)`：指定語言版本。
  - `MessageKey = keyof typeof uiZh | keyof typeof mainZh`。
- `ui.ts`：renderer 用字串。`export const uiZh = { 'nav.overview': '總覽', … }`；`export const uiEn: { [K in keyof typeof uiZh]: string } = { … }`（型別保證鍵一致）。
- `main.ts`：main、core、scripts 用字串，同樣 `mainZh`／`mainEn`。兩檔鍵不得重複（測試檢查）。
- 鍵名：`<區域>.<名稱>`，小寫駝峰，例如 `overview.allExhausted`、`log.switched`、`err.needsRelogin`。
- 英文：簡短、介面慣用語（Overview、Accounts、Dispatch、Event log、Settings；Switch to this account；Browser login；Save current login）。

### 設定與狀態

- `core/config.ts`：`Config.language: LangSetting`，預設 `'auto'`；`load()` 遇到壞值改回 `'auto'`；`setConfig` 接受 `language`（只允許三個值，否則失敗）。
- `continue_prompt`（審查 #1、#2）：`controller` 存設定時會寫整份 cfg，所以「檔案沒有欄位」判斷不到。改為：值是任一語言的內建預設（`'繼續'`、`'continue'`）或無效時，視為「未自訂」，一律換成目前語言的預設 `defaultContinuePrompt(lang)`。
  - `config.load()` 結束前套用；`setConfig` 改了 `language` 後也重算（未自訂時）。`AppState.config.continue_prompt` 因此是語言對應後的值，設定頁顯示正確。
  - 其他值（含空字串＝不送）維持原樣。
  - 代價：英文介面下想送中文「繼續」的使用者，需改成其他字（例如「請繼續」）。可接受。
- `config.ts` 會 import `shared/i18n`：確認 `tsconfig.node.json` 的 include 與 `scripts/build-scripts.mjs` 打包都涵蓋 `src/shared`（審查 #3）。
- `shared/types.ts`：`AppConfig` 加 `language`；`AppState` 加 `language: Lang`（實際使用的語言）。
- `controller.ts`：建構／`start` 時 `setLanguage(resolveLanguage(cfg.language))`；`setConfig` 改到 `language` 時重算並 push 狀態；`getState()` 帶 `language: getLanguage()`。

### main（`src/main/index.ts`、`trayPolicy.ts`）

- 在 `new Controller(...)` 之前呼叫 `setSystemLocales(app.getPreferredSystemLanguages())`（審查 #7）。
- 視窗標題、系統匣選單（開啟視窗、結束）、`trayTooltip`、通知標題改用 `t()`。
- 語言改變時重建系統匣選單、更新視窗標題（在 push 狀態時比對上次語言）。

### renderer

- `App.tsx`：收到 state 時 `setLanguage(state.language)`，並以 `LangContext.Provider value={state.language}` 包住畫面。
- `lib/i18n.ts`：`useT()`：讀 `LangContext`（讓元件隨語言重繪），回傳 `t`。
- 模組層級的常數陣列（如 `NavSidebar` 的 `settingsItems`）改存鍵，渲染時才 `t()`。
- `lib/format.ts`：`formatReset`、`formatRelative` 等改用 `t()`；日期格式維持數字格式。
- `use-app-state.ts` 的 `act()` 內固定字串改用 `t()`。
- 設定「一般」頁加「語言」下拉：`auto` 顯示 `t('settings.language.auto')`（「自動（依系統）」／「Automatic (system)」），另兩個固定顯示 `繁體中文`、`English`。
- `<html lang>` 跟著改（`zh-Hant-TW`／`en`）。

### main 與 core 的使用者可見字串

- `controller.ts` 的事件紀錄（`this.log`）、通知、`fail(...)` 錯誤訊息。
- core 中會傳到畫面或事件紀錄的錯誤：`oauth.ts`、`routing.ts`、`accounts.ts`、`agyaccounts.ts`、`agycred.ts`、`agyquota.ts`、`monitor.ts`、`login.ts`、`sessions.ts`、`launcher.ts`、`integration.ts`、`claudeavail.ts`、`nodebin.ts`。只翻譯字串，不改邏輯。
- scripts：`statusline.ts`（`未儲存`）、`runner.ts` 的訊息：讀 `config.json` 的 `language`（用既有 `storage.readJson`）後 `setLanguage(resolveLanguage(...))`；沒有設定檔或欄位時等同 `'auto'`（系統語言：env → `Intl`）（審查 #5）。
- 含使用者資料（帳號名稱、email、資料夾、PID）的字串一律用 `{參數}`，不拼進鍵（審查 #9）。
- **不改**：`switcher-run.ts` 的輸出、程式註解、和伺服器文字比對的常數、`console.*` 純除錯訊息可不翻。

### CLAUDE.md

scripts 可 import 的模組清單加 `shared/i18n`（主導者更新）。

## 任務

| ID | 內容 | 相依 | 檔案 |
|---|---|---|---|
| T-1 | `shared/i18n`（index、ui、main 骨架，各放幾個鍵）、config `language`、types、controller 語言狀態、main 偵測＋系統匣／標題／通知、renderer `LangContext`／`useT`、設定頁語言選項、`CLAUDE_SWITCHER_LANG`、測試 | — | 上列 |
| T-2 | renderer 全部介面字串改 `t()`，補 `ui.ts` | T-1 | `src/renderer/src/**`、`src/shared/i18n/ui.ts` |
| T-3 | controller、core、statusline、runner 字串改 `t()`，補 `main.ts` | T-1 | `src/main/controller.ts`、`src/core/*`、`src/scripts/statusline.ts`、`src/scripts/runner.ts`、`src/shared/i18n/main.ts` |

T-1 完成並通過測試後，才開始 T-2、T-3（T-1 與 T-3 都改 `controller.ts`）。T-2 與 T-3 不改同一檔案，可平行（審查 #6）。

## 驗證

| AC | 方式 |
|---|---|
| AC-1、AC-3 | 截圖：`CLAUDE_SWITCHER_LANG=en` 與 `zh-TW` 各截總覽、帳號、派工、設定一般頁；切換語言重繪由 `LangContext` 保證，人工確認 |
| AC-2 | 單元測試 `resolveLanguage`／`normalizeLocale`（zh-TW、zh-HK、zh-Hant-TW、zh-CN、en-US、ja-JP、空字串） |
| AC-4 | 程式碼檢查＋使用者實測 |
| AC-5 | 單元測試：controller 在 `en` 時產生英文事件 |
| AC-6 | 單元測試：statusline 在 `CLAUDE_SWITCHER_LANG=en` 時輸出 `unsaved` 對應字串 |
| AC-7 | 單元測試：config 無 `continue_prompt` 時依語言預設；有值時不變 |
| AC-8 | 單元測試：兩語言鍵一致、`{參數}` 集合一致、ui 與 main 鍵不重複、沒有空字串 |
| AC-9 | `npm run typecheck`、`npm test` |

測試環境：`vitest.config.ts` 設 `env: { CLAUDE_SWITCHER_LANG: 'zh-TW' }`，既有斷言中文的測試不受系統語言影響。英文測試用 `setConfig({ language: 'en' })` 或 `setLanguage('en')`，結束時還原為 `'zh-TW'`；spawn 腳本的測試傳 `CLAUDE_SWITCHER_LANG=en`。

## 風險

- 字串量大（約 600 行），翻譯可能漏：AC-8 測試只保證兩字典一致，不保證沒有遺漏的硬寫中文 → T-2、T-3 完成後用 grep 檢查非註解行的中日韓字元。
- 英文字串較長，窄版面可能換行或截斷 → 截圖檢查 900px 寬。
- 已寫入的事件紀錄為舊語言（不翻譯，已列需求）。

## 審查紀錄

規格審查（Claude Sonnet 子代理，2026-11-15）：9 條全部採用。
- #1（高）`continue_prompt` 預設會被整份存檔凍結 → 改用「等於內建預設即未自訂」判斷。
- #2 設定頁顯示需連動 → 併入 #1。
- #3 core 首次依賴 `shared/` → 確認 tsconfig／打包涵蓋。
- #4 環境變數只取代系統語言來源，不覆蓋使用者設定。
- #5 scripts 無設定檔時的行為已註明。
- #6 T-1 先做，T-2／T-3 之後平行。
- #7 `setSystemLocales` 在建立 Controller 之前。
- #8 鍵一致由 AC-8 測試保證（不改）。
- #9 使用者資料用參數。

## 實作紀錄

- T-1：agy `gemini-3.8-flash-high` 執行 82 步未改任何檔案，最後執行允許清單外的指令被拒 → 改用 Claude Sonnet 子代理完成。
- T-2：agy `gemini-3.8-flash-high` 完成；回報通過但實際有 1 個型別錯誤與 10 個 ui／main 重複鍵，由主導者修正（`role.*` 改共用 main 的鍵；其餘 3 個 ui 鍵改名）。
- T-3：Claude Sonnet 子代理完成（216 個鍵）。
- 主導者另修：派工頁表格欄距（英文標題黏在一起）。

## 實作審查（兩位 Claude Sonnet，2026-11-15）

renderer（T-2）：無高／中。低 6 條，採用 3 條：英文「帳號範圍」改 `Account scope: {count} selected`（新鍵 `routing.scopeCount`）、`No restart`、`Delegated to Claude`。不採用：
- 「全部用完」警示的時間粗體消失：純樣式，接受。
- 中文確認句少一個空格：新寫法較自然。
- 範圍外改動：表格欄距為主導者刻意修改。

main／core（T-3）：無高。採用：
- #1（中）`auto` 時 scripts 用 `Intl`、主程式用 Electron，可能不同 → controller 啟動與改語言時寫 `config.language_resolved`，scripts 以 `resolveLanguageFromConfig()` 優先讀它。
- #4 `setLanguage` 移到 `config.save` 成功之後。
- #5 `monitor.ts` 的 import 移到檔頭。

不採用：
- #2 `usage_api/*.json` 的錯誤訊息寫入當下就固定語言，下次輪詢（預設 2 分鐘）即覆寫，接受。
- #3 使用者明確設定等於另一語言內建預設的接續提示會被換掉：規格已列為已知取捨。
- #6 extraResources 已在 `electron-builder.yml` 設定。

## 驗證

- `npm run typecheck` 通過；`npm test` 35 檔 464 個測試通過。
- 截圖（`CLAUDE_SWITCHER_LANG=en`／`zh-TW`，1000×760）：總覽、帳號、派工、設定一般／模型分工／自動整理，英文顯示正常。
- 待使用者實測：系統匣選單與通知語言、切換語言即時重繪。

## 已知限制

- `switcher-run` 寫入派工紀錄的訊息維持中文（給 Claude 讀，依需求不翻）。
- 已產生的事件紀錄維持產生當下的語言。
