# 規格：GUI 內以瀏覽器（Google）登入新增帳號

需求見 `1-requirements.md`。

## 已確認的事實（2026-11-13 本機實測 claude 2.1.322）

- `claude auth login`（預設 `--claudeai`）在 `CLAUDE_CONFIG_DIR=<暫存目錄>` 下執行，只會在該目錄建立 `.claude.json` 等檔案，不動到 `~/.claude`。
- 它會以環境變數 `BROWSER` 指定的程式開啟授權網址：以一個參數（含雙引號的完整網址）呼叫該程式。網址的 `redirect_uri` 是 `http://localhost:<port>/callback`，使用者在瀏覽器完成授權後 claude 會自動收到 code、不需貼上。
- stdout（非 TTY 時）會印出 `If the browser didn't open, visit: <url>`（這個網址的 redirect 是 `platform.claude.com`，需要手動貼 code，只當備援顯示），以及 `Paste code here if prompted >`。
- 未實測：登入成功後憑證檔名與位置。預期為 `<暫存目錄>/.credentials.json`，帳號資訊在 `<暫存目錄>/.claude.json` 的 `oauthAccount`。實作時找不到就回報 AC-6 的錯誤，並把暫存目錄的檔名清單寫入事件紀錄（不含內容），方便使用者回報。
- Edge 位置：`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe` 的預設值（本機為 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）。

## 設計

### 新檔：switcher/browser_open.py

由 claude 透過 `BROWSER` 呼叫：`python browser_open.py "<url>"`。

1. 開頭把專案根目錄加入 `sys.path`（同 statusline.py 寫法）。
2. 取 `sys.argv[1:]` 合併、去掉前後引號與空白得到網址；不是 `http` 開頭 → exit 1。
3. 把網址寫入環境變數 `CLAUDE_SWITCHER_LOGIN_DIR` 指定目錄下的 `browser_url.txt`（變數不存在時跳過）。
4. 找 Edge：先讀登錄檔 App Paths（`winreg`），再試兩個預設路徑（`Program Files (x86)` 與 `Program Files`）。找到 → `subprocess.Popen([msedge, "--inprivate", url], creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)`；找不到 → `webbrowser.open(url)`。
5. 例外吞掉，exit 0（開啟失敗時 GUI 仍可用「複製登入網址」）。

函式 `extract_url(argv) -> str | None`、`find_edge() -> str | None`、`open_url(url, popen=..., web_open=...) -> str`（回傳 `"edge"` 或 `"default"`）可單元測試。

### 新檔：switcher/login.py

```python
class LoginError(Exception): ...

class LoginSession:
    def __init__(self, claude_cmd: list[str] | None = None, popen=subprocess.Popen): ...
    def start(self) -> None
    def poll(self) -> str          # "running" | "done" | "failed"
    def login_url(self) -> str | None   # browser_url.txt 內容；沒有時用 stdout 擷取的備援網址
    def result(self) -> tuple[dict, dict]   # (credentials, oauth_account)；讀不到 → LoginError
    def cancel(self) -> None       # kill_tree + cleanup
    def cleanup(self) -> None      # 刪除暫存目錄（重試 3 次，忽略錯誤）
```

- `start()`：
  - 暫存目錄 `paths.app_dir()/login/<token_hex(4)>`。
  - 在該目錄寫 `open_browser.cmd`：`@"<python.exe>" "<project_root>\switcher\browser_open.py" %*`（python 用 `integration` 同樣的 pythonw → python.exe 規則；可抽一個共用函式 `paths.python_exe()`，但不得改變 integration 既有行為與測試）。
  - 環境：複製 `os.environ`，設 `CLAUDE_CONFIG_DIR=<目錄>`、`BROWSER=<目錄>\open_browser.cmd`、`CLAUDE_SWITCHER_LOGIN_DIR=<目錄>`、`PYTHONUTF8=1`。
  - 指令：`claude_cmd` 預設 `[shutil.which("claude"), "auth", "login"]`；找不到 claude → `LoginError("找不到 claude 指令")`。
  - `Popen(..., stdin=PIPE, stdout=PIPE, stderr=STDOUT, creationflags=procutil.NO_WINDOW, env=env, cwd=<目錄>)`；背景 daemon thread 讀 stdout（utf-8, replace），用 regex `https://\S+` 擷取第一個網址當備援。
- `poll()`：程序還在 → `running`；結束且 exit code 0 → `done`；否則 `failed`。
- `result()`：讀 `<目錄>/.credentials.json`（需含 `claudeAiOauth`）與 `<目錄>/.claude.json` 的 `oauthAccount`；任一缺 → `LoginError`，訊息含目錄內的檔名清單。

