# 規格：Claude Code 多帳號切換器（GUI）

需求見 `1-requirements.md`。

## 已確認的外部事實（來源：code.claude.com/docs/en/statusline.md、hooks.md、authentication.md）

- statusline 指令從 stdin 收到 JSON，含 `session_id`、`cwd`、`transcript_path`；Pro/Max 訂閱在第一次 API 回應後含 `rate_limits.five_hour.{used_percentage,resets_at}`、`rate_limits.seven_day.{used_percentage,resets_at}`（`resets_at` 為 Unix 秒），每個視窗可能缺席。statusline 的 stdout 第一行顯示在 Claude Code 底部。
- hook `StopFailure`：API 錯誤結束回合時觸發，matcher 比對 `error`（`rate_limit`、`overloaded`、`authentication_failed`…）；stdin 含 `session_id`、`cwd`、`error`。文件未保證「usage limit reached」對應 `rate_limit`，所以 statusline 門檻是主要偵測，hook 是備援。
- hook `Stop`：回合正常結束時觸發。
- Windows 憑證：`%USERPROFILE%\.claude\.credentials.json`。文件未說明執行中的 claude 會重新讀取，所以切換後一律重啟 claude。
- 帳號資訊：`%USERPROFILE%\.claude.json` 的 `oauthAccount`（含 `accountUuid`、`emailAddress`）。
- 本機 `claude` 是原生執行檔 `C:\Users\abcz0\.local\bin\claude.exe`（不是 npm shim），`Popen` 取得的 PID 就是 claude 本身。

## 設計

### 目錄與檔案

程式碼（專案根目錄 `C:\presonal_project\Switching_account`）：

```
switcher/
  __init__.py
  __main__.py        # python -m switcher → 啟動 GUI
  paths.py           # 所有路徑；可用環境變數覆寫（測試用）
  storage.py         # read_json / write_json_atomic
  config.py          # 使用者設定
  accounts.py        # slot 管理、目前帳號判斷、切換
  usage.py           # 讀取 statusline 用量與 hook 事件
  integration.py     # 安裝／移除 settings.json 的 statusLine 與 hooks
  statusline.py      # 由 Claude Code 執行的 statusline 腳本
  hook.py            # 由 Claude Code 執行的 hook 腳本
  procutil.py        # 程序存活判斷、結束程序樹（ctypes / taskkill，無黑窗）
  runner.py          # 在 Windows Terminal 中執行，託管 claude
  launcher.py        # GUI 端：啟動 runner、下重啟指令
  monitor.py         # 自動切換判斷（純邏輯）
  switchplan.py      # 選下一個帳號／全部用完判斷（純邏輯）
  gui.py             # tkinter 介面
tests/
  fake_claude.py     # 測試用假 claude
  test_*.py          # unittest
README.md
docs/PROJECT_LOG.md
```

執行期資料（`paths.app_dir()`，預設 `%USERPROFILE%\.claude-switcher`，環境變數 `CLAUDE_SWITCHER_HOME` 覆寫）：

```
slots/<slot_id>.json        # 帳號 slot
config.json                 # 使用者設定
active.json                 # {"switched_at": <unix float>}（只當水位線，不當目前帳號的依據）
usage/<session_id>.json     # statusline 寫入
events/<time_ns>-<hex4>.json  # hook 寫入；檔名可排序，作為水位線
runs/<run_id>.state.json    # runner 擁有（GUI 只讀）
runs/<run_id>.cmd.json      # GUI 擁有（runner 只讀）
backups/settings-<ts>.json
integration.json            # 安裝前原本的 statusLine
```

Claude 路徑（函式，每次呼叫都讀環境變數）：
- `paths.claude_home()`：預設 `%USERPROFILE%\.claude`，環境變數 `CLAUDE_SWITCHER_CLAUDE_HOME` 覆寫。
- `paths.cred_file()` = `claude_home()/.credentials.json`、`paths.settings_file()` = `claude_home()/settings.json`。
- `paths.claude_json()`：預設 `%USERPROFILE%\.claude.json`，環境變數 `CLAUDE_SWITCHER_CLAUDE_JSON` 覆寫。
- `paths.project_root()`：`switcher` 套件的上一層。
- 其他：`slots_dir()`、`usage_dir()`、`events_dir()`、`runs_dir()`、`backups_dir()`、`config_file()`、`active_file()`、`integration_file()`。

