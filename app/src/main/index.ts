import {
  app,
  net,
  shell,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  Notification
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Controller } from './controller'
import { IPC, type AppState } from '../shared/types'
import { getLanguage, setSystemLocales, t, type Lang } from '../shared/i18n'
import { dialogToPage, shouldHaveTray, shouldHideOnClose, trayTooltip } from './trayPolicy'

let controller: Controller | null = null
let mainWin: BrowserWindow | null = null
let disposed = false

const screenshotMode = !!process.env['CLAUDE_SWITCHER_SCREENSHOT']
// 以 --hidden 啟動（開機自動啟動）：不顯示視窗；使用者開啟過視窗後清除
let startedHidden = !screenshotMode && process.argv.includes('--hidden')
let quitting = false
let tray: Tray | null = null
let trayTip = ''
let closeToTray = false
let hiddenByClose = false
let hintShown = false
let lastLang: Lang | null = null
// 保留通知物件參考，避免被 GC 後點擊無效
const liveNotices = new Set<Notification>()

function showWindow(): void {
  startedHidden = false
  hiddenByClose = false
  if (!mainWin || mainWin.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
  syncTray()
}

function showNotice(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  liveNotices.add(n)
  const done = (): void => {
    liveNotices.delete(n)
  }
  n.on('click', () => {
    done()
    showWindow()
  })
  n.on('close', done)
  n.show()
}

function currentAccountName(state: AppState): string | null {
  const a = state.accounts.find((x) => x.active)
  return a ? a.name : state.current.email
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: t('tray.open'), click: showWindow },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

function syncTray(state?: AppState): void {
  if (state) {
    closeToTray = !!state.config.close_to_tray
  }
  // 語言改變：更新視窗標題與系統匣選單
  const lang = getLanguage()
  const langChanged = lastLang !== null && lastLang !== lang
  lastLang = lang
  if (langChanged) {
    if (mainWin && !mainWin.isDestroyed()) mainWin.setTitle(t('app.title'))
    if (tray) {
      tray.setContextMenu(buildTrayMenu())
      trayTip = ''
    }
  }
  const want = shouldHaveTray({
    screenshot: screenshotMode,
    closeToTray,
    startedHidden,
    windowHidden: hiddenByClose
  })
  if (!want) {
    if (tray) {
      tray.destroy()
      tray = null
      trayTip = ''
    }
    return
  }
  if (!tray) {
    const img = appIcon().resize({ width: 32, height: 32 })
    tray = new Tray(img)
    trayTip = ''
    tray.on('click', showWindow)
    tray.on('double-click', showWindow)
    tray.setContextMenu(buildTrayMenu())
  }
  const st = state ?? controller?.getState()
  const tip = trayTooltip(st ? currentAccountName(st) : null)
  if (tip !== trayTip) {
    trayTip = tip
    tray.setToolTip(tip)
  }
}

/** 開機自動啟動：未打包時不改登錄，只記 log。 */
function applyLoginItem(enabled: boolean): void {
  if (screenshotMode) return
  if (!app.isPackaged) {
    console.log(`[dev] 略過 setLoginItemSettings(openAtLogin=${enabled})`)
    return
  }
  const exe = process.env['PORTABLE_EXECUTABLE_FILE'] || process.execPath
  app.setLoginItemSettings({ openAtLogin: enabled, path: exe, args: ['--hidden'] })
}

/**
 * 程式圖示。打包後改讀 asar 外的實體檔（extraResources），
 * 避免 nativeImage 讀 asar 內路徑失敗而顯示空白圖示。
 */
let iconCache: Electron.NativeImage | null = null
function appIcon(): Electron.NativeImage {
  if (iconCache) return iconCache
  const candidates = app.isPackaged ? [join(process.resourcesPath, 'icon.png'), icon] : [icon]
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return (iconCache = img)
  }
  console.error('找不到程式圖示')
  return (iconCache = nativeImage.createEmpty())
}

function scriptsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'scripts')
    : join(app.getAppPath(), 'resources', 'scripts')
}

