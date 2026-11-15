# 切換安全性優化（精簡版）

參考：blog.ax0x.ai「hot-swapping Claude logins」（macOS Keychain 版；Windows 上 `.credentials.json` 即為 Claude Code 每次請求前重讀的來源，機制相同）。文章重點：絕不把已失效的 token 寫進 live 憑證（會讓所有執行中的 claude 被登出）、自動切換要讓使用者知道、重新登入使用中帳號要立即寫入 live 憑證。

## 需求（AC）

- **AC-1**：自動切換挑選目標時，跳過用量紀錄標示 `needs_relogin`（且 `saved_at` 與 slot 相同）的帳號。
- **AC-2**：手動切換到上述帳號時拒絕，回傳「此帳號需要重新登入」，不寫入憑證。
- **AC-3**：切換前，若目標帳號 access token 已過期或 10 分鐘內到期，先 refresh（目標此時非使用中，符合不變條件）。refresh 確定失敗（`RefreshFailedError`）時：寫入 `needs_relogin` 紀錄、不切換到它；自動切換改挑下一個候選（排除已失敗者），手動切換回傳失敗。網路等暫時性錯誤不阻擋切換（token 未確定失效）。
- **AC-4**：自動切換成功後送系統通知「已自動切換帳號」，內容含新帳號名稱與原因。
- **AC-5**：重新登入的帳號是目前使用中帳號時，log 改為「已更新目前登入憑證，執行中的 claude 下一個請求即使用新憑證」（live 模式不需重開）。

## 不做

- 帳號優先順序／備援鏈設定、依消耗速度提前切換（之後另議）。
- 使用中帳號的 token 仍不由本程式 refresh。

## 設計

- `src/core/oauth.ts`：
  - `UsagePoller` 新增 `async ensureFresh(slotId: string): Promise<'ok' | 'dead' | 'error'>`：讀 slot；無 oauth → `'dead'`；`expiresAt` 為數字且 `expiresAt - now >= REFRESH_AHEAD_MS` → `'ok'`；否則呼叫既有 `this.refresh(...)`：成功 `'ok'`，`RefreshFailedError` → 寫 usage_api 紀錄（沿用上一筆視窗／ts，`error: 'token 已過期，需要重新登入'`、`needs_relogin: true`、`saved_at: slot.saved_at`）並 log warn、回 `'dead'`；其他錯誤 log warn（用 `errDetail` 遮蔽 token）回 `'error'`。目標若是目前使用中帳號，直接回 `'ok'`（不 refresh）。
  - 新增匯出純函式 `needsRelogin(slot: { id: string; saved_at: number }): boolean`（讀 `readUsageApi`，`needs_relogin && saved_at` 相同）。
- `src/main/controller.ts`：
  - `PollerLike` 介面加 `ensureFresh?(slotId: string): Promise<'ok' | 'dead' | 'error'>`（選用，測試注入的假 poller 不必實作；沒有時視為 `'ok'`）。
  - `isBlocked(slot)`：`needsRelogin(slot)` 為 true 時回 true。
  - `runSwitch`：目標確定後、取鎖與 `switchTo` 之前（**不得在 `withSlotLock` 內呼叫 ensureFresh**，refresh 自己會取同一把鎖）：
    - 手動（`!p.auto`）：`needsRelogin` → `fail('此帳號需要重新登入', 'INVALID')`；`ensureFresh` 為 `'dead'` → 同樣失敗。
    - 自動：迴圈最多 slot 數次：`pickNext` 的 `isBlocked` 額外排除本次已失敗的 id；`ensureFresh` 為 `'dead'` 時加入失敗集合再挑；挑不到時走既有「所有帳號都已用完」路徑。
    - 目標等於目前帳號時不呼叫 ensureFresh。
  - 自動切換成功（live 與 restart 兩種模式完成切換後）呼叫 `this.notify('已自動切換帳號', \`已切換到「<名稱>」（<原因>）\`)`；手動不通知。
  - `completeLogin` 使用中帳號分支的 log 改為 AC-5 文字，等級 `info`。

## 驗證

- `tests/oauth.test.ts`：ensureFresh 四種結果（未到期 ok、到期 refresh 成功 ok 且 slot 更新、400 → dead 且寫 needs_relogin、網路錯誤 → error）；使用中帳號回 ok 且不打 refresh。
- `tests/controller-live.test.ts`（或 controller.test.ts）：自動切換跳過 needs_relogin 帳號；ensureFresh 回 dead 時改挑下一個；全部 dead 時不切換；手動切到 needs_relogin 帳號失敗且憑證檔未變；自動切換成功呼叫 notify。
- `npm run typecheck`、`npm test`。

## 實作紀錄

- 完成 AC-1～AC-5。改動：`core/oauth.ts`（`needsRelogin`、`UsagePoller.ensureFresh`）、`main/controller.ts`（`PollerLike.ensureFresh?`、`isBlocked`、`runSwitch` 手動／自動流程與通知、`completeLogin` log）。
- 偏差：`ensureFresh` 在 slot 的 `expiresAt` 非數字時回 `'ok'`（不 refresh），與 `pollSlot` 一致；否則既有測試的假憑證（無 expiresAt）會觸發真實 refresh。slot 不存在也回 `'dead'`。
- 測試：`oauth.test.ts` 新增 5 項、`controller-live.test.ts` 新增 7 項；`npm test` 30 檔 389 項全過，`npm run typecheck` 無錯誤。
