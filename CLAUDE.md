# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案

Windows 專用的 Claude Code 多帳號切換器。管理多個訂閱帳號的 OAuth 憑證、顯示所有帳號用量、額度用完時自動切換並以 `claude --continue` 重開。

- **`app/`：目前版本**（Electron + React + Vite + Tailwind v4 + shadcn/ui，TypeScript）。
- `switcher/`：舊 Python／tkinter 版，保留作備援，也是 `app/src/core` 移植時的行為參考實作。兩版共用 `%USERPROFILE%\.claude-switcher` 與相同檔案格式。
- 需求／規格／審查紀錄：`docs/work/<slug>/`（`account-switcher`、`google-login` 為 Python 版；`electron-rewrite` 為目前版本）。專案紀錄 `docs/PROJECT_LOG.md`（每次對話結束前更新）。

## 指令（在 `app/` 下；PATH 需含 Node 22+，本機為 `C:\Program Files\nodejs`）

```powershell
npm run dev            # 開發執行（先打包 scripts）
npm test               # vitest；globalSetup 會先跑 build:scripts
npx vitest run tests/monitor.test.ts            # 單一檔案
npx vitest run tests/oauth.test.ts -t "429"     # 單一測試（名稱比對）
npm run typecheck      # node 與 web 兩份 tsconfig
npm run build          # build:scripts + electron-vite build
npm run package        # portable exe → dist/
```

畫面驗證（不碰真實帳號）：設定 `CLAUDE_SWITCHER_HOME`、`CLAUDE_SWITCHER_CLAUDE_HOME`、`CLAUDE_SWITCHER_CLAUDE_JSON` 指向假資料目錄、`CLAUDE_SWITCHER_DISABLE_POLL=1`（不打用量 API）、`CLAUDE_SWITCHER_SCREENSHOT=<png>`（可加 `CLAUDE_SWITCHER_SCREENSHOT_SIZE=1280x820`、`CLAUDE_SWITCHER_SCREENSHOT_PAGE=<page>`，例如 `accounts`、`settings/general`、`settings/routing`），再 `npx electron-vite preview`：載入 4 秒後截圖並結束（截圖模式不建系統匣、不取單一實例鎖、不改開機啟動登錄）。要讓「Claude CLI」清單有資料，另設 `CLAUDE_SWITCHER_FAKE_CLIS=<ProcInfo[] JSON 檔>`（假程序表；kill／inject 為 no-op）。

Python 版：`python -m unittest discover -s tests -v`（在專案根目錄）。

## 架構（app/）

- `src/core/`：純 Node 模組，**不得 import electron**，vitest 直接測。由 Python 版逐一移植（函式 camelCase，檔案欄位維持 snake_case）。`oauth.ts` 是新增的：用量 API（`api.anthropic.com/api/oauth/usage`）與 token refresh（`platform.claude.com/v1/oauth/token`），皆為未公開介面。
- `src/scripts/`：`statusline`、`hook`、`runner`、`browser-open`、`switcher-run`，esbuild 打包成單檔 `resources/scripts/*.cjs`（`*.ps1` 原樣複製：`inject.ps1`、`agycred.ps1`，註解只能用英文，因 PowerShell 5.1 以系統碼頁讀無 BOM 檔）。只能 import 不含 electron 的 core 模組；statusline／hook 只用 `core/paths|storage|usage|accounts|sessions`；`switcher-run` 另可用 `routing|agycred|agyaccounts|filelock|procutil|dispatchlog|claudeavail|accounts|config`，不得 import `oauth`（不做網路，額度只讀 GUI 寫的快取）。執行時先由 `nodebin.installScripts()` 以 SHA-256 比對複製到 `~/.claude-switcher/bin/`，再由**系統 node** 執行（settings.json 指令、wt 啟動 runner、登入時的 `BROWSER`）。不用 Electron 執行檔，因為 portable exe 每次解壓路徑不同。
- `src/main/controller.ts`：所有流程（3 秒 tick、用量輪詢、自動／手動切換、登入），依賴全部可注入、不 import electron；`src/main/index.ts` 只負責 IPC 與注入 electron API。
- 主程序 `src/main/index.ts`：單一實例、系統匣（`close_to_tray`）、開機自動啟動（`launch_at_login` → `setLoginItemSettings`，路徑用 `PORTABLE_EXECUTABLE_FILE`，參數 `--hidden` 以背景啟動；未打包時不改登錄）。關閉／系統匣決策是 `src/main/trayPolicy.ts` 的純函式。畫面為左側導覽（`NavSidebar`）＋頁面（`src/renderer/src/pages/`），帳號頁依公司分組（Anthropic、Google）。
- `src/shared/types.ts`：IPC 契約（`AppState`、`Api`、`IPC` channel 常數），main／preload／renderer 共用。
- 程序間只透過 `~/.claude-switcher` 下的 JSON 檔溝通：statusline → `usage/` 與 `pidmap/<session>.json`（session ↔ claude PID ↔ 父 shell，每個 session 查一次程序表）、hook → `events/<time_ns>-<hex>.json`（檔名即水位線；kind 為 `prompt`／`stop`／`stopfailure`）、poller → `usage_api/`、runner 擁有 `runs/<id>.state.json`、controller 擁有 `runs/<id>.cmd.json`。
- session 對應以 Claude Code 自己的 `<claudeHome>/sessions/<pid>.json` 為主（`procStart` 為 FILETIME，需與程序 CreationDate 相符；同目錄的 `.key` 檔含 peerToken，不得讀取），pidmap 為舊版後備。用量 API 與 token refresh 由 main 注入 Electron `net.fetch`（使用者網路有 TLS 攔截，Node fetch 會 `SELF_SIGNED_CERT_IN_CHAIN`）。
- 外部 CLI（`core/sessions.ts`、`core/coninject.ts`）：controller 每 15 秒掃描程序表並以 pidmap 對應 session。切換時先掃描，再結束所有互動式 claude，換帳號後以 `claude --resume <session>` 接續：父程序是 PowerShell／cmd 時用 `inject.ps1`（`AttachConsole`＋`WriteConsoleInput`）寫回原視窗，否則開新 wt 分頁由 runner 託管。中斷的回合附上 `continue_prompt`。claude 執行 hook／statusline 時中間隔著數層 `bash.exe`，所以腳本的 `ppid` 不是 claude。
- 切換方式 `switch_mode`：`live`（預設）只換憑證檔——Claude Code 每次請求前比對 `.credentials.json` 的 mtime 並重讀（2.1.323 實測），執行中的 claude 不需重啟；rate_limit 停下的 session 以 `coninject.injectSubmit`（文字與 Enter 分兩次送）輸入 `continue_prompt`；切換後 30 秒內的 stopfailure 不再觸發切換。`restart` 為上述結束並 `--resume` 的流程。
- statusline 腳本測試時設 `CLAUDE_SWITCHER_DISABLE_PIDMAP=1`，以免呼叫真的 PowerShell。