function setupController(): Controller {
  setSystemLocales(app.getPreferredSystemLanguages())
  const c = new Controller({
    scriptsDir: scriptsDir(),
    // Chromium 網路堆疊：使用 Windows 憑證存放區與系統 proxy（Node fetch 不信任攔截用根憑證）
    fetchImpl: ((input, init) => net.fetch(input as string, init as RequestInit)) as typeof fetch,
    agyFetch: ((input, init) => net.fetch(input as string, init as RequestInit)) as typeof fetch,
    push: (state) => {
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.push, state)
      try {
        syncTray(state)
      } catch (e) {
        console.error('更新系統匣失敗：' + (e instanceof Error ? e.message : String(e)))
      }
    },
    notify: (title, body) => showNotice(title, body),
    applyLoginItem,
    copyText: (text) => clipboard.writeText(text)
  })
  ipcMain.handle(IPC.getState, () => c.getState())
  ipcMain.handle(IPC.saveCurrent, (_e, name: string) => c.saveCurrent(name))
  ipcMain.handle(IPC.switchTo, (_e, id: string, restart: boolean) => c.switchTo(id, restart))
  ipcMain.handle(IPC.renameSlot, (_e, id: string, name: string) => c.renameSlot(id, name))
  ipcMain.handle(IPC.deleteSlot, (_e, id: string) => c.deleteSlot(id))
  ipcMain.handle(IPC.refreshUsage, () => c.refreshUsage())
  ipcMain.handle(IPC.clearExhausted, () => c.clearExhausted())
  ipcMain.handle(IPC.startLogin, (_e, browser, relogin) => c.startLogin(browser, relogin))
  ipcMain.handle(IPC.cancelLogin, () => c.cancelLogin())
  ipcMain.handle(IPC.completeLogin, (_e, name: string) => c.completeLogin(name))
  ipcMain.handle(IPC.copyLoginUrl, () => c.copyLoginUrl())
  ipcMain.handle(IPC.pickFolder, async () => {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      defaultPath: c.getState().config.last_folder || undefined
    }
    const r = mainWin
      ? await dialog.showOpenDialog(mainWin, opts)
      : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.launch, (_e, folder: string, cont: boolean) => c.launch(folder, cont))
  ipcMain.handle(IPC.setConfig, (_e, patch) => c.setConfig(patch))
  ipcMain.handle(IPC.installIntegration, () => c.installIntegration())
  ipcMain.handle(IPC.uninstallIntegration, () => c.uninstallIntegration())
  ipcMain.handle(IPC.agySaveCurrent, (_e, name: string) => c.agySaveCurrent(name))
  ipcMain.handle(IPC.agySwitch, (_e, id: string) => c.agySwitch(id))
  ipcMain.handle(IPC.agyRename, (_e, id: string, name: string) => c.agyRename(id, name))
  ipcMain.handle(IPC.agyDelete, (_e, id: string) => c.agyDelete(id))
  ipcMain.handle(IPC.agyStartLogin, () => c.agyStartLogin())
  ipcMain.handle(IPC.agyCancelLogin, () => c.agyCancelLogin())
  ipcMain.handle(IPC.agyFinishLogin, () => c.agyFinishLogin())
  ipcMain.handle(IPC.agyRefreshQuota, () => c.agyRefreshQuota())
  ipcMain.handle(IPC.setRouting, (_e, r) => c.setRouting(r))
  return c
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    title: t('app.title'),
    backgroundColor: '#0a0a0a',
    show: false,
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWin = mainWindow
  mainWindow.on('closed', () => {
    if (mainWin === mainWindow) mainWin = null
  })
  mainWindow.on('ready-to-show', () => {
    if (startedHidden) {
      syncTray()
      return
    }
    mainWindow.show()
  })
  // 關機或登出時不得攔截視窗關閉
  mainWindow.on('session-end', () => {
    quitting = true
  })
  mainWindow.on('close', (e) => {
    if (!shouldHideOnClose({ quitting, closeToTray, startedHidden, screenshot: screenshotMode })) {
      return
    }
    e.preventDefault()
    hiddenByClose = true
    mainWindow.hide()
    syncTray()
    if (!hintShown) {
      hintShown = true
      showNotice(t('app.title'), t('app.backgroundHint'))
    }
  })

  // 開發驗證用：設定 CLAUDE_SWITCHER_SCREENSHOT=<png 路徑> 時，載入後截圖並結束
  const shotPath = process.env['CLAUDE_SWITCHER_SCREENSHOT']
  if (shotPath) {
    const size = (process.env['CLAUDE_SWITCHER_SCREENSHOT_SIZE'] || '').split('x').map(Number)
    if (size.length === 2 && size[0] > 0 && size[1] > 0) mainWindow.setSize(size[0], size[1])
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await mainWindow.webContents.capturePage()
        require('fs').writeFileSync(shotPath, img.toPNG())
        app.quit()
      }, 4000)
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const legacy = process.env['CLAUDE_SWITCHER_SCREENSHOT_DIALOG']
    const page =
      process.env['CLAUDE_SWITCHER_SCREENSHOT_PAGE'] || (legacy ? dialogToPage(legacy) : '')
    mainWindow.loadFile(
      join(__dirname, '../renderer/index.html'),
      shotPath && page ? { query: { page } } : undefined
    )
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// 單一實例鎖要在 whenReady 之前取；失敗就不建 controller 與 IPC。截圖模式不取鎖。
const gotLock = screenshotMode ? true : app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.on('second-instance', (_e, argv) => {
  // 開機自動啟動的第二個實例（--hidden）不應把視窗叫出來
  if (argv.includes('--hidden')) return
  showWindow()
})

if (gotLock)
  app.whenReady().then(() => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('local.claude-switcher')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    controller = setupController()
    createWindow()
    controller.start()
    try {
      syncTray(controller.getState())
    } catch (e) {
      console.error('建立系統匣失敗：' + (e instanceof Error ? e.message : String(e)))
    }

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 結束前先取消登入、停止計時器
app.on('before-quit', (e) => {
  quitting = true
  if (tray) {
    tray.destroy()
    tray = null
  }
  if (disposed || !controller) return
  disposed = true
  e.preventDefault()
  void controller.dispose().finally(() => app.quit())
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
