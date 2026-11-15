# 規格：以 Electron 重寫帳號切換器

需求見 `1-requirements.md`。**行為參考實作**是現有 Python 版（`switcher/*.py` 與 `tests/*.py`）：移植時邏輯、檔案格式、邊界處理以 Python 版為準，除非本規格另有說明。Python 版規格：`docs/work/account-switcher/2-spec.md`、`docs/work/google-login/2-spec.md`。

## 已確認的事實（2026-11-13，本機 claude 2.1.322、Node v26.13.1）

- 用量 API：`GET https://api.anthropic.com/api/oauth/usage`，標頭 `Authorization: Bearer <accessToken>`、`anthropic-beta: oauth-2025-04-20`。回應 `five_hour`／`seven_day`：`{ "utilization": 53.0, "resets_at": "2026-11-12T21:10:00.344194+00:00", ... }`，可能為 `null`。實測 200。
- Token refresh（取自 claude 執行檔）：`POST https://platform.claude.com/v1/oauth/token`，`Content-Type: application/json`，body `{ "grant_type": "refresh_token", "refresh_token": <rt>, "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e", "scope": <scopes 以空白連接> }`；回應 `{ access_token, refresh_token?（缺時沿用舊的）, expires_in（秒） }`。未實測。
- `.credentials.json` 的 `claudeAiOauth` 欄位：`accessToken`、`refreshToken`、`expiresAt`（毫秒）、`refreshTokenExpiresAt`、`scopes`（陣列）、`subscriptionType`、`rateLimitTier`、`subscriptionTypeSource`。
- `claude auth login` 遵守 `CLAUDE_CONFIG_DIR` 與 `BROWSER`（見 google-login 規格）。
- statusline／hook 介面見 account-switcher 規格。

## 架構

```
app/                              # Electron 專案（electron-vite，react-ts 範本）
  package.json
  electron.vite.config.ts
  electron-builder.yml            # portable target
  scripts/build-scripts.mjs       # esbuild 打包 src/scripts/*.ts → resources/scripts/*.cjs
  resources/scripts/              # 產物（git 忽略），打包時放入 extraResources
  src/
    shared/types.ts               # 主程序與畫面共用的型別（IPC 契約，見下）
    core/                         # 純 Node 模組（不 import electron），vitest 測試
      paths.ts storage.ts config.ts accounts.ts switchplan.ts
      usage.ts                    # statusline 用量、hook 事件（同 Python usage.py）
      oauth.ts                    # 用量 API、token refresh、各帳號用量快取
      integration.ts monitor.ts procutil.ts launcher.ts login.ts nodebin.ts
    scripts/                      # 由 Claude Code / wt 以系統 node 執行（esbuild 打包成單檔 .cjs）
      statusline.ts hook.ts runner.ts browser-open.ts
    main/
      index.ts                    # 建立視窗、註冊 IPC
      controller.ts               # 輪詢、切換流程、狀態推送（移植 Python gui.py 的非 UI 邏輯）
    preload/index.ts              # contextBridge 暴露 window.api
    renderer/                     # React + Tailwind v4 + shadcn/ui
  tests/                          # vitest：*.test.ts；fixtures/fake-claude.cjs、fake-login.cjs
```

### 執行檔與腳本

- `core/nodebin.ts`：`findNode(): string | null`：依序 `process.env.CLAUDE_SWITCHER_NODE`、`where node`（`execFileSync`，`windowsHide`）第一行、`C:\Program Files\nodejs\node.exe`。找不到時相關功能顯示「需要安裝 Node.js」。
- `scriptsSourceDir()`：開發時 `app/resources/scripts`；打包後 `process.resourcesPath/scripts`。
- `installScripts()`：把 `*.cjs` 複製到 `paths.binDir()`（`%USERPROFILE%\.claude-switcher\bin`）。整合安裝、啟動託管、瀏覽器登入前都呼叫（內容相同就不複製）。
- settings.json 指令：`"<node 正斜線路徑>" "<binDir 正斜線>/statusline.cjs"`、`.../hook.cjs" stop`、`.../hook.cjs" stopfailure`。辨識本程式項目：command 含 `.claude-switcher/bin/statusline.cjs` 或 `.claude-switcher/bin/hook.cjs`，**以及** Python 版的 `switcher/statusline.py`、`switcher/hook.py`（安裝新版時順便移除舊版項目）。

