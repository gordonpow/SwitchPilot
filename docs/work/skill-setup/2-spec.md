# 規格：模型分工 skill 設定引導

需求：`1-requirements.md`。

## 設計

### 內附 skill

- `app/scripts/build-scripts.mjs`：把 `<repo>/skills/model-routing/SKILL.md` 複製到 `app/resources/scripts/skills/model-routing/SKILL.md`（來源不存在時建置失敗並說明）。
- 打包：`extraResources` 已把 `resources/scripts` 整個複製到 `scripts`，不需改。`nodebin.installScripts` 只複製頂層 `*.cjs`／`*.ps1`，不受影響。
- controller 讀 `join(scriptsDir, 'skills', 'model-routing', 'SKILL.md')`。

### core：`src/core/skillsetup.ts`（不 import electron）

- `skillTargetPath(): string` → `path.join(paths.claudeHome(), 'skills', 'model-routing', 'SKILL.md')`。
- `skillStatus(bundled: string | null): 'unavailable' | 'missing' | 'installed' | 'outdated'`
  - `bundled === null` → `unavailable`；目標不存在 → `missing`；內容相同（忽略 CRLF／LF 差異）→ `installed`；否則 `outdated`。
- `installSkill(bundled: string, overwrite: boolean): 'installed' | 'exists'`
  - 目標存在且內容不同、`overwrite` 為 false → 回 `'exists'`，不寫。
  - `overwrite` 為 true 且目標存在且內容不同 → 先把舊檔寫成 `SKILL.md.bak`（`storage.writeFileAtomic`），再寫新檔。
  - 建立目錄；寫檔用 `storage.writeFileAtomic`。

### controller

- 依賴可注入：`findAgy?: () => string | null`（預設 `whichFirst(['agy.exe'])`），`readBundledSkill?: () => string | null`（預設讀上述內附路徑，失敗回 null）。
- `routingSetup` 狀態（快取，不在每次 `getState` 讀檔）：在 `start()`、`checkRoutingSetup()`、`installSkill()` 之後、agy 帳號增刪後重算並 push。
  ```ts
  routingSetup: {
    nodeFound: boolean
    dispatcherInstalled: boolean // binDir/switcher-run.cjs 存在
    agyInstalled: boolean
    agyAccounts: number
    skill: 'unavailable' | 'missing' | 'installed' | 'outdated'
    skillPath: string
  }
  ```
- `checkRoutingSetup(): Promise<Result>`：重算（並先 `ensureScripts()`，失敗不中斷）。
- `installSkill(overwrite: boolean): Promise<Result>`：內附檔讀不到 → `fail(t('err.skillUnavailable'), 'UNAVAILABLE')`；回 `'exists'` → `fail(t('err.skillExists'), 'EXISTS')`；成功 log `t('log.skillInstalled', { path })`。
- IPC：`routingSetupCheck`、`installSkill`（types、preload、main 註冊、mock-api）。

### renderer

- 新元件 `RoutingSetupCard.tsx`，放在設定「模型分工」頁最上方（RoutingPanel 之前）。
- 每步一列：狀態圖示（完成綠色勾、未完成黃色驚嘆號、選用且未完成灰色圓點）、標題、說明、動作。
  1. Node.js：未找到 → 說明「安裝 Node.js 22 以上（nodejs.org），並加入 PATH 後重新開啟本程式」。
  2. 派工工具：未安裝 → 「重新檢查」會嘗試重新安裝。
  3. agy（選用）：未找到 → 「只有使用 agy 項目時需要。安裝 Antigravity CLI 後按重新檢查」。
  4. agy 帳號（選用）：顯示數量；按鈕「前往帳號」切到帳號頁（需要的 navigate callback 由頁面傳入）。
  5. skill：`missing` → 按鈕「安裝 skill」；`outdated` → 「更新 skill」，按下若回 `EXISTS` → 確認對話框（說明會備份成 `SKILL.md.bak`）→ `installSkill(true)`；`installed` → 顯示路徑；`unavailable` → 說明「找不到內附的 skill 檔，請重新下載本程式」。
  6. 開始使用：兩個範例（各附複製按鈕，用既有 `copyText` 或 `navigator.clipboard`）：
     - `Use the model routing to implement T-1 in docs/spec.md`
     - `依模型分工派工：實作 docs/spec.md 的 T-1`
     - 說明：「skill 只會在新開的 Claude Code 對話載入。」
- 卡片右上「重新檢查」。
- 所有文字加到 `ui.ts`（中英），controller 的錯誤與 log 加到 `main.ts`。

### 功能開關（AC-7）

