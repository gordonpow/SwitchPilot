你是實作者。修正以下 5 個審查問題，不要做其他改動。所有程式在 `C:\presonal_project\Switching_account\app\`。先讀 `C:\presonal_project\Switching_account\CLAUDE.md`。

1. 【高】`src/main/controller.ts` 約 737 行，pendingClear 的取消條件 `ev.lastPromptTs > item.sentAt` 改為 `ev.lastPromptTs > item.sentAt + COMPACT_IGNORE_S`（`/compact` 自己會產生 prompt 事件；同檔約 64 行已有 `COMPACT_IGNORE_S` 常數與說明）。
   測試（`tests/controller-compact.test.ts`）：在 sentAt+1 寫入 prompt 事件，之後 busy→idle 仍要送 Ctrl+L；在 sentAt+31 之後寫入的 prompt 事件才取消。
2. 【中】`src/main/controller.ts` 的 `agyStartLogin`（約 2036 行）與 `restoreAgyLoginBackup`（約 1831 行）：在 `agyLock()` 成功**之後**再檢查一次 `dispatchlog.listRunning().length > 0`，有則釋放鎖並回 `fail('有派工正在使用 agy，請稍後再試', 'BUSY')`（restore 路徑則放鎖、log warn 並略過還原）。補測試：取鎖後才出現登記也會被擋。
3. 【低】`tests/controller-compact.test.ts` 約 464 行「超過 600 秒逾時不送」：先 tick 一次（status busy）讓 sawBusy 為 true，再把時鐘加 601 秒並設 idle 後 tick，驗證沒有送 Ctrl+L。另補三個測試：同 pid 但 sessionId 不符時移除不送；`compactInFlight` 為 true 時本次 tick 不送（下次再送）；該 session 在 live 模式「繼續」處理中時不送。
4. 【低】`src/main/controller.ts` 約 1037 行 live 模式送「繼續」的 `injectSubmit` 路徑：送出前若 `compactInFlight` 為 true 則等下一次（或略過本 session 本次），送出期間設 `compactInFlight = true`，finally 還原。不得改變既有測試的行為。
5. 【低】`src/scripts/switcher-run.ts` 約 467 行：把 `registerRunning` 之後、try/finally 之前的 `mkdirSync`、`rmSync(logFile)` 移到 `registerRunning` 之前。

## 規則

- 只改上述檔案與測試；不要在其他地方建立檔案；只用讀檔、改檔與下列指令，不要使用其他工具或工作流程。
- 註解用繁體中文（台灣用語）。不要 commit，不要改規格與 CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

## 回報

逐項說明改了什麼（檔案:行號）、新增的測試名稱、兩個指令的結果行。用繁體中文。
