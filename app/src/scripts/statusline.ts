// 由 Claude Code 執行的 statusline 腳本：記錄用量並輸出一行狀態。絕不丟例外。
import { resolveLanguage, setLanguage, t, resolveLanguageFromConfig } from '../shared/i18n'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as paths from '../core/paths'
import * as storage from '../core/storage'
import * as accounts from '../core/accounts'
import * as sessions from '../core/sessions'

type Win = { used_percentage: number; resets_at: number } | null

function windowOf(rl: Record<string, unknown>, key: string): Win {
  try {
    const w = rl[key] as Record<string, unknown> | null | undefined
    if (!w || typeof w !== 'object' || w.used_percentage === null || w.used_percentage === undefined)
      return null
    const used = Number(w.used_percentage)
    if (!Number.isFinite(used)) return null
    const reset = Number(w.resets_at || 0)
    return { used_percentage: used, resets_at: Number.isFinite(reset) ? reset : 0 }
  } catch {
    return null
  }
}

type Ctx = {
  used_percentage: number | null
  total_input_tokens: number | null
  context_window_size: number | null
} | null

/** 取 stdin 的 context_window；欄位缺失為 null，三個欄位都沒有就整個回傳 null。 */
function contextOf(raw: unknown): Ctx {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const o = raw as Record<string, unknown>
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const c = {
      used_percentage: num(o.used_percentage),
      total_input_tokens: num(o.total_input_tokens),
      context_window_size: num(o.context_window_size)
    }
    return c.used_percentage === null && c.total_input_tokens === null && c.context_window_size === null
      ? null
      : c
  } catch {
    return null
  }
}

/** 四捨六入五成雙（同 Python round）。 */
function roundHalfEven(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  if (diff > 0.5) return f + 1
  if (diff < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

const fmt = (w: Win): string => (w === null ? '--' : `${roundHalfEven(w.used_percentage)}%`)

function pidAliveLocal(pid: unknown): boolean {
  const n = Number(pid)
  if (!Number.isInteger(n) || n <= 0) return false
  try {
    process.kill(n, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 查詢失敗標記的重試間隔（秒）。 */
const PIDMAP_RETRY_S = 60

/** 每個 session 只查一次：找出 claude 程序與父 shell，寫入 pidmap。失敗不影響狀態列。 */
function ensurePidmap(safe: string, sessionId: string, cwd: string): void {
  try {
    // Claude Code 自己維護 sessions 目錄時不需要 pidmap（省掉 PowerShell 查詢的延遲）
    if (sessions.claudeSessionsDirExists()) return
    const file = path.join(paths.pidmapDir(), safe + '.json')
    const old = storage.readJson(file, null) as Record<string, unknown> | null
    const now = Date.now() / 1000
    if (old && typeof old === 'object') {
      if (old.claude_pid && pidAliveLocal(old.claude_pid)) return
      if (!old.claude_pid && now - Number(old.ts || 0) < PIDMAP_RETRY_S) return
    }
    const procs = sessions.listProcessesSync(process.pid)
    const rec = sessions.buildPidmap(procs, process.pid, sessionId, cwd, now) ?? {
      session_id: sessionId,
      cwd,
      claude_pid: null,
      claude_created: 0,
      shell_pid: null,
      shell_name: null,
      ts: now
    }
    storage.writeJsonAtomic(file, rec)
  } catch {
    /* 忽略 */
  }
}

function readStdin(): string {
  try {
    return fs.readFileSync(0, 'utf-8')
  } catch {
    return ''
  }
}

/** 依 config.json 的 language 設定介面語言；沒有檔案或欄位時視同 auto。 */
function initLanguage(): void {
  try {
    setLanguage(resolveLanguageFromConfig(storage.readJson(paths.configFile(), {})))
  } catch {
    setLanguage(resolveLanguage('auto'))
  }
}

function main(): void {
  initLanguage()
  const raw = readStdin()
  let data: Record<string, unknown> = {}
  if (raw.trim()) {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  }

  let slotId: string | null = null
  let name = t('tray.unsaved')
  try {
    slotId = accounts.currentSlotId()
    if (slotId) {
      const slot = accounts.getSlot(slotId)
      if (slot && slot.name) name = String(slot.name)
    }
  } catch {
    slotId = null
  }

  const rlRaw = data.rate_limits
  const rl =
    rlRaw && typeof rlRaw === 'object' && !Array.isArray(rlRaw)
      ? (rlRaw as Record<string, unknown>)
      : {}
  const five = windowOf(rl, 'five_hour')
  const seven = windowOf(rl, 'seven_day')

  const sessionId = String(data.session_id || 'unknown')
  const safe = sessionId.replace(/[^\p{L}\p{N}\-_]/gu, '_')
  const record = {
    session_id: sessionId,
    cwd: String(data.cwd || ''),
    slot_id: slotId,
    ts: Date.now() / 1000,
    five_hour: five,
    seven_day: seven,
    context: contextOf(data.context_window)
  }
  try {
    storage.writeJsonAtomic(path.join(paths.usageDir(), safe + '.json'), record)
  } catch {
    /* 寫不進去也要輸出狀態列 */
  }

  if (data.session_id) ensurePidmap(safe, sessionId, String(data.cwd || ''))

  process.stdout.write(`[${name}] 5h ${fmt(five)} · 7d ${fmt(seven)}\n`)
}

try {
  main()
} catch {
  try {
    process.stdout.write('[switcher]\n')
  } catch {
    /* 忽略 */
  }
}
process.exitCode = 0
