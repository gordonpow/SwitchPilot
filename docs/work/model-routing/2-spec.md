# 規格：agy 帳號、模型分工、派工與自動整理上下文（第一期）

需求：[1-requirements.md](1-requirements.md)。範圍：AC-1～AC-9、AC-12～AC-15（AC-10、AC-11 為第二期）。程式碼在 `app/`。

## 設計總覽

```
GUI（Electron main / controller）
 ├─ AgyAccounts：認證管理員 gemini:antigravity ⇄ ~/.claude-switcher/agy/slots/*.json
 ├─ AgyQuotaPoller（net.fetch）→ ~/.claude-switcher/agy/quota/<slot>.json
 ├─ routing.json 編輯
 └─ AutoCompact：Stop 事件＋sessions 檔＋statusline 上下文 → injectSubmit('/compact')
switcher-run.cjs（系統 node，dev-workflow 呼叫）
 └─ 讀 routing.json＋agy quota 快取 → 執行 agy 或回報改用 Claude 子代理
```

## A. agy 帳號（AC-1～AC-4）

### `src/scripts/agycred.ps1`（新增）

PowerShell 腳本，參數 `-Action read|write|delete`，`-Target`（預設 `gemini:antigravity`）。

- `read`：`CredReadW(Target, CRED_TYPE_GENERIC=1)`；不存在時 exit 3。存在時把 blob 以 base64 輸出到 stdout，並一併輸出 `UserName`：輸出一行 JSON `{"user":"...","blob_b64":"..."}`。
- `write`：從 stdin 讀一行 JSON `{"user":"...","blob_b64":"..."}`，`CredWriteW`：`Type=1`、`Persist=CRED_PERSIST_LOCAL_MACHINE(2)`、`TargetName`、`UserName`。成功 exit 0。
- `delete`：`CredDeleteW`；不存在也視為成功。
- 腳本不得寫任何檔案或 log；註解只用英文（PowerShell 5.1 以系統碼頁讀無 BOM 的 UTF-8，中文註解會讓解析失敗，已實測）。
- 由 build-scripts 原樣複製，`installScripts` 已會複製 `*.ps1`。

### `src/core/agycred.ts`（新增，不 import electron）

```ts
export interface AgyCred { user: string; blob: string }   // blob 為 UTF-8 JSON 字串
export interface AgyCredOps {
  read(): Promise<AgyCred | null>
  write(c: AgyCred): Promise<void>
  remove(): Promise<void>
}
export function defaultCredOps(ps1Path?: string): AgyCredOps   // 以 execFile powershell 呼叫 agycred.ps1，windowsHide，逾時 15 秒
export function parseBlob(blob: string): { email: string | null; expiryMs: number | null; accessToken: string | null }
```

- `parseBlob`：JSON 欄位 `id_token_email`、`token.expiry`（ISO 字串）、`token.access_token`。格式錯誤回傳全 null。
- 錯誤訊息不得包含 blob、token 或 stdout 內容。

### `src/core/agyaccounts.ts`（新增）

slot 檔：`~/.claude-switcher/agy/slots/<id>.json`：`{ id, name, email, user, blob, saved_at }`（`id` 為 6 位 hex；以 `withSlotLock('agy-'+id)` 保護寫入）。

```ts
listAgySlots(): AgySlot[]
currentAgySlotId(ops): Promise<string | null>   // 讀認證管理員 → email → 對應 slot
saveCurrentAgy(ops, name): Promise<AgySlot>      // 目前登入存成新 slot（email 已存在則更新該 slot）
syncCurrentAgyBack(ops): Promise<boolean>        // 目前登入的 blob 與對應 slot 不同時寫回（agy 自己 refresh 後）
switchAgy(ops, id, isAgyRunning): Promise<void>  // 先 sync back；agy 執行中則丟 AgyBusyError；寫入目標 blob
renameAgy(id, name)、deleteAgy(id)               // 刪除使用中 slot 時只刪檔，不動認證管理員
```

