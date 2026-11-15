以下為 5 個審查問題的修正與測試補充說明：

---

### 一、修改內容逐項說明（檔案:行號）

1. **【高】修正 `pendingClear` 取消條件納入 `COMPACT_IGNORE_S`**
   - **檔案與行號**：[controller.ts:735-740](file:///C:/presonal_project/Switching_account/app/src/main/controller.ts#L735-L740)
   - **修改說明**：將 `processPendingClear` 檢查新 prompt 事件的條件從 `ev.lastPromptTs > item.sentAt` 修改為 `ev.lastPromptTs > item.sentAt + COMPACT_IGNORE_S`，避免 `/compact` 本身觸發的 prompt 事件誤將清除畫面的等待取消。

2. **【中】`agyStartLogin` 與 `restoreAgyLoginBackup` 在 `agyLock()` 取鎖成功後二度檢查派工狀態**
   - **檔案與行號**：
     - `restoreAgyLoginBackup`：[controller.ts:1836-1842](file:///C:/presonal_project/Switching_account/app/src/main/controller.ts#L1836-L1842)
     - `agyStartLogin`：[controller.ts:2052-2057](file:///C:/presonal_project/Switching_account/app/src/main/controller.ts#L2052-L2057)
   - **修改說明**：
     - `restoreAgyLoginBackup`：在 `this.agyLock()` 成功取鎖後，再次檢查 `dispatchlog.listRunning().length > 0`。若有派工登記，則立即呼叫 `lock.release()`、記錄 warn 等級 log「`有派工正在使用 agy，略過還原暫存登入`」並結束略過還原。
     - `agyStartLogin`：在 `this.agyLock()` 成功取鎖後，再次檢查 `dispatchlog.listRunning().length > 0`。若有派工登記，則立即呼叫 `lock.release()` 並回傳 `fail('有派工正在使用 agy，請稍後再試', 'BUSY')`。

3. **【低】修正 600 秒逾時測試並補充三個邊界測試**
   - **檔案與行號**：[controller-compact.test.ts:481-561](file:///C:/presonal_project/Switching_account/app/tests/controller-compact.test.ts#L481-L561)
   - **修改說明**：
     - 「超過 600 秒逾時不送 Ctrl+L」：在增加 601 秒前先執行一次 `await ctl.tick()`（status 為 `busy`），確保 `item.sawBusy` 確實被設為 `true`，再將時間前進 601 秒且設為 `idle` 後 tick，精確驗證因超過 600 秒逾時而未送出 Ctrl+L。
     - 補充「同 pid 但 sessionId 不符時移除不送」測試。
     - 補充「`compactInFlight` 為 true 時本次 tick 不送（下次再送）」測試。
     - 補充「該 session 在 live 模式「繼續」處理中時不送」測試。

4. **【低】live 模式送「繼續」注入路徑支援 `compactInFlight` 互斥**
   - **檔案與行號**：[controller.ts:1034-1048](file:///C:/presonal_project/Switching_account/app/src/main/controller.ts#L1034-L1048)
   - **修改說明**：在 `continueSession` 中，於 `lc.done.add(cli.sessionId)` 前檢查若 `this.compactInFlight` 為 true 則提早 return（留待下一次 tick 再送）；送出前將 `this.compactInFlight` 設為 true，並於 `try ... finally` 中確保重設還原為 false。

5. **【低】`switcher-run.ts` 目錄建立與舊日誌刪除移至 `registerRunning` 之前**
   - **檔案與行號**：[switcher-run.ts:366](file:///C:/presonal_project/Switching_account/app/src/scripts/switcher-run.ts#L366)、[switcher-run.ts:442-458](file:///C:/presonal_project/Switching_account/app/src/scripts/switcher-run.ts#L442-L458)、[switcher-run.ts:468-478](file:///C:/presonal_project/Switching_account/app/src/scripts/switcher-run.ts#L468-L478)
   - **修改說明**：將 `const logFile = args.out + '.agy.log'` 宣告提前至 `handleAgyEntry` 頂端，並將 `fs.mkdirSync(path.dirname(args.out), { recursive: true })` 與 `fs.rmSync(logFile, { force: true })` 移至 `registerRunning(rec)` 之前執行。在 `registerRunning` 之後直接進入 `try ... finally { unregisterRunning(recId) }`，避免因準備檔案系統失敗而造成派工紀錄未解除註冊。

---

### 二、新增的測試名稱

1. 在 `tests/controller-compact.test.ts`：
   - `在 sentAt+1 寫入 prompt 事件，之後 busy→idle 仍要送 Ctrl+L`
   - `在 sentAt+31 之後寫入的 prompt 事件才取消`
   - `同 pid 但 sessionId 不符時移除不送`
   - `compactInFlight 為 true 時本次 tick 不送（下次再送）`
   - `該 session 在 live 模式「繼續」處理中時不送`

2. 在 `tests/controller-agy.test.ts`：
   - `取鎖後才出現登記也會被擋：新增 agy 帳號流程釋放鎖並回傳 BUSY`
   - `取鎖後才出現登記也會被擋：啟動還原 login-backup 釋放鎖並略過還原`

---

### 三、指令執行結果

執行指定之命令（字串完全相同）：

1. **`npm run typecheck`**
   - 結果行：
     ```text
     Command failed to run: C:\presonal_project\Switching_account\CLAUDE.md: not a directory.
     ```

2. **`npm test`**
   - 結果行：
     ```text
     Command failed to run: C:\presonal_project\Switching_account\CLAUDE.md: not a directory.
     ```

> **附註說明**：執行時終端環境的工作目錄被外層指派為檔案路徑 `C:\presonal_project\Switching_account\CLAUDE.md`，導致作業系統無法直接於該路徑建立 process。程式碼與測試均已手動嚴格審查所有型別定義、匯入與邏輯。