### core 模組（移植 Python 版，函式名改 camelCase）

- `paths.ts`：同 Python `paths.py`（環境變數覆寫 `CLAUDE_SWITCHER_HOME`、`CLAUDE_SWITCHER_CLAUDE_HOME`、`CLAUDE_SWITCHER_CLAUDE_JSON`；每次呼叫都讀）；新增 `binDir()`、`loginDir()`、`usageApiDir()`（`app_dir/usage_api`）。
- `storage.ts`：`readJson`、`readJsonStrict`、`writeJsonAtomic`（暫存檔 + `fs.renameSync`；`EPERM`／`EBUSY`／`EACCES` 重試 10 次 × 200 ms；讀端同樣重試 5 次 × 100 ms）。JSON 輸出 2 空格縮排、UTF-8、不跳脫非 ASCII。同步 API（簡單、與 Python 一致）。
- `config.ts`：預設 `{ threshold: 95, auto_switch: true, last_folder: "", login_browser: "chrome", usage_poll_seconds: 120 }`。
- `accounts.ts`：`listSlots`、`getSlot`、`updateSlot`、`currentAccount`、`matchSlot`、`currentSlotId`、`saveCurrent`、`addSlot`、`syncCurrentBack`、`switchTo`、`deleteSlot`、`renameSlot`（新增）、`markExhausted`、`clearExhausted`；`AccountError`。slot JSON 格式不變。
- `switchplan.ts`：`pickNext(slots, currentId, now, isBlocked?: (slot) => boolean)`（新增可選判斷：API 用量已達門檻的帳號視為不可用）、`earliestReset`。
- `usage.ts`：`latestUsage`、`isStale`、`readNewEvents`、`cleanup`（同 Python）。
- `integration.ts`：同 Python（備份、保存並還原原 statusLine、可重複安裝、壞 JSON 不覆寫、非物件丟錯），指令改為上述 node 指令；`install({ nodePath, binDir })` 參數可注入。
- `monitor.ts`：同 Python `monitor.py`（含「同一 tick 進 pending 且有 stop 事件立即 switch_now」）。
- `procutil.ts`：`pidAlive(pid)`（`process.kill(pid, 0)`，`ESRCH` → false、`EPERM` → true）、`killTree(pid)`（`taskkill /PID <pid> /T /F`，`windowsHide: true`，之後輪詢 `pidAlive` 最多 3 秒）。
- `launcher.ts`：同 Python（資料夾含 `;` 丟錯、參數陣列、找不到 `wt.exe` 時 `cmd /c start` 開新主控台）；啟動指令 `[node, binDir/runner.cjs, --run-id, id, --cwd, folder, (--continue)]`；state／cmd 檔格式同 Python。`spawn` 可注入。
- `login.ts`：同 Python `login.py`；`open_browser.cmd` 內容 `@chcp 65001 >nul` + `@"<node>" "<binDir>\browser-open.cjs" %*`；環境另設 `CLAUDE_SWITCHER_BROWSER=chrome|edge|default`。`claudeCmd` 可注入。
- `oauth.ts`（新增）：
  - `fetchUsage(accessToken, fetchImpl = fetch): Promise<UsageWindows>`：轉成 `{ five_hour: { used_percentage, resets_at(unix 秒) } | null, seven_day: ... }`；401 → 丟 `TokenExpiredError`；429 → `RateLimitedError`；其他非 200 → `Error`。逾時 15 秒（`AbortSignal.timeout`）。
  - `refreshToken(oauth: ClaudeAiOauth, fetchImpl): Promise<ClaudeAiOauth>`：回傳更新 `accessToken`、`refreshToken`、`expiresAt = Date.now() + expires_in*1000` 的新物件（其他欄位保留）。400／401 → `RefreshFailedError`。
  - `class UsagePoller`：`pollAll(now)`：對每個 slot（序列執行，非平行）：
    1. 是使用中帳號：token 取自 `cred_file()`；**不 refresh**；`expiresAt` 已過期 → 略過（記 `error: "token_expired_active"`，畫面改用 statusline 資料）。
    2. 非使用中：`expiresAt - now < 10 分鐘` → `refreshToken`，成功後**立刻**以 `getSlot` 重讀並只替換 `credentials.claudeAiOauth` 再 `updateSlot`（避免覆蓋同時間的其他修改）；`RefreshFailedError` → 記 `needs_relogin: true`，不再重試直到 slot 的 `saved_at` 改變（重新登入）。
    3. `fetchUsage`；`TokenExpiredError` 且非使用中 → 強制 refresh 一次再試。`RateLimitedError` → 該帳號 10 分鐘內不再查。
    4. 結果寫 `usage_api/<slot_id>.json`：`{ slot_id, ts, five_hour, seven_day, error: string|null, needs_relogin: bool, saved_at }`。
  - 帳號層級的 refresh 鎖：`withSlotLock(slotId, fn)`（Promise 佇列）；`accounts.switchTo` 的呼叫端（controller）在切換前 `await` 目標 slot 的鎖。
  - 任何 log／事件紀錄不得包含 token。