- `isAgyRunning()`：程序表中有 `agy.exe`（`sessions.listProcesses` 已提供；controller 注入）。原因：執行中的 agy 會把自己 refresh 的 token 寫回認證管理員，覆蓋剛切換的帳號。

### 新增 agy 帳號流程（AC-2，controller）

1. `isAgyRunning()` 為真時拒絕：「請先關閉所有 agy」。
2. 讀目前登入，暫存在記憶體（`backup`，可能為 null）。目前登入的 email 已有 slot → `syncCurrentAgyBack`；沒有 slot → 先 `saveCurrentAgy`（名稱為 email 的 @ 前段），確保程式中途被關閉也能切回。
3. `ops.remove()`。
4. 以 launcher 的方式開新 Windows Terminal 分頁執行 `agy`（無參數，互動模式），標題「agy 登入」。找不到 wt 時用 `cmd /c start`。
5. 每 2 秒輪詢 `ops.read()`：出現 blob 且 email 不屬於既有 slot（或屬於，視為重新登入）→ 狀態「已登入 <email>，請關閉 agy 視窗以完成」。
6. 等到該 agy 程序樹結束（以啟動時記下的 wt 子程序無法取得，改為：程序表中沒有 `agy.exe`）→ 存成 slot（名稱預設 email 的 @ 前段）→ 若有 `backup` 則 `ops.write(backup)` 還原。
7. 逾時 10 分鐘或使用者取消：若認證管理員是空的且有 `backup`，還原 `backup`。
- 狀態以 `AppState.agyLogin: { state: 'idle'|'waiting'|'signed_in'|'done'|'error', email: string|null, message: string|null }` 推送。

### `src/core/agyquota.ts`（新增）

```ts
export const AGY_BASE = 'https://daily-cloudcode-pa.googleapis.com/v1internal'
export function agyUserAgent(version: string): string   // `antigravity/${version} windows/amd64`
export async function fetchAgyQuota(accessToken, version, fetchImpl): Promise<AgyQuota>
export interface AgyQuota {
  ts: number                       // unix 秒
  tier: string | null
  models: Record<string, { remaining: number; resetAt: number | null }>   // remaining 0～1；resetAt unix 秒
  error: string | null
}
```

- 先 `POST :loadCodeAssist` body `{"metadata":{"ideType":"ANTIGRAVITY","pluginType":"GEMINI"}}` 取 `currentTier.id`；再 `POST :fetchAvailableModels` body `{}`，讀 `models.<id>.quotaInfo.{remainingFraction,resetTime}`。只保留有 `quotaInfo` 的模型。
- header：`Authorization: Bearer`、`Content-Type: application/json`、`User-Agent: agyUserAgent(version)`。逾時 20 秒。
- HTTP 401／403 → error「agy 授權失效或已過期（HTTP n）」；其他錯誤沿用 oauth.ts 的 `errDetail` 遮蔽 token。
- `version`：`agy --version` 輸出的第一個 `\d+\.\d+\.\d+`，controller 啟動時取一次並快取（失敗用 `1.5.8`）。
- 快取檔 `~/.claude-switcher/agy/quota/<slotId>.json`（AgyQuota）。

### `AgyQuotaPoller`（controller 內，每 5 分鐘＋手動）

- 對每個 agy slot：使用中 slot 用認證管理員中的最新 blob；其他 slot 用 slot 檔的 blob。`expiryMs > now + 60s` 才查；否則不查，保留舊快取（畫面顯示「最後更新：時間」）。
- **不 refresh 任何 agy token**（使用者選擇方案 1）。
- 查詢前先 `syncCurrentAgyBack`。
- fetch 由 main 注入 `net.fetch`。

## B. 模型分工（AC-5～AC-7）

### `src/core/routing.ts`（新增）

檔案 `~/.claude-switcher/routing.json`：