## agy（Antigravity CLI）與模型分工

- agy 登入存在 Windows 認證管理員 `gemini:antigravity`（JSON blob：`token{access_token,refresh_token,expiry}`、`id_token_email`），由 `agycred.ps1`／`core/agycred.ts` 讀寫；slot 在 `~/.claude-switcher/agy/slots/`。本程式**不 refresh agy token**（使用者選擇；取用 agy 內嵌 OAuth secret 被權限機制拒絕）。
- 切換 agy 帳號或新增帳號前必須沒有 `agy.exe` 在執行（執行中的 agy 會把自己的 token 寫回認證管理員），並持有跨程序檔案鎖 `agy/agy.lock`（`core/filelock.ts`；`withSlotLock` 只在單一程序內有效）。新增帳號流程先把目前登入寫入 `agy/login-backup.json`，啟動時發現此檔會還原。
- agy 額度：`daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`，必須帶 `User-Agent: antigravity/<版本> windows/amd64`（否則 403）；由 GUI 以 `net.fetch` 查詢並寫 `agy/quota/<slot>.json`。
- `~/.claude-switcher/routing.json`：dev-workflow 各階段的供應商／模型備援清單（`core/routing.ts`）。`switcher-run.cjs` 依它與額度快取派工給 agy，輪到 Claude 時 exit 10（delegate）。額度錯誤只認結構化字樣（`RESOURCE_EXHAUSTED` 等），exit 0 且有輸出一律成功。
- 自動整理上下文（`auto_compact`）：statusline 記錄 `context_window`；controller 在回合結束、閒置、有新 prompt（整理後 30 秒外）且超過門檻時送 `/compact`／`/clear`。

## 不變條件

- 目前帳號的唯一依據是 `accounts.currentSlotId()`（比對 `~/.claude.json` 的 `oauthAccount`）。
- `accounts` 是同步 API 且不自帶鎖：主程序所有寫 slot 的路徑都要包 `withSlotLock(slotId, …)`，poller 的 refresh 也用同一把；切換期間 poller 暫停。
- **使用中帳號的 token 絕不由本程式 refresh**（會和執行中的 claude 搶 refresh token 輪替）；只 refresh 非使用中帳號，寫回時只替換 `credentials.claudeAiOauth`。
- 切換順序：`requestRestart`（寫 pending + `killTree`）→ 等 claude 結束（10 秒逾時就 abort，不切換）→ `switchTo`（先 `syncCurrentBack` 存回 refresh 後的 token）→ `releaseRestart`。
- 寫檔一律 `storage.writeJsonAtomic`；壞掉的 settings／`.claude.json` 不得覆寫（`readJsonStrict`）。
- 路徑一律透過 `core/paths` 函式取得（每次讀環境變數）；測試用 `tests/helpers.ts` 的 `useTempEnv` 隔離，絕不碰真實 `~/.claude`、`~/.claude.json`、`~/.claude-switcher`，也不得對真實 API 發請求（注入假 fetch）、不得啟動真正的 claude／wt／瀏覽器（用 `tests/fixtures/fake-*.cjs`）。
- token 不得出現在 log、事件紀錄、錯誤訊息。
- settings.json 指令路徑用正斜線；`open_browser.cmd` 內 `%` 要跳脫成 `%%`。
- shadcn 元件手動放在 `src/renderer/src/components/ui/`（shadcn CLI 曾誤裝名為 `cn` 的套件）。
