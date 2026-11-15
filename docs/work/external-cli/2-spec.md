# 規格：自動偵測並切換所有 Claude CLI

需求：[1-requirements.md](1-requirements.md)。程式碼在 `app/`。

## 設計

### 資料流

1. statusline 與 hook 腳本多記一個欄位 `ppid`（`process.ppid`）。hook 新增 `prompt` 類型（`UserPromptSubmit`）。
2. controller 每 10 秒（與切換時）取得程序列表，從每筆 statusline 紀錄／事件的 `ppid` 往上找最近的 claude 程序，得到「claude PID ↔ session_id ↔ cwd ↔ 父 shell」。
3. 切換時：結束所有有 session 的 CLI → 切換帳號 → 託管的由 runner 重啟，外部的把接續指令寫進父 shell（失敗就開新 wt 分頁）。

### 檔案

#### `src/scripts/statusline.ts`、`src/scripts/hook.ts`

- 紀錄加 `ppid: process.ppid`。
- hook 接受 `kind === 'prompt'`（`UserPromptSubmit`），事件格式相同（`error` 為 null）。

#### `src/core/integration.ts`

- `install()` 多加 `UserPromptSubmit`：`{ hooks: [{ type: 'command', command: `${base}hook.cjs" prompt` }] }`（無 matcher）。
- `isInstalled()`（或同義函式）需同時有 `Stop`、`StopFailure`、`UserPromptSubmit` 三個 hook 才算已安裝。uninstall 已會移除所有 event 中我們的指令，不需改。

#### `src/core/monitor.ts`

- `EventRecord.kind` 加 `'prompt'`。規則不變：規則 1 只看 `stopfailure`，規則 4 只看 `stop`／`stopfailure`。加一個測試確認 `prompt` 事件不觸發切換。

#### `src/core/sessions.ts`（新增，純邏輯 + 可注入的程序列表）

```ts
export interface ProcInfo { pid: number; ppid: number; name: string; cmdline: string }
export type TurnState = 'busy' | 'idle' | 'interrupted' | 'unknown'
export type ShellKind = 'powershell' | 'cmd' | 'other'
export interface DetectedCli {
  claudePid: number
  sessionId: string | null      // null：沒有對應的 statusline／hook 紀錄
  cwd: string | null
  slotId: string | null
  turn: TurnState
  shellPid: number | null       // claude 的父程序
  shellKind: ShellKind
  printMode: boolean            // 命令列含 -p／--print
  cmdline: string               // 只在記憶體中使用，不得寫入 log 或 AppState
}
export function listProcesses(): Promise<ProcInfo[]>
export function isClaudeProc(p: ProcInfo): boolean
export function claudeAncestor(pid: number, byPid: Map<number, ProcInfo>, maxDepth = 8): ProcInfo | null
export function detect(procs: ProcInfo[], usageRecs: Rec[], events: Rec[]): DetectedCli[]
export function resumeArgs(cmdline: string, sessionId: string, prompt: string | null): string[]
export function shellLine(kind: 'powershell' | 'cmd', args: string[]): string | null
```

- `listProcesses()`：`execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 15000, maxBuffer: 32MB })`。輸出以 UTF-8 解析（指令前加 `[Console]::OutputEncoding=[Text.Encoding]::UTF8;`）。失敗回傳空陣列。`CommandLine` 為 null 時給空字串。
- `isClaudeProc`：`name` 不分大小寫等於 `claude.exe`；或 `name` 為 `node.exe` 且 `cmdline` 含 `@anthropic-ai/claude-code` 或 `claude-code\cli.js`／`claude-code/cli.js`。
- `claudeAncestor`：從 `pid` 本身開始往上（含自己），最多 `maxDepth` 層，回傳第一個 `isClaudeProc` 的程序；遇到循環或找不到回傳 null。
- `detect`：
  - `usageRecs` 為 `usage/` 下所有紀錄，`events` 為 `events/` 下所有事件（兩者都需含 `session_id`、`ts`、`ppid`；沒有 `ppid` 的紀錄略過）。
  - 每筆紀錄用 `claudeAncestor(ppid)` 對應到 claude PID。同一個 claude PID 取 `ts` 最大的那筆的 `session_id`、`cwd`、`slot_id`（`/clear` 後 session 會換，以最新為準）。
  - `turn`：只看該 `session_id` 的事件（kind 為 `prompt`／`stop`／`stopfailure`），取 `ts` 最大者：`prompt` → `busy`；`stop` → `idle`；`stopfailure` → `interrupted`；沒有事件 → `unknown`。
  - 列出所有 `isClaudeProc` 的程序（含沒有對應紀錄的，`sessionId: null`）。
  - 父程序：`shellPid = proc.ppid`；父程序名稱 `powershell.exe`／`pwsh.exe` → `powershell`，`cmd.exe` → `cmd`，其他（或父程序不存在）→ `other`。
  - `printMode`：`cmdline` 的參數中有 `-p` 或 `--print`。
  - 巢狀 claude（claude 的祖先也是 claude）：只列出最內層者沒問題，兩個都列出；對應紀錄時取最近祖先，自然正確。