`paths.py`、`storage.py` 由主導者先完成，其他任務直接使用。

### storage.py

- `read_json(path, default=None)`：檔案不存在 → `default`；`PermissionError` 重試 5 次（間隔 0.1 秒）仍失敗 → `default`；JSON 壞掉 → `default`。`encoding="utf-8"`。
- `read_json_strict(path)`：失敗時丟例外（給 `integration.py` 用，不得覆寫壞掉的 settings）。
- `write_json_atomic(path, data)`：建立父目錄，寫同目錄暫存檔再 `os.replace`；`PermissionError` 重試 10 次、間隔 0.2 秒。`ensure_ascii=False, indent=2`。

### accounts.py

Slot 格式：
```json
{"id": "a1b2c3", "name": "主帳號", "email": "x@y", "account_uuid": "...",
 "credentials": { ...整個 .credentials.json... },
 "oauth_account": { ...oauthAccount... },
 "saved_at": 1731480000, "exhausted_until": 0}
```

- `AccountError(Exception)`。
- `list_slots() -> list[dict]`：依 `saved_at` 排序。
- `get_slot(slot_id) -> dict | None`、`update_slot(slot)`。
- `current_account() -> dict | None`：`claude_json()` 的 `oauthAccount`。
- `match_slot(oauth_account) -> dict | None`：有 `accountUuid` 時比對 `account_uuid`；沒有時比對 `emailAddress` 與 `email`。
- `current_slot_id() -> str | None`：`match_slot(current_account())`。**這是目前帳號的唯一依據。**
- `save_current(name) -> dict`：讀 `cred_file()` 與 `oauthAccount`；任一缺少 → `AccountError("找不到目前登入的帳號，請先在 claude 中 /login")`。`match_slot` 找到時更新該 slot（保留 id 與 `exhausted_until`），否則新建（id = `secrets.token_hex(3)`）。
- `sync_current_back() -> bool`：目前帳號對應某 slot，且 `cred_file()` 讀得到、含 `claudeAiOauth`、內容與 slot 不同 → 寫回 slot（含 `oauth_account`），回傳 True。
- `switch_to(slot_id)`：
  1. `sync_current_back()`。
  2. `write_json_atomic(cred_file(), slot.credentials)`。
  3. 讀 `claude_json()`，只替換 `oauthAccount` 後寫回；檔案不存在時跳過。
  4. 重讀 `cred_file()` 驗證與 slot 相同，不同 → `AccountError`。
  5. 寫 `active.json` `{"switched_at": time.time()}`。
- `delete_slot(slot_id)`：`slot_id == current_slot_id()` → `AccountError`。
- `mark_exhausted(slot_id, until_ts)`、`clear_exhausted(slot_id)`。

### switchplan.py（純函式）

- `pick_next(slots, current_id, now) -> dict | None`：從 `current_id` 之後依序循環，回傳第一個 `id != current_id` 且 `exhausted_until <= now` 的 slot。
- `earliest_reset(slots, now) -> float | None`：所有 `exhausted_until > now` 中最小值；沒有則 None。

### integration.py

