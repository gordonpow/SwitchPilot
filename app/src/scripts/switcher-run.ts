// 派工：依 routing.json 挑 agy 帳號與模型執行提示；agy 額度用完換帳號，全部不行則回報改用 Claude 子代理。
// 用法：switcher-run.cjs --role R --prompt FILE --out FILE --cwd DIR [--allow CMD]... [--dry-run] [--agy PATH]
// 最後一行 stdout 為結果 JSON。exit code：ok=0、failed=1、參數錯誤=2、delegate=10。
// 不做任何網路請求；額度只讀 GUI 寫的快取。token、blob 不得輸出。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import * as paths from '../core/paths'
import * as storage from '../core/storage'
import { acquireFileLock, type FileLock } from '../core/filelock'
import { loadRouting, maxConcurrent, ROLE_IDS, type RoleId, type RouteEntry } from '../core/routing'
import { defaultCredOps, type AgyCred, type AgyCredOps } from '../core/agycred'
import { currentAgySlotId, listAgySlots, switchAgy, type AgySlot } from '../core/agyaccounts'
import { listProcesses, type ProcInfo } from '../core/sessions'
import { killTree, whichFirst } from '../core/procutil'
import type { AgyQuota } from '../core/agyquota'
import {
  registerRunning,
  unregisterRunning,
  listRunning,
  pruneDeadRunning,
  updateRunningChildPid,
  type RunningRecord
} from '../core/dispatchlog'
import { claudeAvailable } from '../core/claudeavail'
import * as config from '../core/config'

const LOCK_STALE_MS = 70 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000
const LONG_PROMPT_CHARS = 20000
const DEFAULT_ALLOW = ['npm test', 'npm run typecheck', 'npm run build']
const EXHAUSTED_FALLBACK_SEC = 5 * 3600
const KEEP_DISPATCH = 200
const LOW_REMAINING = 0.01
const QUOTA_RE = /RESOURCE_EXHAUSTED|rateLimitExceeded|(?:HTTP|status)\s*429|code:\s*429|quota exceeded/i
const STDERR_CAP = 1024 * 1024

const IS_TEST = process.env.CLAUDE_SWITCHER_TEST === '1'

interface Args {
  role: RoleId
  prompt: string
  out: string
  cwd: string
  allow: string[]
  dryRun: boolean
  agy: string | null
}

interface Attempt {
  provider: 'claude' | 'agy'
  model: string
  account?: string
  outcome: string
}

interface Result {
  status: 'ok' | 'delegate' | 'failed'
  provider: 'claude' | 'agy' | null
  model: string | null
  agy_account_email?: string
  attempts: Attempt[]
  message: string
}

class ArgError extends Error {}