```json
{
  "version": 1,
  "roles": {
    "requirements": [{ "provider": "claude", "model": "opus" }],
    "spec":         [{ "provider": "claude", "model": "opus" }],
    "spec_review":  [{ "provider": "claude", "model": "sonnet" }],
    "implement":    [{ "provider": "agy", "model": "claude-sonnet-4-6" }, { "provider": "claude", "model": "sonnet" }],
    "impl_review":  [{ "provider": "claude", "model": "sonnet" }],
    "research":     [{ "provider": "claude", "model": "haiku" }],
    "docs":         [{ "provider": "claude", "model": "haiku" }]
  }
}
```

- 每項可選 `accounts: string[]`（agy slot id；空或省略代表全部）。Claude 項目的 `accounts` 第一期忽略（Claude 子代理一定用目前帳號），畫面標示「第二期」。
- `loadRouting()`：檔案不存在或壞掉 → 預設值（AC-7）；未知 role 忽略；缺少的 role 補預設。`saveRouting(r)`：驗證後 `writeJsonAtomic`。
- 驗證：provider ∈ {claude, agy}；claude model ∈ {opus, sonnet, haiku}；agy model 為非空字串且符合 `^[a-z0-9][a-z0-9.\-]{1,63}$`；每個 role 至少一項、最多 5 項。
- role 中文名稱：需求定義、規格、規格審查、實作、實作審查／驗證、查資料、文件草稿。

### 畫面：模型分工（AC-5）

- 新對話框 `RoutingDialog`（TopBar 新增按鈕「模型分工」）：每個 role 一列，列出有順序的項目（`Claude Opus`、`agy · claude-sonnet-4-6` 等 badge），可新增、刪除、上下移動；新增時選供應商與模型，agy 可勾選帳號。
- agy 模型選單來源：所有 agy 快取中出現過的模型 id 的聯集，加上目前設定中已有的值。
- 儲存呼叫 `setRouting`，失敗顯示訊息。

### dev-workflow skill（主導者手動更新，T-6）

- 「模型分工」段改為：派工前讀 `~/.claude-switcher/routing.json`（不存在則用 skill 內原本的分工）。
- 該 role 的第一個可用項目：
  - `claude` → 用 Agent 工具，`model` 為該值（requirements／spec 由主對話本身執行，若主對話模型不符則提醒使用者 `/model`）。
  - `agy` → 執行 `node ~/.claude-switcher/bin/switcher-run.cjs --role <role> --prompt <檔> --out <檔> --cwd <專案目錄> [--allow "<指令>"]...`，依結果處理（見 C）。

## C. 派工 `switcher-run`（AC-8、AC-9）

### `src/scripts/switcher-run.ts`（新增，esbuild 成 `switcher-run.cjs`）

參數：`--role R --prompt FILE --out FILE --cwd DIR [--allow CMD]... [--dry-run] [--agy PATH]`。不做任何網路請求（額度只讀 GUI 寫的快取）。

流程：
1. 讀 routing 的 role 清單（無效 role → exit 2）。
2. 依序處理每一項：
   - `agy` 項：
     - 候選帳號：項目的 `accounts`（或全部 agy slot），排除「已標記用完且未到重置時間」者（`agy/exhausted.json`：`{ "<slotId>|<model>": untilUnixSec }`）。
     - 依快取排序：使用中帳號優先；其次 `remaining` 大者；快取中 `remaining <= 0.01` 且 `resetAt > now` 者排除；沒有快取者排最後但不排除。
     - 選到非使用中帳號時：若 `agy.exe` 執行中，跳過該帳號；否則以 `agyaccounts.switchAgy` 切換（記在結果中）。
     - 執行：`agy --mode accept-edits --model M --settings <allow JSON> -p <prompt 內容>`（cwd 為 `--cwd`），allow 為 `--allow` 的完全相同字串（未給時預設 `npm test`、`npm run typecheck`、`npm run build`），逾時 60 分鐘。stdout／stderr 寫入 `--out`，log 寫 `--out` + `.agy.log`（`--log-file`）。
     - 判定：
       - exit 0 且輸出非空，且不含額度錯誤字樣 → 成功。
       - 輸出或 log 含 `RESOURCE_EXHAUSTED`、`429`、`quota`（不分大小寫）、`exhausted` → 額度用完：寫 exhausted（until = 快取的 `resetAt`，沒有則 now+5h），換下一個候選帳號；沒有候選就換清單下一項。
       - 輸出含 `no output produced`（指令權限被拒）→ 失敗，不換帳號，回報「agy 執行被拒：提示中的指令與允許清單不符」。
       - 其他失敗 → 換清單下一項。
   - `claude` 項：無法在此執行 → 輸出結果 `{status:"delegate", provider:"claude", model}` 並 exit 10（由 dev-workflow 改用 Claude 子代理）。