### scripts（esbuild 打包成單檔 CommonJS，不依賴 node_modules）

- `statusline.ts`、`hook.ts`：同 Python（絕不丟例外、exit 0、UTF-8 輸出）；import `core/*`。
- `runner.ts`：同 Python `runner.py`（`--run-id --cwd [--continue] [--claude PATH] [--no-pause] [--wait-timeout SEC]`；`--claude` 以 `.cjs`／`.js` 結尾時用 `process.execPath` 執行）；claude 以 `spawn(claude, args, { stdio: "inherit", cwd })`。
- `browser-open.ts`：同 Python `browser_open.py`，依 `CLAUDE_SWITCHER_BROWSER`：`chrome` → 找 Chrome（App Paths 登錄檔 `reg query` HKLM／HKCU、預設路徑 `C:\Program Files\Google\Chrome\Application\chrome.exe`、`%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`）以 `--incognito`；`edge` → Edge `--inprivate`；找不到或 `default` → `cmd /c start "" "<url>"`。以 `detached: true, stdio: "ignore"` 啟動後 `unref()`。

### IPC 契約（`src/shared/types.ts`）

```ts
export type Window = { used_percentage: number; resets_at: number } | null
export interface AccountView {
  id: string; name: string; email: string
  active: boolean
  exhaustedUntil: number            // unix 秒，0 = 無（slot 的 exhausted_until）
  savedAt: number                   // unix 秒（slot 的 saved_at）
  subscriptionType: string | null   // credentials.claudeAiOauth.subscriptionType，例如 "max"
  usage: { five_hour: Window; seven_day: Window; updatedAt: number | null;
           source: "api" | "statusline" | null; stale: boolean }
  needsRelogin: boolean
  error: string | null              // 中文說明
}
export interface LoginView { state: "idle" | "running" | "awaiting_name" | "failed"; url: string | null;
                             email: string | null; message: string | null; startedAt: number | null }
export interface EventItem { ts: number; text: string; level: "info" | "warn" | "error" }
export interface AppState {
  accounts: AccountView[]
  current: { slotId: string | null; email: string | null; unsaved: boolean }
  runs: { runId: string; cwd: string; state: "running" | "waiting" }[]
  switching: boolean
  pending: boolean                  // 已達門檻、等待回合結束
  usagePolling: boolean             // UsagePoller 執行中
  lastPollAt: number | null         // unix 秒
  earliestReset: number | null      // 所有帳號都用完時的最早重置時間（unix 秒），否則 null
  config: { threshold: number; auto_switch: boolean; last_folder: string;
            login_browser: "chrome" | "edge" | "default"; usage_poll_seconds: number }
  integration: { installed: boolean; nodeFound: boolean }
  login: LoginView
  events: EventItem[]               // 最新 200 筆
}
export type ErrorCode = "NODE_MISSING" | "CLAUDE_MISSING" | "IN_USE" | "BUSY" | "INVALID" | "UNKNOWN"
export type Result = { ok: true } | { ok: false; error: string; code: ErrorCode }
export interface Api {
  getState(): Promise<AppState>
  onState(cb: (s: AppState) => void): () => void
  saveCurrent(name: string): Promise<Result>
  switchTo(id: string, restartRuns: boolean): Promise<Result>
  renameSlot(id: string, name: string): Promise<Result>
  deleteSlot(id: string): Promise<Result>
  refreshUsage(): Promise<Result>
  startLogin(browser?: "chrome" | "edge" | "default", reloginSlotId?: string): Promise<Result>
  cancelLogin(): Promise<Result>
  completeLogin(name: string): Promise<Result>
  copyLoginUrl(): Promise<Result>
  pickFolder(): Promise<string | null>
  launch(folder: string, cont: boolean): Promise<Result>
  setConfig(patch: Partial<AppState["config"]>): Promise<Result>
  installIntegration(): Promise<Result>
  uninstallIntegration(): Promise<Result>
}
declare global { interface Window { api: Api } }
```

