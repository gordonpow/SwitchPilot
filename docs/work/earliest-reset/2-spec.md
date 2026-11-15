# 規格：全部用完時換到最早重置的帳號

需求：`1-requirements.md`。

## 設計

- `src/core/switchplan.ts`：新增純函式 `pickEarliest<T>(slots, now, availableAt: (s) => number, isExcluded: (s) => boolean): { slot: T; at: number } | null`，回傳 `availableAt` 最小者（同時間時依清單順序）；`isExcluded` 為 true 的跳過。
- `src/core/claudeavail.ts`（或 controller 私有方法）：`slotAvailableAt(slot, rec, now, thresholdPct): number` = max(`exhausted_until`, 超過門檻且未重置之 API 視窗的 `resets_at`)；沒有限制時回傳 `now`。與既有 `slotBlocked` 判斷一致（讀它的實作，共用常數）。
- `src/core/config.ts`：`switch_to_earliest: boolean`，預設 true；`setConfig`、types、mock-api、`tests/accounts.test.ts` 的預設值斷言。
- `src/main/controller.ts` `runSwitch` 中 `if (!nxt)`：
  - `switch_to_earliest` 為 false → 原行為。
  - 否則 `pickEarliest`（排除 `needsRelogin` 與 `ensureFresh` 回 `'dead'` 者；`ensureFresh` 不得在 `withSlotLock` 內呼叫）。
    - 選到的不是目前帳號 → 以既有切換流程只換憑證（不重啟 runner、**不**設定 `liveContinue`、不立即送提示），記錄 `log.switchedEarliest`、通知 `notify.switchedEarliestTitle/Body`（只通知一次，沿用 `warnedExhaust`）。
    - 選到的是目前帳號或沒有可選 → 原本「全部用完」的 log／通知。
    - 兩種情況都設定 `this.resumeAt = at + 60`（live 模式時）與 `this.noTargetUntil = max(既有值, at)`，讓可用時間前的限流事件不再觸發切換（AC-5）。
- tick：`resumeAt` 有值且 `nowSec >= resumeAt` → 清除 `resumeAt`，建立新的 `liveContinue = { until: nowSec + LIVE_WINDOW_S, done }`，掃描後對 `promptEligible` 的 session 送 `continueSession`（與一般切換後相同路徑）；log `log.resumeAfterReset`。
- 手動切換（`p.auto` false）、`clearExhausted()`、切到 restart 模式 → `resumeAt = null`。
- `getState`：`AppState.resumeAt: number | null`；總覽「全部用完」警示在有 `resumeAt` 時加一句「{time} 後自動繼續」。
- renderer：設定「帳號切換」頁加開關（`ui.ts` 中英）。
- 字典：`main.ts` 加 `log.switchedEarliest`、`notify.switchedEarliestTitle`、`notify.switchedEarliestBody`、`log.resumeAfterReset`（中英，參數用 `{name}`、`{time}`）。

## 測試

- `pickEarliest`：最小值、排除、同時間取順序、全部排除回 null。
- `slotAvailableAt`：只有 exhausted_until、只有 API 超門檻、兩者取晚者、都沒有回 now。
- controller（注入假時鐘、假 poller、假 cli；照既有 controller 測試的寫法）：
  - 兩帳號都用完、另一帳號較早重置 → 切過去、不送提示；時間到 +60 秒後的 tick 送「繼續」一次。
  - 目前帳號較早重置 → 不切換，仍安排繼續。
  - 可用時間前的 stopfailure 不再切換。
  - `switch_to_earliest` false → 原行為。
  - 手動切換取消 `resumeAt`。
  - dead 帳號被跳過。

## 實作紀錄

Claude Sonnet 實作，552 個測試通過。偏差：`promptEligible` 加 `maxAgeS`（resume 時不限時間）；`pickEarliest` 的 `at` 不早於 now；`noTargetUntil` 下限 now+60。

## 實作審查（Claude Sonnet，2026-11-15）

無高。採用（修正交給 Sonnet，`prompt-fix-1.md`）：
- 中 #1：restart 模式只換憑證、之後沒人處理 → restart 模式維持原「全部用完」行為。
- 中 #2：`noTargetUntil = at` 會擋住期間新出現的可用帳號數小時 → `noTargetUntil` 一律 `now + 60`；重複切換由 `pickEarliest` 結果相同（選到目前帳號不切換）與 log／通知只一次避免。
- 中 #3：切換失敗時還原 `noTargetUntil`。
- 中 #4：resume 前以 `slotBlocked` 確認目前帳號已可用，仍被擋 → 以 `slotAvailableAt` 重算並順延 `resumeAt`（log 一次）。
- 低 #5：resume（不限時間）時只接受 `error === 'rate_limit'` 的 stopfailure。
- 低 #7：補測試。

不採用：
- 低 #6：`resumeAt` 只在記憶體，App 重啟後遺失。列為已知限制。