3. 最後一行 stdout 輸出 JSON 結果：`{ status: "ok"|"delegate"|"failed", provider, model, agy_account_email?, attempts: [{provider, model, account?, outcome}] , message }`。`--dry-run` 只選不執行（不切換帳號）。
4. 每次執行寫一筆到 `~/.claude-switcher/dispatch/<time_ns>.json`（同結果 JSON＋role、cwd、開始／結束時間），供第二期畫面使用；保留最近 200 筆。
- token、blob 不得出現在輸出、log、dispatch 檔。

## D. 自動整理上下文（AC-12～AC-15）

### statusline

- usage 紀錄加 `context: { used_percentage, total_input_tokens, context_window_size } | null`（來自 stdin `context_window`；欄位缺失為 null）。

### 設定（`core/config.ts`）

```ts
auto_compact: {
  enabled: boolean            // 預設 false
  threshold_type: 'percent' | 'tokens'   // 預設 percent
  threshold: number           // percent：1～99（預設 60）；tokens：1000～2000000
  action: 'compact' | 'clear' // 預設 compact
  wait_seconds: number        // 5～600，預設 20
  folders: string[]           // 空 = 全部；比對時忽略大小寫與結尾斜線，子資料夾也算
}
```

`load()` 驗證，不合法欄位用預設；`setConfig` 不合法回傳 INVALID。

### controller

- turns Map 每個 session 另記 `lastPromptTs`（最新 `prompt` 事件 ts）與 `lastStopTs`、`lastEventTs`（任何事件）。
- 每個 session 記 `lastCompactTs`（記憶體＋`~/.claude-switcher/compact/<session>.json`，重啟後保留）。
- 每次 tick（掃描結果有 sessionId 且 interactive 的 CLI）判斷 AC-13 的五個條件：
  1. `enabled` 且資料夾符合。
  2. 最新事件為 `stop` 且 `readClaudeSessions()` 中該 pid 的 `status === 'idle'`（判斷當下重讀，不用 15 秒前的掃描結果）。
  3. `lastPromptTs > lastCompactTs`。
  4. 該 session 最新 usage 紀錄的 `context`：percent 型比 `used_percentage`，tokens 型比 `total_input_tokens`；沒有 context 資料就不處理。
  5. `now - lastStopTs >= wait_seconds` 且 `lastEventTs === lastStopTs`。
  - 另外：在 live 模式「切換後 30 秒、要送繼續提示」的 session 不處理（`liveContinue` 中且未 done 者）。
- 成立時：`cli.injectSubmit(claudePid, action === 'compact' ? '/compact' : '/clear')`，成功後 `lastCompactTs = now`（寫檔），log「已在 <資料夾> 執行 /compact（上下文 N%）」；失敗記 warn，`lastCompactTs` 也設為 now 避免每 tick 重試。
- 同一 tick 最多處理 1 個 session（避免多個 inject 同時進行）。
- `CliView` 加 `contextPct: number | null`；`CliPanel` 每列顯示「上下文 N%」。

### 畫面

- `SettingsDialog` 新增「自動整理上下文」區：開關、門檻類型（百分比／token 數）、數值、動作（/compact／/clear，選 /clear 時顯示警告「會清除全部上下文」）、等待秒數、套用資料夾（多行文字，一行一個；空白代表全部）。

## IPC 與型別（`src/shared/types.ts`）

