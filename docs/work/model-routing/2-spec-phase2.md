# 規格：模型分工第二期（同時派工與派工畫面）

需求：[1-requirements.md](1-requirements.md) 的 AC-10、AC-11。第一期規格：[2-spec.md](2-spec.md)。程式碼在 `app/`。

## 使用者決定（2026-11-15）

- Claude 不做多帳號平行：Claude 項目仍回 `delegate`（exit 10），由 Claude Code 子代理以目前帳號執行。
- agy 隔離實測：`agy.exe` 含 `JETSKI_OAUTH_TOKEN` 字串，但設成無效值時 agy 仍以認證管理員的登入正常回應（`Reply with exactly: OK` → `OK`），代表此變數不會覆蓋登入。依需求退回「同一時間只用一個 agy 帳號」：可同時跑多個 agy 任務，但都用使用中的 agy 帳號。
- 實作：agy `gemini-3.8-flash-high`（備援 Claude Sonnet）；驗證：Claude Sonnet。已寫入 `~/.claude-switcher/routing.json`。

## 驗收條件（本期）

- **AC-10'**：多個 `switcher-run` 同時執行時，可同時在使用中的 agy 帳號上執行，最多 N 個（`routing.json` 的 `max_concurrent_per_account`，預設 2，範圍 1～8）。達到 N 時該項視為不可用，改用清單下一項（通常是 Claude 委派）。有任何 agy 任務執行中時不切換 agy 帳號（沿用既有 `isAgyRunning` 檢查）。
- **AC-11**：GUI 新增「派工」頁：
  - 「執行中」：階段、供應商、模型、帳號（email）、開始時間、已執行時間、資料夾。
  - 「最近紀錄」：最近 20 筆 `dispatch/*.json`：階段、結果（成功／委派 Claude／失敗）、供應商＋模型、帳號、開始時間、耗時、訊息（截斷）。
  - 每 3 秒（controller tick）更新。
- **AC-12'**：「模型分工」設定頁可設定 N（數字輸入 1～8），存回 `routing.json`。

- **AC-13'（使用者 2026-11-15 追加：依用量跨供應商遞補）**：`switcher-run` 處理 `claude` 項目時，先依快取判斷是否還有可用的 Claude 帳號；**所有** Claude 帳號都不可用時，記 `claude_exhausted` 並改用清單下一項（例如 agy `claude-sonnet-4-6`），不再回 `delegate`。帳號「不可用」= `exhausted_until > now`，或 `usage_api/<id>.json` 的 5 小時或 7 天 `used_percentage >= config.threshold` 且 `resets_at > now`，或 `needs_relogin` 為 true 且 `saved_at` 與 slot 相同。沒有快取的帳號視為可用。
- **AC-13b**：預設分工與使用者目前的 `routing.json` 加入跨供應商同等模型遞補：`requirements`／`spec`：Claude Opus → agy `claude-opus-4-6-thinking`；`spec_review`／`impl_review`：Claude Sonnet → agy `claude-sonnet-4-6`；`implement`：agy Flash → Claude Sonnet → agy `claude-sonnet-4-6`；`research`／`docs`：Claude Haiku → agy `gemini-3.8-flash-medium`。
- **AC-14'（使用者追加：整理後清畫面）**：`auto_compact.clear_screen_after`（預設 true，只在動作為 `/compact` 時生效）：送出 `/compact` 後，等該 session 再次閒置（sessions 檔 `status` 先變為非 `idle` 再回到 `idle`；或送出後 15 秒以上且為 `idle`），送一次 `Ctrl+L`（清除畫面、保留對話）。送出後 10 分鐘仍未完成就放棄。設定頁「自動整理上下文」加開關「整理後清除畫面」。事件紀錄寫「已清除 <資料夾> 的畫面」。不使用 `/clear`（會清掉整理後的摘要）。

## 設計

### Claude 可用性（AC-13'，`src/core/claudeavail.ts`，新檔，不 import electron、不 import oauth）

