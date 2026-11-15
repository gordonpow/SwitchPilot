# 規格：改名為 SwitchPilot

需求：[1-requirements.md](1-requirements.md)。路徑皆相對於 `app/`。

## 設計

### 1. 環境變數相容（AC-5）
- 新增 `src/shared/env.ts`：
  ```ts
  /** 讀取 SWITCHPILOT_<name>，沒有時讀舊名 CLAUDE_SWITCHER_<name>。 */
  export function envVar(name: string): string | undefined
  ```
  空字串視為未設定（與現有 `||` 行為一致）。`process` 不存在時（renderer）回傳 undefined。
- 所有讀 `process.env.CLAUDE_SWITCHER_*` 的地方改用 `envVar('...')`：`core/paths.ts`、`core/nodebin.ts`、`core/sessions.ts`、`main/controller.ts`、`main/index.ts`、`main/trayPolicy.ts`（註解）、`scripts/browser-open.ts`、`scripts/switcher-run.ts`、`shared/i18n/index.ts`。
- 設定給子程序的環境變數改用新名：`core/login.ts`（`SWITCHPILOT_LOGIN_DIR`、`SWITCHPILOT_BROWSER`）、`core/sessions.ts`（`SWITCHPILOT_PIDMAP_START_PID`）；讀取端用 `envVar`，因此新舊都通。
- 測試：`vitest.config.ts`、`tests/helpers.ts`、fixtures 與各測試改用 `SWITCHPILOT_*`；`fake-*.cjs` 讀取時兩個名稱都接受。新增 `tests/env.test.ts`（新名優先、舊名後備、空字串）。
- CLAUDE.md 文件中的環境變數名稱一併更新。

### 2. 資料夾（AC-3、AC-4）
- `core/paths.ts`：
  - `appDir()`：`envVar('HOME')` 有值就用它。否則 `newDir = ~/.switchpilot`、`oldDir = ~/.claude-switcher`：`newDir` 存在 → `newDir`；否則 `oldDir` 存在 → `oldDir`；都不存在 → `newDir`。
  - 解析到 `newDir` 時可以快取（同一程序內不會再變回舊的）；其他結果不快取。`HOME` 環境變數變動時（測試）不能用到過時快取：快取只在沒有環境變數覆寫時使用，且快取 key 含 `os.homedir()`。
  - 匯出 `defaultAppDir()`（`~/.switchpilot`）與 `legacyAppDir()`（`~/.claude-switcher`），供搬移使用。
- 新增 `src/core/appdirmigrate.ts`（不 import electron）：
  ```ts
  export interface MigrateResult { status: 'skipped' | 'migrated' | 'failed'; reason?: string; junction?: boolean }
  export function migrateAppDir(opts?: { from?: string; to?: string }): MigrateResult
  ```
  - `envVar('HOME')` 有值 → skipped。
  - `from` 不存在、或 `lstat` 為 symlink／junction → skipped。
  - `to` 已存在 → skipped（不合併；兩個都在時 `appDir()` 用新的）。
  - `fs.renameSync(from, to)`；失敗 → `failed`（reason 為錯誤 code，不含路徑以外內容），`appDir()` 會繼續用舊資料夾。
  - 成功後 `fs.symlinkSync(to, from, 'junction')`；失敗不影響結果（`junction: false`）。
- `main/index.ts`：在 `setupController()` 建立 Controller 之前呼叫 `migrateAppDir()`（截圖模式不呼叫），結果寫 console log；把 `status === 'migrated'` 以新依賴 `appDirMigrated?: boolean` 傳給 Controller。
- `main/controller.ts`：`appDirMigrated` 為 true 時，啟動流程（第一次 `ensureScripts` 之後）若 `integration.isInstalled()` 為 true，就以 `integration.install({ nodePath, binDir: paths.binDir() })` 重寫路徑；失敗只記事件，不中斷啟動。找不到 node 就跳過。
- `core/integration.ts`：`DEFAULT_BIN_MARKERS` 同時包含 `.claude-switcher/bin/…` 與 `.switchpilot/bin/…`（兩種都視為本程式的項目，install 時舊項目會被替換）。