- `resumeArgs(cmdline, sessionId, prompt)`：
  - 以 Windows 命令列規則切成 token（雙引號包住的保留空白，`\"` 為字面引號）；丟掉第一個 token（執行檔）。node 版（第一個 token 是 node.exe）再丟掉腳本路徑 token。
  - 保留以 `-` 開頭的 token。以下選項會吃下一個值，值一併保留：`--model`、`--permission-mode`、`--add-dir`、`--allowedTools`、`--allowed-tools`、`--disallowedTools`、`--disallowed-tools`、`--mcp-config`、`--settings`、`--agent`、`--append-system-prompt`、`--system-prompt`、`--fallback-model`。`--opt=value` 形式整個保留。
  - 丟掉：`-c`、`--continue`、`-r`／`--resume`（與其值）、`--session-id`（與其值）、`--fork-session`、`-p`、`--print`，以及不屬於上述值的非 `-` token（視為原本的 prompt）。
  - 結果加上 `--resume`、`sessionId`；`prompt` 非空時最後加 `prompt`。回傳的第一個元素不是執行檔（由呼叫端加 `claude`）。
- `shellLine(kind, args)`：產生 `claude` + 參數的一行指令（不含換行）。
  - `powershell`：每個參數用單引號包住，內部 `'` 變 `''`。參數含 `"` 時回傳 null（PowerShell 5.1 傳給原生程式會被拆壞）。
  - `cmd`：每個參數用雙引號包住；參數含 `"`、`%`、`^`、`&`、`|`、`<`、`>` 時回傳 null。
  - 任何參數含換行（`\r`、`\n`）回傳 null。

#### `src/core/coninject.ts`（新增）

- `injectLine(shellPid: number, line: string, opts?: { spawn?, ps1Path? }): Promise<boolean>`：執行 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <inject.ps1> -TargetPid <pid> -TextB64 <base64(utf8(line + '\r'))>`，`windowsHide: true`、逾時 15 秒，exit code 0 才回傳 true。
- `inject.ps1` 原始檔放在 `src/scripts/inject.ps1`（已放入，為 scratchpad 實測版本）。`scripts/build-scripts.mjs` 把它原樣複製到 `resources/scripts/`（該目錄是建置產物，已被 gitignore）。`nodebin.installScripts()` 改為複製 `*.cjs` 與 `*.ps1` 到 `~/.claude-switcher/bin/`。
- 呼叫前若 `shellPid` 不存活回傳 false。

#### `src/scripts/runner.ts`、`src/core/launcher.ts`

- cmd 檔 `go` 指令可帶 `resume?: string`、`prompt?: string`：`{ restart: 'go', seq, resume, prompt }`。runner 收到時以 `--resume <resume> [prompt]` 重啟；沒有 `resume` 時維持 `--continue`。
- runner 新參數 `--resume ID` 與 `--prompt TEXT`（第一次啟動用，給 fallback 新分頁）。`--prompt` 只在有 `--resume` 時有效。runner 也接受 `--extra-args-b64 B`：base64(JSON 字串陣列)，接在 claude 執行檔後、`--resume` 之前（保留原本選項）。重啟（`go`）時也帶上這些原本選項。
- `launcher.releaseRestart(run, opts?: { resume?: string; prompt?: string })`。
- `launcher.launch(folder, cont, opts)` 的 opts 加 `resume?: string; prompt?: string; extraArgs?: string[]`，轉成 runner 參數。

#### `src/core/config.ts`

- `manage_external: boolean`（預設 true）、`continue_prompt: string`（預設 `'繼續'`）。
- 驗證：`continue_prompt` 去頭尾空白；長度 ≤ 200；不得含 `"`、`\r`、`\n`、`%`、`^`、`&`、`|`、`<`、`>`（不合法時 setConfig 回傳 INVALID）。空字串代表不送提示。

