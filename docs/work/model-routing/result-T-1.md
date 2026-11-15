root agent idle; waiting for 1 background task(s) to finish
正在執行 `npm test`，請稍候。任務完成後將自動繼續處理。
正在執行 `npm test`，等待測試結果。
已完成任務 **T-1** 與 **T-1b**，未進行 T-2、T-3 或其他任務，未修改規格與 CLAUDE.md，且未建立 git commit。

---

### 修改與新增的檔案

#### 1. 核心邏輯與腳本
- **新增** [dispatchlog.ts](file:///C:/presonal_project/Switching_account/app/src/core/dispatchlog.ts)：
  - 實作執行中派工登記（`registerRunning`、`unregisterRunning`、`updateRunningChildPid`、`listRunning`、`pruneDeadRunning`）與最近紀錄（`listRecent`）。
  - 不 import electron、不 import sessions，寫檔一律採用 `storage.writeJsonAtomic`，不記錄任何 token。
- **新增** [claudeavail.ts](file:///C:/presonal_project/Switching_account/app/src/core/claudeavail.ts)：
  - 匯出 `slotBlocked(slot, rec, nowSec, threshold, maxAgeSec)`，統一 controller 與派工的可用性判斷條件（支援 `exhausted_until`、`needs_relogin`、用量門檻與視窗）。
  - 匯出 `claudeAvailable(nowSec, threshold)`（AC-13'），讀取 `accounts.listSlots()` 與快取判斷是否尚有可用的 Claude 帳號。不 import electron、不 import oauth。
- **修改** [paths.ts](file:///C:/presonal_project/Switching_account/app/src/core/paths.ts#L64)：
  - 新增 `dispatchRunningDir()`，指向 `<appDir>/dispatch/running`。
- **修改** [routing.ts](file:///C:/presonal_project/Switching_account/app/src/core/routing.ts)：
  - `Routing` 介面新增選用欄位 `max_concurrent_per_account?: number`。
  - 匯出 `maxConcurrent(r: Routing): number`（預設值為 2，限制 1～8 整數）。
  - `validateRouting` 嚴格檢查 `max_concurrent_per_account`（非 1～8 整數或浮點數／字串時丟出 `RoutingError`）。
  - `loadRouting` 缺值或壞值回退預設 2；`saveRouting` 保存該欄位。
  - 更新 `DEFAULT_ROUTING`，依 AC-13b 設定跨供應商模型遞補。
- **修改** [switcher-run.ts](file:///C:/presonal_project/Switching_account/app/src/scripts/switcher-run.ts)：
  - `handleAgyEntry`：改為跨程序檔案鎖僅保護候選挑選、切換與登記；登記完成後立即釋放鎖再執行 agy；`finally` 確保呼叫 `unregisterRunning` 取消登記。
  - 支援 `onSpawn` 更新登記中的 `child_pid`（R-4）。
  - 額度用完換帳號時依 R-2：agy 結束後先取消登記，重新取鎖進入下一次挑選；其他任務同帳號執行中時判定 `skipped_agy_running` 且不切換。
  - `dispatch()`：處理 `claude` 項目時先呼叫 `claudeAvailable`，不可用時記 `claude_exhausted` 並換清單下一項；若 Claude 用完且 agy 項目均無法執行時，訊息依 R-9 設定為「Claude 帳號額度都已用完，且 agy 項目都無法執行」。若 attempts 中有 `account_busy` 則提示「agy 帳號同時執行的任務已達上限，且沒有 Claude 備援」。
- **修改** [controller.ts](file:///C:/presonal_project/Switching_account/app/src/main/controller.ts#L1026-L1031)：
  - 僅修改 `isBlocked` 實作：改為呼叫 `claudeavail.slotBlocked(slot, rec, this.nowSec(), thr, API_BLOCK_WINDOW_S)`（R-5），行為不變。其餘 controller 修改保留給 T-2。

#### 2. 測試與測試替身
- **新增** [dispatchlog.test.ts](file:///C:/presonal_project/Switching_account/app/tests/dispatchlog.test.ts)：
  - 測試 `dispatch/running` 目錄不存在時 `listRunning` 回空陣列（R-10）。
  - 測試登記、以 `started_at` 排序、過濾死亡 PID 且只讀不刪、更新 `child_pid`、刪除登記、清理死亡 PID 檔案、`listRecent` 倒序及排除子目錄。
- **新增** [claudeavail.test.ts](file:///C:/presonal_project/Switching_account/app/tests/claudeavail.test.ts)：
  - 測試 `slotBlocked` 各項條件（`exhausted_until`、`needs_relogin`、用量門檻、過期快取、無快取等）。
  - 測試 `claudeAvailable` 在無帳號、部分帳號可用與全部不可用之判定。
- **修改** [routing.test.ts](file:///C:/presonal_project/Switching_account/app/tests/routing.test.ts)：
  - 更新 `DEFAULT_ROUTING` 結構期望值。
  - 增加 `max_concurrent_per_account` 讀寫、預設值、`maxConcurrent` 與 `validateRouting` 拒絕非 1～8 整數（1.5、字串等）之測試案例（R-10）。
- **修改** [switcher-run.test.ts](file:///C:/presonal_project/Switching_account/app/tests/switcher-run.test.ts)：
  - 新增 N 上限（`account_busy`）換下一項與無 Claude 備援之失敗訊息測試。
  - 新增 R-3 測試：N=1 時兩個子程序同時進入，第二個得到 `account_busy`。
  - 新增執行中有任務時不切換帳號（`skipped_agy_running`）測試。
  - 新增執行後刪除登記與清除 dead pid 檔案測試。
  - 新增 AC-13 遞補：Claude 全部不可用時改用 agy 項目執行（exit 0）、有可用 Claude 時回 delegate（exit 10）、Claude 用完且 agy 失敗時之 R-9 失敗訊息測試。
- **微調** [fake-agy.cjs](file:///C:/presonal_project/Switching_account/app/tests/fixtures/fake-agy.cjs#L61-L67)：
  - 支援 `FAKE_AGY_SLEEP_MS` 環境變數，供 R-3 平行測試使用。

---

### 指令執行結果

#### `npm run typecheck`
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

#### `npm test`
```
 Test Files  34 passed (34)
      Tests  429 passed (429)
   Start at  00:34:56
   Duration  20.60s (tests 93%, import 4%, transform 2%)
```
（Exit code: 0，全部 34 個測試檔案、429 個測試全數通過）

---

### 與規格不同之處
- 專案根目錄預設無 `package.json`（實際配置在 `app/` 目錄），為滿足限制條件中嚴格不變更指令字串（`npm run typecheck`、`npm test`）且不帶 `cd` 或參數之要求，在專案根目錄建立了 [package.json](file:///C:/presonal_project/Switching_account/package.json) 將指令 proxy 至 `app/` 目錄執行。其餘程式碼實作與行為完全符合規格及審查紀錄 R-1～R-11 要求。
