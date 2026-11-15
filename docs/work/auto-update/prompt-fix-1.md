你是實作者。修正自動更新的審查問題，不要做其他改動。所有程式在 `C:\presonal_project\Switching_account\app\`。先讀 `C:\presonal_project\Switching_account\CLAUDE.md` 與 `docs\work\auto-update\2-spec.md`（審查紀錄優先）。

1. 【中】`src/core/updater.ts` 下載串流（約 291、306-311、343-348 行）：建立 write stream 後立刻掛常駐 `error` 監聽，或改用 `stream.pipeline(Readable.fromWeb(res.body), writeStream)`；不得留下 unhandled 'error'，不得洩漏監聽器。
2. 【中】`src/core/updater.ts` 約 378-389 行：失敗時等 write stream `close` 後再刪 `.part`。
3. 【中】`src/scripts/update.ps1`：還原後比對 `.old` 與 Target 大小並寫 log；所有失敗路徑都刪除殘留的 `Target.new`。
4. 【中】`src/scripts/update.ps1` 約 18 行：`New-Item` 沒有 `-LiteralPath`，改 `-Path`（或 `[System.IO.Directory]::CreateDirectory`）。
5. 【中】`src/scripts/update.ps1`：所有複製／改名改用 `[System.IO.File]::Copy($src, $dst, $true)` 與 `[System.IO.File]::Move` 系列（.NET Framework 4.x 沒有 Move 覆蓋參數：先 `[System.IO.File]::Delete` 目的地或用 `[System.IO.File]::Replace`），避免路徑含 `[` `]` 時萬用字元解析錯誤；`Test-Path` 一律 `-LiteralPath`。
6. 【中】`src/main/controller.ts` `applyUpdate`（約 2746-2767 行）與 `src/main/index.ts` `spawnDetached`（約 190 行）：`spawnDetached` 改為回傳 Promise<boolean>，等子程序 `spawn` 事件（成功）或 `error` 事件（失敗）；失敗時 `fail(t('update.applyFailed'...))` 且**不** `quitApp()`。測試用假實作。
7. 【低】`src/scripts/update.ps1` 約 31 行：解鎖檢查改 `[System.IO.FileAccess]::Read` 搭配 `[System.IO.FileShare]::None`（唯讀屬性的 exe 也能判斷）。
8. 【低】`src/core/updater.ts` 約 109 行：預覽標籤比較改為 SemVer 規則（數字段比數值、其他段 ASCII 序比較，不用 `localeCompare`）。
9. 【低】`src/renderer/src/pages/settings/UpdatePage.tsx`：`checkedAt` 為 null（尚未檢查）時不顯示「目前已是最新版本」，改顯示 `ui.ts` 新鍵（中：「尚未檢查」／英：「Not checked yet」或沿用既有鍵）；檢查失敗時顯示錯誤而非「最新版本」。
10. 測試補齊：
    - `tests/update-ps1.test.ts`：Target 被獨占開啟（測試中用 `fs.openSync` 不關閉，或另開一個 PowerShell 鎖住）時逾時且 Target 內容不變；路徑含 `[1]` 的成功替換；改名失敗走還原（例如讓 `Target.new` 無法改名：預先建立同名唯讀目錄或其他可重現方式）時 Target 內容等於原本、`Target.new` 已刪除、log 有還原紀錄。每個測試只用暫存目錄與 `-NoLaunch`。
    - `tests/updater.test.ts`：`res.ok` 為 false、寫檔錯誤（目的地目錄改成檔案）時丟錯且無 `.part` 殘留、無 unhandled error；預覽標籤比較（`1.0.0-beta.2` < `1.0.0-beta.10`、`1.0.0-rc.1` > `1.0.0-beta.9`、`1.0.0` > `1.0.0-rc.1`）。
    - `tests/controller-update.test.ts`：`applyUpdate` 傳給 spawn 的參數含 `process.pid` 與 `process.ppid`；spawn 失敗時不呼叫 quit。

## 規則

- 只改上述檔案與測試；不要在其他地方建立檔案。`.ps1` 註解只能用英文、PowerShell 5.1 相容。
- 測試不得碰真實網路、真實 exe、不得啟動真正的程式。
- 程式註解用繁體中文（台灣用語）。不要 commit，不要改規格與 CLAUDE.md。

## 指令

工作目錄 `C:\presonal_project\Switching_account\app`，PATH 需含 `C:\Program Files\nodejs`。執行 `npm run typecheck` 與 `npm test`，兩者都要通過（`npm test` 只看結果摘要行）。

## 回報

逐項說明改了什麼（檔案:行號）、新增的測試名稱、兩個指令的結果行。繁體中文，600 字以內。