### 3. 名稱字串（AC-1、AC-2、AC-8）
- `shared/i18n/main.ts`、`ui.ts`：`app.title`、`tray.tooltip`、`topbar.title` 及其他提到程式名稱的字串改 `SwitchPilot`（繁中與英文都用 `SwitchPilot`）。用 grep 找出所有「Claude 帳號切換器」「Claude Account Switcher」「帳號切換器」字樣，屬於程式名稱的都改。說明「切換 Claude 帳號」功能本身的字串保留。
- `src/renderer/index.html` `<title>`、`package.json` `description`（`name` 改 `switchpilot`）。
- `electron-builder.yml`：`appId: local.switchpilot`、`productName: SwitchPilot`、`executableName: switchpilot`。
- `main/index.ts`：非 Windows 的 AUMID 改 `local.switchpilot`。
- `scripts/switcher-run.ts`：訊息改 `model routing is disabled in SwitchPilot; …`；對應測試。
- `renderer/src/lib/mock-api.ts`：假資料中的 repo、資產名稱改新名。

### 4. 開機自動啟動（AC-6）
- `main/index.ts` `applyLoginItem`：打包且 win32 時，先呼叫
  `app.setLoginItemSettings({ openAtLogin: false, name: 'electron.app.Claude Account Switcher', path: exe, args: ['--hidden'] })`
  移除舊登錄值（實測舊值名稱即此字串），再設定新的。抽成常數 `LEGACY_LOGIN_ITEM_NAME`。以 Electron 型別定義確認 `name` 選項存在。

### 5. 自動更新（AC-7）
- `core/updater.ts`：`UPDATE_REPO = 'gordonpow/SwitchPilot'`；資產優先 `/^SwitchPilot[-. ].*\.exe$/i`，其次 `/^Claude-Account-Switcher-.*\.exe$/i`，再其次第一個 exe。更新 `tests/updater.test.ts`。
- `update.ps1` 不變（以目標路徑原地替換，exe 檔名不變）。

### 6. 文件（AC-8）
- `README.md`：標題與內文改 SwitchPilot、`~/.switchpilot`、新 repo 網址、新環境變數、exe 檔名；加一段「從 Claude Account Switcher 升級」（自動搬資料夾、舊路徑 junction）。
- `skills/model-routing/SKILL.md`：路徑改 `~/.switchpilot/...`、名稱改 SwitchPilot。
- `CLAUDE.md`（專案）：名稱、路徑、環境變數。

## 任務
- T-1：§1、§2（env、paths、appdirmigrate、integration markers、controller 依賴、index 呼叫）＋測試。
- T-2：§3、§4、§5 ＋測試。（依賴 T-1 的 `envVar`）
- T-3：§6 文件。
三者由同一個 Sonnet 子代理依序完成。

## AC 驗證方式
| AC | 方式 |
|---|---|
| AC-1、2 | grep 無舊名稱；`npm run package` 產物檔名 |
| AC-3、4 | `tests/appdirmigrate.test.ts`、paths 測試、controller 測試（migrated → 重寫 settings） |
| AC-5 | `tests/env.test.ts` |
| AC-6 | 程式檢查；打包後使用者實測登錄 |
| AC-7 | `tests/updater.test.ts` |
| AC-8 | 人工檢查 |
| AC-9 | `npm run typecheck`、`npm test` |

## 邊界與風險
- 搬移時 claude 正在跑 statusline／hook（從舊 bin 執行、寫 usage 檔）→ rename 可能 EPERM/EBUSY → 用舊資料夾，下次啟動再試。
- junction 建立後，舊版程式（若使用者還留著舊 exe）會透過 junction 讀寫同一份資料，相容。
- 新舊資料夾都是實體資料夾（例如搬移後使用者手動建了舊資料夾）：用新的，不合併。
- `appDir()` 每次 `existsSync`：statusline 呼叫頻率低，可接受；有快取。
- 回退：還原 commit；已搬的資料夾可刪除 junction 後改名回 `~/.claude-switcher`。

