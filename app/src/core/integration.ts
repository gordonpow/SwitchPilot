// 安裝／移除 Claude Code settings.json 中的 statusLine 與 hooks。
import { t } from '../shared/i18n'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as paths from './paths'
import * as storage from './storage'
import { findNode } from './nodebin'

type Obj = Record<string, unknown>

// 舊版（Python）的辨識字串；新版另外依 binDir 辨識。
const LEGACY_MARKERS = ['switcher/statusline.py', 'switcher/hook.py']
const DEFAULT_BIN_MARKERS = [
  '.claude-switcher/bin/statusline.cjs',
  '.claude-switcher/bin/hook.cjs',
  '.switchpilot/bin/statusline.cjs',
  '.switchpilot/bin/hook.cjs'
]
const LEGACY_BIN_FRAGMENT = '.claude-switcher/bin/'

const fwd = (p: string): string => p.replace(/\\/g, '/')

function markers(extraBinDir?: string, legacy = true): string[] {
  const list = [...(legacy ? LEGACY_MARKERS : []), ...DEFAULT_BIN_MARKERS]
  for (const d of [paths.binDir(), extraBinDir]) {
    if (d) list.push(`${fwd(d)}/statusline.cjs`, `${fwd(d)}/hook.cjs`)
  }
  return list.map((m) => m.toLowerCase())
}

function isOursCmd(cmd: unknown, extraBinDir?: string, legacy = true): boolean {
  if (typeof cmd !== 'string') return false
  const c = fwd(cmd).toLowerCase()
  return markers(extraBinDir, legacy).some((m) => c.includes(m))
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isOursStatusline(sl: unknown, bin?: string): boolean {
  return isObj(sl) && isOursCmd(sl.command, bin)
}

function loadSettings(): Obj {
  const p = paths.settingsFile()
  if (!fs.existsSync(p)) return {}
  const data = storage.readJsonStrict(p)
  if (!isObj(data)) throw new Error(t('err.settingsNotObject'))
  return data
}

let backupSeq = 0
function backup(settings: Obj): void {
  if (fs.existsSync(paths.settingsFile())) {
    const name = `settings-${Date.now()}${String(backupSeq++ % 1000).padStart(3, '0')}.json`
    storage.writeJsonAtomic(path.join(paths.backupsDir(), name), settings)
  }
}

function stripOursHooks(settings: Obj, bin?: string): void {
  const hooks = settings.hooks
  if (!isObj(hooks)) return
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event]
    if (!Array.isArray(groups)) continue
    const newGroups: unknown[] = []
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) {
        newGroups.push(g)
        continue
      }
      const kept = g.hooks.filter((h) => !(isObj(h) && isOursCmd(h.command, bin)))
      if (kept.length) {
        newGroups.push({ ...g, hooks: kept })
      } else if (g.hooks.length === 0) {
        newGroups.push(g) // 原本就是空的，不是我們造成的
      }
    }
    if (newGroups.length) hooks[event] = newGroups
    else delete hooks[event]
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks
}

export interface InstallOptions {
  nodePath?: string
  binDir?: string
}

/** 安裝 statusLine 與 Stop／StopFailure／UserPromptSubmit hook（同時移除 Python 版項目）。 */
export function install(opts: InstallOptions = {}): void {
  const nodePath = opts.nodePath ?? findNode()
  if (!nodePath) throw new Error(t('err.nodeMissingInstall'))
  const bin = opts.binDir ?? paths.binDir()
  const settings = loadSettings()
  backup(settings)
  const next = structuredClone(settings)

  const base = `"${fwd(nodePath)}" "${fwd(bin)}/`
  const current = next.statusLine
  if (current !== undefined && current !== null && !isOursStatusline(current, bin)) {
    storage.writeJsonAtomic(paths.integrationFile(), { statusLine: current })
  }

  stripOursHooks(next, bin)
  next.statusLine = { type: 'command', command: `${base}statusline.cjs"` }
  if (next.hooks === undefined) next.hooks = {}
  if (!isObj(next.hooks)) throw new Error(t('err.hooksNotObject'))
  const hooks = next.hooks
  const list = (k: string): unknown[] => {
    if (!Array.isArray(hooks[k])) hooks[k] = []
    return hooks[k] as unknown[]
  }
  list('Stop').push({ hooks: [{ type: 'command', command: `${base}hook.cjs" stop` }] })
  list('StopFailure').push({
    matcher: 'rate_limit',
    hooks: [{ type: 'command', command: `${base}hook.cjs" stopfailure` }]
  })
  list('UserPromptSubmit').push({
    hooks: [{ type: 'command', command: `${base}hook.cjs" prompt` }]
  })
  storage.writeJsonAtomic(paths.settingsFile(), next)
}