IPC channel 名稱：`state:get`、`state:push`、以及各方法同名（例如 `accounts:switchTo`）；preload 用 `ipcRenderer.invoke`。

### main/controller.ts

移植 Python `gui.py` 的非 UI 邏輯（`decide()`、`start_switch()`、登入輪詢），改為事件推送：

- 啟動：清殘留登入目錄、事件水位線設為最新事件檔名、`installScripts()`。
- 每 3 秒 `tick()`：`switching` 中跳過；`syncCurrentBack()`；取使用中帳號的用量（statusline 紀錄與 `usage_api` 紀錄中 `ts` 較新者，兩者都需 `ts >= monitor.since`）；讀新事件；自動切換開啟時 `monitor.tick` → `switch_now` 執行切換。
- 每 `usage_poll_seconds` 呼叫 `UsagePoller.pollAll`（不得與自己重疊）；`refreshUsage()` 立即執行一次。
- 切換流程同 Python `start_switch`（mark exhausted → `pickNext`（`isBlocked`：`usage_api` 紀錄 10 分鐘內且任一視窗 ≥ 門檻）→ 沒有則通知與 `earliestReset` → `requestRestart` → 每 500 ms 檢查、最多 10 秒，逾時 abort → `await` 目標 slot 鎖 → `switchTo` → `monitor.reset` → `releaseRestart`）。
- 全部用完：事件紀錄 + 系統通知（Electron `Notification`），同一次耗盡只通知一次。
- 狀態有變就 `webContents.send("state:push", state)`（節流 200 ms）。
- 所有錯誤轉成中文訊息回傳 `Result` 並寫事件紀錄。
- 視窗關閉：有登入進行中 → cancel。

### renderer（React + Tailwind v4 + shadcn/ui + lucide-react）

設計依 `npx ui-skills`（`baseline-ui`、`shadcn-ui-development` 等，實作者自行以 CLI 取得並遵守）。版面：

1. **頂部列**：App 名稱「Claude 帳號切換器」、目前帳號 Badge（未儲存時警告色）、切換中／等待回合結束狀態、「重新整理用量」IconButton、設定（Dialog：登入瀏覽器 Select、用量更新間隔、整合安裝／移除與狀態、Node 是否找到）。
2. **帳號區**：卡片 grid（`grid-cols-[repeat(auto-fill,minmax(260px,1fr))]`）。卡片：名稱（可點擊重新命名 → Dialog）、email、使用中 Badge、兩條 Progress（5 小時、7 天；≥ 門檻紅色、≥ 80% 黃色、其餘中性）、`42% · 11/13 15:00 重置`、資料時間（「2 分鐘前」）與來源；需要重新登入時顯示警告與「重新登入」按鈕（呼叫 `startLogin`）；DropdownMenu：重新命名、刪除（AlertDialog）。動作按鈕「切換到此帳號」（使用中則停用）；有託管中的 claude 時 AlertDialog 問是否一併重啟。最後一張是「新增帳號」虛線卡片：「瀏覽器登入」（主要）與「儲存目前登入的帳號」（次要）。
3. **右側或下方面板**（寬度 ≥ 1200 時右側，否則下方）：
   - 啟動 claude：資料夾 Input + 瀏覽、「啟動」與「接續上次（--continue）」、託管中數量。
   - 自動切換：Switch + 門檻 Slider（50–100，顯示數值）。
   - 事件紀錄：ScrollArea，時間 + 文字，依 level 上色，新事件自動捲到底。
4. **登入 Dialog**：`login.state` 為 `running` 時顯示說明、Spinner、「複製登入網址」、「取消」；`awaiting_name` 時名稱 Input（預設 email）與「儲存」；`failed` 顯示訊息。
5. Toast（sonner）顯示操作結果。
6. 深色為預設，跟隨系統；數字用 `tabular-nums`；時間格式 `MM/DD HH:mm`（本地時間）。

### 打包

- `npm run build`：先 `build:scripts`（esbuild，target node22，format cjs，bundle，platform node）再 `electron-vite build`。
- `npm run package`：`electron-builder --win portable`，`extraResources` 含 `resources/scripts`；產物在 `app/dist/`。
- `npm test`：vitest。`npm run typecheck`：`tsc --noEmit`（node 與 web 兩份 tsconfig）。

