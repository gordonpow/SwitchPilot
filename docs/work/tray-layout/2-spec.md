# 規格：背景執行、開機自動啟動、左導覽排版

需求：`1-requirements.md`（AC-1～AC-12）。

## A. 設定欄位（config.json）

`src/core/config.ts` 的 `Config` 與 `DEFAULTS`、`src/shared/types.ts` 的 `AppConfig` 新增：

| 欄位 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `close_to_tray` | boolean | false | 按 X 時縮到系統匣 |
| `launch_at_login` | boolean | false | 開機自動啟動 |

`load()` 遇到非 boolean 時改用預設值。`Controller.setConfig` 支援兩欄（`!!` 轉 boolean）。

## B. 主程序（`src/main/index.ts`，新檔 `src/main/tray.ts` 可選）

1. **單一實例**：`app.requestSingleInstanceLock()` 失敗就 `app.quit()` 並 return；`second-instance` 事件呼叫 `showWindow()`。截圖模式（`CLAUDE_SWITCHER_SCREENSHOT`）不取鎖。
2. **背景啟動參數**：`process.argv` 含 `--hidden` 時，`ready-to-show` 不呼叫 `show()`，並建立系統匣。
3. **系統匣**（`Tray`）：
   - 圖示用 `resources/icon.png`（`nativeImage.createFromPath(icon).resize({width:16,height:16})`）。
   - 何時存在：`close_to_tray` 為 true，或以 `--hidden` 啟動，或視窗目前被隱藏。設定改為 false 且視窗可見時銷毀。
   - tooltip：`Claude 帳號切換器\n目前：<目前帳號名稱或「未儲存」>`；controller `push` 時更新（只在文字改變時 `setToolTip`）。
   - `click`、`double-click`：`showWindow()`。
   - 右鍵選單：「開啟視窗」、分隔線、「結束」（設 `quitting = true` 後 `app.quit()`，走既有 `before-quit` dispose）。
4. **關閉行為**：`mainWindow.on('close', e)`：若 `!quitting` 且（`close_to_tray` 為 true 或以 `--hidden` 啟動且尚未改設定）——規則簡化為：`!quitting && (cfg.close_to_tray || startedHidden)` 時 `e.preventDefault()`、`hide()`、確保系統匣存在；第一次隱藏時用 `Notification` 顯示「仍在背景執行，可從系統匣開啟」。`startedHidden` 在使用者從系統匣開啟視窗後清為 false（之後依 AC-1 開關）。
   - `window-all-closed` 不變（只有真的關閉才觸發）。
5. **`showWindow()`**：視窗存在就 `show()`、`restore()`（若最小化）、`focus()`；不存在（理論上不會）就 `createWindow()`。
6. **通知點擊**：`notify` 建立的 `Notification` 加 `on('click', showWindow)`。
7. **開機自動啟動**：
   - 函式 `applyLoginItem(enabled: boolean)`：`exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath`；`app.setLoginItemSettings({ openAtLogin: enabled, path: exe, args: ['--hidden'] })`。未打包（`!app.isPackaged`）時不呼叫（開發與截圖不改登錄），只寫 log。
   - 注入 Controller：`ControllerDeps.applyLoginItem?: (enabled: boolean) => void`。Controller 在 `start()` 時以目前設定呼叫一次（AC-7：路徑更新），`setConfig` 中 `launch_at_login` 變更時呼叫；呼叫丟例外時 setConfig 回傳失敗且不寫入設定。
8. 截圖模式（`CLAUDE_SWITCHER_SCREENSHOT`）：不建系統匣、不攔截 close、不呼叫 `applyLoginItem`。

## C. 畫面（renderer）

### 結構

`App.tsx` 改為：

```
<TopBar/>（只剩標題、目前帳號徽章、重新整理用量）
<div flex>
  <NavSidebar page onNavigate/>   寬 w-52（< 1100px 時 w-14 只顯示圖示＋tooltip）
  <main overflow-y-auto p-5>{依 page 顯示}</main>
</div>
```

`page` 型別：`'overview' | 'accounts' | 'cli' | 'events' | 'settings/general' | 'settings/switch' | 'settings/cli' | 'settings/compact' | 'settings/routing' | 'settings/integration'`。存在 React state；`localStorage` 記住上次頁面（try/catch）。截圖用 `?page=<page>`（取代舊的 `?dialog=`，`dialog=settings` 對應 `settings/general`、`dialog=routing` 對應 `settings/routing`）。

### 導覽列 `components/NavSidebar.tsx`