- `claudeAvailable(now: number, threshold: number): { available: boolean; reason: string }`：讀 `accounts.listSlots()` 與 `usage_api/<id>.json`（直接 `storage.readJson`，欄位同 `UsageApiRecord`），依 AC-13' 判斷；沒有任何 Claude slot 時視為可用（使用者可能只用 Claude Code 自己的登入）。
- `switcher-run` 的 `dispatch()`：`claude` 項目先呼叫它（threshold 由 `config.load().threshold`，`config` 若含 electron 依賴則改讀 `config.json` 的 `threshold` 欄位，預設 95）；不可用 → `attempts.push({ provider:'claude', model, outcome:'claude_exhausted' })` 並 `continue`。
- `CLAUDE.md` 的 switcher-run import 清單由主導者更新（加 `accounts`、`claudeavail`、`dispatchlog`）。

### 整理後清畫面（AC-14'）

- `resources/scripts/inject.ps1`：新增參數 `-CtrlKey <letter>`：送出 Ctrl+字母（`wVirtualKeyCode` = 字母大寫的 VK、`UnicodeChar` = 字母序號 1～26、`dwControlKeyState` = `LEFT_CTRL_PRESSED` 0x0008，按下與放開各一筆）。註解只能用英文。
- `src/core/coninject.ts`：新增 `injectCtrlKey(pid, letter)`，與 `injectLine` 相同的執行方式。
- `core/config.ts`：`auto_compact.clear_screen_after: boolean`（預設 true；壞值回預設），`mergeAutoCompact` 支援。
- `controller.ts`：送出 `/compact` 成功後記 `pendingClear: Map<sid, { pid, sentAt, sawBusy }>`；每次 tick 依 `sessions` 掃描結果（既有 lastScan／sessions 檔讀取）更新：看到非 idle 設 `sawBusy`；`idle` 且（`sawBusy` 或 `now - sentAt >= 15`）→ `injectCtrlKey(pid, 'L')`、log、移除；超過 600 秒移除不送。程序已不存在 → 移除。
- 設定頁「自動整理上下文」加開關。
- **實測（主導者）**：用沙盒 `CLAUDE_CONFIG_DIR` 的 claude 確認 WriteConsoleInput 送 Ctrl+L 會清畫面；若不行，改送 `\x0c` 字元（`UnicodeChar` 0x0C、VK 0x4C）再試，並記在實作紀錄。

### 執行中登記（`src/core/dispatchlog.ts`，新檔，不 import electron）

- 目錄：`paths.dispatchRunningDir()` = `<appDir>/dispatch/running`（在 `core/paths.ts` 新增）。
- `RunningRecord`：`{ id, pid, role, provider: 'agy', model, slot_id, account, cwd, out, started_at }`（`started_at` 為 ms；不得含 token）。
- `registerRunning(rec): void`（`writeJsonAtomic` 寫 `<id>.json`）、`unregisterRunning(id): void`（刪檔，忽略錯誤）。
- `listRunning(isAlive = defaultIsAlive): RunningRecord[]`：讀全部，過濾 `pid` 已不存在者（`defaultIsAlive`：`process.kill(pid, 0)`，丟 `ESRCH` 為 false、`EPERM` 為 true），依 `started_at` 排序。只讀不刪。
- `pruneDeadRunning(isAlive)`：刪除 pid 已不存在的檔（switcher-run 用）。
- `listRecent(limit = 20): DispatchRecord[]`：讀 `dispatchDir()` 下 `*.json`（不含子目錄），依檔名倒序取前 `limit` 筆；壞檔略過。`DispatchRecord` 型別對應 `writeDispatch` 寫入的欄位（`status, provider, model, agy_account_email?, attempts, message, role, cwd, started_at, ended_at`）。

### routing（`src/core/routing.ts`）

- `Routing` 加選用欄位 `max_concurrent_per_account?: number`；`loadRouting` 缺值或非 1～8 整數時用預設 2；`validateRouting` 拒絕非 1～8 整數；`saveRouting` 寫入。匯出 `maxConcurrent(r: Routing): number`。