### accounts.py 修改

- 新增 `add_slot(name, credentials, oauth_account) -> dict`：與 `save_current` 相同的新增／更新邏輯（`match_slot` 找到就更新、保留 id 與 `exhausted_until`）；`save_current` 改為讀檔後呼叫 `add_slot`（行為不變，既有測試必須全過）。
- `add_slot` 不碰 `cred_file()`。

### gui.py 修改

- 帳號區新增按鈕「新增帳號（瀏覽器登入）」，放在「儲存目前登入的帳號」前面。
- 按下：
  1. 已有登入進行中 → 不動作。
  2. `LoginSession().start()`；失敗 → showerror。
  3. 開 `tk.Toplevel`「瀏覽器登入」：說明文字「已開啟 Edge InPrivate 視窗，請在瀏覽器中登入（可選 Google）。完成後此視窗會自動關閉。」、按鈕「複製登入網址」（`clipboard_clear/append`，沒有網址時提示稍候）、「取消」；關閉視窗等同取消。
  4. `after(1000)` 輪詢 `poll()`：
     - `done` → `result()` → `simpledialog.askstring("帳號名稱", ..., initialvalue=email)`（取消則用 email）→ `accounts.add_slot`；若新 slot 的 id 等於 `current_slot_id()` → 同時 `write_json_atomic(cred_file(), creds)` 並在事件紀錄寫「登入的是目前使用中的帳號，已更新憑證；執行中的 claude 若出現 Login expired 請重開」。之後 `cleanup()`、關 Toplevel、refresh、事件紀錄「已新增帳號 <名稱>（<email>）」。
     - `failed` → 取得 stdout 最後 5 行寫入事件紀錄、showerror、cleanup。
     - 超過 300 秒 → `cancel()`、事件紀錄「登入逾時」。
  5. GUI 關閉（`WM_DELETE_WINDOW`）時若有登入進行中 → `cancel()`。
- GUI 啟動時刪除 `app_dir()/login/` 下殘留的目錄（上次異常結束）。

### README.md

「第一次設定」改為建議用「新增帳號（瀏覽器登入）」新增所有帳號；保留 `/login` + 儲存目前帳號作為替代方式。說明會開 Edge InPrivate，可選 Google 登入。

## 任務

| 任務 | 內容 |
|---|---|
| T-1 | `browser_open.py`、`login.py`、`accounts.add_slot`、`gui.py` 修改、README；測試 `tests/test_login.py`（`extract_url`、`open_url` 注入、`LoginSession` 用假登入腳本 `tests/fake_login.py`：讀 `CLAUDE_CONFIG_DIR` 寫出 `.credentials.json` 與 `.claude.json` 後 exit 0；失敗情境 exit 1；缺憑證 → LoginError；cancel 與 cleanup 刪目錄）、`test_accounts.py` 加 `add_slot` 測試 |

## AC 驗證方式

| AC | 驗證 |
|---|---|
| AC-1、AC-5 | `test_login.py`（open_url 注入：有 Edge 帶 `--inprivate`、無 Edge 走預設）；使用者實測 |
| AC-2 | `test_login.py`（cancel 刪目錄）；使用者實測 |
| AC-3、AC-6 | `test_login.py`（假登入成功／缺檔）；使用者實測 Google 登入 |
| AC-4 | `test_accounts.py`（add_slot 不動 cred_file）；使用者實測 |

## 風險

- 未實測完成登入後的憑證位置：以 AC-6 錯誤訊息揭露，使用者第一次實測時確認。
- `BROWSER` 由 claude 解讀：若未來版本不再遵守，claude 會自己開預設瀏覽器；流程仍可完成，只是不是 InPrivate。
- 暫存目錄路徑含空白時 `.cmd` 內有引號處理；`BROWSER` 本身路徑含空白未實測。

## 審查紀錄

規模小（1 個實作任務），未送規格審查；實作後跑完整測試。

## 實作偏差

- 新增 `paths.python_exe()`、`paths.login_dir()`；integration 改用 `paths.python_exe()`（行為不變）。
- `open_browser.cmd` 加 `@chcp 65001 >nul`，UTF-8 寫入。
- `find_edge` 依序查 HKLM、HKCU App Paths，再試預設路徑；`open_url` 多可選參數 `edge`（測試注入）。
- 逾時另跳 `showwarning`；GUI 關閉時取消登入後 `root.destroy()`。
- 結果：71 個 unittest 通過；真實 Google 登入待使用者實測。