## 審查後修訂（優先於上文）
- R-1 有效資料夾：「新資料夾有效」＝存在且含 `config.json` 或 `slots/`。`appDir()`：新資料夾有效 → 新；否則舊資料夾存在 → 舊；否則新。快取只在解析到「有效的新資料夾」時使用。`migrateAppDir`：`to` 存在但是空資料夾 → 先 `rmdirSync` 再搬；`to` 非空 → skipped。`index.ts` 在 `migrateAppDir()` 之前不得呼叫任何 `paths.*` 或寫檔（含 config、log）。
- R-2 settings 路徑修正改為每次啟動檢查，不依賴 `appDirMigrated`：在 `core/integration.ts` 新增 `usesLegacyBinDir(): boolean`（statusLine 或任一 hook 指令含 `.claude-switcher/bin/`）。Controller 啟動時（第一次 `ensureScripts` 之後），`paths.appDir()` 等於 `paths.defaultAppDir()` 且 `usesLegacyBinDir()` → `integration.install({ nodePath, binDir: paths.binDir() })`；找不到 node 或失敗只記事件。`appDirMigrated` 依賴改為 `appDirMigration?: MigrateResult`，用於記事件：migrated（含 junction 是否成功）、failed（提示「資料夾搬移失敗，繼續使用舊資料夾，下次啟動再試」）。事件文字加 i18n 鍵。
- R-3 `migrateAppDir(opts)`：有傳 `from`／`to` 時不檢查 `envVar('HOME')`；沒傳時才檢查 HOME，並用 `legacyAppDir()`／`defaultAppDir()`。測試一律傳 from/to（都在暫存目錄）。
- R-4 `tests/helpers.ts` 的 KEYS 同時列新舊兩組名稱，`beforeEach` 先刪全部再設新名；`vitest.config.ts` 用新名；舊名後備測試先刪新名。
- R-5 新舊版同時執行（productName 改變 → 單一實例鎖與 userData 不同）：不另外處理；搬移因占用失敗時沿用舊資料夾並記 R-2 的 failed 事件。README 說明升級前先關閉舊版（自動更新本來就會等舊版結束）。
- R-6 發布限制：每個 release 只附一個 exe（`SwitchPilot-x.y.z.exe`），因舊版 1.1.x 找不到舊檔名時取第一個 exe。自動更新是原地替換，升級後的 exe 檔名維持舊名，README 說明。`updater.ts` 的 `User-Agent` 改 `switchpilot`。
- R-7 AC-6：移除舊登錄值在 `enabled` 為 true 或 false 時都執行（Controller 啟動時每次都會呼叫 applyLoginItem）。

## 審查紀錄
規格審查（全新 Sonnet 子代理，2026-11-16）：6 條 + 1 補充，全部採用（R-1～R-7）。
- 新資料夾被提早建立成空資料夾導致帳號消失（高）→ R-1。
- settings 只在搬移那次重寫，失敗不重試（高）→ R-2。
- migrate 的 HOME 判斷與測試矛盾（中）→ R-3。
- 測試環境變數隔離（中）→ R-4。
- 新舊版同時執行（中）→ R-5，記錄限制。
- 舊版挑第一個 exe、檔名、User-Agent（低／中）→ R-6。
- 登錄值移除時機 → R-7。

實作審查（全新 Sonnet 子代理，2026-11-16）：無高嚴重度；4 條＋1 補充，採用 3 條。
- 搬移後殘留舊 bin 腳本重建實體舊資料夾，junction 建不起來（中）→ 採用：`migrateAppDir` 新增修復路徑：新資料夾有效、舊資料夾為實體且無效時，改名為 `.claude-switcher.leftover-<ms>` 保留，再建 junction（`reason: 'repaired'`）；加 2 個測試。
- junction 失敗時 Python 版讀不到帳號（低）→ 採用：README 註明設定 `CLAUDE_SWITCHER_HOME`。
- 新資料夾非空但無效時永不搬（低）→ 不採用：main 已把 `migrateAppDir` 結果（含 `target-exists`）寫 console log；不自動改名使用者手動建立的資料夾。
- trayPolicy 註解名稱錯誤（低）→ 採用。
- userData 路徑改變（補充）→ 不採用：只影響最後開啟頁面的 localStorage，帳號與設定在 appDir。