- `core/config.ts`：`routing_enabled: boolean`，預設 true，壞值回預設；`setConfig` 支援。
- `core/skillsetup.ts`：`uninstallSkill(): boolean`（刪 `SKILL.md`；`model-routing` 資料夾空了就刪；不存在回 false；不刪 `.bak`）。
- controller：`uninstallSkill(): Promise<Result>`（log `t('log.skillRemoved')`）＋ IPC `uninstallSkill`；重算 `routingSetup`。
- `switcher-run.ts`：讀 `config.load().routing_enabled`；false 時不讀額度、不執行 agy，輸出 `{status:'delegate', provider:'claude', model: <role 第一個 claude 項目或 'sonnet'>, attempts:[], message:'model routing is disabled in Claude Account Switcher; use a Claude subagent'}`，exit 10。（switcher-run 的訊息維持不翻譯，給 Claude 讀。）
- renderer：
  - 設定「模型分工」頁最上方：開關「啟用模型分工」與說明。關閉時隱藏引導卡片與 RoutingPanel。
  - 從開到關且 `routingSetup.skill` 為 `installed`／`outdated` → 確認對話框「也要移除 Claude Code 的 model-routing skill 嗎？」（移除／保留）。
  - `NavSidebar`：`routing_enabled` 為 false 時不顯示「派工」；目前頁面是 `dispatch` 時改回總覽。
  - 引導卡片第 5 步已安裝時另有「移除 skill」按鈕。
- skill（`skills/model-routing/SKILL.md`）：exit 10 說明已含「功能關閉」（主導者已改，不需再改）。

### README

「Model routing」一節改成「Set up model routing (step by step)」，步驟 1～6 對應 App；保留手動複製指令作為替代方式。

## 任務

| ID | 內容 |
|---|---|
| T-1 | 全部（build-scripts、skillsetup、controller、IPC、renderer、i18n、測試）。README 由主導者寫 |

## 驗證

- 單元測試：`skillStatus` 四種狀態（含 CRLF 視為相同）、`installSkill` 新裝／相同不寫／不同回 exists／覆蓋並備份；controller `routingSetup` 欄位（注入 findAgy、readBundledSkill、findNode）、`installSkill` 的 EXISTS 與成功。
- 建置後 `resources/scripts/skills/model-routing/SKILL.md` 存在（測試檢查）。
- `uninstallSkill`：刪檔、空資料夾刪除、保留 `.bak`、不存在回 false。
- config `routing_enabled` 預設與壞值。
- switcher-run：`routing_enabled: false` 時 exit 10、model 為第一個 Claude 項目，且沒有執行假 agy（沿用 `tests/switcher-run.test.ts` 的 fake agy 機制確認未被呼叫）。
- 截圖：設定 → 模型分工（en、zh-TW）。

## 審查紀錄

規格審查（Claude Sonnet，2026-11-15）：10 條，無高；全部採用（#9 已完成、#10 確認無問題）。**以下優先於前文：**

- R-1（#1）`routingSetup.nodeFound` 直接呼叫 `this.findNodeFn()`（不吃 `node()` 快取）；`checkRoutingSetup` 同時清除 node 快取。
- R-2（#2）內附 skill 預設路徑用 `nodebin.scriptsSourceDir(this.scriptsDir)` 為基底。controller 測試一律注入 `readBundledSkill`；另寫一個測試只檢查建置產物 `resources/scripts/skills/model-routing/SKILL.md` 存在。
- R-3（#3）`routing_enabled` 完整路徑：`config.ts`（預設 true、`load()` 非 boolean 回預設，同 `close_to_tray` 寫法）、`types.ts` 的 `AppConfig`／`AppConfigPatch`、controller `setConfig`（`!!`）與 `getState` 輸出的 config、`mock-api.ts`。
- R-4（#4）`switcher-run` 在 `dispatch` 開頭（`loadRouting()` 之後、任何 `claudeAvailable`／`handleAgyEntry` 之前）判斷 `routing_enabled === false`；取 role 第一個 claude 項目（沒有則 `sonnet`）回 delegate。仍照常寫派工紀錄（status delegate）。測試用 `useTempEnv`，以 fake agy 標記檔確認 agy 未被呼叫。
- R-5（#5）頁面守衛放在 App 層：state 已載入且 `config.routing_enabled === false` 且 `page === 'dispatch'` → 改成 `overview`（state 未載入時不動，避免誤跳）。
- R-6（#6）`agyAccounts` 直接用 `getState` 已有的 agy 帳號清單長度，不另存快取。
- R-7（#7）`skillStatus`：目標存在但讀取失敗（含目標是目錄）→ `outdated`。`installSkill`：目標是目錄 → 丟錯（controller 轉成 `fail`）；`.bak` 已存在直接覆蓋；備份內容原樣（不轉換換行）。
- R-8（#8）`uninstallSkill` 測試：有 `.bak` 時資料夾保留；沒有 `.bak` 時資料夾刪除。