`settings.json` 加入（路徑一律用正斜線，避免 bash 吃掉反斜線）：
```json
"statusLine": {"type": "command", "command": "\"C:/.../python.exe\" \"C:/.../switcher/statusline.py\""},
"hooks": {
  "Stop": [{"hooks": [{"type": "command", "command": "\"C:/.../python.exe\" \"C:/.../switcher/hook.py\" stop"}]}],
  "StopFailure": [{"matcher": "rate_limit", "hooks": [{"type": "command", "command": "\"C:/.../python.exe\" \"C:/.../switcher/hook.py\" stopfailure"}]}]
}
```
- python 路徑：`sys.executable`；檔名是 `pythonw.exe` 時改用同目錄的 `python.exe`。
- 本程式的項目以 command 含 `switcher/statusline.py` 或 `switcher/hook.py` 辨識。
- `install()`：`read_json_strict`（檔案不存在當作 `{}`）；備份到 `backups/`；原本有非本程式的 `statusLine` → 存入 `integration.json`；先移除舊的本程式項目再加入（可重複安裝）；其他鍵與其他 hook 原樣保留。
- `uninstall()`：備份；移除本程式的 hook 項目（matcher group 的 `hooks` 空了就刪 group，陣列空了刪鍵，`hooks` 空了刪鍵）；`statusLine` 是本程式的 → 還原 `integration.json` 原值或刪除。
- `is_installed() -> bool`。
- 函式接受可選參數 `python_exe`、`project_root` 方便測試。

### statusline.py（Claude Code 執行；快、不得丟例外）

- 開頭：把 `paths.project_root()` 等價的路徑（本檔的上兩層）加入 `sys.path`；`sys.stdout.reconfigure(encoding="utf-8")`。
- 讀 stdin JSON；`slot_id = accounts.current_slot_id()`。
- 寫 `usage/<session_id>.json`：`{"session_id": str, "cwd": str, "slot_id": str|null, "ts": float, "five_hour": {"used_percentage": float, "resets_at": float}|null, "seven_day": 同上|null}`。
- stdout 一行：`[<slot 名稱或 未儲存>] 5h 42% · 7d 10%`，缺資料顯示 `--`。
- 全部 try/except，失敗印 `[switcher]`，exit 0。

### hook.py

- 開頭同 statusline。參數 `stop` 或 `stopfailure`。
- 寫 `events/<time.time_ns()>-<secrets.token_hex(2)>.json`：`{"kind": "stop"|"stopfailure", "session_id", "cwd", "error": str|null, "slot_id": current_slot_id(), "ts": float}`。
- 不印 stdout，exit 0，例外吞掉。

### usage.py

- `latest_usage(slot_id, since=0.0) -> dict | None`：`usage/` 中 `slot_id` 相符、`ts >= since` 的最新一筆（格式同 statusline 寫入）。
- `is_stale(record, now, max_age=600) -> bool`。
- `read_new_events(after_name: str | None) -> tuple[list[dict], str | None]`：回傳檔名大於 `after_name` 的事件（依檔名排序，每筆加上 `"_name"`），以及最新檔名（沒有新事件時回傳原 `after_name`）。
- `cleanup(now, max_age=86400)`：刪除過舊的 usage 與 events 檔。

### procutil.py

- `NO_WINDOW = subprocess.CREATE_NO_WINDOW`，所有背景 subprocess 都要帶。
- `pid_alive(pid) -> bool`：ctypes `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetExitCodeProcess == STILL_ACTIVE(259)`。
- `kill_tree(pid) -> bool`：`taskkill /PID <pid> /T /F`（`creationflags=NO_WINDOW`，stdout/stderr 丟棄）；回傳之後 `pid_alive` 為 False。

### runner.py（在 Windows Terminal 中執行）

`python -m switcher.runner --run-id <id> --cwd <folder> [--continue] [--claude <path>]`

`--claude` 預設 `shutil.which("claude")`；找不到 → 印錯誤、`input()` 等 Enter、結束。

state 檔（runner 寫）：`{"run_id", "cwd", "runner_pid", "claude_pid": int|null, "state": "running"|"waiting"|"exited", "updated": float}`。
cmd 檔（GUI 寫）：`{"restart": "pending"|"go"|"abort", "seq": int}`。

