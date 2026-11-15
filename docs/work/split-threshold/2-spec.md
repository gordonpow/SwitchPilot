# 規格：5 小時與每週用量門檻分開設定

路徑相對於 `app/`。

## 設計
- `core/config.ts`：`Config` 新增 `threshold_weekly: number`。載入時缺少或不合法 → 等於 `threshold`（50～100 夾住）。`threshold` 意義不變（5 小時門檻）。
- 新增型別與工具（放 `core/claudeavail.ts` 或新檔 `core/thresholds.ts`，renderer 需要的部分放 `shared/`）：
  ```ts
  export interface Thresholds { five_hour: number; seven_day: number }
  export function toThresholds(t: number | Thresholds): Thresholds   // number → 兩者相同
  export function thresholdsFromConfig(cfg: { threshold?: unknown; threshold_weekly?: unknown }): Thresholds  // 預設 95；weekly 缺少時用 threshold
  ```
- `core/claudeavail.ts`：`slotBlocked`、`exhaustedRecovered`、`slotAvailableAt`、`claudeAvailable` 的 `threshold` 參數改為 `number | Thresholds`，`five_hour` 視窗比 `five_hour` 門檻、`seven_day` 視窗比 `seven_day` 門檻。`claudeAvailable` 未傳時用 `thresholdsFromConfig(config.load())`。
- `core/monitor.ts`：`Monitor.threshold` 改為 `Thresholds`（建構子接受 `number | Thresholds`）；`overWindows` 依視窗門檻。
- `main/controller.ts`：所有 `Number(this.cfg.threshold) || 95` 改為 `thresholdsFromConfig(this.cfg)`；`setConfig` 接受 `threshold_weekly`（同 `threshold` 驗證：非數字 → `err.thresholdNaN`，夾 50～100）；更新 monitor；`getState` 的 config 帶出 `threshold_weekly`。
- `shared/types.ts`：config 型別加 `threshold_weekly`。
- `scripts/switcher-run.ts`：若有自己讀門檻，改用 `thresholdsFromConfig`。
- Renderer：
  - `AutoSwitchPanel.tsx`：兩個滑桿，鍵 `autoSwitch.thresholdFiveHour`「5 小時門檻」／`autoSwitch.thresholdWeekly`「每週門檻」（英文 `5-hour threshold`／`Weekly threshold`）。舊鍵 `autoSwitch.threshold` 不再使用就刪除（Zh 與 En 一起）。
  - `AccountCard.tsx`、`AccountsPage.tsx`、`OverviewPage.tsx`：`UsageBar` 依視窗傳對應門檻；`OverviewPage` 若用單一門檻判斷，改依視窗。
  - `mock-api.ts` 加 `threshold_weekly`。
- README 設定說明（若有門檻描述）更新。

## 任務
- T-1：上述全部＋測試（config 載入相容、claudeavail 各函式分開門檻、monitor、controller setConfig／自動切換用週門檻）。

## AC 驗證
AC-1、4：程式檢查（使用者實測畫面）；AC-2、3、5：自動測試＋typecheck。

## 邊界
- 舊設定沒有 `threshold_weekly`：每週門檻跟著 `threshold`，直到使用者調整每週滑桿後才各自獨立。
- Python 版只讀 `threshold`，不受影響。

## 審查紀錄
規格行為單純，未另做規格審查；實作完成後做 diff 審查。

## 實作偏差
- 門檻工具放新檔 `core/thresholds.ts`（renderer 只用數字，不放 shared）。
- 只調整 5 小時滑桿時，`setConfig` 會把目前（沿用的）每週值一起寫入，之後兩者各自獨立。比「每週跟著 5 小時直到調整每週滑桿」更直覺，接受。
- 實作結果：typecheck 通過，612 測試全過（Opus 重跑確認）。
