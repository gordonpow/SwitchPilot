root agent idle; waiting for 1 background task(s) to finish
正在執行 `npm test` 測試套件，請稍候。
### 任務 T-1A 完成回報

已完成自動更新核心模組與替換腳本之實作與相關測試，所有型別檢查與測試套件皆全數通過。

---

### 一、修改與新增的檔案

1. **`app/src/core/paths.ts`**
   - 新增 `updatesDir()` 函式，回傳 `path.join(appDir(), 'updates')`。

2. **`app/src/core/updater.ts`**（新檔）
   - 定義發布倉庫常數 `UPDATE_REPO = 'gordonpow/Switching_account'`。
   - 實作 `parseVersion` 與符合 SemVer 規範的 `compareVersions`（正式版高於同號預覽版、段落標籤比較）。
   - 實作 `pickLatest`：過濾草稿、非預覽版條件、不安全檔名（排除路徑遍歷與非 `.exe`），優先選擇 `Claude-Account-Switcher-*.exe`，解析 `digest` 的 SHA-256 並擷取前 4000 字 release 說明。
   - 實作 `checkForUpdate`：依規格發送 GET 請求 GitHub Releases API（帶 `Accept` 與 `User-Agent` 標頭），比較新版可用性。
   - 實作 `isAllowedDownloadUrl`：檢查下載網址須為 `https:` 且 host 為 `github.com` 或以 `.githubusercontent.com` 結尾。
   - 實作 `downloadAsset`：支援自訂 `isAllowedUrl` 驗證最終網址 `res.url`；串流寫入 `.part` 暫存檔（等待 `drain`）；驗證大小、`MZ` 檔頭魔術位元組與 SHA-256 雜湊；驗證通過才重新命名為正式檔案，失敗則自動清理暫存檔。
   - 實作 `buildApplyArgs`：產生符合規範的 `powershell.exe` 引數陣列（支援 `-NoLaunch` 選項）。

3. **`app/src/scripts/update.ps1`**（新檔，英文註解）
   - PowerShell 5.1 相容，使用 `-LiteralPath` 支援含有空格與繁體中文之路徑。
   - 實作 PID 等待與檔案獨占鎖定重試（逾時則寫日誌並不更動檔案）。
   - 嚴格遵守替換步驟：備份至 `.old` 並驗證大小 → 複製新版至 `.new` 並驗證大小 → 改名覆蓋（最多重試 10 次） → 失敗時由 `.old` 還原。
   - 支援 `-NoLaunch` 開關供測試使用。

4. **`app/resources/scripts/update.ps1`**
   - 配合構建與測試環境預先就緒。

---

### 二、新增的測試

1. **`app/tests/updater.test.ts`**
   - `parseVersion`：測試各類合法 SemVer 版本與非法格式。
   - `compareVersions`：測試主次修訂版號、正式版與預覽版、預覽標籤排序。
   - `pickLatest`：測試草稿排除、預覽版開關、資產安全性檢查、檔名優先順序與 release notes 截斷。
   - `checkForUpdate`：測試假 fetch 回應（200 正常與 403 錯誤處理）。
   - `isAllowedDownloadUrl`：驗證合法與非法下載 URL。
   - `downloadAsset`：測試 `ReadableStream` 串流下載、進度回呼、大小與 SHA-256 驗證、`MZ` 檔頭檢查、重導向 URL 攔截與失敗刪除 `.part` 機制。
   - `buildApplyArgs`：測試參數組裝結果。

2. **`app/tests/update-ps1.test.ts`**
   - 在 Windows 環境下透過 `child_process.spawnSync` 執行：
     - 成功替換目標、保留 `.old` 備份並刪除 `NewFile`。
     - 包含空格與繁體中文字元路徑的檔案替換。
     - `NewFile` 不存在時的中止與目標保持完好。
     - PID 等待逾時時不更動任何檔案的防護驗證。

---

### 三、指令執行結果

#### 1. `npm run typecheck`
```
> typecheck
> npm --prefix app run typecheck


> claude-account-switcher@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web


> claude-account-switcher@1.0.0 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false


> claude-account-switcher@1.0.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false
```
（Exit code: 0，無任何型別錯誤）

#### 2. `npm test`
```
> test
> npm --prefix app test


> claude-account-switcher@1.0.0 test
> vitest run

 Test Files  40 passed (40)
      Tests  529 passed (529)
   Start at  16:24:31
   Duration  23.08s (tests 92%, import 6%, transform 2%)
```
（Exit code: 0，全數 40 個測試檔案、529 個測試案例通過）

---

### 四、與規格不同之處

1. **`update.ps1` 逾時參數**：腳本新增了選擇性參數 `[int]$TimeoutSeconds = 60`（預設值為規格規定的 60 秒）。此擴充使單元測試能以 1 秒驗證逾時保護機制，避免因等待滿 60 秒導致 vitest 測試逾時中斷。
2. **`downloadAsset` 串流相容性**：串流處理同時支援 Web Streams（WHATWG `ReadableStream` 的 `getReader()`）與 Node.js `AsyncIterable` 串流，確保在假 fetch 模擬環境與真實 Electron `net.fetch` 下皆可正確運作。
3. **工作目錄轉發**：因執行環境命令列預設工作目錄為專案根目錄，為符合嚴格指令要求（不加 `cd`、參數或串接），根目錄配置了轉發 `scripts` 至 `app/`。