- `AppState` 加：
  - `agyAccounts: AgyAccountView[]`（`{ id, name, email, active, quota: { ts, tier, models: {id, remaining, resetAt}[], error } | null, tokenExpired: boolean }`）
  - `agyLogin`（見 A）
  - `routing: Routing`
  - `agyModels: string[]`
- `AppConfig` 加 `auto_compact`。
- `CliView` 加 `contextPct`。
- `Api` 加：`agySaveCurrent(name)`、`agySwitch(id)`、`agyRename(id,name)`、`agyDelete(id)`、`agyStartLogin()`、`agyCancelLogin()`、`agyRefreshQuota()`、`setRouting(r)`。IPC channel 對應 `agy:*`、`routing:set`。

## 畫面：agy 帳號（AC-1）

- 主畫面帳號卡片區下方新增「agy 帳號」區：每個帳號一張小卡（名稱、email、使用中 badge、tier），列出主要模型的剩餘額度（至少 `claude-sonnet-4-6`、`claude-opus-4-6-thinking`、`gemini-3.8-flash-tiered` 或快取中前 5 個；百分比條＋重置時間），token 過期時顯示「最後更新：時間（token 已過期，切換到此帳號後更新）」。
- 操作：切換、重新命名、刪除、「新增 agy 帳號」（顯示登入流程狀態）、「儲存目前 agy 登入」、重新整理額度。

## 任務

| ID | 內容 | 相依 |
|---|---|---|
| T-1 | `agycred.ps1`、`core/agycred.ts`、`core/agyaccounts.ts`、`core/agyquota.ts` ＋測試（假 ops、假 fetch） | — |
| T-2 | `core/routing.ts`、`src/scripts/switcher-run.ts` ＋測試（假 agy 執行檔 fixture、假 slot 與快取） | T-1 |
| T-3 | statusline context、config `auto_compact`、controller 自動整理邏輯 ＋測試 | — |
| T-4 | controller：agy 帳號、登入流程、quota poller、routing IPC；types、preload、index（注入 net.fetch 給 agy quota） ＋測試 | T-1、T-2、T-3 |
| T-5 | 畫面：agy 帳號區、RoutingDialog、SettingsDialog 自動整理、CliPanel 上下文；mock-api；截圖 | T-4 |
| T-6 | dev-workflow skill 改讀 routing.json（主導者） | T-2 |

## 驗證對照

| AC | 方式 |
|---|---|
| AC-1、AC-3 | agyaccounts／controller 測試（假 ops）；截圖 |
| AC-2 | controller 測試（假 ops 模擬登入、agy 程序結束、還原 backup、逾時還原） |
| AC-4 | agyquota 測試（假 fetch：200、401、403、缺 quotaInfo）；過期 token 不查 |
| AC-5～AC-7 | routing 測試（預設、驗證、補缺 role）；截圖 |
| AC-8、AC-9 | switcher-run 測試（假 agy：成功、額度錯誤換帳號、全部用完回 delegate、權限被拒、dry-run、agy 執行中不切換） |
| AC-12～AC-15 | statusline 測試、config 測試、controller 測試（五個條件各自不成立時不送、成立時送一次、/clear、資料夾過濾、live 繼續視窗中不送） |
| 實機 | agycred.ps1 讀寫：使用者實測（新增帳號流程會刪除再還原認證管理員資料） |

## 風險與回退

- 認證管理員格式或 agy 的額度 API 改變 → 額度顯示錯誤原因、切換失敗；不影響 Claude 功能。
- 新增 agy 帳號流程會先刪除目前 agy 登入；流程中斷時以 `backup` 還原（記憶體中）。程式在流程中被關閉會遺失 backup → 開始流程前先把目前登入存成 slot（`syncCurrentAgyBack` 或 `saveCurrentAgy`），確保可以再切回。
- 自動整理送字時使用者正在輸入 → 文字混入；以「等待秒數且期間無事件」降低機率。
- `/compact` 會消耗 token 產生摘要；門檻預設 60%、功能預設關閉。

## 修訂（規格審查後，優先於前文）

