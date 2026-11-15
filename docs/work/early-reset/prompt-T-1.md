你是實作者。完成 `C:\presonal_project\Switching_account\docs\work\early-reset\1-requirements.md` 的全部 AC。先讀 `C:\presonal_project\Switching_account\CLAUDE.md` 與該需求檔。程式在 `C:\presonal_project\Switching_account\app\`。

## 做法（照這個設計）

- `src/core/accounts.ts`：`markExhausted` 同時寫 `exhausted_at = now`（新增選用參數或由呼叫者傳入 now，讓測試可控制時間）；`clearExhausted` 一併清 `exhausted_at`。
- `src/core/claudeavail.ts`：新增純函式 `exhaustedRecovered(slot, rec, threshold): boolean`，依 AC-1、AC-2 判斷（`rec.ts >= markedAt + 60`、兩個視窗 `used_percentage < threshold`；`needs_relogin` 為 true 回 false）。
- `src/main/controller.ts`：
  - 在用量輪詢完成後（找到 poller 寫完 `usage_api` 之後的地方，或 tick 開頭讀 `usage_api`），對每個 `exhausted_until > now` 的帳號檢查 `exhaustedRecovered`；符合就在 `withSlotLock` 內清除、log（`main.ts` 新鍵，中英）、`requestPush`。
  - AC-3：
    - 清除的是目前帳號且 `resumeAt` 有值 → `resumeAt = now`。
    - 清除的是其他帳號且 `resumeAt` 有值、`switch_mode === 'live'`、不在切換中 → 呼叫 `runSwitch({ target: 該帳號, auto: false 以外的適當參數 … })`。切換成功後，對因 rate_limit 停下的 session 送繼續（沿用 `handleResume` 用的「不限時間、只限 rate_limit」路徑，可重構成共用方法），並清 `resumeAt`。仔細讀 `runSwitch`、`switchToEarliest`、`handleResume`、`promptEligible`，不要破壞既有行為。
    - 清除後重設 `noTargetUntil = 0`、`warnedExhaust = false`。
- 總覽警示由既有 `allExhausted` 計算，清除後自然消失；確認即可。

## 測試

用 `tests/helpers.ts` 的 `useTempEnv`，照 `tests/earliest-reset.test.ts` 的假依賴寫法，新檔 `tests/early-reset.test.ts`：
- `exhaustedRecovered`：新資料低於門檻 → true；資料太舊（< markedAt + 60）→ false；任一視窗 ≥ 門檻 → false；舊資料無 `exhausted_at` 用 `exhausted_until - 18000`；`needs_relogin` → false。
- controller：
  - 其他帳號提前恢復且正在等待 → 切過去並送繼續一次。
  - 目前帳號提前恢復且正在等待 → 下一個 tick 送繼續。
  - 沒在等待 → 只清標記。
  - 未恢復（仍 ≥ 門檻）→ 不清。
  - 使用中帳號恢復 → `earliestReset` 不再顯示（狀態的 `earliestReset` 為 null）。

## 規則

- 程式註解用繁體中文（台灣用語）；文字用 i18n 字典（中英）；不得碰真實環境、網路或程序。
- 不要 commit，不要改 CLAUDE.md。
- 工作目錄 `C:\presonal_project\Switching_account\app`，PATH 需含 `C:\Program Files\nodejs`；`npm run typecheck` 與 `npm test` 都要通過（只看結果摘要行）。

回報：改了哪些檔案、新增測試、兩個指令的結果行、與設計不同之處。繁體中文，500 字以內。