#### `src/shared/types.ts`

- `AppConfig` 加 `manageExternal: boolean`、`continuePrompt: string`（命名依現有 AppConfig 慣例）。
- 新增：
  ```ts
  export interface CliView {
    pid: number
    cwd: string | null
    sessionId: string | null
    slotName: string | null
    turn: 'busy' | 'idle' | 'interrupted' | 'unknown'
    hosted: boolean
    method: 'runner' | 'inject' | 'window' | 'none'   // 切換時的接續方式
  }
  ```
  `AppState` 加 `clis: CliView[]`、`clisScannedAt: number | null`。
- `method`：託管（claude PID 等於某個 active run 的 `claude_pid`）→ `runner`；沒有 session 或 printMode → `none`；shellKind 為 powershell／cmd → `inject`；其他 → `window`。

#### `src/main/controller.ts`

- 新依賴 `cli?: CliOps`：
  ```ts
  export interface CliOps {
    listProcesses(): Promise<sessions.ProcInfo[]>
    kill(pid: number): Promise<boolean>              // 預設 procutil.killTree
    inject(shellPid: number, line: string): Promise<boolean>  // 預設 coninject.injectLine
  }
  ```
  預設實作用真的；測試注入假的。`CLAUDE_SWITCHER_DISABLE_POLL=1` 時也不掃描程序（畫面驗證用）。
- 掃描：每 10 秒（`SCAN_MS`）一次，非切換中、不與上一次重疊。讀 `usage/` 全部紀錄與 `events/` 全部事件（新增 `usage.allUsageRecords()`、`usage.allEvents()`，讀全部檔案，不動水位線），呼叫 `sessions.detect`，存成 `this.clis`，轉成 `CliView` 放進 state。
- `runSwitch`（`restartRuns` 為 true 時）：
  1. 現有：`activeRuns()`，對每個 run `requestRestart`。
  2. 若 `cfg.manage_external`：重新掃描一次，取 `externals = clis.filter(c => sessionId && !printMode && 不是託管 run 的 claude_pid)`。對每個先記下 `interrupted = turn === 'busy' || turn === 'interrupted'`，再 `cli.kill(claudePid)`。
  3. 等待：`stillAlive` 包含 runs 的 claude_pid 與 externals 的 claudePid。逾時：runs 照舊 abort；externals 中已結束者仍要接續（帳號未變），然後回傳失敗。
  4. `switchTo` 失敗：同上，runs abort、已結束的 externals 接續。
  5. 成功後：
     - runs：用掃描結果找出該 run 的 claude_pid 對應的 session；有 session 時 `releaseRestart(r, { resume, prompt })`，prompt 依 AC-4；沒有時 `releaseRestart(r)`。
     - externals：`resume(ext)`。
  - `resume(ext)`：`args = resumeArgs(ext.cmdline, ext.sessionId, interrupted && continue_prompt ? continue_prompt : null)`。shellKind 為 powershell／cmd 且 `shellLine` 不為 null 且 shell 存活 → 等 800 ms 後 `cli.inject(shellPid, line)`；成功記 log「已在原視窗接續 <資料夾>」。否則（或 inject 失敗）→ `launcher.launch(cwd, false, { node, binDir, resume: sessionId, prompt, extraArgs: args 中 --resume 之前的部分 })`，記 log「已在新視窗接續 <資料夾>」。cwd 為 null 時無法開新視窗，記 warn。
  - log 只寫資料夾與 PID，不寫命令列與 session 以外的內容。
- `setConfig` 支援兩個新欄位。

#### 畫面（`src/renderer/src/`）

- 新元件 `components/CliPanel.tsx`：標題「Claude CLI」，副標「切換帳號時會結束並接續以下 CLI」。每列：資料夾（截斷、title 顯示完整）、PID、帳號、狀態 badge（工作中／閒置／中斷／未知）、接續方式（託管／原視窗／新分頁／無法接續；無法接續時 tooltip「尚未取得 session，請安裝整合後重新啟動此 CLI」）。空清單顯示「目前沒有偵測到 claude CLI」。放在 LaunchPanel 旁或下方（依現有版面）。
- `SettingsDialog`：加開關「切換時一併處理外部 CLI」與輸入框「中斷後自動送出的提示（留空則不送）」。
- `lib/mock-api.ts` 補 `clis` 假資料。

## 任務