迴圈：
1. `Popen([claude, *args], cwd=folder)`（繼承主控台）；寫 state `running` 與 `claude_pid`。
2. `wait()` 後讀 cmd 檔：
   - 不存在或 `restart` 不是 `pending`／`go` → state `exited`，結束。
   - `pending`：state `waiting`；每 0.5 秒重讀，最多 120 秒。等到 `go` → 進第 3 步；`abort` 或逾時 → 印訊息，state `exited`，結束。
   - `go` → 第 3 步。
3. 刪除 cmd 檔，印 `[switcher] 已切換帳號，以 claude --continue 重新啟動…`，args 加上 `--continue`，回第 1 步。

`main(argv) -> int` 可被測試直接呼叫。`--claude` 讓測試注入 `tests/fake_claude.py`：路徑以 `.py` 結尾時用 `[sys.executable, path]` 執行。測試另需 `--no-pause`（找不到 claude 時不等 Enter）與 `--wait-timeout <秒>`（預設 120）。

### launcher.py

- `launch(folder, cont=False) -> str`（run_id = `secrets.token_hex(4)`）：
  - 資料夾含 `;` → `ValueError`（wt 會把 `;` 當子命令分隔）。
  - 指令以 list 傳：`["wt.exe", "-w", "new", "--title", "Claude (switcher)", "-d", folder, python_exe, "-m", "switcher.runner", "--run-id", id, "--cwd", folder, (+ "--continue")]`。
  - 環境：`PYTHONPATH=project_root()`、`PYTHONUTF8=1`。
  - 找不到 `wt.exe` → 改 `[python_exe, "-m", "switcher.runner", ...]` + `CREATE_NEW_CONSOLE`。
- `active_runs() -> list[dict]`：state 檔中 `state != "exited"` 且 `pid_alive(runner_pid)`；其餘的 state／cmd 檔刪除。
- `request_restart(run) -> bool`：寫 cmd `pending`；`claude_pid` 存活 → `kill_tree`；回傳 claude 是否已結束。
- `release_restart(run)`：寫 cmd `go`。`abort_restart(run)`：寫 cmd `abort`。

### monitor.py（純邏輯）

```python
@dataclass
class Action:
    kind: str                # "none" | "pending" | "switch_now"
    reason: str = ""         # 中文說明
    exhausted_until: float = 0.0
```

`Monitor(threshold: float = 95, pending_timeout: float = 600)`：
- `tick(now, active_slot_id, usage_record, events) -> Action`
  - `usage_record`：`usage.latest_usage(active_slot_id, since=self.since)` 的結果（呼叫端負責篩選）。
  - `events`：本次新事件（呼叫端用水位線去重）；monitor 只採用 `slot_id == active_slot_id` 且 `ts >= self.since` 的事件。
  - `usage_record` 的 `slot_id != active_slot_id` 或 `ts < self.since` → 視為 None。
  - 規則：
    1. 有 `kind=="stopfailure"` 且 `error=="rate_limit"` → `switch_now`；`exhausted_until` = 用量紀錄中超過門檻視窗的最大 `resets_at`，沒有則 `now + 5*3600`。
    2. 用量 `five_hour` 或 `seven_day` 的 `used_percentage >= threshold` → 進入（或維持）pending，記住 `exhausted_until`（超過門檻視窗中最大的 `resets_at`）與開始時間；回傳 `pending`。
    3. pending 中，用量紀錄存在且兩個視窗都低於門檻 → 取消 pending，回傳 `none`。
    4. pending 中，有 `stop` 或 `stopfailure` 事件 → `switch_now`。
    5. pending 超過 `pending_timeout` → `switch_now`。
- `reset(since: float)`：清除 pending，`self.since = since`。

### gui.py

單一視窗（`tk.Tk` + `ttk`），標題「Claude 帳號切換器」：

