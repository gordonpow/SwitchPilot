# 修正：live 切換後 statusline 舊帳號用量被誤認為新帳號（精簡版）

## 問題（2026-11-15 實測）

00:00:14 F115112109（878c48）rate_limit → 00:00:16 自動切到 abcz（276de8）。執行中 claude 的 statusline `rate_limits` 來自最後一次 API 回應，切換後到新帳號第一次回應前仍是 F 的數字；statusline 腳本以「目前帳號」標記 `slot_id`，於是 F 的 100%（resets 1794679800）被記成 276de8。00:00:30 monitor 判定 276de8 超過門檻 → `runSwitch` 自動 → `markExhausted(276de8, 1794679800)` → 無目標 →「所有帳號都已用完」。

## AC

- **AC-1**：判斷使用中帳號用量（`pickUsage` 的 statusline 來源）時，若該 slot 的 usage_api 紀錄有仍有效的視窗（`resets_at > now`），且 statusline 同一視窗的 `resets_at` 與之相差超過 3600 秒，視為別的帳號的舊資料，不採用該筆 statusline（改用 usage_api，或無資料）。優先比 `seven_day`；`seven_day` 無法比較時比 `five_hour`。兩者皆無法比較時照舊採用。
- **AC-2**：上述情境（statusline 被拒）不會觸發自動切換、不會 `markExhausted`。
- **AC-3**：新增 Api `clearExhausted(): Promise<Result>`：所有 slot 的 `exhausted_until` 歸 0（各自 `withSlotLock`），並重設 `noTargetUntil`、`warnedExhaust`，log「已清除所有帳號的用完標記」。總覽頁「所有帳號的額度都已用完」警示加按鈕「清除用完標記」呼叫它。

- **AC-4**：總覽頁帳號摘要每列 5 小時／7 天 MiniBar 下方以小字顯示重置時間（24 小時內「HH:mm 重置」，超過「MM/DD HH:mm 重置」；`resets_at` 為 0 或無資料不顯示；可截斷）。

## 設計

- `src/main/controller.ts` `pickUsage`：取 `sl` 後，`active` 為 true 時呼叫新純函式 `isForeignStatusline(sl, api, nowSec)`，true 則 `sl = null`。純函式放 `src/core/usage.ts`（或新檔 `src/core/usagematch.ts`，不 import electron），單元測試。
- 被拒時 log 一次 info（每次切換最多一次，例：「statusline 用量仍是切換前帳號的資料，暫不採用」），不得含 token。
- `src/shared/types.ts`：`Api.clearExhausted`、IPC channel；`src/preload`、`src/main/index.ts` 註冊；`OverviewPage.tsx` 按鈕。

## 驗證

- 純函式測試：7d 相差 >1h → foreign；相差 1 秒 → 非 foreign；api 視窗已過期 → 不比；只有 5h 可比時用 5h；api 為 null → 非 foreign。
- controller 測試（`controller-live.test.ts`）：切換後寫入帶舊帳號 resets_at、用量 100% 的 statusline usage 檔，tick 後不切換、目前 slot 的 `exhausted_until` 仍為 0；`clearExhausted` 清除所有 slot 標記。
- `npm run typecheck`、`npm test`。

## 實作紀錄

- 已完成 AC-1～AC-3；純函式 `isForeignStatusline` 放在 `src/core/usage.ts`（未另開新檔）。
- 偏差：除規格列出的檔案外，另在 `renderer/src/lib/mock-api.ts` 補 `clearExhausted`（Api 型別需要）；`clearExhausted` 只對 `exhausted_until` 非 0 的 slot 寫入。被拒 log 以 `foreignLogged` 旗標控制，每次切換成功後重設。
- AC-4：`lib/format.ts` 新增 `formatReset`；`OverviewPage` 的 `MiniBar` 加 `reset` 屬性，以 `truncate` 小字置於進度條下，窄寬度時截斷不擠壞。新增 `tests/format-reset.test.ts`（3 則）。
- 測試：新增 `tests/usage-foreign.test.ts`（6 則）、`controller-live.test.ts` 2 則。`npm run typecheck` 通過；`npm test` 31 檔、397 則全過。