| ID | 內容 | 相依 |
|---|---|---|
| T-1 | scripts（ppid、prompt）、integration（UserPromptSubmit、isInstalled）、monitor 型別、config 新欄位與驗證、nodebin 複製 `.ps1`、build-scripts 複製 `inject.ps1`、usage 的 `allUsageRecords`／`allEvents` + 測試 | — |
| T-2 | `core/sessions.ts`、`core/coninject.ts` + 測試（假程序表、假 spawn） | — |
| T-3 | runner／launcher 的 resume、prompt、extraArgs + 測試（fake-claude 記錄 argv） | — |
| T-4 | types、controller（掃描、runSwitch、resume、setConfig）+ 測試 | T-1、T-2、T-3 |
| T-5 | 畫面：CliPanel、SettingsDialog、mock-api；截圖確認 | T-4 |

## 驗證對照

| AC | 方式 |
|---|---|
| AC-1 | controller 測試（state.clis 內容）、假資料截圖 |
| AC-2 | controller 測試：外部與託管都被 kill，切換後 inject／releaseRestart 帶 resume |
| AC-3 | controller 測試：powershell → inject；inject 失敗 → launch；other → launch |
| AC-4 | controller 測試：busy／interrupted 帶 prompt，idle 不帶 |
| AC-5 | sessions 測試：resumeArgs 各種命令列；printMode 不處理 |
| AC-6 | config 測試、controller 測試（manage_external=false 不 kill 外部；手動切換並重啟也處理） |
| AC-7 | runner 測試：cmd 帶 resume 時 argv 含 `--resume ID prompt` |
| AC-8 | integration 測試 |
| AC-9 | `npm test`、`npm run typecheck` |
| 原視窗寫入 | 已在 scratchpad 實測 conhost 與 Windows Terminal；herdr 由使用者實測 |

## 風險與回退

- herdr 的終端機實作若不支援 `WriteConsoleInput`：inject.ps1 會回傳非 0，自動改開新分頁。
- 強制結束後終端機模式可能殘留（例如 claude 改過的 console mode）；PowerShell 的 PSReadLine 讀取時會重設，cmd 可能顯示異常。使用者實測確認。
- PID 重用：只採用 `ts` 在 24 小時內的紀錄（`usage.cleanup` 已會刪除舊檔），且必須是目前存在的 claude 程序。
- 回退：設定關閉「一併處理外部 CLI」即恢復原本行為。

## 附錄：inject.ps1

原始檔 `app/src/scripts/inject.ps1`：參數 `-TargetPid`、`-TextB64`；`FreeConsole` → `AttachConsole(pid)` → `CreateFileW("CONIN$")` → 每個字元送 key down／up 兩筆 `KEY_EVENT`（`\r` 的 virtual key 為 0x0D）→ `WriteConsoleInputW`；成功 exit 0，`AttachConsole` 失敗 exit 10，開 CONIN$ 失敗 exit 11，寫入不完整 exit 12。

## 修訂（審查後，優先於前文）

- **R-1 PID 對應改在 statusline 腳本內完成**（審查 #1，已實測：claude 執行指令時中間隔著 3 層 `bash.exe`，腳本的 `ppid` 是短命 shell）。
  - statusline 腳本：若 `pidmap/<safe session>.json` 不存在，或其中 `claude_pid` 已不存活，就同步執行一次 PowerShell 查詢（`windowsHide`、逾時 5 秒），從 `process.pid` 往上找第一個 claude 程序（判定同 `isClaudeProc`），寫入 `pidmap/<safe session>.json`：`{ session_id, cwd, claude_pid, claude_created, shell_pid, shell_name, ts }`。每個 session 只查一次（約 0.5～1 秒），失敗也照常輸出狀態列。
  - `claude_created`：Win32_Process `CreationDate` 轉 unix 毫秒。
  - `shell_pid`／`shell_name`：claude 程序的父程序。若 claude 是 `node.exe` 且父程序是 `cmd.exe` 且其命令列含 `claude.cmd`（npm shim），再往上一層（審查 #4）。
  - 查詢腳本內容放在 `core/sessions.ts` 的匯出常數（PowerShell 指令字串），供 statusline 與測試共用；查詢函式可注入，測試不呼叫真的 PowerShell。
  - hook 不做查詢，只記 `session_id`；statusline 與 hook 都不再記 `ppid`。
  - `paths.pidmapDir()` 新增；`usage.cleanup` 一併清 `pidmap/`。