- **R-1 agy 登入備份落地**（審查 #1）：步驟 2 改為把 `backup` 寫入 `~/.claude-switcher/agy/login-backup.json`（`{user, blob, started_at}`，writeJsonAtomic）。controller 啟動時若此檔存在且認證管理員為空 → 自動還原並刪檔；認證管理員有值 → 只刪檔（記 info）。流程正常結束或取消後刪檔。
  - 步驟 6 的完成條件改為：(a) 已偵測到新 blob，且 (b) 曾在程序表看到 `agy.exe`、之後連續 2 次輪詢（4 秒）都沒有 `agy.exe`。只有 (a) 成立而使用者按「完成」也可結束。
  - 結束時順序：先把新 blob 存成 slot（email 為 null 則視為登入失敗，不存）→ 確認存檔成功 → 才 `write(backup)`。登入失敗（沒有新 blob）→ 認證管理員為空時還原 backup。
- **R-2 跨程序檔案鎖**（審查 #2）：新增 `core/filelock.ts`：`acquireFileLock(path, {staleMs})` 以 `fs.openSync(path,'wx')` 建立，內容 `{pid, ts}`；已存在時若持有者 pid 不存活或超過 staleMs 視為過期並接手；`release` 刪檔。鎖檔 `~/.claude-switcher/agy/agy.lock`。
  - switcher-run：從「選帳號、切換」到「agy 執行結束」全程持有（staleMs 70 分鐘）。
  - GUI：`switchAgy`、新增帳號流程、poller 的 `syncCurrentAgyBack` 都要先取鎖；取不到 → 切換與新增回傳「agy 正在被派工使用中」、poller 跳過 syncBack（仍可查額度）。
  - `switchAgy` 的「agy 執行中」檢查在持有鎖後進行，縮小 TOCTOU。
- **R-3 自動整理防迴圈**（審查 #3、#8、#9）：
  - turns 改存每 session 的 `lastPromptTs`、`lastStopTs`、`lastStopFailureTs`、`lastEventTs`（任何 prompt／stop／stopfailure 事件）、`lastKind`。hook 只寫這三種事件。
  - 條件 3 改為：存在 `lastPromptTs > lastCompactTs + 30`（送出整理後 30 秒內的事件視為整理本身造成）。
  - 條件 4 改為：只採用 `ts > lastCompactTs` 的 usage 紀錄（整理後的新資料），沒有就不處理。
  - 條件 2 明訂：`lastKind === 'stop'`（`stopfailure` 之後不整理）。
  - `lastCompactTs` 在送出**之前**設定並寫檔。
  - live：`liveContinue` 存在且該 session 不在 `done` 中 → 不整理。
  - 同時只有一個 inject 進行（in-flight 旗標，tick 不重入）；多個候選時取 `lastStopTs` 最舊者。
  - 實機確認 `/compact`、`/clear` 觸發哪些 hook 列為使用者實測項目。