function parseArgs(argv: string[]): Args {
  let role = ''
  let prompt = ''
  let out = ''
  let cwd = ''
  const allow: string[] = []
  let dryRun = false
  let agy: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new ArgError(`參數 ${k} 缺少值`)
      return v
    }
    if (k === '--role') role = next()
    else if (k === '--prompt') prompt = next()
    else if (k === '--out') out = next()
    else if (k === '--cwd') cwd = next()
    else if (k === '--allow') allow.push(next())
    else if (k === '--dry-run') dryRun = true
    else if (k === '--agy') {
      agy = next()
      if (!IS_TEST) throw new ArgError('--agy 只能在測試環境使用')
    } else throw new ArgError(`未知參數：${k}`)
  }
  if (!(ROLE_IDS as readonly string[]).includes(role))
    throw new ArgError(`無效的階段：${role || '（未指定）'}`)
  if (!prompt) throw new ArgError('缺少 --prompt')
  if (!out) throw new ArgError('缺少 --out')
  for (const c of allow) {
    if (!c || c.length > 200 || /[\r\n"*?]/.test(c))
      throw new ArgError('--allow 不得為空、超過 200 字元，或含換行、引號、* 與 ?')
  }
  const cwdAbs = path.resolve(cwd || process.cwd())
  const promptAbs = path.resolve(prompt)
  if (!fs.existsSync(promptAbs) || !fs.statSync(promptAbs).isFile())
    throw new ArgError(`找不到提示檔：${prompt}`)
  if (!fs.existsSync(cwdAbs) || !fs.statSync(cwdAbs).isDirectory())
    throw new ArgError(`找不到專案目錄：${cwd}`)
  return {
    role: role as RoleId,
    prompt: promptAbs,
    out: path.resolve(out),
    cwd: cwdAbs,
    allow: allow.length ? allow : DEFAULT_ALLOW,
    dryRun,
    agy
  }
}

// ---- 測試用替身（只在 CLAUDE_SWITCHER_TEST=1 時生效） ----

function fakeCredOps(file: string): AgyCredOps {
  return {
    async read() {
      const v = storage.readJson(file, null) as Partial<AgyCred> | null
      if (!v || typeof v.blob !== 'string') return null
      return { user: typeof v.user === 'string' ? v.user : '', blob: v.blob }
    },
    async write(c) {
      storage.writeJsonAtomic(file, c)
    },
    async remove() {
      fs.rmSync(file, { force: true })
    }
  }
}

function credOps(): AgyCredOps {
  const fake = process.env.CLAUDE_SWITCHER_FAKE_AGYCRED
  return IS_TEST && fake ? fakeCredOps(fake) : defaultCredOps()
}

async function procs(): Promise<ProcInfo[]> {
  const fake = process.env.CLAUDE_SWITCHER_FAKE_PROCS
  if (IS_TEST && fake) {
    const v = storage.readJson(fake, []) as unknown
    return Array.isArray(v) ? (v as ProcInfo[]) : []
  }
  return listProcesses()
}

async function isAgyRunning(): Promise<boolean> {
  return (await procs()).some((p) => /^agy(\.exe)?$/i.test(String(p.name)))
}

// ---- exhausted 與額度快取 ----

const nowSec = (): number => Math.floor(Date.now() / 1000)
const exKey = (slotId: string, model: string): string => `${slotId}|${model.toLowerCase()}`

function readExhausted(): Record<string, number> {
  const v = storage.readJson(paths.agyExhaustedFile(), {}) as unknown
  const out: Record<string, number> = {}
  if (v && typeof v === 'object') {
    for (const [k, u] of Object.entries(v as Record<string, unknown>)) {
      if (typeof u === 'number' && Number.isFinite(u)) out[k] = u
    }
  }
  return out
}

function readQuota(slotId: string): AgyQuota | null {
  const v = storage.readJson(path.join(paths.agyQuotaDir(), `${slotId}.json`), null) as AgyQuota | null
  return v && typeof v === 'object' && v.models && typeof v.models === 'object' ? v : null
}

function modelQuota(
  q: AgyQuota | null,
  model: string
): { remaining: number; resetAt: number | null } | null {
  if (!q) return null
  const want = model.toLowerCase()
  for (const [id, m] of Object.entries(q.models)) {
    if (id.toLowerCase() === want && typeof m?.remaining === 'number') return m
  }
  return null
}

/** 依規格排序候選帳號；排除已標記用完、或快取顯示額度見底且尚未重置者。 */
function pickCandidates(entry: RouteEntry, activeId: string | null): AgySlot[] {
  const now = nowSec()
  const ex = readExhausted()
  const scope = entry.accounts && entry.accounts.length > 0 ? new Set(entry.accounts) : null
  const rows: { slot: AgySlot; remaining: number | null; active: boolean }[] = []
  for (const slot of listAgySlots()) {
    if (scope && !scope.has(slot.id)) continue
    const until = ex[exKey(slot.id, entry.model)]
    if (until !== undefined && until > now) continue
    const mq = modelQuota(readQuota(slot.id), entry.model)
    if (mq && mq.remaining <= LOW_REMAINING && mq.resetAt !== null && mq.resetAt > now) continue
    rows.push({ slot, remaining: mq ? mq.remaining : null, active: slot.id === activeId })
  }
  rows.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    if ((a.remaining === null) !== (b.remaining === null)) return a.remaining === null ? 1 : -1
    return (b.remaining ?? 0) - (a.remaining ?? 0)
  })
  return rows.map((r) => r.slot)
}