- **R-2 detect 改用 pidmap**：`detect(procs, pidmaps, turns, runs)`。
  - `procs` 需含 `created`（CreationDate，unix 毫秒）。pidmap 有效條件：`claude_pid` 在 procs 中、是 claude 程序、`created` 等於 `claude_created`（防 PID 重用，審查 #5）。
  - 同一 `claude_pid` 有多筆有效 pidmap 時取 `ts` 最新（`/clear` 換 session）；同一 `session_id` 對應多個 PID 時只保留 `ts` 最新者（審查 #14）。
  - `hosted`：claude 程序的祖先（含 shim）包含某個 active run 的 `runner_pid`（審查 #4），不再比對 `claude_pid`。
  - `shellKind` 以 pidmap 的 `shell_name` 判定，且 `shell_pid` 必須仍在 procs 中，否則 `other`。
- **R-3 排除非互動 claude**（審查 #3）：命令列含 `-p`、`--print`、`--input-format`、`--output-format`、`--sdk-url` 任一者 → `interactive: false`（取代 `printMode`），不結束、不接續，method 為 `none`。
- **R-4 turn 狀態由 controller 增量維護**（審查 #6、#13）：啟動時讀一次全部事件建立 `Map<session_id, {kind, ts}>`，之後在每次 tick 的 `readNewEvents` 結果中更新，不再每次掃描都讀全部事件。`allUsageRecords`／`allEvents` 改為 `usage.allEvents()`（只在啟動時用）與 `usage.allPidmaps()`。
  - 已知限制：使用者按 Esc 中斷不會觸發 Stop，該 session 會被當成 busy，接續時會送提示。整合安裝前就啟動的 claude 沒有 `UserPromptSubmit` 事件，turn 為 `unknown`（不送提示）。畫面在 turn 為 `unknown` 時顯示 tooltip「重新啟動此 CLI 後可偵測工作狀態」。
- **R-5 掃描**：每 15 秒一次（`SCAN_MS = 15000`），切換流程中**在任何 kill／requestRestart 之前**先掃描一次並保存結果（審查 #2）；runs 的 session 與 turn 從這次結果取得。`ConvertTo-Json` 單一物件時包成陣列。程序查詢指令加入 `CreationDate`（以 `[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()` 輸出）。
- **R-6 resumeArgs**（審查 #7）：
  - 需值選項清單加入 `--effort`、`--plugin-dir`、`--setting-sources`、`--permission-prompt-tool`、`--max-turns`、`--betas`、`--teammate-mode`。variadic（吃到下一個 `-` 開頭 token 為止）：`--add-dir`、`--allowedTools`、`--allowed-tools`、`--disallowedTools`、`--disallowed-tools`、`--mcp-config`、`--betas`、`--plugin-dir`。
  - 需值選項後面接的是 `-` 開頭 token 時，不吃。`-r`／`--resume` 只有在下一個 token 不是 `-` 開頭時才吃值。
  - 未知選項一律視為布林旗標；後面的非 `-` token 視為 prompt 丟掉。
  - node 版：丟掉 token 直到（含）第一個以 `cli.js`、`cli.mjs` 結尾或含 `claude-code` 的 token。
- **R-7 shellLine**（審查 #8）：任何參數為空字串、以 `\` 結尾、含換行，或（powershell）含 `"`、`‘ ’ ‚ ‛` → 回傳 null。cmd 規則不變。
- **R-8 method 判定統一**（審查 #9）：`sessions.planResume(cli, prompt)` 回傳 `{ method: 'runner'|'inject'|'newtab'|'none', line?: string, args: string[] }`，畫面與切換流程共用。`inject` 條件：shellKind 為 powershell／cmd、shell 存在、`shellLine` 不為 null；否則有 cwd 時 `newtab`，沒有則 `none`。`CliView.method` 的 `window` 改名 `newtab`。
- **R-9 參數與輸入驗證**（審查 #10）：
  - runner 參數改為 `--resume ID`、`--prompt-b64 B`、`--extra-args-b64 B`（base64 UTF-8；extra 為 JSON 字串陣列）。cmd 檔 `go` 的 `resume`、`prompt`、`extra_args` 照常存 JSON。
  - runner 走 `.cmd`／`.bat` 時，任何參數含 cmd 特殊字元（`"%^&|<>`）就丟掉該次 extraArgs 與 prompt，只用 `--resume ID`，並印出提示。
  - `sessionId` 必須符合 `^[0-9a-fA-F-]{36}$`，否則該 CLI 視為沒有 session。
  - `continue_prompt` 禁止字元再加 `;`。
  - `runSwitch` 中每個 CLI 的結束與接續各自 try/catch，一個失敗不影響其他。