### switcher-run（`src/scripts/switcher-run.ts`，`handleAgyEntry`）

改為「鎖只保護挑選、切換與登記；執行 agy 時不持鎖」：

1. 取 `agy.lock`（失敗 → `agy_busy`，同現在）。
2. `pruneDeadRunning()`；`running = listRunning()`。
3. 挑候選（同現在）。對每個候選：
   - 若 `slot.id !== current`：若 `running.length > 0` 或 `isAgyRunning()` → `skipped_agy_running`，換下一個候選（不切換）。否則照舊切換。
   - 若 `slot.id === current` 且 `running.filter(r => r.slot_id === slot.id).length >= N` → 記 `account_busy`，換下一個候選。
   - 可執行：`registerRunning({ id: <time_ns>-<hex>, pid: process.pid, ... })`，**釋放鎖**，執行 agy，結束後（finally）`unregisterRunning(id)`。
4. 額度用完時要換下一個候選帳號（需要切換）：重新取鎖再進入步驟 2（以迴圈實作，最多候選數次）；拿不到鎖 → `agy_busy`、回 null。
5. dry-run 行為不變（不登記）。
6. `dispatch()` 的失敗訊息：attempts 中有 `account_busy` 時訊息為「agy 帳號同時執行的任務已達上限，且沒有 Claude 備援」。

注意：`switcher-run` 只能 import 不含 electron 的 core 模組，`dispatchlog` 符合；不得 import `oauth`。

### controller 與 IPC

- `src/shared/types.ts`：`AppState.dispatch: { running: DispatchRunningView[]; recent: DispatchRecentView[]; maxConcurrent: number }`。View 欄位：running `{ id, role, model, account, cwd, startedAt }`；recent `{ id, role, status, provider, model, account, startedAt, endedAt, message }`（`id` 用檔名）。
- `src/main/controller.ts`：建立 state 時呼叫 `dispatchlog.listRunning()`、`listRecent(20)`，轉成 view。讀檔失敗回空陣列，不得丟例外。
- 設定 N：沿用既有儲存 routing 的 Api（`setRouting` 或同名方法）；routing 物件含 `max_concurrent_per_account`。

### 畫面

- `NavSidebar`：在「Claude CLI」下方加「派工」（圖示用 lucide 既有圖示，例如 `Workflow` 或 `ListChecks`），旁邊顯示執行中數量。
- `src/renderer/src/pages/DispatchPage.tsx`：兩個卡片（執行中、最近紀錄），表格或列表；空狀態文字「目前沒有執行中的派工」「尚無派工紀錄」。階段名稱用中文（需求定義、規格、規格審查、實作、實作審查／驗證、查資料、文件草稿；沿用模型分工頁既有的對照表，若有）。狀態徽章：成功／委派 Claude／失敗。時間用 `lib/format` 既有函式。
- `RoutingPage`（模型分工設定頁）：加「每個 agy 帳號同時執行上限」數字輸入（1～8）。
- `?page=dispatch` 可截圖（`CLAUDE_SWITCHER_SCREENSHOT_PAGE=dispatch`）。

## 任務

| ID | 內容 | 檔案 | 相依 |
|---|---|---|---|
| T-1 | `core/paths.ts`、`core/dispatchlog.ts`、`core/routing.ts`、`scripts/switcher-run.ts`；測試 `tests/dispatchlog.test.ts`、`tests/routing.test.ts`（新欄位）、`tests/switcher-run.test.ts`（N 上限 → account_busy 改委派、執行中有任務時不切換帳號、執行後刪除登記、dead pid 被清除） | 如左 | — |
| T-1b | AC-13'／13b：`core/claudeavail.ts`、`switcher-run.ts` 的 `dispatch()`、`core/routing.ts` 的 `DEFAULT_ROUTING`；測試 `tests/claudeavail.test.ts`、`switcher-run.test.ts`（全部 Claude 用完 → 改用 agy 項；有可用帳號 → delegate） | 如左 | T-1 |
| T-3 | AC-14'：`inject.ps1`、`core/coninject.ts`、`core/config.ts`、`main/controller.ts`（compact 段）、設定頁；測試 config 預設／壞值、controller：compact 後 busy→idle 送 Ctrl+L、逾時不送、程序消失移除 | 如左 | T-2 |
| T-2 | `shared/types.ts`、`main/controller.ts`、`preload`／`main/index.ts`（如需）、`renderer` 的 `NavSidebar`、`DispatchPage`、`RoutingPage`、`App` 路由、`lib/mock-api.ts`；controller 測試：state 含 dispatch 資料 | 如左 | T-1 |

