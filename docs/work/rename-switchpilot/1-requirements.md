# 需求：改名為 SwitchPilot

使用者已確認 AC（2026-11-16）：「全部改（含 repo 與資料夾）」，新名稱 SwitchPilot。

## 目標
程式未來不只支援 Claude／Gemini，名稱改成不綁定特定 AI 的 SwitchPilot，舊使用者升級時資料與自動更新不中斷。

## 驗收條件
- AC-1：視窗標題、系統匣提示、通知、設定頁等介面文字（繁中／英文）顯示 SwitchPilot，不再出現「Claude 帳號切換器」「Claude Account Switcher」作為程式名稱。
- AC-2：打包產出 `dist/SwitchPilot <版本>.exe`；`productName: SwitchPilot`、`appId: local.switchpilot`。
- AC-3：資料夾預設為 `~/.switchpilot`。新版啟動時，若舊 `~/.claude-switcher` 是實體資料夾且新資料夾不存在，整個搬到新位置，並在舊位置建立指向新資料夾的 junction（舊路徑的指令、skill、已安裝的 hook 仍可用）。搬移失敗（檔案被占用）時繼續使用舊資料夾，下次啟動再試。
- AC-4：搬移成功且 Claude Code 整合（statusline／hooks）已安裝時，自動把 `~/.claude/settings.json` 中的路徑改成 `~/.switchpilot/bin/...`（沿用既有 install，含備份）。
- AC-5：環境變數改名為 `SWITCHPILOT_*`；舊的 `CLAUDE_SWITCHER_*` 仍有效（新名稱優先）。
- AC-6：開機自動啟動：舊的登錄值 `electron.app.Claude Account Switcher` 會被移除，只留新名稱的一筆，開機不會啟動兩次。
- AC-7：自動更新：`UPDATE_REPO = gordonpow/SwitchPilot`；資產優先挑 `SwitchPilot-*.exe`，也接受舊名 `Claude-Account-Switcher-*.exe`。舊版（1.1.x）仍能更新到新版（GitHub repo 改名後舊網址會轉址；舊版找不到舊檔名時取第一個 exe）。
- AC-8：README、CLAUDE.md、`skills/model-routing/SKILL.md`、switcher-run 訊息改用 SwitchPilot 與新路徑。
- AC-9：typecheck 與全部測試通過；新增搬移、環境變數相容的測試。

## 不做
- 不新增 Codex／Copilot 等新 AI 支援（另案）。
- 不改內部模組／檔名（例如 `switcher-run.cjs`、`claude-switcher` 程式內部識別字以外的檔案格式）。
- 不改 `docs/work/` 下的歷史文件與 `switcher/` Python 版。

## 限制
- 語言只用繁中（台灣）或英文；`*.ps1` 註解只能英文。
- GitHub repo 改名在發布前、經使用者同意後執行。