- **R-10 需要更新整合**（審查 #11）：`AppState.integration` 加 `needsUpdate: boolean`（有我們的 statusLine 或 Stop hook，但缺 `UserPromptSubmit`）；畫面上原本「安裝整合」的位置顯示「更新整合」。`installed` 定義改為三個 hook 與 statusLine 都齊全。
- **R-11 coninject 不記錯誤內容**（審查 #12）：`execFile` 的錯誤（含 base64 命令列）不得傳入 log；只記 exit code。
- **R-12 inject 前再確認**（審查 #14）：等 800 ms 後再確認 shell 存活才寫入。風險：若父 shell 執行的是 `claude; 其他指令` 之類的腳本，寫入的文字會被腳本後面的程式讀走。

## 審查紀錄

規格審查（Sonnet，2026-11-13）14 條：全部採用（R-1～R-12）。其中 #6 的 Esc 中斷誤判無法從 hook 偵測，列為已知限制；#13 的程序掃描改 15 秒。

## 實作偏差

- statusline 直接 import `core/sessions.ts`（只用 `node:child_process`，打包後約 11 KB）。查詢失敗時寫入 `claude_pid: null` 標記，60 秒內不重查。測試用 `CLAUDE_SWITCHER_DISABLE_PIDMAP=1` 停用，或 `CLAUDE_SWITCHER_PIDMAP_CMD`＋`CLAUDE_SWITCHER_PIDMAP_START_PID` 改用假查詢。
- `integration.needsUpdate`：有我們的 statusLine 或 Stop hook 但 `isInstalled` 為 false（比「缺 UserPromptSubmit」寬）。
- `detect` 中 sessionId 不合 UUID，或同 session 有多個 PID 而非 ts 最新者，設為 null。
- `planResume`：hosted 一律回傳 `runner`。
- `AppConfig` 新欄位沿用 snake_case：`manage_external`、`continue_prompt`。
- 畫面驗證新增 `CLAUDE_SWITCHER_FAKE_CLIS=<ProcInfo[] JSON>`：用假程序表掃描（即使停用輪詢），kill／inject 為 no-op。
- 託管 run 對應 session：取 `hosted` 且 `claudePid === run.claude_pid` 者。npm 安裝（`claude.cmd` shim）時對不到，該 run 退回 `--continue`。
- 實作中子代理誤執行一次 statusline 腳本，在真實 `~/.claude-switcher/usage/` 寫入 `unknown.json`，已刪除。

## 驗證紀錄（程式碼層面）

- `npm test`：19 檔 214 個測試通過；`npm run typecheck`、`npm run build`、`npm run package` 通過（`dist/Claude Account Switcher 1.0.0.exe`，106.1 MB，含 `resources/scripts/inject.ps1`）。
- 原視窗寫入：scratchpad 實測 conhost 與 Windows Terminal（ConPTY）PowerShell，含中文。
- 假資料截圖：scratchpad `shot/cli-1280x820.png`、`shot/cli-800x1500.png`。
- 待使用者實測：herdr 窗格寫入、真實切換與接續、提示送出。
- 尚未做 diff 審查。

## 第二版：不重啟模式（2026-11-13，使用者決定設為預設）

### 依據

已實測 claude 2.1.323：每次 API 請求前會比對 `.credentials.json` 的 mtime，變了就重讀。換檔後，執行中的 claude 下一個請求即改用新 token。`inject.ps1` 也能直接寫入執行中 claude 的輸入框（以 `AttachConsole(claude PID)` 進入同一個 console）。

### 驗收條件

- **AC-10**：設定新增「切換方式」：`live`（不重啟，預設）／`restart`（結束並以 `--resume` 重開，即第一版行為）。
- **AC-11**：`live` 模式下，用量達門檻就立即切換，不等回合結束（不進 pending）；rate_limit 事件也立即切換。切換時只換帳號，不結束任何 claude、不動 runner。
- **AC-12**：`live` 模式下，切換後對「最後事件為 `stopfailure`（rate_limit）」的互動式 session，把 `continue_prompt` 送進該 claude 的輸入框。`continue_prompt` 為空時不送。閒置與工作中的 session 不送任何東西。
- **AC-13**：切換後 30 秒內收到的 `stopfailure` 事件，視為舊帳號造成的失敗：不觸發再次切換，而是對該 session 送 `continue_prompt`（同一 session 在同一次切換只送一次）。30 秒後的 `stopfailure` 照常觸發切換。
- **AC-14**：畫面「Claude CLI」區塊在 `live` 模式下，接續方式顯示「免重啟」；有 session 且狀態為中斷者標示「會送出提示」。
- **AC-15**：`restart` 模式行為與第一版完全相同（既有測試不改語意仍通過）。