## 驗證

- `npm run typecheck`、`npm test`。
- 假資料截圖：`dispatch/running/*.json`（pid 用截圖程序可見的存活 pid，例如 `process.pid` 無法預知時改注入；截圖時可接受只顯示最近紀錄）與 `dispatch/*.json` 數筆，`?page=dispatch`、`settings/routing`，1280×820 與 900×640。
- diff 審查：Claude Sonnet。

## 風險

- 多個 agy 同時在同一工作區改檔會互相覆蓋：屬於派工者（dev-workflow）責任，只平行派「不改同一檔案」的任務（既有規則）。
- pid 重用：登記檔的 pid 被其他程序重用時會誤判為執行中，最多造成暫時少用一個名額；GUI 只顯示。
- 回退：`max_concurrent_per_account` 設 1 即與第一期相同（同時只跑一個）。

## 實測紀錄（主導者，2026-11-15）

- `WriteConsoleInputW` 送 `wVirtualKeyCode=0x4C`、`UnicodeChar=0x0C`、`dwControlKeyState=0x0008`（按下＋放開）到 raw-mode 的 node 程序：stdin 收到 `[12]`（Ctrl+L）；同法送 Ctrl+C 收到 `[3]`。Claude Code 收到 Ctrl+L 後是否清除畫面，列為使用者實測。
- routing.json 已更新為 AC-13b 的清單（含 `max_concurrent_per_account: 2`）；現行 switcher-run 對新檔 dry-run 正常（Claude 項目仍回 delegate，待 T-1b）。

## 審查紀錄（Sonnet，2026-11-15）

以下修訂**優先於前文**：

- **R-1（高，採用）**：GUI 的 agy 切換、新增 agy 帳號、還原登入備份（`controller.ts` 呼叫 `switchAgy` 或寫 `gemini:antigravity` 前、已檢查 `isAgyRunning()` 的地方）同時檢查 `dispatchlog.listRunning().length > 0`，有則回 `fail('有派工正在使用 agy，請稍後再試', 'BUSY')`。switcher-run 維持「先 register 再釋放鎖」。補 controller 測試。
- **R-2（高，採用）**：額度用完要換帳號時：agy 已結束 → 先 `unregisterRunning(自己的 id)` → 重新取鎖 → 重讀 running。其他 switcher-run 仍在同帳號執行時，不切換（`skipped_agy_running`）屬正確行為。
- **R-3（中，採用）**：每次取得鎖後重讀 `loadRouting()` 取得 N。測試：N=1 時兩個子程序同時進入，第二個得到 `account_busy`（用 `tests/fixtures/fake-*.cjs` 的假 agy 睡 1 秒）。
- **R-4（低，部分採用）**：登記加 `child_pid`（agy 子程序 pid，spawn 後更新登記檔）；不做 pid＋started_at 雙重比對（風險已記錄）。
- **R-5（高，採用）**：`claudeavail` 匯出 `slotBlocked(slot, rec, nowSec, threshold, maxAgeSec)`（rec 為 usage_api 紀錄；`exhausted_until > now`、`needs_relogin && rec.saved_at === slot.saved_at`、或 rec.ts 在 `maxAgeSec` 內且任一視窗 `used_percentage >= threshold && (resets_at === 0 || resets_at > now)`）。controller 的 `isBlocked` 改呼叫同一函式（`maxAgeSec` = 既有 `API_BLOCK_WINDOW_S`），避免兩套標準。poller 也會查使用中帳號，usage_api 有其紀錄。threshold 直接用 `config.load().threshold`（config 不含 electron）。快取舊且未滿時視為可用，與原行為相同。
- **R-6（中，採用）**：attempts／log 只寫 email 或 slot id，不得含 credentials。dispatchlog 不 import `sessions`。
- **R-7（高，採用）**：Ctrl+L 時機：
  - 每個 tick 重讀 sessions 檔（`readSessionsFn` 或既有讀法），不依賴 15 秒掃描；以 `pid` 與 `sessionId === sid` 雙重比對。
  - 送出條件：看過非 idle 後回到 idle（`sawBusy`）；或 `idle` 且該 session statusline 的 `context.used_percentage` 比送出時低（整理已完成）。兩者都沒有 → 10 分鐘後放棄。取消 15 秒後備。
  - 送出後該 session 有新的 `prompt` 事件（ts > sentAt）→ 移除不送。
  - 與 `injectSubmit`／compact 串行：送 Ctrl+L 時設 `compactInFlight`，且該 session 不在 `liveContinue` 處理中。
  - `injectSubmit('/compact')` 回 false 不建立 pending。設定頁在動作為 `/clear` 時停用此開關。