## 任務

| 任務 | 內容 | 相依 |
|---|---|---|
| T-0 | 建立 `app/`：electron-vite react-ts、Tailwind v4（`@tailwindcss/vite`）、shadcn/ui 初始化與元件（button card badge progress dialog alert-dialog input select switch slider scroll-area tooltip dropdown-menu sonner label separator）、lucide-react、vitest、esbuild 腳本建置、electron-builder portable、`src/shared/types.ts`（照上方契約）、`.gitignore`；`npm run build`、`npm run typecheck`、`npm test`（空測試可過）全部可跑 | — |
| T-1 | core：paths storage config accounts switchplan usage integration nodebin + 測試（移植 Python 測試案例） | T-0 |
| T-2 | core：oauth.ts（UsagePoller、refresh、鎖）+ 測試（注入假 fetch：正常、401→refresh→重試、refresh 失敗 needs_relogin、429 退避、使用中帳號不 refresh、refresh 後只替換 claudeAiOauth、不 log token） | T-1 |
| T-3 | core：monitor procutil launcher login；scripts：statusline hook runner browser-open + 測試（移植 Python 的 monitor／runner／login 測試；runner 用 fake-claude.cjs；statusline／hook 以打包後的 .cjs 跑子程序） | T-1 |
| T-4 | main：index.ts、controller.ts、preload；IPC 依契約 | T-2、T-3 |
| T-5 | renderer：完整 UI（依契約，開發時可用假資料 mock `window.api`） | T-0 |
| T-6 | 打包驗證、`app/README.md`、更新根目錄 `README.md`、`CLAUDE.md` | T-4、T-5 |

T-2／T-3 平行；T-5 可與 T-1～T-4 平行。

## AC 驗證方式

| AC | 驗證 |
|---|---|
| AC-1、AC-10 | T-5 完成後 `npm run dev` 截圖（Opus 檢查）；使用者實測 |
| AC-2 | oauth 測試；使用者實測（兩個帳號都顯示用量） |
| AC-3 | login 測試；使用者實測 Chrome 無痕登入 |
| AC-4、AC-6、AC-7 | accounts／monitor／switchplan 測試；使用者實測 |
| AC-5 | runner／launcher 測試；使用者實測 |
| AC-8 | integration 測試（含移除 Python 版項目） |
| AC-9 | accounts 測試使用 Python 版產生的 slot JSON 樣本 |
| AC-11 | `npm run package` 產生 exe（Opus 用 Bash 檢查） |

## 邊界情況與風險

- 未公開 API 改版：`fetchUsage`／`refreshToken` 失敗只影響用量顯示，切換照常；錯誤以中文顯示在卡片。
- refresh token 輪替：本程式只 refresh 非使用中帳號；若有非託管的 claude 仍用某個非使用中帳號（例如切換前沒關的 VS Code），兩邊會互相作廢 token → 該帳號顯示需要重新登入。README 註明。
- 同時有 Python 版在跑：兩者共用資料目錄，會重複切換；README 註明只執行一個。
- 系統沒有 node：整合、託管、登入停用並提示；帳號卡片與手動切換仍可用。

## 回退

新版不刪除 Python 版；資料格式相同，可隨時改回 `python -m switcher`。整合移除可還原 settings.json（備份在 `backups/`）。

## 審查後修訂（優先於上文）

### R-1 slot 寫入鎖與 refresh 競爭
- 新增 `core/lock.ts`（T-1 提供）：`withSlotLock(slotId, fn)`，in-process Promise 佇列。主程序所有寫 slot 的路徑（`updateSlot` 呼叫端：`syncCurrentBack`、`switchTo`、`renameSlot`、`markExhausted`、`addSlot`、poller 寫回）都經過它；scripts 不寫 slot。
- controller `switching` 期間 poller 暫停（`pollAll` 開始前檢查，執行中每個帳號之間也檢查）。
- poller refresh 成功後、寫回前：若 `currentSlotId() === slotId`（refresh 期間變成使用中）→ 讀 `cred_file()`：其 `claudeAiOauth.refreshToken` 等於送出的舊 refresh token → 新 oauth 同時寫入 cred_file 與 slot；否則丟棄新 token 並標 `needs_relogin`（事件紀錄說明）。
- refresh 收到 400／401：重讀 slot，若 `refreshToken` 已不同於送出的值（被他方輪替）→ 用新的再試一次；仍失敗才 `needs_relogin`。

