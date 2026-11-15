你是實作者。修正「全部用完時換到最早重置的帳號」的審查問題，不要做其他改動。先讀 `C:\presonal_project\Switching_account\CLAUDE.md` 與 `C:\presonal_project\Switching_account\docs\work\earliest-reset\2-spec.md`（文末實作審查紀錄）。程式在 `C:\presonal_project\Switching_account\app\`。

1. `src/main/controller.ts`（約 1318、1385 行 `switchToEarliest`）：`switch_mode === 'restart'` 時不走 switchToEarliest，維持原「全部用完」行為。
2. 約 1317 行：`noTargetUntil` 一律設 `now + 60`（不再設成 `at`）。確認在可用時間前反覆收到 rate_limit 時：選到同一個目前帳號 → 不切換、log 與通知不重複（沿用 `warnedExhaust` 或新增旗標，`resumeAt` 不被往前改）。
3. 切換失敗（catch，約 1325-1331）時把 `noTargetUntil` 還原為進入前的值。
4. `handleResume`（約 1081-1092）：送提示前以 `slotBlocked`（目前帳號、目前用量紀錄、門檻）確認；仍被擋 → `resumeAt = slotAvailableAt(...) + 60`（不早於 now + 60），log 一次（`main.ts` 新鍵，中英），不送提示。
5. `promptEligible` 以 `maxAgeS = Infinity` 呼叫時，只接受 `error === 'rate_limit'` 的 stopfailure（一般切換行為不變）。
6. 測試（`tests/earliest-reset.test.ts`）：restart 模式維持原行為且不切換；切換失敗還原 `noTargetUntil`；超過 15 分鐘前因 rate_limit 停下的 session 在 resume 時會送、`error` 為空的不送；resume 時目前帳號仍被擋 → 順延不送，之後解除才送；可用時間前新增一個可用帳號後，60 秒後的 rate_limit 會正常切到該帳號。

規則：程式註解繁體中文（台灣用語）；文字用 i18n 字典（中英）；測試用 `useTempEnv` 與注入假依賴；不要 commit，不要改規格與 CLAUDE.md。工作目錄 `C:\presonal_project\Switching_account\app`，PATH 需含 `C:\Program Files\nodejs`；`npm run typecheck` 與 `npm test` 都要通過（只看結果摘要行）。

回報：逐項改了什麼（檔案:行號）、新增測試、兩個指令的結果行。繁體中文，400 字以內。
