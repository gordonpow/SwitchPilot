### 修改檔案清單

共修改 23 個檔案（1 個字典檔、22 個 renderer 檔案）：

1. [src/shared/i18n/ui.ts](file:///C:/presonal_project/Switching_account/app/src/shared/i18n/ui.ts)
2. [src/renderer/src/App.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/App.tsx)
3. [src/renderer/src/lib/format.ts](file:///C:/presonal_project/Switching_account/app/src/renderer/src/lib/format.ts)
4. [src/renderer/src/lib/routing.ts](file:///C:/presonal_project/Switching_account/app/src/renderer/src/lib/routing.ts)
5. [src/renderer/src/lib/use-app-state.ts](file:///C:/presonal_project/Switching_account/app/src/renderer/src/lib/use-app-state.ts)
6. [src/renderer/src/components/AccountCard.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/AccountCard.tsx)
7. [src/renderer/src/components/AgySection.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/AgySection.tsx)
8. [src/renderer/src/components/AutoSwitchPanel.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/AutoSwitchPanel.tsx)
9. [src/renderer/src/components/CliPanel.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/CliPanel.tsx)
10. [src/renderer/src/components/EventLog.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/EventLog.tsx)
11. [src/renderer/src/components/LaunchPanel.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/LaunchPanel.tsx)
12. [src/renderer/src/components/LoginDialog.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/LoginDialog.tsx)
13. [src/renderer/src/components/NameDialog.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/NameDialog.tsx)
14. [src/renderer/src/components/NavSidebar.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/NavSidebar.tsx)
15. [src/renderer/src/components/RoutingPanel.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/RoutingPanel.tsx)
16. [src/renderer/src/components/TopBar.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/TopBar.tsx)
17. [src/renderer/src/components/UsageBar.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/components/UsageBar.tsx)
18. [src/renderer/src/pages/AccountsPage.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/pages/AccountsPage.tsx)
19. [src/renderer/src/pages/CliPage.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/pages/CliPage.tsx)
20. [src/renderer/src/pages/DispatchPage.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/pages/DispatchPage.tsx)
21. [src/renderer/src/pages/EventsPage.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/pages/EventsPage.tsx)
22. [src/renderer/src/pages/OverviewPage.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/pages/OverviewPage.tsx)
23. [src/renderer/src/pages/settings/SettingsPages.tsx](file:///C:/presonal_project/Switching_account/app/src/renderer/src/pages/settings/SettingsPages.tsx)

---

### 新增鍵數

- 原有鍵數：5 個（語言設定相關）
- 目前總鍵數：224 個
- **淨新增鍵數：219 個**（涵蓋 common、format、error、role、app、dialog、nav、topbar、login、autoSwitch、launch、events、usage、accounts、agy、cli、routing、overview、dispatch、settings）
- `uiZh` 與 `uiEn` 鍵集合與變數參數完全一致，且與 `mainZh` 零重複。

---

### 兩項指令執行結果行

因終端機工作目錄目前為專案根目錄 `C:\presonal_project\Switching_account`（且嚴格遵守不加 `cd`、參數、管線或建立外部檔案之限制），執行結果如下：

1. **`npm run typecheck`**
   ```text
   npm error code ENOENT
   npm error syscall open
   npm error path C:\presonal_project\Switching_account\package.json
   npm error errno -4058
   npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open 'C:\presonal_project\Switching_account\package.json'
   ```

2. **`npm test`**
   ```text
   npm error code ENOENT
   npm error syscall open
   npm error path C:\presonal_project\Switching_account\package.json
   npm error errno -4058
   npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open 'C:\presonal_project\Switching_account\package.json'
   ```

---

### 刻意保留中文的地方與原因

1. **`src/renderer/src/lib/mock-api.ts`**
   - **原因**：符合任務指示「`lib/mock-api.ts` 的假資料內容不必翻」，作為本機無 preload 預覽環境的 mock 資料保留。
2. **所有程式碼註解**
   - **原因**：符合任務規範「不改程式註解」、「程式註解用繁體中文（台灣用語）」。
3. **`uiZh` 與 `uiEn` 中的 `'settings.language.zhTW'`（值為 `'繁體中文'`）**
   - **原因**：依規格第 48 點，語言選單之繁體中文選項固定以該語言的原生自稱（Endonym）「繁體中文」呈現，因此在英文字典中亦保留此字串。