1. **帳號**：`ttk.Treeview`（名稱、Email、狀態：`使用中`／`可用`／`用完，MM/DD HH:MM 重置`）；按鈕：儲存目前登入的帳號（`simpledialog.askstring`）、切換到選取帳號、刪除（`messagebox.askyesno`）、重新整理。目前登入的帳號沒有對應 slot 時顯示「目前登入的帳號尚未儲存」。
2. **用量**：目前帳號 5 小時、7 天：`ttk.Progressbar` + `42%，MM/DD HH:MM 重置`；沒資料或過舊時顯示提示。
3. **啟動**：資料夾 Entry + 瀏覽 + 「啟動 claude」+「啟動（--continue）」；託管中的視窗數。
4. **自動切換**：Checkbutton「額度用完自動切換」、門檻 Spinbox（50–100，預設 95）。
5. **整合**：已安裝／未安裝 + 安裝／移除按鈕。
6. **事件紀錄**：唯讀 `tk.Text`，`HH:MM:SS 訊息`。

輪詢 `root.after(3000, tick)`：
1. `switching` 旗標為 True → 跳過（只更新畫面）。
2. `accounts.sync_current_back()`（保存 refresh 後的 token）。
3. `usage.latest_usage(current, since=monitor.since)`；`usage.read_new_events(watermark)` 更新水位線（GUI 啟動時水位線設為目前最新事件檔名，忽略舊事件）。
4. 自動切換開啟時 `monitor.tick(...)`；`pending` 時事件紀錄寫一次「已達門檻，等待回合結束後切換」；`switch_now` → `start_switch(reason, exhausted_until, auto=True)`。
5. 每 10 分鐘 `usage.cleanup`。

`start_switch(target=None, reason, exhausted_until=None, auto)`：
1. `switching = True`。
2. 自動：`mark_exhausted(current, exhausted_until)`；`target = switchplan.pick_next(...)`；沒有 → 事件紀錄 + `messagebox.showwarning`（同一次耗盡只跳一次）顯示 `earliest_reset`，`monitor.reset(now)`，`switching = False`，結束。
3. `runs = active_runs()`；每個 `request_restart`。
4. 用 `after(500)` 非阻塞輪詢，等所有 `claude_pid` 結束，最多 10 秒。逾時 → 每個 run `abort_restart`，事件紀錄「切換中止：claude 未結束」，`switching = False`，結束（不切換，避免覆寫正在寫入的憑證）。
5. `accounts.switch_to(target)`；失敗 → `abort_restart`、錯誤訊息、`switching = False`。
6. `monitor.reset(time.time())`；每個 run `release_restart`；事件紀錄「切換：A → B（原因）」；`switching = False`。

手動切換：有託管中的 run 時詢問是否一併重啟（是 → 同上 3–6；否 → 直接 `switch_to`）。所有切換都提醒（只在事件紀錄）：「非本程式啟動的 claude 不會切換」。

設定變更存 `config.json`：`{"threshold": 95, "auto_switch": true, "last_folder": ""}`。

所有操作 try/except，錯誤 `messagebox.showerror` + 事件紀錄。

## 任務

| 任務 | 內容 | 相依 |
|---|---|---|
| T-0 | `paths.py`、`storage.py`、`__init__.py`（主導者） | — |
| T-1 | `config.py`、`accounts.py`、`switchplan.py` + `tests/test_accounts.py`、`tests/test_switchplan.py` | T-0 |
| T-2 | `integration.py`、`statusline.py`、`hook.py`、`usage.py` + `tests/test_integration.py`、`tests/test_usage.py`（statusline／hook 用 subprocess 以 stdin 餵 JSON 測試） | T-0；statusline／hook 會 import `accounts.current_slot_id`，T-1 先完成或同時進行時以介面為準 |
| T-3 | `monitor.py`、`procutil.py`、`runner.py`、`launcher.py`、`tests/fake_claude.py` + `tests/test_monitor.py`、`tests/test_runner.py`（假 claude：restart 流程、abort、無 cmd 結束） | T-0、T-1 |
| T-4 | `gui.py`、`__main__.py`、`README.md` | T-1～T-3 |

T-1、T-2 平行；T-3 在 T-1 完成後；T-4 最後。

## AC 驗證方式

