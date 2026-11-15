# 專案紀錄：Claude 帳號切換器

## 專案介紹

- **名稱**：Claude 帳號切換器（Switching_account）
- **目標**：管理多個 Claude Code 訂閱帳號、一次看到所有帳號用量；一個帳號的 5 小時或每週額度用完時，自動切換到另一個帳號，並以 `claude --continue` 接續原本的對話。
- **技術**：
  - 目前版本 `app/`：Electron 44 + React 19 + Vite 8 + Tailwind CSS 4 + shadcn/ui（TypeScript），Node v26；vitest；electron-builder portable exe。
  - 舊版 `switcher/`：Python 3.13 + tkinter（保留備援）。
- **Repo**：https://github.com/gordonpow/Switching_account（公開；本機 `C:\presonal_project\Switching_account`）。agy 執行紀錄（`*.agy.log`）與 `img/` 截圖含帳號資訊，列入 `.gitignore`。
- **架構重點**：
  - 帳號 slot 存在 `%USERPROFILE%\.claude-switcher\slots\`，切換時替換 `~/.claude/.credentials.json` 與 `~/.claude.json` 的 `oauthAccount`；兩版共用相同檔案格式。
  - 所有帳號用量：以各帳號 token 呼叫未公開的 `api/oauth/usage`；非使用中帳號 token 由程式 refresh，使用中帳號交給 Claude Code。
  - statusline 腳本寫入 `rate_limits`；`Stop`／`StopFailure` hook 寫入回合結束與額度錯誤事件；腳本以系統 node 執行（`~/.claude-switcher/bin/*.cjs`）。
  - runner 在 Windows Terminal 中託管 claude，切換時以 `--continue` 重開。
  - 文件：`docs/work/account-switcher/`、`google-login/`（Python 版）、`electron-rewrite/`（目前版本）。

## 新增功能

### 已發布

- **v1.1.0 預覽版**（2026-11-15）：https://github.com/gordonpow/Switching_account/releases/tag/v1.1.0 ，commit `638eaa9`，資產 `Claude-Account-Switcher-1.1.0.exe`（SHA-256 `0e677bcc…67f2`，與 GitHub `digest` 一致）。自動更新、模型分工設定引導、全部用完換到最早重置帳號、工作列圖示修正。
- **v1.0.0 預覽版**（2026-11-15）：GitHub Release https://github.com/gordonpow/Switching_account/releases/tag/v1.0.0 ，資產 `Claude-Account-Switcher-1.0.0.exe`（SHA-256 `bf99bcf2…cca2`，未簽章）。
初版 `488f0c7`（2026-11-15 推送）包含以下全部功能；之後：多國語言與程式圖示 `27b0ff8`、英文 README 與 model-routing skill `d67d0e7`。

- Python 版帳號切換器 GUI（AC-1～AC-9）：`switcher/`、`tests/`（71 個 unittest 通過）、`啟動切換器.bat`。
- Python 版 GUI 內瀏覽器（Google）登入新增帳號。
- Electron 版重寫（`app/`，AC-1～AC-11）：帳號卡片與所有帳號用量總覽、自動 token refresh、Chrome 無痕／Edge InPrivate／預設瀏覽器登入、託管與自動切換、整合安裝（移除 Python 版項目）、portable exe。135 個 vitest 通過、typecheck／build／package 通過、假資料環境截圖確認。
- 自動偵測並切換所有 Claude CLI（`docs/work/external-cli/`）：列出所有執行中 claude（含非本程式啟動的）、切換時結束並以 `claude --resume` 在原視窗（寫入 console 輸入）或新分頁接續、中斷的回合自動送「繼續」、保留原本選項。214 個測試通過、portable exe 已更新。

### 待辦

- 使用者實測外部 CLI 切換：更新整合、重開現有 claude；不重啟模式（換帳號後執行中 claude 用新帳號、rate_limit 停下的自動送「繼續」）；restart 模式的 herdr 原視窗接續。
- 使用者實測 Electron 版：瀏覽器登入新增兩個帳號、用量總覽（含非使用中帳號 refresh）、手動切換、安裝整合、託管 claude、調低門檻觸發自動切換。
- 實作 diff 審查（使用者要求驗證時）。
- Electron 版驗收後移除 Python 版。

## 對話紀錄

### 2026-11-13

- 使用者詢問如何做一個在額度用完時切換 Claude 帳號的程式 → 說明換憑證檔與 `CLAUDE_CONFIG_DIR` 兩種做法，以及偵測方式與條款風險。
- 使用者要求做 GUI → 選定 Python + tkinter、GUI 託管 claude 並自動切換、用 statusline 顯示用量；完成需求文件（AC-1～AC-9，AC-9 加入 Stop／StopFailure hook）與規格文件，送規格審查。
- 規格審查 16 條，採用 14 條、不採用 2 條（見規格「審查紀錄」）。
- 實作 T-0～T-4：帳號核心、整合／statusline／hook／用量、monitor／runner／launcher、GUI 與 README；61 個 unittest 全部通過、compileall 通過。功能面待使用者實測。
- 執行 `/init` 建立 `CLAUDE.md`。
- 使用者詢問能否用 Google 登入 → 可以；說明第二個帳號需用無痕視窗避免授權成已登入的帳號。
- 使用者要求在 GUI 內跳出瀏覽器登入 → 經同意實測 `claude auth login`：遵守 `BROWSER` 環境變數與 `CLAUDE_CONFIG_DIR`。實作「新增帳號（瀏覽器登入）」：暫存設定目錄執行登入、Edge InPrivate 開授權頁、完成後自動存成 slot（不切換）。71 個 unittest 通過，真實登入待使用者實測。
- 使用者詢問能否用 Chrome 登入 → 現有「複製登入網址」貼到 Chrome 無痕即可；提議加入瀏覽器選項（併入 Electron 版）。
- 使用者要求用 `npx ui-skills` 美化介面、一次看多個帳號用量 → 查明 ui-skills 為網頁前端設計指引；實測 `api/oauth/usage` 可用各帳號 token 查用量。使用者選擇自動 refresh token、不用 Python、改用 Electron + React + Vite + Tailwind + shadcn/ui。
- 升級 Node 到 v26.13.1（winget）。完成 `electron-rewrite` 需求（AC-1～AC-11）與規格；規格審查 14 條，採用 11、部分採用 3（R-1～R-12）。
- 實作 T-0～T-6：Electron 骨架、core 移植、oauth／UsagePoller、monitor／launcher／login／scripts、controller／IPC、畫面（ui-skills `baseline-ui`）、打包；135 個測試通過、portable exe 產生並以假資料啟動截圖確認；更新 `README.md`、`CLAUDE.md`。功能面待使用者實測。
- 使用者回報使用中帳號（Team 方案）卡片顯示「用量 API 暫時無法使用」→ 以同一 token 在 Node 重打 API 回 200，判斷為暫時性失敗；原本錯誤只記 `e.name` 無法看出原因。修正 `core/oauth.ts`：暫時性錯誤（網路、5xx、逾時）2 秒後重試一次；錯誤訊息附 HTTP 狀態或網路錯誤原因（遮蔽 token）。新增 3 個測試（共 138 個通過）。`electron-builder.yml` 排除 `dist*` 資料夾（避免舊產物被打包進 exe）；新 exe 輸出到 `app/dist-next/`（原 exe 執行中無法覆蓋）。
- 使用者要求自動偵測目前開著的 claude CLI，額度用滿時每個都切換帳號並接續工作 → 查到 4 個 claude 都在 herdr 的 PowerShell 中。使用者選擇在原視窗接續、只對中斷的回合送「繼續」。實測 `AttachConsole`＋`WriteConsoleInput` 可寫入 conhost 與 Windows Terminal 的 PowerShell（含中文）。完成需求與規格；規格審查 14 條全部採用（R-1～R-12，含實測發現 hook／statusline 的父程序是 bash，改由 statusline 自行查 claude PID）。實作 T-1～T-5：214 個測試通過、typecheck／build／package 通過，假資料截圖確認「Claude CLI」區塊。功能面待使用者實測。
- 使用者詢問 realiti4/claude-swap 能否達成需求 → 它有自動切換與多帳號用量，但不偵測／接續執行中的 CLI；其 README 稱 Claude Code 會重讀憑證檔。
- 使用者要求驗證是否重讀憑證 → 靜態分析 claude 2.1.323：每次 API 請求前的 refresh 檢查會比對 `.credentials.json` 的 mtime，變動就清快取重讀。實測（沙盒 `CLAUDE_CONFIG_DIR`、假 token、`ANTHROPIC_BASE_URL` 指向本機記錄伺服器）：執行中的 claude 換檔後下一個請求即改用新 token；`inject.ps1` 也能直接把文字送進執行中 claude 的輸入框。
- 使用者決定改為不重啟模式並設為預設 → 規格第二版（AC-10～AC-15）：`switch_mode` 預設 `live`，達門檻立即切換、只換憑證；因 rate_limit 停下的 session 自動在 claude 輸入框送出「繼續」；切換後 30 秒內的 stopfailure 視為舊帳號失敗，只送提示不再切換。`restart` 模式保留。228 個測試通過、typecheck／build／package 通過。功能面待使用者實測。
- 使用者要求 diff 審查 → 非 git repo，改以檔案對規格審查（兩位 Sonnet：controller／畫面、core／scripts）。採用 17 項並修正（含 live 模式先換帳號再掃描、切換瞬間舊憑證寫進新 slot 的防護、cmd 後備路徑命令注入、resumeArgs 旗標、statusline 只查祖先鏈、Claude Desktop 誤判、無目標時 60 秒節流）；不採用 6 項（原因記於規格）。241 個測試通過、portable exe 已更新。
- 使用者實測回報：(1) 用量 API「fetch failed：self signed certificate in certificate chain」→ 網路有 TLS 攔截，Node fetch 不信任 Windows 憑證存放區；改由 main 注入 Electron `net.fetch`（實測 Node fetch 重現 `SELF_SIGNED_CERT_IN_CHAIN`，`net.fetch` 正常連線）。(2) CLI 清單多為未知資料夾／帳號 → 閒置 session 不會執行 statusline 而無 pidmap；改讀 Claude Code 自己維護的 `~/.claude/sessions/<pid>.json`（sessionId、cwd、procStart、kind、status，不讀 `.key` 檔），帳號欄一律顯示目前帳號；有此目錄時 statusline 不再查程序。實測本機 4 個 claude 全部正確偵測。251 個測試通過、exe 已更新。
- 使用者要求把實作交給 agy 的 Sonnet → 新增 dev-workflow `scripts/run-agy-impl.sh`（`--mode accept-edits`、只允許完全相同字串的指令），更新 skill、全域 CLAUDE.md 與記憶。
- 使用者要求新增 agy 登入、依階段選模型（需求 Opus、實作 agy Sonnet→額度用完改 Claude Sonnet）、多帳號平行管理與資源調度 → 研究：agy 登入存在 Windows 認證管理員 `gemini:antigravity`（JSON，可備份切換）；額度可用 `daily-cloudcode-pa` 的 `fetchAvailableModels`／`retrieveUserQuota` 查（需 `User-Agent: antigravity/<版本> windows/amd64`），實測 agy 的 Claude 模型只剩約 2.6%（11/18 重置）。完成需求草稿 `docs/work/model-routing/1-requirements.md`，使用者確認先做第一期。取用 agy 內嵌 OAuth client secret 以 refresh 非使用中帳號的嘗試被權限機制拒絕，第一期改為不 refresh。
- 使用者要求新增自動整理上下文（回合結束、有新 prompt、超過門檻才 /compact 或 /clear，可設定）→ 加入需求 AC-12～AC-15；agy token 採方案 1（不 refresh 非使用中帳號）。規格（含審查 18 條，R-1～R-13 全採用）。實作先交 agy Sonnet：讀檔被拒（需 `AGY_ADD_DIRS`）後又遇 agy 額度用完，改由 Claude Sonnet 完成 T-1～T-5：agy 帳號（認證管理員讀寫、切換、新增流程、額度）、模型分工（routing.json＋畫面）、`switcher-run` 派工、自動整理上下文；主導者更新 dev-workflow skill 讀 routing.json（T-6）與 CLAUDE.md。358 個測試通過。功能面待使用者實測。
- 使用者要求「新增帳號」可選擇登入 Claude 或 agy → 卡片加 Claude／agy 切換，agy 模式顯示「登入 agy 帳號」「儲存目前 agy 登入」（沿用原本的 agy 對話框，改由 App 控制）；agy 區塊上方移除「新增 agy 帳號」按鈕。typecheck 通過、358 個測試通過。
- 使用者反映 claude 一直被登出 → 查對話紀錄：全部是 `API Error: 403 Attention Required! | Cloudflare`（17:47–17:53、18:16），憑證本身有效；原因可能是網路（TLS 攔截／共用 IP）或本程式的用量查詢。修改：用量與 token 更新請求帶 `User-Agent: claude-account-switcher/1.0`；收到 403 不重試，所有帳號暫停查詢 15 分鐘；查詢間隔新增 30 分鐘選項。360 個測試通過。

### 2026-11-14

- 使用者要求：可縮到背景（設定可選）、開機自動啟動（設定可選）、畫面改左右排版減少空白、設定用多級選單；補充「帳號不分學校等用途，依公司名稱分類」→ `docs/work/tray-layout/`：系統匣（按 X 縮到系統匣、右鍵開啟／結束、tooltip 顯示目前帳號）、單一實例、開機以 `--hidden` 背景啟動；左側導覽（總覽、帳號、Claude CLI、事件紀錄、設定▸6 個子頁），帳號頁依 Anthropic／Google 分組，「新增帳號」下拉選公司；設定與模型分工改為頁面。規格經 Sonnet 審查（採用 R-1～R-8）。377 個測試通過；系統匣與開機啟動待使用者實測。
- 使用者要求繼續未完成的工作 → 補做 tray-layout 畫面驗證：typecheck 通過，假資料截圖 6 頁×2 尺寸（1280×820、900×640）版面正常；portable exe 已是最新。系統匣與開機啟動仍待使用者實測。
- 使用者詢問換帳號是否需要 /login → 不需要，只有新增帳號或 refresh token 失效時要登入一次。
- 使用者要求參考 blog.ax0x.ai「hot-swapping Claude logins」做優化 → `docs/work/hot-swap-safety/`：自動切換跳過需重新登入的帳號、手動切換到這類帳號時拒絕；切換前目標 token 快到期先 refresh，確定失效不切換（避免把失效 token 寫進 `.credentials.json` 讓所有 claude 被登出）；自動切換成功送系統通知；使用中帳號重新登入的提示改為不需重開。實作由 Claude Sonnet 完成（agy 額度用完），389 個測試通過、typecheck 通過。未做：帳號優先順序、依消耗速度提前切換。
- 使用者詢問「非本程式啟動的 claude 不會切換」→ 為舊版過時提示（已支援外部 CLI，herdr 中的 claude 也會切換），移除該啟動訊息；typecheck 通過、portable exe 已重建，待使用者實測切換。

### 2026-11-15

- 使用者回報兩個帳號都顯示「額度已用完」→ 查明：live 切換後執行中 claude 的 statusline 仍回報切換前帳號（F115112109）的 rate_limits，但被標成新帳號，monitor 誤判 abcz 超過門檻並把它標成用完到 02:10。修正（`docs/work/hot-swap-safety/2b-stale-statusline.md`）：statusline 與用量 API 的 `resets_at` 相差超過 1 小時視為舊帳號資料不採用；總覽警示加「清除用完標記」；總覽帳號摘要顯示 5 小時／7 天下次重置時間。400 個測試通過、typecheck 通過、假資料截圖確認；portable exe 重建中。
- 使用者要求實作改用 agy Flash、驗證用 Claude Sonnet，並做模型分工第二期；追加「依用量跨供應商遞補（Claude 都用完改 agy Sonnet）」與「/compact 後清畫面」→ 實測 `JETSKI_OAUTH_TOKEN` 不會覆蓋 agy 登入，退回同時只用一個 agy 帳號（可同時跑 N 個任務，預設 2）；新增派工頁、Claude 可用性判斷（與自動切換共用）、`routing.json` 跨供應商遞補清單、整理後送 Ctrl+L（不用 /clear 以保留摘要）。規格審查 11 條採用；實作 agy Flash 4 次派工（3 個問題由主導者修正），Sonnet 實作審查 5 條全採用。449 個測試通過。Ctrl+L 清畫面待使用者實測。
- 使用者要求推到 GitHub → 建立 git repo 與根目錄 `.gitignore`（排除建置產物、`__pycache__`、含 email 的 agy log、截圖），掃描確認無 email／token 後 commit `488f0c7` 並推送 `main`。
- 使用者要求：多國語言並自動偵測系統語言、README 改英文、工作列圖示（白紙）改成程式圖示，並詢問模型分工是否需要 skill。
  - 圖示：原為 Electron 範本預設圖；新畫雙人頭像＋切換箭頭（`app/build/icon-src/icon.svg`，以 Electron 轉 PNG、PIL 產生 ico／icns）。白紙原因：Windows 視窗未設 icon，系統匣從 asar 讀圖 → 視窗一律設 icon，打包後改讀 extraResources 的實體檔。
  - README：改寫為英文並更新到目前功能（live 切換、agy、模型分工、派工、自動整理），說明模型分工需由 skill 或 CLAUDE.md 指示 Claude Code 呼叫 `switcher-run`。
  - 多國語言（`docs/work/i18n/`）：繁中＋英文，`auto` 依系統語言（zh-TW／HK／MO／Hant 為繁中，其他英文），設定「一般」頁可指定。規格審查 9 條全採用；T-1 agy Flash 無產出改 Sonnet、T-2 agy Flash（主導者修 2 個問題）、T-3 Sonnet；實作審查（兩位 Sonnet）採用 6 條。464 個測試通過、英文截圖確認。portable exe 重建。
- 使用者確認模型分工需要 skill 才會被 Claude Code 使用 → 新增 `skills/model-routing/SKILL.md`（英文，從 dev-workflow 派工段落整理：讀 routing.json、呼叫 switcher-run、exit code、agy 提示規則、失敗處理），README 說明安裝方式。commit `27b0ff8`、`d67d0e7` 並推送。
- 使用者要求發布 exe → 建立 GitHub Release `v1.0.0`（pre-release），上傳 portable exe，release notes 英文＋繁中（含未簽章 SmartScreen 說明、SHA-256、條款提醒）。
- 使用者回報工作列圖示仍是白紙 → 先試 `setAppDetails`（指定圖示與重新啟動指令）無效；對照實驗（win-unpacked、假資料、截工作列）：設定 AppUserModelID 時白紙、不設定時正確顯示新圖示；另以小腳本確認不設 AppUserModelID 時 Electron 通知仍正常 → Windows 不再設定 AppUserModelID，移除 `setAppDetails`。
- 使用者要求：模型分工 skill 的逐步設定引導（App 內＋README）與功能開關（`docs/work/skill-setup/`）→ 規格審查 10 條採用；agy Flash 做一半後被拒，Sonnet 接手完成。設定「模型分工」頁：啟用開關、6 步設定引導卡片（Node、派工工具、agy、agy 帳號、安裝／更新／移除 skill、範例指令）；關閉時隱藏派工並詢問移除 skill；`switcher-run` 關閉時一律 delegate。487 個測試通過。
- 使用者要求：每 10 分鐘檢查更新、紅點引導、自動下載並替換（`docs/work/auto-update/`）→ 規格審查 9 條採用；T-1A（updater、update.ps1）agy Flash、T-1B（controller、介面）Sonnet；實作審查無高、中 6 條＋低 2 條採用並由 Sonnet 修正。537 個測試通過。版本號提高到 1.1.0。
- 使用者要求：兩個帳號都用完時換到最早重置的帳號（`docs/work/earliest-reset/`）→ Sonnet 實作；實作審查無高，採用 6 條（restart 模式維持原行為、等待期間只暫停 60 秒、失敗還原、resume 前確認可用並順延、只對 rate_limit 停下的 session 送提示、補測試），不採用 1 條（排程只在記憶體，列為已知限制）。設定「帳號切換」頁有開關（預設開）。557 個測試通過。
- 重建 `Claude Account Switcher 1.1.0.exe`（18:02），以假資料啟動實際 portable exe 截工作列，確認顯示新圖示。commit `638eaa9` 並發布 v1.1.0 預覽版（刪除 agy 誤建的根目錄 `package.json`）。
