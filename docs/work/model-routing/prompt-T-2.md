你是實作者。完成任務 T-2（AC-11、AC-12'、R-1），不要做其他任務。T-1 已完成（`src/core/dispatchlog.ts`、`src/core/claudeavail.ts`、`src/core/routing.ts` 的 `max_concurrent_per_account` 已存在，可直接使用）。

## 必讀

1. `C:\presonal_project\Switching_account\CLAUDE.md`
2. `C:\presonal_project\Switching_account\docs\work\model-routing\2-spec-phase2.md`：「controller 與 IPC」「畫面」兩節、AC-11、AC-12'，以及文末審查紀錄 R-1（優先於前文）。

## 範圍（所有程式在 `C:\presonal_project\Switching_account\app\`）

- `src/shared/types.ts`：`AppState.dispatch`（running／recent／maxConcurrent），view 型別。
- `src/main/controller.ts`：
  - 建立 state 時讀 `dispatchlog.listRunning()`、`listRecent(20)` 轉成 view；讀檔失敗回空陣列，不得丟例外。`maxConcurrent` 來自 `loadRouting()`。
  - R-1：GUI 的 agy 切換、新增 agy 帳號、還原登入備份等路徑（搜尋 `isAgyRunning()` 與 `switchAgy` 的呼叫處），在既有檢查旁加上 `dispatchlog.listRunning().length > 0` 時回 `fail('有派工正在使用 agy，請稍後再試', 'BUSY')`。
- 儲存 N：沿用既有儲存 routing 的 Api（找 `setRouting` 或類似名稱），讓 routing 物件可帶 `max_concurrent_per_account`。
- 畫面（`src/renderer/src/`）：`NavSidebar` 加「派工」項（lucide 既有圖示，顯示執行中數量）、新增 `pages/DispatchPage.tsx`、App 路由支援 `dispatch` 頁（含 `?page=dispatch`）、模型分工設定頁加「每個 agy 帳號同時執行上限」數字輸入（1～8）、`lib/mock-api.ts` 補資料。沿用既有元件風格與 `src/renderer/src/components/ui/` 的 shadcn 元件；中文介面文字用繁體中文（台灣用語）。
- 測試：controller 測試補「state 含 dispatch 資料」「有執行中登記時 GUI 切換 agy 被拒」。

## 規則

- 只改 `app/` 內的檔案。**不要在專案根目錄或其他地方建立任何檔案**（例如不要建 `package.json`）。
- `src/core/*` 不得 import electron。token 不得出現在 log 或畫面。
- 測試用 `tests/helpers.ts` 的 `useTempEnv`，不碰真實家目錄、不發網路請求。
- 不要 commit，不要修改規格與 CLAUDE.md。

## 指令

只執行以下指令，字串完全相同：不加 cd、參數、管線、`2>&1` 或串接；工作目錄已是 `app/`。

- `npm run typecheck`
- `npm test`

兩者都要通過才算完成。

## 回報

改了哪些檔案、新增哪些測試、兩個指令的結果行、與規格不同之處。用繁體中文。
