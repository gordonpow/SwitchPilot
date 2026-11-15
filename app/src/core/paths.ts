// 所有檔案路徑。每次呼叫都重新讀取環境變數，方便測試覆寫。
import { envVar } from '../shared/env'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function home(): string {
  return os.homedir()
}

// ---- Claude Code 的檔案 ----

export function claudeHome(): string {
  return envVar('CLAUDE_HOME') || path.join(home(), '.claude')
}

export function credFile(): string {
  return path.join(claudeHome(), '.credentials.json')
}

export function settingsFile(): string {
  return path.join(claudeHome(), 'settings.json')
}

export function claudeJson(): string {
  return envVar('CLAUDE_JSON') || path.join(home(), '.claude.json')
}

// ---- 本程式的資料 ----

/** 預設資料夾（新名稱）。 */
export function defaultAppDir(): string {
  return path.join(home(), '.switchpilot')
}

/** 舊版資料夾（~/.claude-switcher）。 */
export function legacyAppDir(): string {
  return path.join(home(), '.claude-switcher')
}

/** 新資料夾「有效」：存在且含 config.json 或 slots/（空資料夾不算，避免遮住舊資料）。 */
export function isValidAppDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'config.json')) || fs.existsSync(path.join(dir, 'slots'))
}

// 只快取「有效的新資料夾」；key 含 homedir，避免 homedir 改變（測試）時用到過時結果。
let cachedNew: { home: string; dir: string } | null = null

export function appDir(): string {
  const override = envVar('HOME')
  if (override) return override
  const h = home()
  if (cachedNew && cachedNew.home === h) return cachedNew.dir
  const newDir = defaultAppDir()
  if (isValidAppDir(newDir)) {
    cachedNew = { home: h, dir: newDir }
    return newDir
  }
  if (fs.existsSync(legacyAppDir())) return legacyAppDir()
  return newDir
}

export const slotsDir = (): string => path.join(appDir(), 'slots')
export const usageDir = (): string => path.join(appDir(), 'usage')
export const eventsDir = (): string => path.join(appDir(), 'events')
export const pidmapDir = (): string => path.join(appDir(), 'pidmap')
export const runsDir = (): string => path.join(appDir(), 'runs')
export const backupsDir = (): string => path.join(appDir(), 'backups')
export const configFile = (): string => path.join(appDir(), 'config.json')
export const activeFile = (): string => path.join(appDir(), 'active.json')
export const integrationFile = (): string => path.join(appDir(), 'integration.json')

/** 由 claude 執行的腳本（statusline.cjs 等）安裝位置。 */
export const binDir = (): string => path.join(appDir(), 'bin')

/** 瀏覽器登入的暫存目錄根（內含權杖，用完必須刪除）。 */
export const loginDir = (): string => path.join(appDir(), 'login')

/** 各帳號 API 用量快取。 */
export const usageApiDir = (): string => path.join(appDir(), 'usage_api')

/** 自動更新下載暫存與日誌目錄。 */
export const updatesDir = (): string => path.join(appDir(), 'updates')

// ---- agy（Antigravity）帳號與派工 ----

export const agyDir = (): string => path.join(appDir(), 'agy')
export const agySlotsDir = (): string => path.join(agyDir(), 'slots')
export const agyQuotaDir = (): string => path.join(agyDir(), 'quota')
/** 跨程序檔案鎖（GUI 與 switcher-run 共用）。 */
export const agyLockFile = (): string => path.join(agyDir(), 'agy.lock')
/** 新增 agy 帳號流程中，被暫時移除的原登入備份（含 OAuth blob）。 */
export const agyLoginBackupFile = (): string => path.join(agyDir(), 'login-backup.json')
export const agyExhaustedFile = (): string => path.join(agyDir(), 'exhausted.json')
/** 派工紀錄。 */
export const dispatchDir = (): string => path.join(appDir(), 'dispatch')
/** 執行中派工登記目錄。 */
export const dispatchRunningDir = (): string => path.join(dispatchDir(), 'running')

/** 自動整理上下文：每個 session 的 lastCompactTs 紀錄。 */
export const compactDir = (): string => path.join(appDir(), 'compact')

/** 模型分工設定。 */
export const routingFile = (): string => path.join(appDir(), 'routing.json')
