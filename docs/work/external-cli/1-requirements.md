# 需求：自動偵測並切換所有 Claude CLI

## 目標

使用者常同時開好幾個 claude CLI（目前在 herdr 的 PowerShell 窗格中執行，不是由本程式託管）。額度用完切換帳號時，所有 CLI 都要換到新帳號，並在原本的視窗接續同一個對話，被中斷的工作要自動繼續。

## 使用者已決定（2026-11-13）

- 接續位置：原本的視窗。結束 claude 後，把接續指令寫進原本的 shell（Windows `AttachConsole` + `WriteConsoleInput`）；做不到時改開新 Windows Terminal 分頁託管。
  - 已實測：一般 conhost 與 Windows Terminal（ConPTY）中的 PowerShell 都能寫入，含中文。
- 自動繼續：只有被中斷的 session 自動送出提示（預設「繼續」）；閒置的只恢復對話。

## 驗收條件

- **AC-1**：GUI 的「Claude CLI」區塊列出目前執行中的所有 claude CLI，包含非本程式啟動的。每列顯示：PID、資料夾、帳號、狀態（工作中／閒置／中斷）、接續方式（原視窗／新分頁／無法接續）。約 10 秒更新一次。
- **AC-2**：自動切換時，所有偵測到且有 session 的 CLI（託管與外部）都會被結束。切換帳號後，每個 CLI 都以 `claude --resume <session_id>` 接續原本的對話。
- **AC-3**：外部 CLI 的父程序是 `powershell.exe`、`pwsh.exe` 或 `cmd.exe` 時，接續指令寫進原本的視窗。寫入失敗或父程序是其他程式時，改開新的 Windows Terminal 分頁，由 runner 託管並接續。
- **AC-4**：結束時正在工作（最後事件是 `UserPromptSubmit`）或因 rate_limit 失敗的 session，接續時附上設定的提示文字（預設「繼續」）。閒置的 session 不附提示。
- **AC-5**：原本的命令列選項保留，例如 `--dangerously-skip-permissions`、`--model X`。原本的 prompt 參數、`--continue`、`--resume` 不重複帶入。`-p`／`--print` 模式的 claude 不處理。
- **AC-6**：設定中可以關閉「一併處理外部 CLI」，也可以修改提示文字。手動「切換並重啟」也套用同樣的流程。
- **AC-7**：本程式託管的 runner 重啟時，也改用 `--resume <session_id>` 並套用 AC-4；找不到 session 時才用 `--continue`。
- **AC-8**：安裝整合會加入 `UserPromptSubmit` hook。已安裝但缺少這個 hook 時，畫面顯示需要更新整合。
- **AC-9**：所有測試與 typecheck 通過。測試使用假的程序列表、假的 kill 與假的寫入，不碰真實的 claude 程序。

## 不做的範圍

- VS Code 擴充套件面板中的 claude（沒有獨立的 shell 可寫入）。
- 整合安裝之前就啟動、且還沒執行過 statusline／hook 的 claude（拿不到 session，列為「無法接續」，不結束它）。
- Windows 以外的平台。

## 限制

- 只用繁體中文或英文；token 與命令列內容不得寫入 log。
- 程序列表透過 `Get-CimInstance Win32_Process`（powershell，隱藏視窗）取得。
- 強制結束 claude 會中斷進行中的工具呼叫；這是使用者已接受的行為（中斷者會自動送「繼續」）。
