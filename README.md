# Claude 帳號切換器

在 Windows 上管理多個 Claude 訂閱帳號：一次看到所有帳號的 5 小時／7 天用量；額度用完（或達到門檻）時，一鍵或自動切換帳號，並在同一個專案資料夾用 `claude --continue` 接著原本的對話繼續做。

本專案有兩個版本，資料格式相同、可互換，**同一時間只執行其中一個**：

| 版本 | 位置 | 狀態 |
|---|---|---|
| Electron 版（建議） | `app/` | 目前版本：深色卡片介面、所有帳號用量總覽、Chrome 無痕／Edge InPrivate 登入 |
| Python 版 | `switcher/` | 舊版（tkinter），保留作為備援，之後移除 |

## 需求

- Windows 10／11
- Node.js 22 以上（statusline、hook、runner、登入腳本由系統的 `node` 執行；開發也需要）
- Windows Terminal（`wt.exe`；找不到時改開一般主控台視窗）
- Claude Code，帳號為 Claude Pro 或 Max 訂閱

## 安裝

- **直接使用**：執行 `app\dist\Claude Account Switcher 1.0.0.exe`（可攜式，不需安裝）。
- **從原始碼**：
  ```powershell
  cd app
  npm install
  npm run dev        # 開發執行
  npm run package    # 產生 dist\Claude Account Switcher <版本>.exe
  ```

## 第一次設定

1. 開啟程式，在「新增帳號」卡片按「瀏覽器登入」。程式會開 Chrome 無痕視窗（可在設定改成 Edge InPrivate 或預設瀏覽器），在視窗中登入（可選 Google）；完成後輸入名稱即新增。過程不會動到目前登入的帳號，也不會影響正在執行的 claude。
2. 重複步驟 1 新增其他帳號。
3. 在設定（右上角齒輪）按「安裝整合」：修改 `~/.claude/settings.json` 的 `statusLine` 與 `Stop`、`StopFailure` hook（修改前備份；若有 Python 版的整合會一併換掉）。已開啟的 claude 需重開才會生效。

替代方式：先在 claude 中 `/login`，再按「儲存目前登入的帳號」。

## 使用方式

- **用量總覽**：每張帳號卡片顯示 5 小時與 7 天用量、重置時間、資料來源（API／statusline）與更新時間；預設每 2 分鐘更新，右上角可手動重新整理。用量達門檻為紅色、80% 以上為黃色。
- **手動切換**：卡片上按「切換到此帳號」。有託管中的 claude 時，可選「切換並重啟」或「只切換，不重啟」。
- **啟動 claude**：選擇專案資料夾，按「啟動」或「接續上次」（`--continue`）。claude 在 Windows Terminal 中由本程式託管，才能被自動重啟。資料夾路徑不可含分號（`;`）。
- **自動切換**：開啟「用量達門檻時自動切換帳號」並設定門檻（50–100%，預設 95%）。會跳過已用完或 API 用量已達門檻的帳號。
- **所有帳號都用完**：不切換，顯示系統通知與最早重置時間。
- **需要重新登入**：未使用中帳號的 token 無法更新時，卡片會顯示警告，按「重新登入」即可。

## 運作原理

1. **用量 API**：程式用各帳號保存的 token 查詢 Claude Code `/usage` 使用的 API。未使用中帳號的 token 快到期時由程式自動更新並存回；使用中帳號的 token 交給 Claude Code 自己更新，程式不碰。
2. **statusline 門檻**：整合的 statusline 腳本把 Claude Code 傳來的 `rate_limits` 寫成檔案；程式每 3 秒讀取，使用中帳號達門檻就進入「等待回合結束」。
3. **回合結束**：`Stop` hook 通知回合已結束才切換，避免中斷正在進行的工作（等待超過 10 分鐘也會切換）。
4. **rate_limit 備援**：`StopFailure` hook 收到 `rate_limit` 錯誤時立即切換。
5. **runner 重開**：切換時結束託管的 claude，把憑證換成下一個帳號，runner 以 `claude --continue` 在同一資料夾重新開啟。

切換前會先把目前憑證寫回目前帳號的 slot，保存 Claude Code 可能已更新的 token。

## 資料存放位置

- 程式資料：`%USERPROFILE%\.claude-switcher\`（`slots\` 帳號、`usage_api\` 各帳號用量、`usage\`、`events\`、`runs\`、`bin\` 腳本、`backups\`）。可用環境變數 `CLAUDE_SWITCHER_HOME` 改位置。
- 被修改的 Claude 檔案：`%USERPROFILE%\.claude\.credentials.json`、`%USERPROFILE%\.claude.json`（只換 `oauthAccount`）、`%USERPROFILE%\.claude\settings.json`（只在安裝／移除整合時）。

## 移除方式

1. 設定中按「移除整合」，還原 `settings.json`（備份在 `%USERPROFILE%\.claude-switcher\backups\`）。
2. 關閉程式，刪除 `%USERPROFILE%\.claude-switcher` 資料夾與 exe。

## 已知限制

- 用量 API 與 token 更新是 Claude Code 內部使用、未公開文件的介面，可能隨 Claude Code 改版失效；失效時只影響用量顯示，改用 statusline 資料，切換功能不受影響。
- 非本程式啟動的 claude（VS Code 擴充套件、其他終端機）不會被切換，且可能 refresh 舊帳號 token、改寫憑證檔；若它仍在使用某個未使用中帳號，會和本程式互相作廢 token，導致該帳號需要重新登入。切換前請先關閉它們。
- 同一資料夾同時開多個 claude 時，`--continue` 可能接錯對話。
- 強制結束 claude 時，其底下的 MCP server 會一併結束（重開後會重新啟動）。
- 不支援 macOS／Linux、桌面版 Claude app、claude.ai 網頁。

## 安全提醒

`slots\*.json` 內含登入權杖（等同密碼）。請勿上傳到 Git、雲端硬碟或任何同步服務，也不要分享給他人。檔案沒有加密，保護程度與原本的 `.credentials.json` 相同（只靠使用者目錄的權限）。token 只會送往 `api.anthropic.com` 與 `platform.claude.com`。

## 條款提醒

使用多個帳號來繞過用量限制，可能違反 Anthropic 的使用條款。請自行確認並自負風險。

## Python 版（舊版）

`python -m switcher` 或雙擊 `啟動切換器.bat`；需要 Python 3.13。功能為 Electron 版的子集（只顯示使用中帳號的用量，登入只支援 Edge InPrivate）。