### 設計

- `core/config.ts`：`switch_mode: 'live' | 'restart'`，預設 `'live'`；其他值不合法（setConfig 回傳 INVALID）。`AppConfig` 同步加欄位。
- `core/monitor.ts`：`Monitor` 加 `waitTurnEnd = true` 屬性。為 false 時，規則 2 達門檻直接回傳 `switch_now`（reason「已達門檻」）。另加 `ignoreFailuresUntil = 0`（秒）：規則 1 忽略 `ts < ignoreFailuresUntil` 的 `stopfailure`。controller 依 `switch_mode` 設定這兩個值。
- `core/coninject.ts`：新增 `injectSubmit(targetPid, text, opts)`：先送 `text`（不含換行），等 `submitDelayMs`（預設 500）再單獨送 `\r`。原因：claude 的 TUI 可能把連續輸入的換行當成貼上，不會送出。存活檢查對象為 `targetPid`。
- `src/main/controller.ts`：
  - `runSwitch` 在 `switch_mode === 'live'` 時：不呼叫 `activeRuns`／`requestRestart`／kill，不等待。先掃描一次（若掃描啟用），再 `switchTo`（含 `syncCurrentBack`，鎖照舊）。成功後：
    - `monitor.reset(now)`，並設 `monitor.ignoreFailuresUntil = now + 30`。
    - `this.liveContinue = { until: now + 30, done: Set<session_id> }`。
    - 對掃描結果中 `interactive && sessionId && turn === 'interrupted'` 者，呼叫 `continueSession(cli)`。
  - `continueSession(cli)`：`continue_prompt` 為空就略過。`done` 已含該 session 就略過。否則加入 `done`，以 `cli.injectSubmit(claudePid, prompt)` 送出（`CliOps` 加 `injectSubmit`）。log 只寫資料夾與 PID：成功「已在 <資料夾> 送出繼續提示」，失敗 warn「無法送出繼續提示：<資料夾>」。每個 session 各自 try/catch。
  - `tickInner`：處理新事件時，若 `liveContinue` 存在且 `now <= until`，對每個 `kind === 'stopfailure'` 的事件，找出 `session_id` 對應的 CLI（用最近一次掃描結果；找不到就立即重新掃描一次），呼叫 `continueSession`。
  - `restart` 模式：完全維持第一版流程。
  - `monitor.waitTurnEnd = switch_mode === 'restart'`，在建構與 setConfig 時同步。
- `src/core/sessions.ts`：`planResume` 不動。`CliView.method` 加 `'live'`：controller 在 `live` 模式下，對 interactive 的 CLI 一律給 `'live'`，非 interactive 給 `'none'`。
- 畫面：
  - `SettingsDialog` 加「切換方式」選擇（不重啟（建議）／結束並重開）。選「不重啟」時，說明文字：「切換後執行中的 claude 會在下一個請求自動使用新帳號；因額度用完而停下的 CLI 會自動送出提示」。
  - 「外部 CLI」開關與提示文字欄維持。外部 CLI 開關只影響 `restart` 模式；`live` 模式送提示也受它控制（關閉時只對託管 run 的 claude 送）。
  - `CliPanel`：method `'live'` 顯示「免重啟」；`turn === 'interrupted'` 時加註「會送出提示」。
  - `AutoSwitchPanel` 若有「等待回合結束」之類文字，依模式調整。
  - `mock-api` 預設 `switch_mode: 'live'`。

### 任務

- T-6：config、monitor、coninject、controller、types、畫面與測試，一次完成。

### 測試

- config：預設 `live`、不合法值。
- monitor：`waitTurnEnd=false` 達門檻立即 `switch_now`；`ignoreFailuresUntil` 內的 stopfailure 不觸發。
- coninject：`injectSubmit` 分兩次呼叫 spawn，第二次為 `\r`（假 spawn、`submitDelayMs: 0`）。
- controller（live）：
  - 切換時不呼叫 kill／requestRestart。
  - 只有 interrupted 的 session 收到 `injectSubmit`，目標為 claudePid，文字為 `continue_prompt`。
  - `continue_prompt` 為空不送。
  - 切換後 30 秒內的新 stopfailure 不再觸發切換，而是送提示且只送一次；30 秒後的 stopfailure 照常切換。
  - 外部 CLI 開關關閉時只對託管者送。