/** 標記帳號＋模型額度用完。 */
function markExhausted(slotId: string, model: string): void {
  const now = nowSec()
  const mq = modelQuota(readQuota(slotId), model)
  const until =
    mq && mq.resetAt !== null && mq.resetAt > now ? mq.resetAt : now + EXHAUSTED_FALLBACK_SEC
  const next: Record<string, number> = {}
  for (const [k, u] of Object.entries(readExhausted())) if (u > now) next[k] = u
  next[exKey(slotId, model)] = until
  storage.writeJsonAtomic(paths.agyExhaustedFile(), next)
}

// ---- 執行 agy ----

interface AgyRun {
  code: number | null
  timedOut: boolean
  spawnError: boolean
  stdoutBytes: number
  stdoutText: string
  stderr: string
}

function runAgy(
  args: Args,
  agyArgs: string[],
  onSpawn?: (childPid: number) => void
): Promise<AgyRun> {
  const timeoutMs =
    IS_TEST && Number(process.env.CLAUDE_SWITCHER_RUN_TIMEOUT_MS) > 0
      ? Number(process.env.CLAUDE_SWITCHER_RUN_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
  const bin = args.agy ?? whichFirst(['agy.exe']) ?? 'agy'
  const isScript = /\.(c|m)?js$/i.test(bin)
  const cmd = isScript ? process.execPath : bin
  const cmdArgs = isScript ? [bin, ...agyArgs] : agyArgs
  return new Promise((resolve) => {
    const outStream = fs.createWriteStream(args.out, { flags: 'w' })
    const res: AgyRun = {
      code: null,
      timedOut: false,
      spawnError: false,
      stdoutBytes: 0,
      stdoutText: '',
      stderr: ''
    }
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      outStream.end(() => resolve(res))
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, cmdArgs, {
        cwd: args.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      if (child.pid && onSpawn) {
        onSpawn(child.pid)
      }
    } catch {
      res.spawnError = true
      finish()
      return
    }
    child.stdout?.on('data', (d: Buffer) => {
      outStream.write(d)
      res.stdoutBytes += d.length
      if (res.stdoutText.length < 4096) res.stdoutText += d.toString('utf-8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      outStream.write(d)
      if (res.stderr.length < STDERR_CAP) res.stderr += d.toString('utf-8')
    })
    child.on('error', () => {
      res.spawnError = true
      finish()
    })
    child.on('close', (code) => {
      res.code = code
      finish()
    })
    timer = setTimeout(() => {
      res.timedOut = true
      if (child.pid) void killTree(child.pid).then(finish, finish)
      else finish()
    }, timeoutMs)
  })
}

function readLog(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return ''
  }
}

/** 提示超過 20000 字元時改傳「請讀檔」的短提示（永遠不截斷）。 */
function buildPrompt(args: Args): { text: string; extraDirs: string[] } {
  const text = fs.readFileSync(args.prompt, 'utf-8')
  if (text.length > LONG_PROMPT_CHARS)
    return {
      text: `請完整讀取並照做檔案 ${args.prompt} 中的指示。`,
      extraDirs: [path.dirname(args.prompt)]
    }
  return { text, extraDirs: [] }
}

function agyArgsFor(args: Args, model: string): string[] {
  const settings = JSON.stringify({
    permissions: { allow: args.allow.map((c) => `command(${c})`) }
  })
  const { text, extraDirs } = buildPrompt(args)
  const dirs = [...(process.env.AGY_ADD_DIRS ?? '').split(';').filter(Boolean), ...extraDirs]
  const out = ['--mode', 'accept-edits', '--model', model]
  for (const d of dirs) out.push('--add-dir', d)
  out.push('--settings', settings, '--log-file', args.out + '.agy.log', '-p', text)
  return out
}

// ---- 流程 ----

function writeDispatch(result: Result, role: RoleId, cwd: string, startedAt: number): void {
  try {
    const dir = paths.dispatchDir()
    const ns = BigInt(Date.now()) * 1000000n + (process.hrtime.bigint() % 1000000n)
    storage.writeJsonAtomic(path.join(dir, `${ns}.json`), {
      ...result,
      role,
      cwd,
      started_at: startedAt,
      ended_at: Date.now()
    })
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort()
    for (const n of names.slice(0, Math.max(0, names.length - KEEP_DISPATCH)))
      fs.rmSync(path.join(dir, n), { force: true })
  } catch {
    /* 紀錄失敗不影響派工結果 */
  }
}

/** 處理一個 agy 項目：回傳結果表示結束；回傳 null 表示換清單下一項。 */
async function handleAgyEntry(
  args: Args,
  entry: RouteEntry,
  attempts: Attempt[]
): Promise<Result | null> {
  const ops = credOps()
  const logFile = args.out + '.agy.log'
  let triedAny = false

  // 額度用完時換帳號（R-2），以迴圈重新取鎖執行
  while (true) {
    let lock: FileLock | null = null
    if (!args.dryRun) {
      lock = acquireFileLock(paths.agyLockFile(), { staleMs: LOCK_STALE_MS })
      if (!lock) {
        attempts.push({ provider: 'agy', model: entry.model, outcome: 'agy_busy' })
        return null
      }
    }

    let chosenSlot: AgySlot | null = null
    let recId: string | null = null

    try {
      pruneDeadRunning()
      const running = listRunning()
      const N = maxConcurrent(loadRouting())

      const cur = await ops.read()
      const activeId = await currentAgySlotId(ops)
      // 目前登入存在但沒有對應 slot：切換會覆蓋未儲存的登入，所以不切換
      const unsavedLogin = cur !== null && activeId === null
      const candidates = pickCandidates(entry, activeId)
      if (candidates.length === 0) {
        if (!triedAny) {
          attempts.push({ provider: 'agy', model: entry.model, outcome: 'no_account' })
        }
        return null
      }

      let current = activeId
      for (const slot of candidates) {
        const base = { provider: 'agy' as const, model: entry.model, account: slot.email }
        if (args.dryRun) {
          attempts.push({ ...base, outcome: 'dry_run' })
          return {
            status: 'ok',
            provider: 'agy',
            model: entry.model,
            agy_account_email: slot.email,
            attempts,
            message: `dry-run：會使用 agy ${entry.model}（帳號 ${slot.email}），未執行`
          }
        }

        if (slot.id !== current) {
          if (unsavedLogin && current === null) {
            attempts.push({ ...base, outcome: 'skipped_unsaved_login' })
            continue
          }
          if (running.length > 0 || (await isAgyRunning())) {
            attempts.push({ ...base, outcome: 'skipped_agy_running' })
            continue
          }
          try {
            await switchAgy(ops, slot.id, isAgyRunning)
            current = slot.id
          } catch {
            attempts.push({ ...base, outcome: 'switch_failed' })
            continue
          }
        }

        const count = running.filter((r) => r.slot_id === slot.id).length
        if (count >= N) {
          attempts.push({ ...base, outcome: 'account_busy' })
          continue
        }

        chosenSlot = slot
        triedAny = true
        fs.mkdirSync(path.dirname(args.out), { recursive: true })
        fs.rmSync(logFile, { force: true })
        recId = `${Date.now()}-${process.pid}-${(process.hrtime.bigint() % 1000000n).toString(16)}`
        const rec: RunningRecord = {
          id: recId,
          pid: process.pid,
          role: args.role,
          provider: 'agy',
          model: entry.model,
          slot_id: slot.id,
          account: slot.email,
          cwd: args.cwd,
          out: args.out,
          started_at: Date.now()
        }
        registerRunning(rec)
        break
      }
    } finally {
      lock?.release()
      lock = null
    }

    if (!chosenSlot || !recId) {
      return null
    }

    const base = { provider: 'agy' as const, model: entry.model, account: chosenSlot.email }

    let run: AgyRun
    try {
      run = await runAgy(args, agyArgsFor(args, entry.model), (childPid) => {
        if (recId) updateRunningChildPid(recId, childPid)
      })
    } finally {
      unregisterRunning(recId)
    }

    const log = readLog(logFile)
    if (run.spawnError) {
      attempts.push({ ...base, outcome: 'spawn_failed' })
      return null
    }
    if (run.timedOut) {
      attempts.push({ ...base, outcome: 'timeout' })
      return null
    }
    if (/no output produced/i.test(run.stdoutText) || /soft-denying tool confirmation/i.test(log)) {
      attempts.push({ ...base, outcome: 'permission_denied' })
      return {
        status: 'failed',
        provider: 'agy',
        model: entry.model,
        agy_account_email: chosenSlot.email,
        attempts,
        message: 'agy 執行被拒：提示中的指令與允許清單不符'
      }
    }
    // exit 0 且 stdout 非空一律成功（不看額度字樣）
    if (run.code === 0 && run.stdoutText.trim() !== '') {
      attempts.push({ ...base, outcome: 'ok' })
      return {
        status: 'ok',
        provider: 'agy',
        model: entry.model,
        agy_account_email: chosenSlot.email,
        attempts,
        message: `已由 agy ${entry.model}（帳號 ${chosenSlot.email}）完成，輸出在 ${args.out}`
      }
    }
    // 額度用完時換帳號：已結束的 agy 已在 finally 刪除登記，進入下一輪迴圈重新取鎖
    if (QUOTA_RE.test(run.stderr) || QUOTA_RE.test(log)) {
      markExhausted(chosenSlot.id, entry.model)
      attempts.push({ ...base, outcome: 'quota_exhausted' })
      continue
    }

    attempts.push({
      ...base,
      outcome: run.code === 0 ? 'empty_output' : `failed_exit_${run.code ?? 'null'}`
    })
    return null
  }
}

async function dispatch(args: Args): Promise<Result> {
  const routing = loadRouting()
  const cfg = config.load()
  if (cfg.routing_enabled === false) {
    const roleEntries = routing.roles[args.role] ?? []
    const firstClaude = roleEntries.find((e) => e.provider === 'claude')
    const model = firstClaude?.model ?? 'sonnet'
    return {
      status: 'delegate',
      provider: 'claude',
      model,
      attempts: [],
      message: 'model routing is disabled in Claude Account Switcher; use a Claude subagent'
    }
  }

  const attempts: Attempt[] = []
  for (const entry of routing.roles[args.role]) {
    if (entry.provider === 'claude') {
      const thr = Number(config.load().threshold) || 95
      const avail = claudeAvailable(nowSec(), thr)
      if (!avail.available) {
        attempts.push({ provider: 'claude', model: entry.model, outcome: 'claude_exhausted' })
        continue
      }
      attempts.push({ provider: 'claude', model: entry.model, outcome: 'delegate' })
      return {
        status: 'delegate',
        provider: 'claude',
        model: entry.model,
        attempts,
        message: `請改用 Claude 子代理（model: ${entry.model}）執行`
      }
    }
    const r = await handleAgyEntry(args, entry, attempts)
    if (r) return r
  }
  const hasClaudeExhausted = attempts.some((a) => a.outcome === 'claude_exhausted')
  const hasAccountBusy = attempts.some((a) => a.outcome === 'account_busy')
  const hasAgyBusy = attempts.some((a) => a.outcome === 'agy_busy')

  let message: string
  if (hasClaudeExhausted) {
    message = 'Claude 帳號額度都已用完，且 agy 項目都無法執行'
  } else if (hasAccountBusy) {
    message = 'agy 帳號同時執行的任務已達上限，且沒有 Claude 備援'
  } else if (hasAgyBusy) {
    message = 'agy 正在被其他派工或 GUI 使用中，且沒有 Claude 備援'
  } else {
    message = '清單中沒有可用的項目：agy 帳號都無法執行，且沒有 Claude 備援'
  }

  return {
    status: 'failed',
    provider: null,
    model: null,
    attempts,
    message
  }
}

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`switcher-run：${e instanceof Error ? e.message : String(e)}\n`)
    return 2
  }
  const startedAt = Date.now()
  let result: Result
  try {
    result = await dispatch(args)
  } catch (e) {
    result = {
      status: 'failed',
      provider: null,
      model: null,
      attempts: [],
      message: `派工發生錯誤：${e instanceof Error ? e.name : 'Error'}`
    }
  }
  if (!args.dryRun) writeDispatch(result, args.role, args.cwd, startedAt)
  process.stdout.write(JSON.stringify(result) + '\n')
  return result.status === 'ok' ? 0 : result.status === 'delegate' ? 10 : 1
}

void main().then((code) => {
  process.exitCode = code
})