- **R-8（中，採用）**：`inject.ps1` 的 `-CtrlKey` 與 `-TextB64` 互斥，字母只接受 A–Z，否則 exit 2。若使用者實測 Claude Code 對此不清畫面，備案為改送原字元 `\x0c`。
- **R-9（中，採用）**：`dispatch()` 失敗訊息：有 `claude_exhausted` 且無可用 agy → 「Claude 帳號額度都已用完，且 agy 項目都無法執行」。dev-workflow skill 註明：Claude 子代理執行中才遇額度用完時，主導者重跑 switcher-run 以遞補。
- **R-10（低，採用）**：補測試：`dispatch/running` 不存在時 `listRunning` 回空、N 為 1.5／字串時 validate 拒絕、GUI 切換在有登記時被拒。
- **R-11（低，採用）**：主導者更新 CLAUDE.md 的 switcher-run import 清單。

## 實作紀錄（2026-11-15）

- 實作者：agy `gemini-3.8-flash-high`（經 `switcher-run --role implement`），T-1、T-2、T-3、審查修正共 4 次派工。
- Flash 問題（主導者查證後處理）：
  - T-1：在專案根目錄建立 `package.json`（proxy 指令），已刪除。
  - T-2：最後嘗試未允許的 `RunWorkflow` 被拒（`permission_denied`），之前的改動完整。
  - T-3：回報已改 `inject.ps1`，實際未改；由主導者補上 `-CtrlKey`（`SendCtrl`、互斥與 A–Z 檢查），以按鍵記錄程式實測 `L`→`[12]`、非法字母 exit 2、文字注入不受影響。
  - 審查修正 4：live「繼續」遇 `compactInFlight` 直接 return，會讓該 session 永遠收不到「繼續」；主導者改為最多等 20 秒。
- agy 行為：指令的工作目錄是第一個 `--add-dir`（`AGY_ADD_DIRS` 第一項），不是 `--cwd`；第一項是檔案時指令失敗（`not a directory`）。T-1 多建 `package.json`、T-3 無法跑測試皆因此。
- 實作審查（Claude Sonnet）：5 項全部採用並修正（`/compact` 自身 prompt 事件讓清畫面失效、`agyStartLogin`／還原備份在取鎖後重查登記、逾時測試空殼與補測、continue 串行、登記前建目錄）。
- 驗證：`npm run typecheck` 通過、`npm test` 34 檔 449 項通過；假資料截圖：派工頁（執行中 1、最近 3）、模型分工（上限輸入）、自動整理設定。Ctrl+L 是否讓 Claude Code 清畫面待使用者實測。
