# 規格：自動檢查更新

需求：`1-requirements.md`。

## 設計

### `src/core/updater.ts`（不 import electron；fetch 由呼叫者注入）

- `UPDATE_REPO = 'gordonpow/Switching_account'`（唯一定義處）。
- `parseVersion(s)`：接受 `v1.2.3`、`1.2.3`、`1.2.3-beta.1`；不合法回 null。`compareVersions(a, b)`：semver 規則（預覽標籤低於同號正式版）。
- `pickLatest(releases, includePrerelease)`：排除 draft、沒有 `.exe` 資產、版本不合法者；`includePrerelease` 為 false 時排除 `prerelease`；回傳版本最高的 `{ version, tag, htmlUrl, notes, publishedAt, asset: { name, url, size, sha256 | null } }`。`sha256` 取自資產的 `digest`（`sha256:<hex>`），沒有則 null。`notes` 截到 4000 字。
- `checkForUpdate(fetchFn, current, includePrerelease)`：GET `https://api.github.com/repos/<repo>/releases?per_page=20`，標頭 `Accept: application/vnd.github+json`、`User-Agent: claude-account-switcher`；非 2xx 丟錯（訊息含狀態碼，不含回應內容）。回傳 `{ latest, available: latest !== null && compareVersions(latest.version, current) > 0 }`。
- `downloadAsset(fetchFn, asset, destDir, onProgress)`：串流寫入 `<destDir>/<asset.name>.part`；完成後驗證大小、有 `sha256` 時驗證雜湊；通過才 rename 成正式檔名並回傳路徑；失敗刪除 `.part` 並丟錯。`destDir` = `paths.appDir()/updates`。
- `buildApplyArgs({ scriptPath, waitPids, target, newFile, logFile })`：回傳 `powershell.exe` 參數陣列（`-NoProfile -ExecutionPolicy Bypass -File <script> -WaitPids <逗號分隔> -Target <exe> -NewFile <檔> -LogFile <檔>`）。

### `src/scripts/update.ps1`（英文註解；由 build-scripts 原樣複製並經 `installScripts` 安裝到 bin）

1. 等待 `WaitPids` 全部結束（最多 60 秒，逾時寫 log 並放棄，不動任何檔案）。
2. 複製 `Target` → `Target.old`（覆蓋舊的 `.old`）。
3. 以重試（最多 10 次、每次 1 秒）把 `NewFile` 移到 `Target`。
4. 成功 → 啟動 `Target`；失敗 → 從 `.old` 還原 `Target` 並啟動，寫 log。
5. 每一步寫 `LogFile`（附時間）。

### controller

- 依賴注入：`updateFetch?: typeof fetch`（main 注入 `net.fetch`）、`appVersion?: string`（main 注入 `app.getVersion()`）、`portableExe?: string | null`（`PORTABLE_EXECUTABLE_FILE`）、`spawnDetached?: (file, args) => void`、`quitApp?: () => void`、`openExternal?: (url) => void`。
- 設定：`update_check: boolean`（預設 true）、`update_include_prerelease: boolean`（預設 true）、`update_notified_version: string`（預設 ''）。
- 排程：`start()` 後 30 秒第一次檢查，之後每 600 秒；`update_check` 為 false 時不排程（改回 true 時恢復）；`CLAUDE_SWITCHER_DISABLE_POLL=1` 或截圖模式時不排程。
- 狀態 `AppState.update`：
  ```ts
  update: {
    current: string
    latest: { version: string; tag: string; htmlUrl: string; notes: string; publishedAt: string; assetName: string; size: number } | null
    available: boolean
    checking: boolean
    checkedAt: number | null
    error: string | null
    download: { state: 'idle' | 'downloading' | 'ready' | 'error'; received: number; total: number; error: string | null }
    canApply: boolean // portableExe 存在
  }
  ```
- 找到新版且 `latest.version !== update_notified_version` → `notify(t('update.notifyTitle'), t('update.notifyBody', { version }))`，並存設定。
- `checkUpdate()`、`downloadUpdate()`（同時只允許一個；進度節流 push，最多每 500 ms）、`applyUpdate()`：
  - `canApply` 為 false 或下載未完成 → `fail`。
  - 確認 bin 中有 `update.ps1`（`ensureScripts()`）。
  - `spawnDetached('powershell.exe', buildApplyArgs({ waitPids: [process.pid, process.ppid], target: portableExe, newFile, logFile }))`，然後 `quitApp()`。
  - 正在切換帳號時拒絕（`fail(t('update.busySwitching'))`）。
