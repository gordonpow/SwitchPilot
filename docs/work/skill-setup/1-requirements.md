# 需求：模型分工 skill 設定引導

## 目標

讓第一次使用的人不用讀程式碼，也能一步一步完成「讓 Claude Code 依模型分工派工」的設定。

## 使用者決定（2026-11-15）

App 內引導（設定 → 模型分工）＋ README 逐步教學。不需要此功能的使用者可關閉。

## 驗收條件

- AC-1：設定「模型分工」頁最上方有「設定引導」卡片，依序列出步驟，每步顯示狀態（完成／未完成／選用），未完成時有說明與動作。
  1. Node.js 22 以上（偵測系統 node）。
  2. 派工工具 `switcher-run.cjs` 已安裝在 `~/.claude-switcher/bin/`。
  3. Antigravity CLI（選用，只有 agy 項目需要）。
  4. agy 帳號（選用）：已儲存的數量，可前往帳號頁。
  5. model-routing skill 已安裝到 `~/.claude/skills/model-routing/SKILL.md`：未安裝／已安裝／版本不同。
  6. 開始使用：中英範例指令，可一鍵複製；提醒新開的 Claude Code 對話才會載入 skill。
- AC-2：按「安裝 skill」把 App 內附的 SKILL.md 寫到上述位置；已有內容不同的檔案時先詢問，確認後把舊檔備份為 `SKILL.md.bak` 再覆蓋。
- AC-3：卡片有「重新檢查」按鈕；安裝後狀態立即更新。
- AC-4：所有文字支援繁中與英文。
- AC-5：README 的 Model routing 一節改成逐步教學，與 App 步驟一致。
- AC-7：設定可關閉「模型分工」功能（`routing_enabled`，預設開啟）。關閉時：
  - 左側導覽隱藏「派工」，設定「模型分工」頁只顯示開關與說明（不顯示引導卡片與分工清單）。
  - `switcher-run` 不派給 agy：直接 exit 10（delegate），`model` 用該 role 第一個 Claude 項目（沒有則 `sonnet`），`message` 說明功能已關閉。
  - 關閉時若 skill 已安裝，詢問是否一併移除（移除＝刪除 `SKILL.md`，資料夾空了也刪除）；引導卡片在開啟時提供「移除 skill」。
- AC-6：既有測試通過；新增測試涵蓋狀態判斷與安裝（含覆蓋與備份）。

## 不做

- 自動安裝 Node.js 或 agy。
- 修改使用者的 `CLAUDE.md`。
- 專案層級（`.claude/skills`）安裝。

## 限制

- App 內附的 SKILL.md 以 repo 的 `skills/model-routing/SKILL.md` 為唯一來源（建置時複製）。
- 測試不得碰真實 `~/.claude`（`useTempEnv`）。