export function uninstall(opts: { binDir?: string } = {}): void {
  const p = paths.settingsFile()
  if (!fs.existsSync(p)) return
  const settings = loadSettings()
  backup(settings)
  const next = structuredClone(settings)
  stripOursHooks(next, opts.binDir)
  if (isOursStatusline(next.statusLine, opts.binDir)) {
    const saved = storage.readJson(paths.integrationFile(), null)
    if (isObj(saved) && saved.statusLine !== undefined && saved.statusLine !== null) {
      next.statusLine = saved.statusLine
    } else {
      delete next.statusLine
    }
    try {
      fs.unlinkSync(paths.integrationFile())
    } catch {
      /* 忽略 */
    }
  }
  storage.writeJsonAtomic(p, next)
}

function hasHook(hooks: unknown, event: string, bin?: string): boolean {
  if (!isObj(hooks) || !Array.isArray(hooks[event])) return false
  return (hooks[event] as unknown[]).some(
    (g) =>
      isObj(g) &&
      Array.isArray(g.hooks) &&
      g.hooks.some((h) => isObj(h) && isOursCmd(h.command, bin, false))
  )
}

/** settings.json 是否含新版（node／.cjs）的 statusLine 與 Stop、StopFailure、UserPromptSubmit 三個 hook。 */
export function isInstalled(opts: { binDir?: string } = {}): boolean {
  const data = storage.readJson(paths.settingsFile(), null)
  if (!isObj(data)) return false
  const sl = data.statusLine
  if (!(isObj(sl) && isOursCmd(sl.command, opts.binDir, false))) return false
  return (
    hasHook(data.hooks, 'Stop', opts.binDir) &&
    hasHook(data.hooks, 'StopFailure', opts.binDir) &&
    hasHook(data.hooks, 'UserPromptSubmit', opts.binDir)
  )
}

/** 已有新版整合（statusLine 或 Stop hook）但尚未齊全（例如缺 UserPromptSubmit）：需要更新。 */
export function needsUpdate(opts: { binDir?: string } = {}): boolean {
  const data = storage.readJson(paths.settingsFile(), null)
  if (!isObj(data)) return false
  const sl = data.statusLine
  const present =
    (isObj(sl) && isOursCmd(sl.command, opts.binDir, false)) ||
    hasHook(data.hooks, 'Stop', opts.binDir)
  return present && !isInstalled(opts)
}

/** statusLine 或任一 hook 指令是否還指向舊資料夾（.claude-switcher/bin/）。 */
export function usesLegacyBinDir(): boolean {
  const data = storage.readJson(paths.settingsFile(), null)
  if (!isObj(data)) return false
  const legacy = (cmd: unknown): boolean =>
    typeof cmd === 'string' && fwd(cmd).toLowerCase().includes(LEGACY_BIN_FRAGMENT)
  if (isObj(data.statusLine) && legacy(data.statusLine.command)) return true
  const hooks = data.hooks
  if (!isObj(hooks)) return false
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) continue
      if (g.hooks.some((h) => isObj(h) && legacy(h.command))) return true
    }
  }
  return false
}