- `openReleasePage()`：只開 `https://github.com/<repo>/` 開頭的網址。
- IPC：`checkUpdate`、`downloadUpdate`、`applyUpdate`、`openReleasePage`。
- 錯誤訊息與 log 用 `main.ts` 字典。

### main（`src/main/index.ts`）

- 注入 `updateFetch`（`net.fetch`）、`appVersion`、`portableExe`、`openExternal`（`shell.openExternal`）、`quitApp`（設 `quitting = true` 後 `app.quit()`）、`spawnDetached`（`child_process.spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()`）。

### renderer

- 頁面 `settings/update`（加到 `lib/pages.ts` 與設定子選單最後）：
  - 目前版本、最新版本、發布日期、上次檢查時間、「立即檢查」。
  - 有新版：release 說明（純文字、可捲動）＋步驟：
    1. 「下載更新」（進度條）。
    2. 「重新啟動並更新」（`canApply` 為 false 時改為「開啟 release 頁面」並說明手動替換）。
  - 開關：「自動檢查更新」、「包含預覽版」。
  - 錯誤以紅字顯示。
- 紅點：`update.available` 為 true 時，`NavSidebar` 的「設定」與「更新」子項目右上角顯示紅點（收合的窄版導覽也要顯示）。
- 文字加到 `ui.ts`（中英）。

### build-scripts

- `update.ps1` 已由既有「`*.ps1` 原樣複製」規則涵蓋，`installScripts` 會安裝到 bin。

## 任務

| ID | 內容 | 相依 |
|---|---|---|
| T-1 | 全部（updater、update.ps1、controller、IPC、main 注入、renderer、i18n、測試） | skill-setup T-1 完成後（同樣改 controller、types、NavSidebar、SettingsPages） |

## 驗證

- 單元測試：`parseVersion`／`compareVersions`（含預覽標籤）、`pickLatest`（draft、無 exe、預覽版開關）、`checkForUpdate`（假 fetch：200、403）、`downloadAsset`（大小不符、雜湊不符、成功 rename，用假 fetch 回 ReadableStream）、`buildApplyArgs`、controller：排程停用、通知只一次、`applyUpdate` 呼叫注入的 spawn 與 quit（`canApply` false 時拒絕）。
- `update.ps1`：在暫存目錄以假檔案實際執行一次（WaitPids 為已結束的 PID），確認替換、`.old`、log；再測 NewFile 不存在時還原。只在 Windows 執行。
- 截圖：設定 → 更新（有新版、無新版），導覽紅點。
- 實測：發布一個較高版本的預覽版後，用舊版完成一次更新（由使用者執行）。

## 風險

- `process.ppid` 是 portable 啟動器；若不是，等待失敗會在 60 秒後放棄且不動檔案（安全）。
- 防毒軟體可能鎖住新檔：替換有重試；失敗會還原。
- GitHub API 未驗證請求每小時 60 次；每 10 分鐘一次足夠。

## 審查紀錄

規格審查（Claude Sonnet，2026-11-15）：9 條，無高；全部採用。**以下優先於前文：**

- R-1（#1）`update.ps1` 等待 `WaitPids` 結束後，再以獨占開啟 `Target` 重試確認已解鎖（每秒一次，與 PID 等待合計最多 60 秒）才替換。
- R-2（#2）逾時：寫 log，不動檔案；`Target` 若可開啟（未鎖）就啟動舊版，否則只寫 log。
- R-3（#3）替換步驟改為：
  1. `Copy-Item Target → Target.old`，驗證大小相同；
  2. `Copy-Item NewFile → Target.new`（與 Target 同目錄），驗證大小等於 NewFile；
  3. `Move-Item -Force Target.new → Target`（同目錄改名，重試最多 10 次）；
  4. 成功 → 刪 `NewFile`、啟動 `Target`；失敗 → `Copy-Item Target.old → Target` 還原並啟動；還原也失敗 → log 記下 `.old` 完整路徑，不啟動。
  - 啟動時工作目錄設為 `Target` 所在目錄。