### R-2 輪詢
- `pollAll` 正在執行時，計時觸發或手動 `refreshUsage` 直接跳過（`refreshUsage` 回傳 `{ok:false, code:"BUSY"}`）。
- 每個請求逾時 15 秒；`pollAll` 不另設整體上限。

### R-3 scripts 打包
- `src/scripts/*` 只能 import `core/paths`、`core/storage`、`core/usage`、`core/accounts`（`accounts` 只能 import `paths`、`storage`、`lock`）。`core/*` 一律不得 import `electron`；`Notification` 只在 `main/`。
- 測試：打包後每個 `.cjs` 不含字串 `require("electron")`，且小於 300 KB。

### R-4 storage
- 維持同步 API；重試等待用 `Atomics.wait`（只在檔案被鎖時發生，極少）。不採用 async 版本（檔案很小、競爭罕見）。

### R-5 installScripts
- 以 SHA-256 比較來源與目標內容，不同才複製；複製用「寫暫存檔 + rename」並套用 storage 的重試。

### R-6 路徑與引號
- `open_browser.cmd` 內的路徑把 `%` 轉成 `%%`；整個檔案以 UTF-8 寫入並 `chcp 65001`。
- 啟動資料夾去掉結尾反斜線（磁碟根目錄 `C:\` 除外）。
- 測試涵蓋路徑含空格、中文、`&`、`%`。

### R-7 資料相容
- slot、config 欄位名稱維持 snake_case（`exhausted_until`、`saved_at`、`account_uuid`、`oauth_account`）；camelCase 只出現在 `AccountView`，由 controller 轉換。
- accounts 測試用 Python 版格式的 slot JSON 樣本（含 float `saved_at`、中文名稱）讀取後切換、寫回，欄位語意不變（不要求位元組相同）。

### R-8 用量資料
- API `utilization` 為 0–100 百分比（實測 53.0）；轉成 `used_percentage`，限制在 0–100；`resets_at` ISO 字串轉 unix 秒；視窗為 `null` 或缺欄位 → `null`。測試涵蓋這些情況。

### R-9 AppState 欄位語意
- `usage`：使用中帳號取 statusline 與 usage_api 中 `ts` 較新者；非使用中只取 usage_api。`source` 為採用的來源；`updatedAt` 為該紀錄 `ts`（unix 秒）；`stale` = `now - updatedAt > max(600, 3 × usage_poll_seconds)`。
- `error`：中文訊息，例如「token 已過期，需要重新登入」、「用量 API 暫時無法使用」、「查詢太頻繁，稍後再試」。
- `needsRelogin`：usage_api 紀錄 `needs_relogin` 為真且其 `saved_at` 等於 slot 目前的 `saved_at`。
- `integration.installed`：settings.json 含本程式（bin 路徑）的 statusLine 與兩個 hook。node 找不到時 `installIntegration` 回傳 `code: "NODE_MISSING"`。

### R-10 重新登入
- `startLogin(browser, reloginSlotId)`：登入完成後 `addSlot` 以 uuid／email 比對；比對到 `reloginSlotId` 以外的帳號時事件紀錄警告（登入了別的帳號）。`completeLogin(name)` 時若比對到既有 slot 則更新該 slot（保留 id、`exhausted_until`；`saved_at` 更新使 `needs_relogin` 失效），不新增重複帳號。重新登入時名稱預設為原名稱。

### R-11 切換流程歸屬
- `controller` 負責整個切換流程（含手動切換 `switchTo(id, restartRuns)`：`restartRuns` 為 true 時同自動切換的 request/等待/release 流程；false 時直接 `accounts.switchTo`）。`launcher` 只提供 `launch`、`activeRuns`、`requestRestart`、`releaseRestart`、`abortRestart`。
- monitor 型別：
  ```ts
  type UsageRecord = { session_id?: string; slot_id: string | null; ts: number; five_hour: Window; seven_day: Window }
  type EventRecord = { kind: "stop" | "stopfailure"; session_id?: string; cwd?: string; error: string | null; slot_id: string | null; ts: number; _name: string }
  type Action = { kind: "none" | "pending" | "switch_now"; reason: string; exhaustedUntil: number }
  class Monitor { constructor(threshold = 95, pendingTimeout = 600); since: number; tick(now, activeSlotId, usage: UsageRecord | null, events: EventRecord[]): Action; reset(since: number): void }
  ```

### R-12 測試補充
- login：假登入前後 `cred_file()` 與 `claude_json()` 內容不變。
- controller：`isBlocked` 組裝（usage_api 已達門檻的帳號被跳過）、`runs` 清單。controller 以可注入的依賴撰寫（時間、launcher、poller），可在 vitest 中不啟動 Electron 測試。
- AC-11：`npm run package` 後檢查 `dist/win-unpacked/resources/scripts/*.cjs` 存在（portable 解壓內容相同）。

## 審查紀錄

2026-11-13 Sonnet 規格審查 14 條：

- 採用：1（R-1）、2（R-1）、3（R-2）、4（R-3）、6（IPC 契約已更新：`savedAt`、`subscriptionType`、`runs` 清單、`usagePolling`、`lastPollAt`、`earliestReset`、`ErrorCode`、`reloginSlotId`；R-10）、7（R-5）、8（R-6）、10（R-8）、12（R-9；lock 由 T-1 提供）、13（R-11）、14（R-9）。
- 部分採用：5（不改 async，見 R-4）、9（欄位名稱與語意相容，不要求位元組相同，R-7）、11（補 login 不變性、controller isBlocked、打包產物檢查；不加 Playwright 截圖斷言，介面由 `npm run dev` 截圖與使用者實測）。

## 實作偏差

- 版本：electron 44、electron-vite 6、vite 8、react 19、tailwindcss 4.3、vitest 5、esbuild 0.28、electron-builder 26；Node 升級為 v26.13.1（LTS）。
- types.ts：`Window` 改名 `UsageWindow`（避免與 DOM `Window` 混淆）；`LoginView` 加 `reloginSlotId`、`defaultName`；新增 `AppConfig`、`RunView`、`LoginBrowser`、`IPC` channel 常數。
- shadcn：CLI 誤裝 `cn` 套件，改手動放元件與 `components.json`；`progress.tsx` 加 `indicatorClassName`。ui-skills 使用 `baseline-ui`（`shadcn-ui-development` 不存在）。
- core：`accounts` 同步且不自帶鎖（由 controller／poller 包 `withSlotLock`）；`readNewEvents` 回傳 `{events, last}`；`isInstalled` 只認新版項目；`install` 缺 node 丟 Error（controller 轉 `NODE_MISSING`）。
- oauth：`pollAll()` 回傳 boolean（false = 執行中或暫停）；失敗時保留上一筆視窗資料；使用中帳號 token 過期記代碼 `token_expired_active`（controller 轉中文）；refresh 成功但 slot 已被他方更新時丟棄新結果、採用 slot 內較新者；429 退避只存在記憶體。
- T-3：`killTree`、`requestRestart`、`LoginSession.cancel` 為 async；login `result()` 回傳 `{creds, account}`；browser-open 找不到 Chrome 時退到 Edge InPrivate 再退到預設；default 模式以 `windowsVerbatimArguments` 避免 `&` 被 cmd 切斷；vitest globalSetup 先打包 scripts。
- controller：新增 `CLAUDE_SWITCHER_DISABLE_POLL` 開關（停用時 `refreshUsage` 回 `INVALID`）；`isBlocked` 另要求視窗 `resets_at` 未過；登入結果取得後立即刪除暫存目錄；`before-quit` 等 `dispose()`。
- index.ts：新增 `CLAUDE_SWITCHER_SCREENSHOT`／`_SIZE` 截圖開關（驗證用）。

## 驗證紀錄（2026-11-13，程式碼層面）

- `npm test`：15 檔 135 測試通過；`npm run typecheck`、`npm run build` 通過。
- 隔離假資料環境截圖（1280×820、920×700）：卡片、進度條顏色、需要重新登入、方案 Badge、寬／窄版面皆正確。
- `npm run package`：產生 `dist/Claude Account Switcher 1.0.0.exe`（106 MB）；`dist/win-unpacked` 以假資料環境啟動成功並截圖，`bin/` 複製出 4 個 `.cjs`。
- 未驗證（待使用者實測）：真實帳號的用量 API 顯示、非使用中帳號 token refresh、Chrome 無痕登入、整合安裝、託管與自動切換。未做實作 diff 審查。