- controller（restart）：既有測試全部通過（測試中明確設 `switch_mode: 'restart'`，或依預設調整）。

### 風險

- 依賴 Claude Code 目前「比對 mtime 重讀憑證」的行為；版本變更可能失效。屆時改用 `restart` 模式。
- 使用者正在該 claude 輸入框打字時，送出的提示會和輸入混在一起。
- `~/.claude.json` 的 `oauthAccount` 已在切換時替換，但執行中 claude 的 `/status` 仍顯示舊 email，直到重開。
- 切換瞬間若執行中的 claude 正好在 refresh 舊帳號的 token，可能把舊帳號憑證寫回 `.credentials.json`。Claude Code 寫檔前會重新讀檔，風險低；下一輪 `syncCurrentBack` 與目前帳號判定（`currentSlotId` 比對 `oauthAccount`）會顯示不一致。列為已知風險，使用者實測觀察。

## 實作審查紀錄（2026-11-13，兩位 Sonnet 審查者：controller／畫面、core／scripts）

採用（交由修正任務處理）：
- live 模式手動切換仍跳出「切換並重啟」對話框且文案錯誤 → live 模式不顯示。
- `handleLiveFailures` 以牆鐘判斷 30 秒視窗，與 monitor 以事件 ts 判斷不一致，可能既不送提示也不切換 → 改用事件 ts。
- live 分支先掃描程序表再換帳號，延遲切換 1～30 秒 → 先換帳號再掃描。
- `interrupted` 狀態不會過期，舊的中斷 session 每次切換都被送提示 → 只送 15 分鐘內的 rate_limit 失敗。
- 「會送出提示」標示未考慮提示為空與外部 CLI 開關 → `CliView.willPrompt` 由 controller 計算。
- restart 分支 `requestRestart` 未逐個 try/catch；`kill` 回傳 false 仍記成已結束；live 切換中改設定為 restart 仍會設定 30 秒忽略視窗。
- 沒有可切換目標時，live 模式每 3 秒嘗試一次並記 log → 60 秒節流。
- 切換瞬間舊 claude refresh 寫回舊帳號憑證時，`syncCurrentBack` 會把它存進新帳號 slot → 檢查憑證是否屬於其他 slot，是則不寫回。
- launcher cmd.exe 後備路徑的 `start /D dir` 可被 `&` 等字元注入 → 驗證後拒絕。
- `resumeArgs` 需值選項不完整、未知旗標可能吃掉 `--resume` → 補清單，未知旗標連同後面的值一起丟掉。
- statusline 同步查詢掃全部程序（1.5～4 秒）→ 只沿祖先鏈查。
- `config.load` 未驗證 `continue_prompt`；提示與 shellLine 未拒絕控制字元。
- Claude Desktop（同名 `claude.exe`）會被誤列 → 排除 `--type=` 與 Desktop 路徑。
- `scripts.test` 的「已存活時不再查詢」未驗證第二次不查詢。

不採用：
- `extra_args` 寫入 `runs/<id>.cmd.json`：只在 restart 模式使用，檔案位於使用者自己的設定目錄，內容與該使用者可見的程序命令列相同。
- `tokenize` 不處理引號內 `""`、statusline `pidAlive` 不比對 created（`detect` 會比對 created）、`inject.ps1` 錯誤碼一律 10、runner 以 `.cmd` 啟動時的引號規則（待確認、少見）。
- 掃描失敗時保留上次結果：`listProcesses` 失敗與真的沒有程序無法區分，維持現狀。

### 修正結果

- 上述採用項目全部修正。偏差：未知旗標後接非 `-` token 時連同旗標一起丟掉；為避免誤丟，新增 `BOOLEAN_FLAGS` 清單（`--dangerously-skip-permissions`、`--verbose`、`--debug`、`--ide`、`--strict-mcp-config`、`--chrome` 等）保留且不吃後面的 token。
- 祖先鏈查詢 `psAncestorQuery` 以真實 PowerShell 對本機程序實測（唯讀）：1.15 秒，正確找到 claude、父 PowerShell 與 herdr。
- `npm test` 241 個通過；typecheck、package 通過。