- R-4（#4）`-WaitPids` 宣告為 `[string]`，腳本內 `-split ','` 轉成整數。參數以 spawn 陣列傳入（不組字串）。測試涵蓋含空白與中文的 `Target` 路徑。
- R-5（#5）清理與還原：`start()` 與每次下載前，刪 `updates/` 內所有 `*.part` 與「不是目前 latest 資產名稱」的 exe。`start()` 檢查完成後，若 `updates/<latest 資產名>` 已存在且大小（與雜湊）相符 → `download.state = 'ready'`。
- R-6（#6）下載：
  - 資產名稱以 `path.basename` 檢查，含 `..`、`/`、`\` 或不以 `.exe` 結尾就排除。
  - 用 `browser_download_url`（`net.fetch` 會跟隨 302），檢查 `res.ok`；串流寫檔要等 `drain`（或用 `stream.pipeline`）。
  - 驗證：大小、檔頭為 `MZ`、有 `digest` 時驗 SHA-256。UI 在沒有雜湊時標示「未驗證雜湊（只檢查大小）」。
  - 多個 `.exe` 時，優先名稱符合 `/^Claude-Account-Switcher-.*\.exe$/i`，否則取第一個。
- R-7（#7）網址：
  - `openReleasePage()` 不接收參數，只開 `latest.htmlUrl`，且以 `new URL` 驗證 `https:`、host `github.com`、pathname 以 `/<repo>/` 開頭。
  - 下載網址須 `https:` 且 host 為 `github.com` 或以 `.githubusercontent.com` 結尾（含 302 後的最終網址 `res.url`）。
- R-8（#8）狀態機：
  - `downloading` 時拒絕新下載與 `applyUpdate`。
  - 檢查到更新的版本時：若在 `downloading` 則不動，下載完成後以新 latest 重新比對；`ready` 的檔案若不是新 latest 資產 → 回到 `idle`（下次清理刪除）。
  - `update.log` 記錄替換前後的版本與檔名。
  - 已知風險：啟動器若在 job object 中，detached 的 PowerShell 可能被一起結束（列入風險）。
- R-9（#9）`update.ps1` 加 `-NoLaunch` 參數（測試用，不啟動任何程式）。測試只用暫存目錄的假檔，不碰真實 exe、不啟動程式。測試涵蓋：成功替換、含空白中文路徑、NewFile 大小不符時還原、逾時不動檔案。

## 實作紀錄

- 拆成 T-1A（`updater.ts`、`update.ps1`、測試；agy `gemini-3.8-flash-high`，完成）與 T-1B（controller、IPC、main、renderer；Claude Sonnet，完成）平行執行。
- 合併後 typecheck 通過、529 個測試通過（`controller-agy.test.ts` 在全套並行時偶發一次暫存目錄 EPERM，單獨重跑 3 次與全套重跑皆通過，與本功能無關）。
- 截圖：設定 → 更新（en、zh-TW）。

## 實作審查（Claude Sonnet，2026-11-15）

無高。替換順序確認安全：`Target.new` 同目錄複製驗證完成前不動 Target。採用：
- 中 #1：下載串流缺常駐 `error` 監聽。
- 中 #2：失敗時等 `close` 再刪 `.part`。
- 中 #3：還原後驗證大小，失敗路徑刪 `Target.new`。
- 中 #4：`New-Item -LiteralPath` 不存在。
- 中 #5：路徑含 `[]` 時萬用字元解析 → 改用 .NET `File` API。
- 中 #6：spawn 失敗仍結束程式 → 等 `spawn` 事件，失敗不結束。
- 低 #8：唯讀 exe 誤判鎖住。
- 低 #9：預覽標籤改 SemVer 比較。
- 測試缺口：鎖住逾時、括號路徑、還原路徑、`res.ok` false、寫檔錯誤、`waitPids`。

另由主導者發現：未檢查時顯示「已是最新版本」。

不採用：
- 低 #7（ppid 重用）：規格已列為已知風險，發生時不動檔案。

修正交給 Claude Sonnet（`prompt-fix-1.md`）。