- 上半：總覽（LayoutDashboard）、帳號（Users，旁邊小字顯示帳號總數）、Claude CLI（Terminal，數量）、事件紀錄（ScrollText）。
- 分隔線後：設定（Settings），可展開／收合（預設：目前在 settings/* 時展開），子項目縮排：一般、帳號切換、Claude CLI、自動整理上下文、模型分工、Claude Code 整合。
- 目前項目 `aria-current="page"` 並以背景色標示。用 `<nav aria-label="主選單">` 與 `<button>`。

### 頁面

- **總覽** `pages/OverviewPage.tsx`：
  - 全部額度用完警示（沿用 App 現有區塊）。
  - 兩欄格線（`lg:grid-cols-2`，窄時一欄）：
    - 卡片「帳號摘要」：分 Anthropic、Google 兩組，每個帳號一列（名稱、使用中徽章、Claude 帳號顯示 5 小時／7 天兩條細進度；agy 帳號顯示主要模型 claude-sonnet-4-6 剩餘％，沒有就顯示第一個模型）；點列跳到「帳號」頁。
    - `LaunchPanel`、`AutoSwitchPanel`。
    - `EventLog` 只顯示最近 8 筆＋「查看全部」連到事件紀錄頁。
- **帳號** `pages/AccountsPage.tsx`：
  - 頁首：標題「帳號」、右側「新增帳號」下拉選單（DropdownMenu）：
    - Anthropic（Claude）：瀏覽器登入、儲存目前登入的帳號（未儲存時才可用）
    - Google（agy）：登入新帳號、儲存目前 agy 登入（未儲存時才可用）
  - 區塊「Anthropic」（標題＋數量＋重新整理用量按鈕）：`AccountCard` 格線 `grid-cols-[repeat(auto-fill,minmax(260px,1fr))]`。沒有帳號時顯示空狀態文字。
  - 區塊「Google」（標題＋數量＋額度更新時間＋重新整理額度）：`AgySection` 的卡片與登入狀態列，格線同上。
  - `AddAccountCard.tsx` 移除（功能併入下拉選單）；目前帳號未儲存的黃色提示改成區塊上方的提示列，附「儲存」按鈕。
  - 「agy 帳號」等字樣改為「Google 帳號」或直接用區塊標題；卡片內可加小標籤「Claude」「agy」。
- **Claude CLI** `pages/CliPage.tsx`：`LaunchPanel` 與 `CliPanel`（CliPanel 改為佔滿高度、不再固定高度捲動框，或高度隨頁面）。
- **事件紀錄**：`EventLog` 全頁（全部事件）。
- **設定頁**：`SettingsDialog.tsx` 拆成 `pages/settings/*.tsx`（或一個檔案內多個 section 元件），每頁一個標題與說明：
  - 一般：開機時自動啟動、關閉視窗時縮到系統匣（Switch，呼叫 `setConfig`）、登入瀏覽器、用量更新間隔。
  - 帳號切換：自動切換開關與門檻（目前在 `AutoSwitchPanel` 與設定內的相關項目；總覽仍顯示 AutoSwitchPanel 狀態）、切換方式。
  - Claude CLI：切換時一併處理外部 CLI、中斷後自動送出的提示。
  - 自動整理上下文：`AutoCompactSection`。
  - 模型分工：`RoutingDialog` 內容改成頁面元件 `RoutingPanel`（儲存按鈕在頁內）。
  - Claude Code 整合：安裝／移除整合。
  - `SettingsDialog`、`RoutingDialog` 對話框殼移除；所有選項、驗證與送出時機（失焦／Enter）不變。
- `TopBar`：移除「模型分工」「設定」按鈕與對應 props。
- 其他對話框（登入、重新命名、刪除、切換確認、agy 對話框）維持在 App 層，行為不變。

## 任務

| ID | 內容 | 檔案 | 相依 |
|---|---|---|---|
| T-0 | 型別：`AppConfig` 加兩欄（主導者先做） | `src/shared/types.ts` | — |
| T-1 | 設定欄位、controller 注入 `applyLoginItem`、main 系統匣／單一實例／關閉行為／`--hidden`；測試：config 預設與壞值、setConfig 兩欄、`applyLoginItem` 在 start 與變更時呼叫、丟例外時不寫入 | `core/config.ts`、`main/controller.ts`、`main/index.ts`、`tests/config.test.ts`、`tests/controller*.test.ts` | T-0 |
| T-2 | 畫面全部 | `src/renderer/src/**` | T-0 |

T-1、T-2 可平行。

## 驗證

| AC | 方式 |
|---|---|
| AC-1～AC-7 | 單元測試（config、controller 注入）＋使用者實測（系統匣、登錄需打包後真實執行） |
| AC-8～AC-12 | typecheck、build、截圖（1280×820、900×640，各頁 `?page=`） |

## 風險

- portable exe 啟動時會先解壓，`PORTABLE_EXECUTABLE_FILE` 才是原始路徑；若未提供則用 `process.execPath`（開發時不寫登錄）。
- 開機啟動時 node 或網路可能尚未就緒：輪詢本來就有重試，不另處理。
- 回退：設定兩欄預設皆關，行為與現在相同。

## 審查紀錄（Sonnet，2026-11-14）

以下修訂**優先於前文**：

- **R-1（高，採用）**：`before-quit` 第一行無條件設 `quitting = true`（所有結束路徑：系統匣「結束」、`app.quit()`、截圖、關機）。另處理 `app.on('session-end')`（設 quitting）避免擋關機。結束時 `tray.destroy()`。
- **R-2（中，採用）**：`second-instance` 的 `argv` 含 `--hidden` 時忽略（不顯示視窗）。`startedHidden` 在所有 `showWindow()` 路徑清除。
- **R-3（中，採用）**：系統匣存在條件改為：`close_to_tray` 為 true，或以 `--hidden` 啟動且視窗未顯示過，或視窗已因 X 隱藏。main 從 `push(state)` 讀 `state.config.close_to_tray` 判斷變更：改為 false 且視窗可見時銷毀系統匣。
- **R-4（中，採用）**：`tray` 為模組層變數；`Notification` 物件存在模組層 Set，`close`／`click` 後移除，避免被 GC 而點擊無效。「第一次隱藏」通知每個程序一次。
- **R-5（中，部分採用）**：`start()` 呼叫 `applyLoginItem` 失敗時 catch 並記 log（`warn`），不影響啟動；`setConfig` 只在 `launch_at_login` 值改變時、`config.save` 之前呼叫，丟例外則回傳失敗且不寫入。封裝版 `PORTABLE_EXECUTABLE_FILE` 不存在時退回 `process.execPath`。不採用：讀 `getLoginItemSettings` 顯示工作管理員停用狀態（不在需求範圍，記為已知限制）。
- **R-6（中，採用）**：main 新增環境變數 `CLAUDE_SWITCHER_SCREENSHOT_PAGE=<page>` 以 `?page=` 載入；保留 `CLAUDE_SWITCHER_SCREENSHOT_DIALOG` 相容（settings→`settings/general`、routing→`settings/routing`）。主導者更新 CLAUDE.md。
- **R-7（低，採用）**：tooltip 截斷至 120 字元；圖示 resize 32px；`showWindow` 先 `restore()`（若最小化）再 `show()`、`focus()`。單一實例鎖在 `whenReady` 之前取，失敗時不建立 controller、不註冊 IPC。
- **R-8（測試，採用）**：關閉決策抽成純函式 `shouldHideOnClose({ quitting, closeToTray, startedHidden, screenshot })`（放 `src/main/trayPolicy.ts`，不 import electron），單元測試涵蓋；另測 `launch_at_login` 同值不重複呼叫、`start` 時 `applyLoginItem` 丟例外不影響、`load()` 非 boolean 回預設、`setConfig` 兩欄。AC-2～AC-4、AC-5～AC-7 列入驗證文件的手動步驟。

## 實作紀錄

- 實作者：agy 額度用完（約 11/18 重置），依備援改由 Claude Sonnet 子代理平行完成 T-1（main／config）與 T-2（畫面）。
- 偏差：`session-end` 掛在 `BrowserWindow`（Electron 的 app 沒有此事件）；`setConfig` 失敗碼用既有 `UNKNOWN`；模型分工頁以「還原」取代「取消」；窄版導覽的設定子項以數字 1～6 當圖示。
- 測試：377 個通過。會 spawn 程序的測試在全套平行執行時偶爾超過 5 秒，`vitest.config.ts` 的 `testTimeout` 調為 20 秒。
- 已知限制：使用者若在工作管理員停用開機啟動，畫面仍顯示開啟（不讀 `getLoginItemSettings`）。
- 畫面驗證（2026-11-14）：typecheck 通過；以假資料（3 個 Anthropic 帳號）截圖總覽、帳號、Claude CLI、事件紀錄、設定▸一般、設定▸模型分工，1280×820 與 900×640 各一張，版面正常（900 寬時導覽收成圖示）。portable exe 已更新（`app/dist/`）。