- **R-4 額度錯誤判定收斂**（審查 #4）：exit 0 且輸出非空 → 一律成功。只有在 exit 非 0 或輸出為空時，才檢查 `.agy.log` 與 stderr（不檢查 stdout），且只認結構化字樣：`RESOURCE_EXHAUSTED`、`rateLimitExceeded`、`HTTP 429`／`status 429`／`code: 429`、`quota exceeded`（不分大小寫）。
- **R-5 長提示**（審查 #5）：prompt 內容超過 20000 字元時，改傳短 prompt「請完整讀取並照做檔案 <prompt 檔絕對路徑> 中的指示。」；永遠不截斷。
- **R-6 參數安全**（審查 #6）：`--settings` 以 `JSON.stringify` 組成；`--allow` 每項不得含換行、`"`、`*`、`?`，長度 ≤ 200，否則 exit 2；`--agy` 只在環境變數 `CLAUDE_SWITCHER_TEST=1` 時接受；以 `spawn(..., {shell:false})` 執行。
- **R-7 共用檔寫入**（審查 #7）：`exhausted.json` 讀改寫在 R-2 的鎖內進行，`writeJsonAtomic`；key 的 model 轉小寫。`resetAt` 已過去或缺少 → until = now + 5h。dispatch 檔不含 prompt 內容。
- **R-8 帳號比對**（審查 #10、#11）：email 一律轉小寫比對。`saveCurrentAgy` 在 email 為 null 時丟錯「無法讀取 agy 登入的 email」；email 已存在時更新 `user`、`blob`、`saved_at`。`syncCurrentAgyBack` 找不到對應 slot 時不寫、不報錯，回傳 false；畫面顯示「目前 agy 登入（未儲存）」並提供「儲存」。
- **R-9 scripts 匯入範圍**（審查 #12）：`switcher-run` 可 import `core/{paths,storage,lock,filelock,routing,agycred,agyaccounts,sessions,procutil}`，不得 import electron 或 oauth（避免網路）。CLAUDE.md 同步更新。`agycred` 預設 ps1 路徑為 `paths.binDir()/agycred.ps1`。
- **R-10 config 深度合併**（審查 #13）：`auto_compact` 在 `load()` 與 `setConfig` 中逐欄位合併與驗證；`setConfig({auto_compact:{...部分}})` 只改給定欄位。
- **R-11 需求補充**（審查 #14、#15）：AC-4 補「畫面顯示最後更新時間」；AC-5 註明 Claude 的帳號範圍第一期不生效。
- **R-12 檔案與逾時**（審查 #16、#18）：slot、login-backup 含完整 OAuth blob，存於使用者設定目錄（繼承使用者 ACL），文件註明。agycred 的 stderr 不外傳，測試涵蓋。switcher-run 逾時 60 分鐘後 `killTree` agy 程序樹。
- **R-13 skill 差異**（審查 #17）：T-6 說明 switcher-run 沒有 log 視窗，執行過程看 `<out>.agy.log`。

## 審查紀錄

規格審查（Sonnet，2026-11-13）18 條：全部採用（R-1～R-13）。#3 中「`/compact` 是否觸發 UserPromptSubmit」未實測，改以 30 秒忽略視窗與「整理後的新 usage 資料」雙重防護，並列入使用者實測。

## 實作紀錄

- 執行者：T-1、T-3 先交給 agy Sonnet（`run-agy-impl.sh`）。第一次因規格與 CLAUDE.md 在 agy 工作區外、讀檔被拒（soft-denying）而提早結束；加 `AGY_ADD_DIRS` 重跑時遇到 agy 額度用完（`RESOURCE_EXHAUSTED (code 429)`，約 119 小時後重置），依規則改由 Claude Sonnet 子代理完成 T-1～T-5；T-6 由主導者完成。
- 偏差：
  - `fetchAgyQuota` 不丟例外，失敗回傳 `error`；`remainingFraction` 缺少視為 0（proto3 JSON 省略 0）。
  - T-3 保留既有 `turns` Map，另以 `sessEv` 存 R-3 欄位；自動整理另檢查 claude PID 仍存活；門檻比較用 `>=`。
  - switcher-run：取不到 agy 鎖記 `agy_busy` 並換下一項；權限被拒直接 failed 不換帳號；目前 agy 登入未儲存時不切換（`skipped_unsaved_login`）；長 prompt 改傳路徑時自動 `--add-dir` 該目錄；支援 `AGY_ADD_DIRS`。
  - 新增 `agyFinishLogin`（R-1 的「使用者按完成」）；登入流程進行期間持有 agy 鎖；登入後取消且認證管理員非空時不還原（新登入顯示為「未儲存」）。
  - 截圖用環境變數 `CLAUDE_SWITCHER_SCREENSHOT_DIALOG=routing|settings`、`CLAUDE_SWITCHER_FAKE_AGYCRED`。
- 驗證：`npm test` 28 檔 358 個通過；typecheck、build 通過；假資料截圖 `routing-main.png`、`routing-dialog.png`、`settings-dialog.png`。尚未做 diff 審查；agycred.ps1 讀寫真實認證管理員、agy 登入流程、額度顯示、switcher-run 實際派工、自動整理 `/compact` 觸發哪些 hook，待使用者實測。
