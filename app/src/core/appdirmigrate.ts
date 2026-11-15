// 啟動時把舊資料夾（~/.claude-switcher）整個搬到新位置（~/.switchpilot），並留下 junction。
// 不得 import electron。
import * as fs from 'node:fs'
import { envVar } from '../shared/env'
import * as paths from './paths'

export interface MigrateResult {
  status: 'skipped' | 'migrated' | 'failed'
  reason?: string
  junction?: boolean
}

function errCode(e: unknown): string {
  const c = (e as NodeJS.ErrnoException | undefined)?.code
  return typeof c === 'string' ? c : 'UNKNOWN'
}

export function migrateAppDir(opts: { from?: string; to?: string } = {}): MigrateResult {
  const explicit = opts.from !== undefined || opts.to !== undefined
  if (!explicit && envVar('HOME')) return { status: 'skipped', reason: 'env-override' }
  const from = opts.from ?? paths.legacyAppDir()
  const to = opts.to ?? paths.defaultAppDir()

  let st: fs.Stats
  try {
    st = fs.lstatSync(from)
  } catch {
    return { status: 'skipped', reason: 'no-source' }
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return { status: 'skipped', reason: 'not-directory' }

  // 修復：已搬過（新資料夾有效），但舊路徑又被殘留的舊 bin 腳本建成實體資料夾（沒有 config／slots），
  // 導致 junction 建不起來。把殘留資料夾改名保留，再建 junction。
  if (paths.isValidAppDir(to) && !paths.isValidAppDir(from)) {
    try {
      fs.renameSync(from, `${from}.leftover-${Date.now()}`)
    } catch (e) {
      return { status: 'failed', reason: errCode(e) }
    }
    try {
      fs.symlinkSync(to, from, 'junction')
      return { status: 'migrated', reason: 'repaired', junction: true }
    } catch {
      return { status: 'migrated', reason: 'repaired', junction: false }
    }
  }

  if (fs.existsSync(to)) {
    let empty = false
    try {
      empty = fs.statSync(to).isDirectory() && fs.readdirSync(to).length === 0
    } catch {
      empty = false
    }
    if (!empty) return { status: 'skipped', reason: 'target-exists' }
    try {
      fs.rmdirSync(to)
    } catch (e) {
      return { status: 'failed', reason: errCode(e) }
    }
  }

  try {
    fs.renameSync(from, to)
  } catch (e) {
    return { status: 'failed', reason: errCode(e) }
  }

  let junction = false
  try {
    fs.symlinkSync(to, from, 'junction')
    junction = true
  } catch {
    junction = false
  }
  return { status: 'migrated', junction }
}