| AC | 驗證 |
|---|---|
| AC-1、AC-2、AC-4 | `test_accounts.py`；使用者操作 GUI |
| AC-3 | `test_accounts.py`（寫回、替換、`.claude.json` 其他鍵保留、驗證）；使用者在新 claude `/status` |
| AC-5 | `test_usage.py`（statusline 寫入、過舊判斷）；使用者實測 |
| AC-6 | `test_runner.py`（runner 啟動假 claude）；使用者實測 wt |
| AC-7 | `test_monitor.py`（門檻、pending、取消、hook、逾時、slot 篩選）、`test_runner.py`（pending→go 以 --continue 重開）；使用者實測（門檻調低） |
| AC-8 | `test_switchplan.py`（全部用完回傳 None、earliest_reset） |
| AC-9 | `test_integration.py`（保留其他鍵、重複安裝、移除還原原 statusLine、壞 JSON 不覆寫、正斜線路徑） |

全部完成後：`python -m unittest discover -s tests -v` 與 `python -m compileall -q switcher tests`。

## 邊界情況與風險

- **非託管的 claude**（VS Code 擴充套件、其他終端）：不會被重啟，且可能 refresh 舊帳號 token、改寫 `.credentials.json`／`.claude.json`。README 註明切換前關閉其他 claude。
- **強制結束 claude**：門檻觸發時等回合結束才切換；`kill_tree` 會一併結束 MCP server（重開後會重新啟動）。
- **token refresh 競爭**：每次 tick 與切換前 `sync_current_back`。
- **使用者 /login 換帳號**：`current_slot_id` 依 `.claude.json`，GUI 顯示「尚未儲存」。
- **`--continue` 接錯對話**：同一資料夾同時開多個 claude 時可能接錯；README 註明。
- **statusline 沒有 rate_limits**：只靠 hook 備援。
- **Stop hook 延遲**：每回合多啟動一次 python（約 50–100 ms），可接受。

## 回退

GUI「移除整合」還原 settings.json；備份在 `%USERPROFILE%\.claude-switcher\backups\`。刪除 `%USERPROFILE%\.claude-switcher` 即完全移除。

## 審查紀錄

2026-11-13 Sonnet 規格審查，16 條：

- 採用：1（切換中旗標、slot_id 篩選、事件水位線）、2（taskkill 失敗處理、確認存活；本機 claude 為原生 exe，非 shim）、3（等待逾時改為中止切換、切換後驗證憑證）、4（每次 tick `sync_current_back`）、5（假 claude 測 runner）、6（`switchplan.py` 純函式）、7（正斜線、list 傳參、拒絕含 `;` 的資料夾）、8（`CREATE_NO_WINDOW`、改用 ctypes 判斷存活）、9（stdout UTF-8）、10（讀端重試、事件檔名排序）、11a（用量降回門檻以下取消 pending）、11d（顯示日期）、12（`current_slot_id` 為唯一依據，`active.json` 只當水位線）、13、14（`Action` dataclass、輸入格式）、15（paths／storage 先由主導者完成）、16（run 檔拆成 state／cmd）。
- 不採用：11b（只有 `rate_limit` 代表額度用完，其他錯誤切換帳號無用）、11c（hook `async` 欄位未查證；延遲可接受）。

## 實作偏差

- accounts：`switch_to` 找不到 slot 丟 `AccountError`；`.claude.json` 壞掉時丟例外不覆寫；sync 後重讀目標 slot。
- integration：備份檔名用 `time_ns`；settings 不是物件時丟 `ValueError`；重複安裝不覆寫已保存的原 statusLine。
- statusline：usage 檔名把 session_id 的特殊字元換成 `_`。
- monitor：同一次 tick 進入 pending 且有 stop 事件時直接 `switch_now`。
- launcher：`launch()` 多 `popen`、`wt_path` 參數（測試注入）；cmd 檔 seq 遞增。
- gui：目前帳號未儲存時不自動切換；手動切換不重啟時直接 `switch_to`；決策邏輯抽成 `decide()`、`slot_status()`、`fmt_ts()`。
- 新增 `啟動切換器.bat`。
