// 主程序控制器：輪詢、切換流程、登入流程、狀態推送。
// 移植自 Python gui.py 的非 UI 邏輯。不 import electron：Notification、clipboard 等由外部注入。
// 任何事件、log、錯誤訊息都不得包含 token。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import * as accounts from '../core/accounts'
import { defaultCredOps, parseBlob, type AgyCred, type AgyCredOps } from '../core/agycred'
import * as agyacc from '../core/agyaccounts'
import { fetchAgyQuota, readAgyQuota, writeAgyQuota, type FetchLike } from '../core/agyquota'
import { acquireFileLock, type FileLock } from '../core/filelock'
import * as routingMod from '../core/routing'
import * as config from '../core/config'
import * as integration from '../core/integration'
import * as launcherMod from '../core/launcher'
import { withSlotLock } from '../core/lock'
import * as login from '../core/login'
import { Monitor, type EventRecord, type UsageRecord } from '../core/monitor'
import * as nodebin from '../core/nodebin'
import { slotBlocked } from '../core/claudeavail'
import { needsRelogin, readUsageApi, UsagePoller, type FetchImpl, type UsageApiRecord } from '../core/oauth'
import * as paths from '../core/paths'
import { pidAlive, killTree, whichFirst } from '../core/procutil'
import * as sessions from '../core/sessions'
import { injectCtrlKey, injectLine, injectSubmit } from '../core/coninject'
import * as storage from '../core/storage'
import * as switchplan from '../core/switchplan'
import * as usage from '../core/usage'
import * as dispatchlog from '../core/dispatchlog'
import {
  getLanguage,
  resolveLanguage,
  setLanguage,
  t
} from '../shared/i18n'
import type {
  AccountView,
  AgyAccountView,
  AgyLoginView,
  Routing,
  AppConfigPatch,
  AppState,
  CliView,
  DispatchRecentView,
  DispatchRunningView,
  ErrorCode,
  EventItem,
  LoginBrowser,
  LoginView,
  Result,
  RunView,
  UsageWindow
} from '../shared/types'

const TICK_MS = 3000
const CLEANUP_EVERY_S = 600
const API_BLOCK_WINDOW_S = 600
const LOGIN_POLL_MS = 1000
const LOGIN_TIMEOUT_MS = 300_000
const PUSH_THROTTLE_MS = 200
const MAX_EVENTS = 200
const NODE_CACHE_MS = 60_000
const SCAN_MS = 15_000
/** 不重啟模式：切換後處理舊帳號 stopfailure 的視窗（秒） */
const LIVE_WINDOW_S = 30
/** 切換當下送提示：該 session 最後一次 stopfailure 距今不得超過此秒數 */
const INTERRUPT_MAX_AGE_S = 900
/** 找不到可切換目標後，自動切換暫停的秒數 */
const NO_TARGET_PAUSE_S = 60
/** 自動整理：送出後這段秒數內的 prompt 事件視為整理本身造成，不算新 prompt */
const COMPACT_IGNORE_S = 30
/** agy 額度輪詢間隔 */
const AGY_POLL_MS = 5 * 60 * 1000
/** agy 登入流程：輪詢間隔與逾時 */
const AGY_LOGIN_POLL_MS = 2000
const AGY_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const AGY_LOCK_STALE_MS = 70 * 60 * 1000
/** access token 剩餘時間低於此值視為過期，不查額度 */
const AGY_TOKEN_MARGIN_MS = 60_000
const AGY_DEFAULT_VERSION = '1.5.8'
const agyBusyMsg = (): string => t('agy.busyDispatch')
const SAFE_SESSION_RE = /^[0-9A-Za-z-]{1,64}$/

/** 每個 session 的 turn 相關事件時間（unix 秒）；自動整理用。 */
interface SessionEvents {
  lastPromptTs: number
  lastStopTs: number
  lastStopFailureTs: number
  /** 任何 prompt／stop／stopfailure 事件 */
  lastEventTs: number
  lastKind: 'prompt' | 'stop' | 'stopfailure' | null
}

/** 自動整理後清除畫面待處理紀錄（AC-14'、R-7）。 */
interface PendingClear {
  pid: number
  sid: string
  sentAt: number
  sawBusy: boolean
  ctxAtSend: number | null
  cwd?: string | null
}

/** 資料夾比對：忽略大小寫、斜線方向與結尾斜線；子資料夾也算。 */
function normFolder(p: string): string {
  return p.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function folderMatches(cwd: string | null, folders: string[]): boolean {
  if (folders.length === 0) return true
  if (!cwd) return false
  const c = normFolder(cwd)
  return folders.some((f) => {
    const n = normFolder(f)
    return n !== '' && (c === n || c.startsWith(n + '\\'))
  })
}

export interface PollerLike {
  pollAll(): Promise<boolean>
  readonly running: boolean
  /** 切換前確保目標帳號 token 有效；沒實作時視為 'ok'。 */
  ensureFresh?(slotId: string): Promise<'ok' | 'dead' | 'error'>
}

export interface LauncherLike {
  launch(
    folder: string,
    cont: boolean,
    opts: {
      node: string
      binDir: string
      resume?: string
      prompt?: string
      extraArgs?: string[]
    }
  ): string
  activeRuns(): launcherMod.RunState[]
  requestRestart(run: launcherMod.RunState): Promise<boolean>
  releaseRestart(run: launcherMod.RunState, opts?: launcherMod.RestartOptions): void
  abortRestart(run: launcherMod.RunState): void
}

/** 外部 CLI 相關的系統操作；測試注入假的。 */
export interface CliOps {
  listProcesses(): Promise<sessions.ProcInfo[]>
  kill(pid: number): Promise<boolean>
  inject(shellPid: number, line: string): Promise<boolean>
  /** 對執行中的 claude 輸入文字並送出（先文字、再單獨送 Enter） */
  injectSubmit(claudePid: number, text: string): Promise<boolean>
  /** 送出 Ctrl+字母到目標 console */
  injectCtrlKey?: (targetPid: number, letter: string) => Promise<boolean>
}

const defaultCliOps = (): CliOps => {
  const fake = process.env.CLAUDE_SWITCHER_FAKE_CLIS
  return {
    // 僅供畫面截圖：CLAUDE_SWITCHER_FAKE_CLIS=<ProcInfo[] 的 JSON 檔>，此時 kill／inject 不做任何事
    listProcesses: fake
      ? async () => {
          try {
            return JSON.parse(fs.readFileSync(fake, 'utf-8')) as sessions.ProcInfo[]
          } catch {
            return []
          }
        }
      : sessions.listProcesses,
    kill: fake ? async () => false : killTree,
    inject: fake ? async () => false : (pid, line) => injectLine(pid, line),
    injectSubmit: fake ? async () => false : (pid, text) => injectSubmit(pid, text),
    injectCtrlKey: fake ? async () => false : (pid, letter) => injectCtrlKey(pid, letter)
  }
}

/** 預設的 agy 版本查詢：執行 `agy --version` 取第一個 x.y.z，失敗用 1.5.8。 */
function defaultAgyVersion(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const bin = whichFirst(['agy.exe']) ?? 'agy'
      execFile(
        bin,
        ['--version'],
        { windowsHide: true, timeout: 10000, encoding: 'utf8' },
        (err, out) => {
          const m = err ? null : /\d+\.\d+\.\d+/.exec(String(out))
          resolve(m ? m[0] : AGY_DEFAULT_VERSION)
        }
      )
    } catch {
      resolve(AGY_DEFAULT_VERSION)
    }
  })
}

/** 預設的 agy 登入：以 wt 開新分頁執行 agy（標題「agy 登入」），找不到 wt 用 cmd /c start。 */
function defaultLaunchAgyLogin(): void {
  const agy = whichFirst(['agy.exe']) ?? 'agy'
  const local = process.env.LOCALAPPDATA
  const extra = local ? path.join(local, 'Microsoft', 'WindowsApps') : ''
  const wt = whichFirst(['wt.exe'], (process.env.PATH ?? '') + (extra ? ';' + extra : ''))
  const opts = { env: { ...process.env }, detached: true, stdio: 'ignore' as const }
  const child = wt
    ? spawn(wt, ['-w', 'new', '--title', t('agy.loginTitle'), agy], opts)
    : spawn('cmd.exe', ['/d', '/c', 'start', t('agy.loginTitle'), agy], opts)
  child.on('error', () => {})
  child.unref()
}

/** 僅供畫面截圖：CLAUDE_SWITCHER_FAKE_AGYCRED=<json 檔> 時用檔案當認證管理員；停用輪詢時不碰真的認證管理員。 */
function fileCredOps(file: string): AgyCredOps {
  return {
    async read() {
      const v = storage.readJson(file, null) as Partial<AgyCred> | null
      return v && typeof v.blob === 'string' ? { user: String(v.user ?? ''), blob: v.blob } : null
    },
    async write(c) {
      storage.writeJsonAtomic(file, c)
    },
    async remove() {
      fs.rmSync(file, { force: true })
    }
  }
}

const inertCredOps: AgyCredOps = {
  read: async () => null,
  write: async () => undefined,
  remove: async () => undefined
}

export interface LoginSessionLike {
  startedAt: number
  start(): void
  poll(): login.LoginPoll
  loginUrl(): string | null
  lastLines(n?: number): string[]
  result(): { creds: Record<string, unknown>; account: Record<string, unknown> }
  cancel(): Promise<void>
  cleanup(): void
}

export interface ControllerDeps {
  /** 毫秒。 */
  now?: () => number
  poller?: PollerLike
  launcher?: LauncherLike
  notify?: (title: string, body: string) => void
  findNode?: () => string | null
  scriptsDir?: string
  push?: (state: AppState) => void
  createLogin?: (opts: { node: string; binDir: string; browser: LoginBrowser }) => LoginSessionLike
  copyText?: (text: string) => void
  pidAlive?: (pid: number) => boolean
  cli?: CliOps
  /** 用量 API／token 更新使用的 fetch（main 傳入 Electron net.fetch，以信任系統憑證）。 */
  fetchImpl?: FetchImpl
  /** 讀取 Claude 的 sessions 檔（測試可注入）。 */
  readClaudeSessions?: () => sessions.ClaudeSessionRec[]
  /** inject 前等待毫秒數（預設 800）。 */
  injectDelayMs?: number
  /** 不啟動用量輪詢（亦可用環境變數 CLAUDE_SWITCHER_DISABLE_POLL=1）。 */
  disablePoll?: boolean
  /** 等待 claude 結束：檢查間隔與上限（毫秒）。 */
  waitIntervalMs?: number
  waitMaxMs?: number
  /** agy 登入資料（認證管理員）存取；測試注入假的。 */
  agyCred?: AgyCredOps
  /** 取得 agy 版本（額度 API 的 User-Agent 用）。 */
  agyVersion?: () => Promise<string>
  /** agy 額度查詢用的 fetch（main 傳入 net.fetch）。 */
  agyFetch?: FetchLike
  /** 開新分頁執行 agy 讓使用者登入。 */
  launchAgyLogin?: () => void
  /** 套用「開機自動啟動」（main 注入 setLoginItemSettings）；丟例外表示失敗。 */
  applyLoginItem?: (enabled: boolean) => void
}

class ControllerError extends Error {
  constructor(
    message: string,
    public code: ErrorCode
  ) {
    super(message)
    this.name = 'ControllerError'
  }
}

const ok: Result = { ok: true }
const fail = (error: string, code: ErrorCode = 'UNKNOWN'): Result => ({ ok: false, error, code })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function toWindow(v: unknown): UsageWindow {
  if (!isObj(v)) return null
  const u = Number(v.used_percentage)
  if (v.used_percentage === null || v.used_percentage === undefined || !Number.isFinite(u)) {
    return null
  }
  const r = Number(v.resets_at)
  return { used_percentage: u, resets_at: Number.isFinite(r) ? r : 0 }
}

const idleLogin = (): LoginView => ({
  state: 'idle',
  url: null,
  email: null,
  message: null,
  startedAt: null,
  reloginSlotId: null,
  defaultName: null
})

export class Controller {
  readonly monitor: Monitor
  private cfg: config.Config
  private now: () => number
  private poller: PollerLike
  private launcher: LauncherLike
  private notify: (title: string, body: string) => void
  private findNodeFn: () => string | null
  private scriptsDir: string | undefined
  private pushFn: (state: AppState) => void
  private createLogin: NonNullable<ControllerDeps['createLogin']>
  private copyText: ((text: string) => void) | undefined
  private alive: (pid: number) => boolean
  private pollDisabled: boolean
  private cli: CliOps
  private scanEnabled: boolean
  private injectDelayMs: number
  private waitIntervalMs: number
  private waitMaxMs: number
  private agyOps: AgyCredOps
  private agyVersionFn: () => Promise<string>
  private agyVersionCache: string | null = null
  private agyFetchImpl: FetchLike | undefined
  private launchAgyLoginFn: () => void
  private agyCur: { email: string | null; slotId: string | null; expiryMs: number | null } | null =
    null
  private agyQuerying = false
  private agyPollTimer: NodeJS.Timeout | null = null
  private agyBusyOp = false
  private agyLoginView: AgyLoginView = { state: 'idle', email: null, message: null }
  private agyLoginCtx: {
    backup: AgyCred | null
    lock: FileLock
    startedMs: number
    sawAgy: boolean
    noAgyCount: number
    detected: { email: string } | null
  } | null = null
  private agyLoginTimer: NodeJS.Timeout | null = null
  private agyLoginBusy = false

  private events: EventItem[] = []
  private watermark: string | null = null
  private switching = false
  private pendingLogged = false
  private warnedExhaust = false
  /** 本次切換後是否已記錄過「statusline 為舊帳號資料」 */
  private foreignLogged = false
  /** unix 秒：此時間前不再嘗試自動切換（上次找不到目標） */
  private noTargetUntil = 0
  private warnedMismatch = false
  private lastCleanup = 0
  private lastPollAt: number | null = null
  private ticking = false
  private readSessionsFn: () => sessions.ClaudeSessionRec[]
  private turns = new Map<string, sessions.TurnRec>()
  private sessEv = new Map<string, SessionEvents>()
  /** session → 上次送出整理的時間（unix 秒）；同步存在 compact/<session>.json */
  private lastCompact = new Map<string, number>()
  private compactInFlight = false
  private pendingClear = new Map<string, PendingClear>()
  private clis: CliView[] = []
  private clisScannedAt: number | null = null
  private scanP: Promise<sessions.DetectedCli[]> | null = null
  private lastScan: sessions.DetectedCli[] = []
  /** 不重啟模式切換後 30 秒內的接續狀態；done 為本次切換已送過提示的 session */
  private liveContinue: { until: number; done: Set<string> } | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private disposed = false

  private tickTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private lastPushed = ''

  private nodeCache: { path: string | null; at: number } | null = null

  private loginSession: LoginSessionLike | null = null
  private loginView: LoginView = idleLogin()
  private loginStartedMs = 0
  private loginTimer: NodeJS.Timeout | null = null
  private loginResult: {
    creds: Record<string, unknown>
    account: Record<string, unknown>
  } | null = null

  private applyLoginItemFn: ((enabled: boolean) => void) | undefined

  constructor(deps: ControllerDeps = {}) {
    this.now = deps.now ?? Date.now
    this.cfg = config.load()
    setLanguage(resolveLanguage(this.cfg.language))
    this.monitor = new Monitor(Number(this.cfg.threshold) || 95)
    this.monitor.waitTurnEnd = this.cfg.switch_mode === 'restart'
    this.poller =
      deps.poller ??
      new UsagePoller({
        fetchImpl: deps.fetchImpl,
        now: this.now,
        isPaused: () => this.switching,
        log: (level, text) => this.log(level, text)
      })
    this.launcher = deps.launcher ?? launcherMod
    this.notify = deps.notify ?? (() => undefined)
    this.findNodeFn = deps.findNode ?? nodebin.findNode
    this.scriptsDir = deps.scriptsDir
    this.pushFn = deps.push ?? (() => undefined)
    this.createLogin = deps.createLogin ?? ((o) => new login.LoginSession(o))
    this.copyText = deps.copyText
    this.alive = deps.pidAlive ?? pidAlive
    this.pollDisabled = deps.disablePoll ?? process.env.CLAUDE_SWITCHER_DISABLE_POLL === '1'
    this.cli = deps.cli ?? defaultCliOps()
    this.readSessionsFn = deps.readClaudeSessions ?? sessions.readClaudeSessions
    this.injectDelayMs = deps.injectDelayMs ?? 800
    this.scanEnabled = !this.pollDisabled || !!process.env.CLAUDE_SWITCHER_FAKE_CLIS
    this.waitIntervalMs = deps.waitIntervalMs ?? 500
    this.waitMaxMs = deps.waitMaxMs ?? 10_000
    this.agyOps =
      deps.agyCred ??
      (process.env.CLAUDE_SWITCHER_FAKE_AGYCRED
        ? fileCredOps(process.env.CLAUDE_SWITCHER_FAKE_AGYCRED)
        : this.pollDisabled
          ? inertCredOps
          : defaultCredOps())
    this.agyVersionFn = deps.agyVersion ?? defaultAgyVersion
    this.agyFetchImpl = deps.agyFetch ?? deps.fetchImpl
    this.launchAgyLoginFn = deps.launchAgyLogin ?? defaultLaunchAgyLogin
    this.applyLoginItemFn = deps.applyLoginItem
    this.watermark = usage.readNewEvents(null).last
    this.ingestTurns(usage.allEvents())
  }

  private nowSec(): number {
    return this.now() / 1000
  }

  // ---------- 事件與推送 ----------
  log(level: EventItem['level'], text: string): void {
    this.events.push({ ts: Math.floor(this.nowSec()), text, level })
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.requestPush()
  }

  /** 節流 200 ms；內容沒變就不推送。 */
  requestPush(): void {
    if (this.disposed || this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.flushPush()
    }, PUSH_THROTTLE_MS)
  }

  /** 立即推送（內容有變才送）。 */
  flushPush(): void {
    if (this.disposed) return
    try {
      const state = this.buildState()
      const json = JSON.stringify(state)
      if (json === this.lastPushed) return
      this.lastPushed = json
      this.pushFn(state)
    } catch (e) {
      // 推送失敗不影響主流程
      console.error('推送狀態失敗：' + errMsg(e))
    }
  }

  // ---------- 啟動與結束 ----------
  start(): void {
    try {
      login.cleanupStale()
    } catch {
      /* 忽略 */
    }
    this.watermark = usage.readNewEvents(null).last
    // 記下實際語言給外部腳本（statusline、runner）用：它們的系統語言來源（Intl）可能與 Electron 不同
    if (this.cfg.language_resolved !== getLanguage()) {
      try {
        this.cfg = { ...this.cfg, language_resolved: getLanguage() }
        config.save(this.cfg)
      } catch {
        /* 寫不進去時腳本退回自行判斷 */
      }
    }
    try {
      this.ensureScripts()
    } catch (e) {
      this.log('warn', t('log.scriptsInstallFailed', { error: errMsg(e) }))
    }
    try {
      this.applyLoginItemFn?.(!!this.cfg.launch_at_login)
    } catch (e) {
      this.log('warn', t('log.loginItemApplyFailed', { error: errMsg(e) }))
    }
    this.log('info', t('log.started', { count: accounts.listSlots().length }))
    this.scheduleTick(0)
    if (!this.pollDisabled) this.schedulePoll(1000)
    if (this.scanEnabled) this.scheduleScan(1000)
    void this.restoreAgyLoginBackup().then(() => {
      if (!this.pollDisabled) this.scheduleAgyPoll(3000)
      else void this.refreshAgyCurrent()
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const t of [
      this.tickTimer,
      this.pollTimer,
      this.pushTimer,
      this.loginTimer,
      this.scanTimer,
      this.agyPollTimer,
      this.agyLoginTimer
    ]) {
      if (t) clearTimeout(t)
    }
    this.tickTimer = this.pollTimer = this.pushTimer = this.loginTimer = this.scanTimer = null
    this.agyPollTimer = this.agyLoginTimer = null
    // 關閉程式時釋放登入流程持有的鎖（backup 檔保留，下次啟動會還原）
    this.agyLoginCtx?.lock.release()
    this.agyLoginCtx = null
    const s = this.loginSession
    this.loginSession = null
    this.loginResult = null
    if (s) {
      try {
        await s.cancel()
      } catch {
        /* 忽略 */
      }
    }
  }

  private scheduleTick(delay: number): void {
    if (this.disposed) return
    this.tickTimer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleTick(TICK_MS))
    }, delay)
  }

  private schedulePoll(delay: number): void {
    if (this.disposed) return
    this.pollTimer = setTimeout(() => {
      void this.pollNow().finally(() =>
        this.schedulePoll(Math.max(30, Number(this.cfg.usage_poll_seconds) || 120) * 1000)
      )
    }, delay)
  }

  // ---------- 外部 CLI 掃描 ----------
  /** 增量更新 turn 狀態：每個 session 取 ts 最新的 prompt／stop／stopfailure。 */
  private ingestTurns(evs: ReadonlyArray<{ [k: string]: unknown }>): void {
    for (const e of evs) {
      const kind = e.kind
      const sid = e.session_id
      const ts = Number(e.ts)
      if (typeof sid !== 'string' || !sid || !Number.isFinite(ts)) continue
      if (kind !== 'prompt' && kind !== 'stop' && kind !== 'stopfailure') continue
      const old = this.turns.get(sid)
      if (!old || ts >= old.ts) {
        this.turns.set(sid, { kind, ts, error: typeof e.error === 'string' ? e.error : null })
      }
      let se = this.sessEv.get(sid)
      if (!se) {
        se = {
          lastPromptTs: 0,
          lastStopTs: 0,
          lastStopFailureTs: 0,
          lastEventTs: 0,
          lastKind: null
        }
        this.sessEv.set(sid, se)
      }
      if (kind === 'prompt') se.lastPromptTs = Math.max(se.lastPromptTs, ts)
      else if (kind === 'stop') se.lastStopTs = Math.max(se.lastStopTs, ts)
      else se.lastStopFailureTs = Math.max(se.lastStopFailureTs, ts)
      if (ts >= se.lastEventTs) {
        se.lastEventTs = ts
        se.lastKind = kind
      }
    }
  }

  // ---------- 自動整理上下文 ----------
  private compactFile(sid: string): string {
    return path.join(paths.compactDir(), `${sid}.json`)
  }

  private getLastCompact(sid: string): number {
    const m = this.lastCompact.get(sid)
    if (m !== undefined) return m
    const rec = storage.readJson(this.compactFile(sid), null)
    const v = isObj(rec) ? Number(rec.last_compact_ts) : 0
    const ts = Number.isFinite(v) && v > 0 ? v : 0
    this.lastCompact.set(sid, ts)
    return ts
  }

  private setLastCompact(sid: string, ts: number): void {
    this.lastCompact.set(sid, ts)
    try {
      storage.writeJsonAtomic(this.compactFile(sid), { session_id: sid, last_compact_ts: ts })
    } catch {
      /* 寫檔失敗仍以記憶體為準 */
    }
  }

  /** 每個 session 最新的 statusline 紀錄（依 ts）。 */
  private latestUsageBySession(): Map<string, usage.UsageFileRecord> {
    const best = new Map<string, usage.UsageFileRecord>()
    for (const r of usage.allUsage()) {
      const sid = r.session_id
      if (typeof sid !== 'string' || typeof r.ts !== 'number') continue
      const old = best.get(sid)
      if (!old || r.ts > old.ts) best.set(sid, r)
    }
    return best
  }

  /**
   * 自動整理：同一次最多處理 1 個 session（多個候選取 lastStopTs 最舊者）。
   * 條件見規格 D 與 R-3；log 只寫資料夾、PID 與上下文百分比。
   */
  private async maybeCompact(nowSec: number): Promise<void> {
    const ac = this.cfg.auto_compact
    if (!ac.enabled || this.compactInFlight || this.disposed) return
    const lc = this.liveContinue
    const usages = this.latestUsageBySession()
    let fresh: sessions.ClaudeSessionRec[] | null = null
    let best: { cli: sessions.DetectedCli; stopTs: number; pct: string } | null = null
    for (const cli of this.lastScan) {
      const sid = cli.sessionId
      if (!sid || !cli.interactive || !SAFE_SESSION_RE.test(sid)) continue
      if (!folderMatches(cli.cwd, ac.folders)) continue
      if (lc && !lc.done.has(sid)) continue
      const ev = this.sessEv.get(sid)
      if (!ev || ev.lastKind !== 'stop') continue
      if (!(nowSec - ev.lastStopTs >= ac.wait_seconds) || ev.lastEventTs !== ev.lastStopTs) continue
      const last = this.getLastCompact(sid)
      if (!(ev.lastPromptTs > last + COMPACT_IGNORE_S)) continue
      const u = usages.get(sid)
      if (!u || !(u.ts > last) || !isObj(u.context)) continue
      const ctx = u.context
      const used = Number(ctx.used_percentage)
      const tokens = Number(ctx.total_input_tokens)
      const value = ac.threshold_type === 'percent' ? used : tokens
      if (ctx[ac.threshold_type === 'percent' ? 'used_percentage' : 'total_input_tokens'] == null)
        continue
      if (!Number.isFinite(value) || value < ac.threshold) continue
      if (!this.alive(cli.claudePid)) continue
      // 判斷當下重讀 sessions 檔（不用 15 秒前的掃描結果）
      if (fresh === null) {
        try {
          fresh = this.readSessionsFn()
        } catch {
          fresh = []
        }
      }
      const rec = fresh.find((s) => s.pid === cli.claudePid && s.sessionId === sid)
      if (!rec || rec.status !== 'idle') continue
      if (!best || ev.lastStopTs < best.stopTs) {
        const size = Number(ctx.context_window_size)
        const pct =
          Number.isFinite(used) && ctx.used_percentage != null
            ? `${Math.round(used)}%`
            : Number.isFinite(tokens) && size > 0
              ? `${Math.round((tokens / size) * 100)}%`
              : `${Math.round(tokens)} tokens`
        best = { cli, stopTs: ev.lastStopTs, pct }
      }
    }
    if (!best) return
    const { cli, pct } = best
    const sid = cli.sessionId as string
    const cmd = ac.action === 'compact' ? '/compact' : '/clear'
    const where = t('common.where', { cwd: cli.cwd ?? t('common.unknownFolder'), pid: cli.claudePid })
    this.compactInFlight = true
    try {
      // 先設定並寫檔再送出，避免失敗或重啟後每個 tick 重試
      this.setLastCompact(sid, nowSec)
      if (await this.cli.injectSubmit(cli.claudePid, cmd)) {
        this.log('info', t('log.cmdRan', { where, cmd, pct }))
        if (cmd === '/compact' && ac.clear_screen_after) {
          const u = usages.get(sid)
          const usedPct =
            isObj(u?.context) && Number.isFinite(Number(u.context.used_percentage))
              ? Number(u.context.used_percentage)
              : null
          this.pendingClear.set(sid, {
            pid: cli.claudePid,
            sid,
            sentAt: nowSec,
            sawBusy: false,
            ctxAtSend: usedPct,
            cwd: cli.cwd
          })
        }
      } else {
        this.log('warn', t('log.cmdFailed', { cmd, where }))
      }
    } catch {
      this.log('warn', t('log.cmdFailed', { cmd, where })) // 錯誤內容可能含命令列，不記錄
    } finally {
      this.compactInFlight = false
    }
  }

  /**
   * 整理後清除畫面（AC-14'、R-7）：
   * 每個 tick 重讀 sessions 檔；雙重比對 pid 與 sid；看到非 idle 記 sawBusy；
   * idle 且（sawBusy 或 context 百分比下降）時送 Ctrl+L，與其他注入串行且不在 liveContinue 中。
   */
  private async processPendingClear(nowSec: number): Promise<void> {
    if (this.pendingClear.size === 0 || this.disposed) return
    let sessionsList: sessions.ClaudeSessionRec[] | null = null
    const getSessions = (): sessions.ClaudeSessionRec[] => {
      if (sessionsList === null) {
        try {
          sessionsList = this.readSessionsFn()
        } catch {
          sessionsList = []
        }
      }
      return sessionsList
    }

    const usages = this.latestUsageBySession()
    const lc = this.liveContinue

    for (const [sid, item] of Array.from(this.pendingClear.entries())) {
      // 該 session 有 ts > sentAt + COMPACT_IGNORE_S 的 prompt 事件 → 移除不送（/compact 本身產生的 prompt 視為整理自身造成）
      const ev = this.sessEv.get(sid)
      if (ev && ev.lastPromptTs > item.sentAt + COMPACT_IGNORE_S) {
        this.pendingClear.delete(sid)
        continue
      }

      // 超過 600 秒 → 移除不送
      if (nowSec - item.sentAt > 600) {
        this.pendingClear.delete(sid)
        continue
      }

      // 每個 tick 重讀 sessions 檔，以 pid 與 sessionId === sid 雙重比對；程序不存在或對不上 → 移除
      if (!this.alive(item.pid)) {
        this.pendingClear.delete(sid)
        continue
      }
      const rec = getSessions().find((s) => s.pid === item.pid && s.sessionId === sid)
      if (!rec) {
        this.pendingClear.delete(sid)
        continue
      }

      // 看到非 idle → sawBusy = true
      if (rec.status !== 'idle') {
        item.sawBusy = true
      }

      // idle 且（sawBusy 或 statusline 的 context.used_percentage 低於 ctxAtSend）
      if (rec.status === 'idle') {
        let ctxDropped = false
        if (item.ctxAtSend !== null) {
          const u = usages.get(sid)
          if (u && isObj(u.context)) {
            const currentPct = Number(u.context.used_percentage)
            if (Number.isFinite(currentPct) && currentPct < item.ctxAtSend) {
              ctxDropped = true
            }
          }
        }

        if (item.sawBusy || ctxDropped) {
          // 送 Ctrl+L 時與其他注入串行（沿用 compactInFlight），且該 session 不在 live 模式「繼續」的處理中
          if (this.compactInFlight) {
            continue
          }
          if (lc && !lc.done.has(sid)) {
            continue
          }

          this.compactInFlight = true
          try {
            const ok = await (this.cli.injectCtrlKey
              ? this.cli.injectCtrlKey(item.pid, 'L')
              : Promise.resolve(false))
            if (ok) {
              const folder = item.cwd ?? rec.cwd ?? t('common.unknownFolder')
              this.log('info', t('log.screenCleared', { folder }))
            }
          } catch {
            // 忽略錯誤，不把命令列往外洩漏
          } finally {
            this.compactInFlight = false
            this.pendingClear.delete(sid)
          }
        }
      }
    }
  }

  private scheduleScan(delay: number): void {
    if (this.disposed) return
    this.scanTimer = setTimeout(() => {
      const next = (): void => this.scheduleScan(SCAN_MS)
      if (this.switching) return next()
      void this.scanNow().then(next, next)
    }, delay)
  }

  /** 掃描一次（不與上一次重疊）：存結果並更新畫面用的 CliView。失敗回傳空陣列。 */
  private async scanNow(): Promise<sessions.DetectedCli[]> {
    while (this.scanP) {
      try {
        await this.scanP
      } catch {
        /* 忽略 */
      }
    }
    const p = this.doScan()
    this.scanP = p
    try {
      return await p
    } finally {
      this.scanP = null
    }
  }

  /** 切換當下是否會對這個 claude 送出繼續提示（只限 live 模式）。 */
  private promptEligible(c: sessions.DetectedCli): boolean {
    if (this.cfg.switch_mode !== 'live') return false
    if (!String(this.cfg.continue_prompt ?? '')) return false
    if (!c.sessionId || !c.interactive || c.turn !== 'interrupted') return false
    if (!c.hosted && !this.cfg.manage_external) return false
    const t = this.turns.get(c.sessionId)
    if (!t || t.kind !== 'stopfailure') return false
    if (this.nowSec() - t.ts > INTERRUPT_MAX_AGE_S) return false
    return !t.error || t.error === 'rate_limit'
  }

  /** 由掃描結果組出畫面用的 CliView（設定變動時可直接用上次結果重算）。 */
  private buildClis(found: sessions.DetectedCli[]): CliView[] {
    // 所有 claude 共用同一份憑證，一律顯示目前帳號
    let cur: string | null = null
    try {
      const id = accounts.currentSlotId()
      cur = id ? (accounts.getSlot(id)?.name ?? null) : null
    } catch {
      cur = null
    }
    const curName = cur ?? t('tray.unsaved')
    let usages = new Map<string, usage.UsageFileRecord>()
    try {
      usages = this.latestUsageBySession()
    } catch {
      /* 忽略 */
    }
    return found.map((c) => {
      const ctx = c.sessionId ? usages.get(c.sessionId)?.context : null
      const pct = isObj(ctx) && ctx.used_percentage != null ? Number(ctx.used_percentage) : NaN
      return {
        pid: c.claudePid,
        cwd: c.cwd,
        sessionId: c.sessionId,
        slotName: curName,
        turn: c.turn,
        hosted: c.hosted,
        method:
          this.cfg.switch_mode === 'live'
            ? c.interactive
              ? 'live'
              : 'none'
            : sessions.planResume(c, null).method,
        willPrompt: this.promptEligible(c),
        contextPct: Number.isFinite(pct) ? Math.round(pct) : null
      }
    })
  }

  private async doScan(): Promise<sessions.DetectedCli[]> {
    let found: sessions.DetectedCli[] = []
    try {
      const procs = await this.cli.listProcesses()
      let runs: launcherMod.RunState[] = []
      try {
        runs = this.launcher.activeRuns()
      } catch {
        /* 忽略 */
      }
      found = sessions.detect(procs, usage.allPidmaps(), this.turns, runs, this.readSessionsFn())
      this.lastScan = found
      this.clis = this.buildClis(found)
      this.clisScannedAt = Math.floor(this.nowSec())
    } catch (e) {
      this.log('warn', t('log.cliScanFailed', { error: errMsg(e) }))
    }
    this.requestPush()
    return found
  }

  // ---------- Node 與 scripts ----------
  private node(): string | null {
    const t = this.now()
    if (
      !this.nodeCache ||
      (this.nodeCache.path === null && t - this.nodeCache.at > 5000) ||
      t - this.nodeCache.at > NODE_CACHE_MS
    ) {
      this.nodeCache = { path: this.findNodeFn(), at: t }
    }
    return this.nodeCache.path
  }

  private requireNode(): string {
    const n = this.node()
    if (!n) throw new ControllerError(t('err.nodeMissingInstall'), 'NODE_MISSING')
    return n
  }

  private ensureScripts(): void {
    nodebin.installScripts({ sourceDir: this.scriptsDir })
  }

  // ---------- tick ----------
  async tick(): Promise<void> {
    if (this.switching || this.ticking || this.disposed) return
    this.ticking = true
    try {
      await this.tickInner()
    } catch (e) {
      this.log('error', t('log.pollFailed', { error: errMsg(e) }))
    } finally {
      this.ticking = false
    }
  }

  private async tickInner(): Promise<void> {
    const nowSec = this.nowSec()
    const cur0 = accounts.currentSlotId()
    if (cur0) await withSlotLock(cur0, () => this.syncCurrent(cur0))
    const current = accounts.currentSlotId()
    const rec = current ? this.monitorUsage(current) : null
    const r = usage.readNewEvents(this.watermark)
    this.watermark = r.last
    this.ingestTurns(r.events as unknown as ReadonlyArray<{ [k: string]: unknown }>)
    await this.handleLiveFailures(nowSec, r.events as unknown as EventRecord[])
    await this.maybeCompact(nowSec)
    await this.processPendingClear(nowSec)
    const auto = !!this.cfg.auto_switch
    let action = { kind: 'none', reason: '', exhaustedUntil: 0 } as {
      kind: 'none' | 'pending' | 'switch_now'
      reason: string
      exhaustedUntil: number
    }
    if (auto && current) {
      action = this.monitor.tick(nowSec, current, rec, r.events as unknown as EventRecord[])
    }
    if (action.kind === 'pending') {
      if (!this.pendingLogged) {
        this.pendingLogged = true
        this.log('info', t('monitor.thresholdWaiting'))
      }
    } else {
      this.pendingLogged = false
    }
    if (nowSec - this.lastCleanup > CLEANUP_EVERY_S) {
      this.lastCleanup = nowSec
      usage.cleanup(nowSec)
    }
    this.requestPush()
    if (action.kind === 'switch_now' && nowSec >= this.noTargetUntil) {
      await this.runSwitch({
        target: null,
        reason: action.reason,
        exhaustedUntil: action.exhaustedUntil,
        auto: true,
        restartRuns: true
      })
    }
  }

  /** 同步目前帳號的憑證回 slot；憑證檔屬於別的帳號時不寫回，並只記一次 warn。須在 slot 鎖內呼叫。 */
  private syncCurrent(slotId: string): void {
    const wrote = accounts.syncCurrentBack()
    let mismatch = false
    if (!wrote) {
      const creds = storage.readJson(paths.credFile(), null)
      mismatch =
        isObj(creds) && 'claudeAiOauth' in creds && accounts.credsBelongToOther(creds, slotId)
    }
    if (mismatch && !this.warnedMismatch) {
      this.log('warn', t('log.credMismatch'))
    }
    this.warnedMismatch = mismatch
  }

  /**
   * 不重啟模式：切換後視窗內的 stopfailure 視為舊帳號造成，對該 session 送提示（每次切換只送一次）。
   * 是否在視窗內以事件的 ts 與 until 比較（與 monitor 的 ignoreFailuresUntil 一致）。
   */
  private async handleLiveFailures(nowSec: number, events: EventRecord[]): Promise<void> {
    const lc = this.liveContinue
    if (!lc) return
    if (this.cfg.switch_mode !== 'live') {
      this.liveContinue = null
      return
    }
    for (const e of events) {
      if (e.kind !== 'stopfailure' || typeof e.session_id !== 'string' || !e.session_id) continue
      if (!(Number(e.ts) < lc.until)) continue
      const sid = e.session_id
      if (lc.done.has(sid)) continue
      let cli = this.lastScan.find((c) => c.sessionId === sid)
      if (!cli && this.scanEnabled) {
        cli = (await this.scanNow()).find((c) => c.sessionId === sid)
      }
      if (cli) await this.continueSession(cli)
    }
    // 牆鐘過了視窗，且本批事件都處理完才清除
    if (nowSec > lc.until && this.liveContinue === lc) this.liveContinue = null
  }

  /** 對一個 claude 送出接續提示（同一次切換同一 session 只送一次）。log 只寫資料夾與 PID。 */
  private async continueSession(cli: sessions.DetectedCli): Promise<void> {
    const prompt = String(this.cfg.continue_prompt ?? '')
    if (!prompt || !cli.sessionId || !cli.interactive) return
    if (!cli.hosted && !this.cfg.manage_external) return
    const lc = this.liveContinue
    if (!lc || lc.done.has(cli.sessionId)) return
    // 與整理／清畫面的注入串行：等它結束（最多 20 秒），不可直接略過，否則該 session 不會再收到「繼續」
    for (let waited = 0; this.compactInFlight && waited < 20000; waited += 250) {
      await new Promise((r) => setTimeout(r, 250))
    }
    if (this.compactInFlight || lc.done.has(cli.sessionId)) return
    lc.done.add(cli.sessionId)
    const where = t('common.where', { cwd: cli.cwd ?? t('common.unknownFolder'), pid: cli.claudePid })
    this.compactInFlight = true
    try {
      if (await this.cli.injectSubmit(cli.claudePid, prompt)) {
        this.log('info', t('log.continueSent', { where }))
      } else {
        this.log('warn', t('log.continueFailed', { where }))
      }
    } catch {
      this.log('warn', t('log.continueFailed', { where })) // 錯誤內容可能含命令列，不記錄
    } finally {
      this.compactInFlight = false
    }
  }

  /** 使用中帳號的用量（statusline 與 usage_api 取 ts 較新者；皆需 ts >= since）。 */
  private monitorUsage(slotId: string): UsageRecord | null {
    const best = this.pickUsage(slotId, true, this.monitor.since)
    if (!best) return null
    return {
      slot_id: slotId,
      ts: best.ts,
      five_hour: best.five_hour,
      seven_day: best.seven_day
    }
  }

  private pickUsage(
    slotId: string,
    active: boolean,
    since: number
  ): {
    ts: number
    five_hour: UsageWindow
    seven_day: UsageWindow
    source: 'api' | 'statusline'
    api: UsageApiRecord | null
  } | null {
    const api = readUsageApi(slotId)
    const apiOk = api && typeof api.ts === 'number' && api.ts >= since
    let sl = active ? usage.latestUsage(slotId, since) : null
    if (sl && api && usage.isForeignStatusline(sl, api, this.nowSec())) {
      sl = null
      if (!this.foreignLogged) {
        this.foreignLogged = true
        this.log('info', t('log.statuslineStale'))
      }
    }
    let best: {
      ts: number
      five_hour: UsageWindow
      seven_day: UsageWindow
      source: 'api' | 'statusline'
    } | null = null
    if (apiOk && api) {
      best = {
        ts: api.ts,
        five_hour: toWindow(api.five_hour),
        seven_day: toWindow(api.seven_day),
        source: 'api'
      }
    }
    if (sl && (best === null || sl.ts > best.ts)) {
      best = {
        ts: sl.ts,
        five_hour: toWindow(sl.five_hour),
        seven_day: toWindow(sl.seven_day),
        source: 'statusline'
      }
    }
    return best ? { ...best, api: api ?? null } : null
  }

  // ---------- 用量輪詢 ----------
  /** 執行一次輪詢；回傳是否有跑完（false：執行中、切換中暫停）。 */
  private async pollNow(): Promise<boolean> {
    if (this.pollDisabled || this.disposed) return false
    const p = this.poller.pollAll()
    this.requestPush() // 此時 poller 已進入執行中
    let ran = false
    try {
      ran = await p
    } catch (e) {
      this.log('error', t('log.usageQueryFailed', { error: errMsg(e) }))
    }
    if (ran) this.lastPollAt = Math.floor(this.nowSec())
    this.requestPush()
    return ran
  }

  /** 清除所有帳號的用完標記，並重設無目標暫停與警示旗標。 */
  async clearExhausted(): Promise<Result> {
    try {
      for (const s of accounts.listSlots()) {
        if ((s.exhausted_until || 0) !== 0) {
          await withSlotLock(s.id, () => accounts.clearExhausted(s.id))
        }
      }
      this.noTargetUntil = 0
      this.warnedExhaust = false
      this.log('info', t('log.exhaustedCleared'))
      this.requestPush()
      return ok
    } catch (e) {
      return fail(t('err.clearExhaustedFailed', { error: errMsg(e) }))
    }
  }

  async refreshUsage(): Promise<Result> {
    if (this.pollDisabled) return fail(t('err.pollDisabled'), 'INVALID')
    if (this.poller.running || this.switching)
      return fail(t('err.pollBusy'), 'BUSY')
    const ran = await this.pollNow()
    return ran ? ok : fail(t('err.pollBusy'), 'BUSY')
  }

  // ---------- 切換流程 ----------
  private slotName(id: string | null): string {
    const s = id ? accounts.getSlot(id) : null
    return s?.name || id || t('tray.unsaved')
  }

  private isBlocked(slot: accounts.Slot): boolean {
    const rec = readUsageApi(slot.id)
    const thr = Number(this.cfg.threshold) || 95
    return slotBlocked(slot, rec, this.nowSec(), thr, API_BLOCK_WINDOW_S)
  }

  private abortRuns(runs: launcherMod.RunState[]): void {
    for (const r of runs) {
      try {
        this.launcher.abortRestart(r)
      } catch (e) {
        this.log('error', t('log.abortRestartFailed', { error: errMsg(e) }))
      }
    }
  }

  private async runSwitch(p: {
    target: string | null
    reason: string
    exhaustedUntil: number
    auto: boolean
    restartRuns: boolean
  }): Promise<Result> {
    if (this.switching) return fail(t('err.switching'), 'BUSY')
    this.switching = true
    this.requestPush()
    try {
      const nowSec = this.nowSec()
      const current = accounts.currentSlotId()
      let target = p.target
      if (p.auto) {
        if (current && p.exhaustedUntil) {
          const until = p.exhaustedUntil
          await withSlotLock(current, () => accounts.markExhausted(current, until))
        }
        const slots = accounts.listSlots()
        // 挑目標；refresh 確定失敗（dead）的帳號加入失敗集合後改挑下一個。
        // ensureFresh 不得在 withSlotLock 內呼叫（refresh 自己會取同一把鎖）。
        const failed = new Set<string>()
        let nxt: accounts.Slot | null | undefined = null
        for (let i = 0; i <= slots.length; i++) {
          nxt = switchplan.pickNext(
            slots,
            current,
            nowSec,
            (s) => failed.has(s.id) || this.isBlocked(s)
          )
          if (!nxt || nxt.id === current || !this.poller.ensureFresh) break
          if ((await this.poller.ensureFresh(nxt.id)) !== 'dead') break
          failed.add(nxt.id)
          this.log('warn', t('log.tokenInvalidSkip', { name: this.slotName(nxt.id) }))
          nxt = null
        }
        if (!nxt) {
          this.noTargetUntil = nowSec + NO_TARGET_PAUSE_S
          if (!this.warnedExhaust) {
            this.warnedExhaust = true
            this.log('warn', t('log.allExhausted'))
            const er = switchplan.earliestReset(slots, nowSec)
            this.notify(
              t('notify.allExhaustedTitle'),
              t('notify.allExhaustedBody', { time: er ? fmtTs(er) : t('common.unknown') })
            )
          }
          this.monitor.reset(nowSec)
          return fail(t('log.allExhausted'), 'BUSY')
        }
        target = nxt.id
      }
      if (!target) return fail(t('err.noTarget'), 'INVALID')
      const tid = target
      if (!p.auto && tid !== current) {
        const ts = accounts.getSlot(tid)
        if (ts && needsRelogin(ts)) return fail(t('err.needsRelogin'), 'INVALID')
        if (this.poller.ensureFresh && (await this.poller.ensureFresh(tid)) === 'dead') {
          return fail(t('err.needsRelogin'), 'INVALID')
        }
      }
      const notifyAuto = (): void => {
        if (p.auto) {
          this.notify(
            t('notify.autoSwitchedTitle'),
            t('notify.autoSwitchedBody', { name: this.slotName(tid), reason: p.reason })
          )
        }
      }

      if (this.cfg.switch_mode === 'live') {
        try {
          const lockCur = current && current !== tid ? current : null
          await withSlotLock(tid, () =>
            lockCur ? withSlotLock(lockCur, () => accounts.switchTo(tid)) : accounts.switchTo(tid)
          )
        } catch (e) {
          this.log('error', t('log.switchAccountFailed', { error: errMsg(e) }))
          return fail(
            t('log.switchAccountFailed', { error: errMsg(e) }),
            e instanceof accounts.AccountError ? 'INVALID' : 'UNKNOWN'
          )
        }
        const ts = this.nowSec()
        this.monitor.reset(ts)
        // 切換期間使用者可能改了模式，確認仍是 live 才設定接續視窗
        if (this.cfg.switch_mode === 'live') {
          this.monitor.ignoreFailuresUntil = ts + LIVE_WINDOW_S
          this.liveContinue = { until: ts + LIVE_WINDOW_S, done: new Set() }
        }
        this.pendingLogged = false
        this.warnedExhaust = false
        this.foreignLogged = false
        this.noTargetUntil = 0
        this.log('info', t('log.switched', { from: this.slotName(current), to: this.slotName(tid), reason: p.reason }))
        notifyAuto()
        // 換帳號之後才掃描並送提示，掃描不會延遲換帳號
        const scan = this.scanEnabled ? await this.scanNow() : []
        for (const c of scan) {
          if (this.promptEligible(c)) await this.continueSession(c)
        }
        return ok
      }

      const runs = p.restartRuns ? this.launcher.activeRuns() : []
      // 任何 kill／requestRestart 之前先掃描一次，runs 的 session 與 turn 取自這次結果
      const scan = p.restartRuns && this.scanEnabled ? await this.scanNow() : []
      const runPids = new Set(runs.map((r) => Number(r.claude_pid)).filter((n) => n > 0))
      const runInfo = runs.map((r) => {
        const c = scan.find((x) => x.hosted && x.claudePid === r.claude_pid)
        return { run: r, cli: c ?? null, interrupted: !!c && isInterrupted(c.turn) }
      })
      const externals = this.cfg.manage_external
        ? scan
            .filter((c) => c.sessionId && c.interactive && !c.hosted && !runPids.has(c.claudePid))
            .map((c) => ({ cli: c, interrupted: isInterrupted(c.turn) }))
        : []

      const requested: launcherMod.RunState[] = []
      for (const r of runs) {
        requested.push(r) // 失敗前可能已寫入 pending，一併 abort
        try {
          await this.launcher.requestRestart(r)
        } catch (err) {
          // 其他 CLI 尚未動到：中止已要求重啟的託管視窗，不切換
          this.abortRuns(requested)
          this.log('error', t('log.restartRequestFailed', { error: errMsg(err) }))
          return fail(t('log.restartRequestFailed', { error: errMsg(err) }), 'UNKNOWN')
        }
      }
      for (const e of externals) {
        const where = t('common.where', { cwd: e.cli.cwd ?? t('common.unknownFolder'), pid: e.cli.claudePid })
        try {
          if (await this.cli.kill(e.cli.claudePid)) {
            this.log('info', t('log.externalKilled', { where }))
          } else {
            this.log('warn', t('log.killFailed', { where }))
          }
        } catch {
          this.log('warn', t('log.killFailed', { where })) // 錯誤內容可能含命令列，不記錄
        }
      }
      this.requestPush()

      const started = this.now()
      const stillAlive = (): boolean =>
        runs.some((r) => !!r.claude_pid && this.alive(r.claude_pid as number)) ||
        externals.some((e) => this.alive(e.cli.claudePid))
      while (stillAlive() && this.now() - started < this.waitMaxMs) {
        await sleep(this.waitIntervalMs)
      }
      // 已結束的外部 CLI：帳號沒變也要接續
      const resumeDead = async (): Promise<void> => {
        for (const e of externals) {
          if (!this.alive(e.cli.claudePid)) await this.resumeExternal(e.cli, e.interrupted)
        }
      }
      if (stillAlive()) {
        this.abortRuns(runs)
        await resumeDead()
        this.log('error', t('log.switchAborted'))
        return fail(t('err.switchAbortedTimeout'), 'BUSY')
      }

      try {
        // 等目標 slot 的鎖（poller 刷新 token 中）；同時鎖住目前 slot，因 switchTo 會先寫回它
        const lockCur = current && current !== tid ? current : null
        await withSlotLock(tid, () =>
          lockCur ? withSlotLock(lockCur, () => accounts.switchTo(tid)) : accounts.switchTo(tid)
        )
      } catch (e) {
        this.abortRuns(runs)
        await resumeDead()
        this.log('error', t('log.switchAccountFailed', { error: errMsg(e) }))
        return fail(
          t('log.switchAccountFailed', { error: errMsg(e) }),
          e instanceof accounts.AccountError ? 'INVALID' : 'UNKNOWN'
        )
      }
      this.monitor.reset(this.nowSec())
      this.pendingLogged = false
      this.noTargetUntil = 0
      for (const ri of runInfo) {
        try {
          const sid = ri.cli?.sessionId
          if (ri.cli && sid) {
            const prompt = this.promptFor(ri.interrupted)
            const plan = sessions.planResume(ri.cli, prompt)
            const extra = extraArgsOf(plan.args)
            this.launcher.releaseRestart(ri.run, {
              resume: sid,
              ...(prompt ? { prompt } : {}),
              ...(extra.length ? { extraArgs: extra } : {})
            })
          } else {
            this.launcher.releaseRestart(ri.run)
          }
        } catch (e) {
          this.log('error', t('log.releaseRestartFailed', { error: errMsg(e) }))
        }
      }
      for (const e of externals) await this.resumeExternal(e.cli, e.interrupted)
      this.warnedExhaust = false
      this.foreignLogged = false
      this.log('info', t('log.switched', { from: this.slotName(current), to: this.slotName(tid), reason: p.reason }))
      notifyAuto()
      return ok
    } catch (e) {
      this.log('error', t('log.switchFailed', { error: errMsg(e) }))
      return fail(t('log.switchFailed', { error: errMsg(e) }))
    } finally {
      this.switching = false
      this.requestPush()
    }
  }

  private promptFor(interrupted: boolean): string | null {
    const t = String(this.cfg.continue_prompt ?? '')
    return interrupted && t ? t : null
  }

  /** 接續一個外部 CLI：優先寫入原視窗，失敗或不可寫入就開新分頁。log 只寫資料夾與 PID。 */
  private async resumeExternal(cli: sessions.DetectedCli, interrupted: boolean): Promise<void> {
    const where = t('common.where', { cwd: cli.cwd ?? t('common.unknownFolder'), pid: cli.claudePid })
    try {
      const plan = sessions.planResume(cli, this.promptFor(interrupted))
      if (plan.method === 'none' || !cli.sessionId) {
        this.log('warn', t('log.resumeFailed', { where }))
        return
      }
      if (plan.method === 'inject' && plan.line && cli.shellPid) {
        await sleep(this.injectDelayMs)
        let okInject = false
        if (this.alive(cli.shellPid)) {
          try {
            okInject = await this.cli.inject(cli.shellPid, plan.line)
          } catch {
            okInject = false // 錯誤內容可能含命令列，不記錄
          }
        }
        if (okInject) {
          this.log('info', t('log.resumedInPlace', { where }))
          return
        }
      }
      if (!cli.cwd) {
        this.log('warn', t('log.resumeWindowFailed', { where }))
        return
      }
      const node = this.node()
      if (!node) {
        this.log('warn', t('log.resumeNoNode', { where }))
        return
      }
      const prompt = this.promptFor(interrupted)
      const extra = extraArgsOf(plan.args)
      this.launcher.launch(cli.cwd, false, {
        node,
        binDir: paths.binDir(),
        resume: cli.sessionId,
        ...(prompt ? { prompt } : {}),
        ...(extra.length ? { extraArgs: extra } : {})
      })
      this.log('info', t('log.resumedNewWindow', { where }))
    } catch (e) {
      this.log('error', t('log.resumeError', { where, error: errMsg(e) }))
    }
  }

  // ---------- Api ----------
  private async guard(fn: () => Promise<Result> | Result): Promise<Result> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof ControllerError) return fail(e.message, e.code)
      if (e instanceof accounts.AccountError) {
        this.log('error', e.message)
        return fail(e.message, 'INVALID')
      }
      this.log('error', errMsg(e))
      return fail(errMsg(e))
    } finally {
      this.requestPush()
    }
  }

  getState(): AppState {
    return this.buildState()
  }

  saveCurrent(name: string): Promise<Result> {
    return this.guard(async () => {
      const n = String(name ?? '').trim()
      if (!n) return fail(t('err.nameEmpty'), 'INVALID')
      const existing = accounts.matchSlot(accounts.currentAccount())
      const slot = await withSlotLock(existing?.id ?? '__new__', () => accounts.saveCurrent(n))
      this.log('info', t('log.accountSaved', { name: slot.name, email: slot.email }))
      return ok
    })
  }

  switchTo(id: string, restartRuns: boolean): Promise<Result> {
    return this.guard(async () => {
      if (this.switching) return fail(t('err.switching'), 'BUSY')
      if (!accounts.getSlot(id)) return fail(t('err.accountNotFound'), 'INVALID')
      const current = accounts.currentSlotId()
      if (id === current) return fail(t('err.alreadyActive'), 'INVALID')
      return this.runSwitch({
        target: id,
        reason: restartRuns ? t('switch.manualRestart') : t('switch.manual'),
        exhaustedUntil: 0,
        auto: false,
        restartRuns: !!restartRuns
      })
    })
  }

  renameSlot(id: string, name: string): Promise<Result> {
    return this.guard(async () => {
      await withSlotLock(id, () => accounts.renameSlot(id, String(name ?? '')))
      return ok
    })
  }

  deleteSlot(id: string): Promise<Result> {
    return this.guard(async () => {
      const name = this.slotName(id)
      if (id === accounts.currentSlotId()) return fail(t('err.cannotDeleteActive'), 'IN_USE')
      await withSlotLock(id, () => accounts.deleteSlot(id))
      try {
        fs.rmSync(path.join(paths.usageApiDir(), `${id}.json`), { force: true })
      } catch {
        /* 忽略 */
      }
      this.log('info', t('log.accountDeleted', { name }))
      return ok
    })
  }

  async setConfig(patch: AppConfigPatch): Promise<Result> {
    return this.guard(() => {
      const next: config.Config = { ...this.cfg }
      if (patch.threshold !== undefined) {
        const th = Number(patch.threshold)
        if (!Number.isFinite(th)) return fail(t('err.thresholdNaN'), 'INVALID')
        next.threshold = Math.min(100, Math.max(50, th))
      }
      if (patch.auto_switch !== undefined) next.auto_switch = !!patch.auto_switch
      if (patch.last_folder !== undefined) next.last_folder = String(patch.last_folder)
      if (patch.login_browser !== undefined) {
        if (!['chrome', 'edge', 'default'].includes(patch.login_browser)) {
          return fail(t('err.browserUnsupported'), 'INVALID')
        }
        next.login_browser = patch.login_browser
      }
      if (patch.usage_poll_seconds !== undefined) {
        const s = Number(patch.usage_poll_seconds)
        if (!Number.isFinite(s)) return fail(t('err.intervalNaN'), 'INVALID')
        next.usage_poll_seconds = Math.min(3600, Math.max(30, Math.round(s)))
      }
      if (patch.manage_external !== undefined) next.manage_external = !!patch.manage_external
      if (patch.continue_prompt !== undefined) {
        const v = config.validateContinuePrompt(patch.continue_prompt)
        if (v === null) {
          return fail(t('err.promptInvalid'), 'INVALID')
        }
        next.continue_prompt = v
      }
      if (patch.language !== undefined) {
        const l = config.validateLanguage(patch.language)
        if (l === null) return fail(t('err.languageUnsupported'), 'INVALID')
        next.language = l
      }
      if (patch.close_to_tray !== undefined) next.close_to_tray = !!patch.close_to_tray
      if (patch.launch_at_login !== undefined) next.launch_at_login = !!patch.launch_at_login
      let modeChanged = false
      if (patch.switch_mode !== undefined) {
        const m = config.validateSwitchMode(patch.switch_mode)
        if (m === null) return fail(t('err.switchModeUnsupported'), 'INVALID')
        modeChanged = m !== next.switch_mode
        next.switch_mode = m
      }
      if (patch.auto_compact !== undefined) {
        const merged = config.mergeAutoCompact(next.auto_compact, patch.auto_compact)
        if (merged === null) {
          return fail(
            t('err.autoCompactInvalid'),
            'INVALID'
          )
        }
        next.auto_compact = merged
      }
      if (next.launch_at_login !== !!this.cfg.launch_at_login) {
        try {
          this.applyLoginItemFn?.(next.launch_at_login)
        } catch (e) {
          return fail(t('err.loginItemFailed', { error: errMsg(e) }), 'UNKNOWN')
        }
      }
      const lang = resolveLanguage(next.language)
      const langChanged = lang !== getLanguage()
      if (langChanged) {
        // 未自訂的接續提示（內建預設之一）跟著換成新語言的預設
        next.continue_prompt = config.localizeContinuePrompt(next.continue_prompt, lang)
      }
      // 外部腳本（statusline、runner）讀這個欄位，確保與主程式使用相同語言
      next.language_resolved = lang
      config.save(next)
      if (langChanged) setLanguage(lang)
      this.cfg = next
      this.monitor.waitTurnEnd = next.switch_mode === 'restart'
      if (next.switch_mode === 'restart') {
        this.monitor.ignoreFailuresUntil = 0
        this.liveContinue = null
      }
      // 影響「會送出提示」的欄位有變：直接用上次掃描結果重算，不必重掃
      if (
        patch.switch_mode !== undefined ||
        patch.continue_prompt !== undefined ||
        langChanged ||
        patch.manage_external !== undefined
      ) {
        this.clis = this.buildClis(this.lastScan)
      }
      if (modeChanged && this.scanEnabled) void this.scanNow()
      this.monitor.threshold = Number(next.threshold) || 95
      return ok
    })
  }

  installIntegration(): Promise<Result> {
    return this.guard(() => {
      const node = this.requireNode()
      this.ensureScripts()
      integration.install({ nodePath: node, binDir: paths.binDir() })
      this.log('info', t('log.integrationInstalled'))
      return ok
    })
  }

  uninstallIntegration(): Promise<Result> {
    return this.guard(() => {
      integration.uninstall({ binDir: paths.binDir() })
      this.log('info', t('log.integrationRemoved'))
      return ok
    })
  }

  launch(folder: string, cont: boolean): Promise<Result> {
    return this.guard(async () => {
      const f = String(folder ?? '').trim()
      if (!f) return fail(t('err.chooseFolder'), 'INVALID')
      const node = this.requireNode()
      this.ensureScripts()
      this.launcher.launch(f, !!cont, { node, binDir: paths.binDir() })
      if (this.cfg.last_folder !== f) {
        const next = { ...this.cfg, last_folder: f }
        config.save(next)
        this.cfg = next
      }
      this.log('info', cont ? t('log.claudeLaunchedContinue', { folder: f }) : t('log.claudeLaunched', { folder: f }))
      return ok
    })
  }

  // ---------- 登入流程 ----------
  startLogin(browser?: LoginBrowser, reloginSlotId?: string): Promise<Result> {
    return this.guard(async () => {
      if (this.loginSession || this.loginView.state !== 'idle') {
        return fail(t('err.loginInProgress'), 'BUSY')
      }
      const node = this.requireNode()
      const b: LoginBrowser = browser ?? (this.cfg.login_browser as LoginBrowser)
      if (reloginSlotId && !accounts.getSlot(reloginSlotId)) {
        return fail(t('err.reloginNotFound'), 'INVALID')
      }
      this.ensureScripts()
      const session = this.createLogin({ node, binDir: paths.binDir(), browser: b })
      try {
        session.start()
      } catch (e) {
        try {
          session.cleanup()
        } catch {
          /* 忽略 */
        }
        const msg = errMsg(e)
        return fail(
          msg,
          msg.includes('claude')
            ? 'CLAUDE_MISSING'
            : msg.includes('Node')
              ? 'NODE_MISSING'
              : 'UNKNOWN'
        )
      }
      this.loginSession = session
      this.loginStartedMs = this.now()
      this.loginResult = null
      this.loginView = {
        ...idleLogin(),
        state: 'running',
        startedAt: Math.floor(this.nowSec()),
        reloginSlotId: reloginSlotId ?? null
      }
      this.log('info', reloginSlotId ? t('log.reloginStarted') : t('log.browserLoginStarted'))
      this.scheduleLoginPoll(session)
      return ok
    })
  }

  private scheduleLoginPoll(session: LoginSessionLike): void {
    if (this.loginTimer) clearTimeout(this.loginTimer)
    this.loginTimer = setTimeout(() => {
      void this.loginTick().then(() => {
        if (this.loginSession === session && this.loginView.state === 'running') {
          this.scheduleLoginPoll(session)
        }
      })
    }, LOGIN_POLL_MS)
  }

  /** 登入輪詢一次（每秒由計時器呼叫；測試可直接呼叫）。 */
  async loginTick(): Promise<void> {
    const session = this.loginSession
    if (!session || this.loginView.state !== 'running') return
    try {
      const st = session.poll()
      if (st === 'running') {
        if (this.now() - this.loginStartedMs > LOGIN_TIMEOUT_MS) {
          this.loginSession = null
          await session.cancel()
          this.loginView = {
            ...this.loginView,
            state: 'failed',
            message: t('login.timeout')
          }
          this.log('warn', t('log.loginTimeout'))
        } else {
          const url = session.loginUrl()
          if (url !== this.loginView.url) this.loginView = { ...this.loginView, url }
        }
        return
      }
      if (st === 'failed') {
        const lines = session.lastLines(5)
        this.loginSession = null
        session.cleanup()
        this.loginView = {
          ...this.loginView,
          state: 'failed',
          message: t('login.failed', { detail: lines.length ? lines.join(' / ') : t('common.noOutput') })
        }
        this.log('error', this.loginView.message ?? t('login.failedPlain'))
        return
      }
      // done
      const { creds, account } = session.result()
      this.loginSession = null
      session.cleanup() // 暫存目錄含 token，立刻刪除，結果只留在記憶體
      const email = typeof account.emailAddress === 'string' ? account.emailAddress : ''
      const matched = accounts.matchSlot(account)
      const relogin = this.loginView.reloginSlotId
      if (relogin && (!matched || matched.id !== relogin)) {
        this.log('warn', t('log.loginAccountMismatch'))
      }
      const baseName = relogin ? accounts.getSlot(relogin)?.name : matched?.name
      this.loginResult = { creds, account }
      this.loginView = {
        ...this.loginView,
        state: 'awaiting_name',
        email: email || null,
        defaultName: baseName || email || t('common.newAccount'),
        url: null
      }
    } catch (e) {
      const s = this.loginSession
      this.loginSession = null
      try {
        s?.cleanup()
      } catch {
        /* 忽略 */
      }
      this.loginView = { ...this.loginView, state: 'failed', message: t('login.failed', { detail: errMsg(e) }) }
      this.log('error', this.loginView.message ?? t('login.failedPlain'))
    } finally {
      this.requestPush()
    }
  }

  async cancelLogin(): Promise<Result> {
    const session = this.loginSession
    this.loginSession = null
    if (this.loginTimer) clearTimeout(this.loginTimer)
    this.loginTimer = null
    this.loginResult = null
    try {
      if (session) {
        await session.cancel()
        this.log('info', t('log.browserLoginCancelled'))
      }
    } catch (e) {
      this.log('error', t('log.loginCancelFailed', { error: errMsg(e) }))
    }
    this.loginView = idleLogin()
    this.requestPush()
    return ok
  }

  completeLogin(name: string): Promise<Result> {
    return this.guard(async () => {
      const res = this.loginResult
      if (this.loginView.state !== 'awaiting_name' || !res) {
        return fail(t('err.noPendingName'), 'INVALID')
      }
      const email = typeof res.account.emailAddress === 'string' ? res.account.emailAddress : ''
      const finalName = String(name ?? '').trim() || this.loginView.defaultName || email || t('common.newAccount')
      const matched = accounts.matchSlot(res.account)
      const slot = await withSlotLock(matched?.id ?? '__new__', () =>
        accounts.addSlot(finalName, res.creds, res.account)
      )
      if (slot.id === accounts.currentSlotId()) {
        await withSlotLock(slot.id, () => storage.writeJsonAtomic(paths.credFile(), res.creds))
        this.log('info', t('log.credUpdated'))
      }
      this.log('info', t(matched ? 'log.accountUpdated' : 'log.accountAdded', { name: finalName, email }))
      this.loginResult = null
      this.loginView = idleLogin()
      if (!this.pollDisabled) void this.pollNow()
      return ok
    })
  }

  copyLoginUrl(): Promise<Result> {
    return this.guard(() => {
      const url = this.loginSession?.loginUrl() ?? this.loginView.url
      if (!url) return fail(t('err.loginUrlNotReady'), 'INVALID')
      if (!this.copyText) return fail(t('err.clipboardUnavailable'))
      this.copyText(url)
      this.log('info', t('log.loginUrlCopied'))
      return ok
    })
  }

  // ---------- agy 帳號 ----------
  private agyLock(): FileLock | null {
    return acquireFileLock(paths.agyLockFile(), { staleMs: AGY_LOCK_STALE_MS })
  }

  private async isAgyRunning(): Promise<boolean> {
    const procs = await this.cli.listProcesses()
    return procs.some((p) => /^agy(\.exe)?$/i.test(String(p.name)))
  }

  /** 讀取目前 agy 登入並更新快取（email、對應 slot、token 到期）。讀取失敗保留舊值。 */
  private async refreshAgyCurrent(): Promise<AgyCred | null> {
    let cur: AgyCred | null = null
    try {
      cur = await this.agyOps.read()
    } catch (e) {
      this.log('warn', t('log.agyReadFailed', { error: errMsg(e) }))
      return null
    }
    if (!cur) {
      this.agyCur = { email: null, slotId: null, expiryMs: null }
    } else {
      const p = parseBlob(cur.blob)
      const slot = p.email ? agyacc.listAgySlots().find((x) => x.email === p.email) : undefined
      this.agyCur = { email: p.email, slotId: slot?.id ?? null, expiryMs: p.expiryMs }
    }
    this.requestPush()
    return cur
  }

  /** 啟動時：若上次新增帳號流程中途結束留下 login-backup，認證管理員為空就還原，否則只刪檔。 */
  async restoreAgyLoginBackup(): Promise<void> {
    const file = paths.agyLoginBackupFile()
    if (!fs.existsSync(file)) return
    if (dispatchlog.listRunning().length > 0) return
    const lock = this.agyLock()
    if (!lock) return // 派工或另一個程序使用中，下次再處理
    if (dispatchlog.listRunning().length > 0) {
      lock.release()
      this.log('warn', t('log.agyDispatchSkipRestore'))
      return
    }
    try {
      const rec = storage.readJson(file, null)
      const valid = isObj(rec) && typeof rec.blob === 'string' && rec.blob !== ''
      let cur: AgyCred | null
      try {
        cur = await this.agyOps.read()
      } catch (e) {
        this.log('warn', t('log.agyReadFailedNoRestore', { error: errMsg(e) }))
        return
      }
      if (isObj(rec) && valid && !cur) {
        await this.agyOps.write({
          user: typeof rec.user === 'string' ? rec.user : '',
          blob: rec.blob as string
        })
        this.log('info', t('log.agyRestored'))
      } else {
        this.log('info', t('log.agyBackupExpired'))
      }
      fs.rmSync(file, { force: true })
    } catch (e) {
      this.log('error', t('log.agyRestoreBackupFailed', { error: errMsg(e) }))
    } finally {
      lock.release()
      await this.refreshAgyCurrent()
    }
  }

  private scheduleAgyPoll(delay: number): void {
    if (this.disposed) return
    this.agyPollTimer = setTimeout(() => {
      void this.agyPollOnce().finally(() => this.scheduleAgyPoll(AGY_POLL_MS))
    }, delay)
  }

  private async agyVersion(): Promise<string> {
    if (!this.agyVersionCache) {
      try {
        this.agyVersionCache = (await this.agyVersionFn()) || AGY_DEFAULT_VERSION
      } catch {
        this.agyVersionCache = AGY_DEFAULT_VERSION
      }
    }
    return this.agyVersionCache
  }

  /**
   * 查詢所有 agy 帳號的額度一次。不 refresh token；token 過期者不查（保留舊快取）。
   * 查詢前在持有 agy 鎖時 syncCurrentAgyBack；取不到鎖就跳過 syncBack，仍查額度。回傳是否有執行。
   */
  async agyPollOnce(): Promise<boolean> {
    if (this.agyQuerying || this.disposed) return false
    this.agyQuerying = true
    this.requestPush()
    try {
      if (!this.agyLoginCtx) {
        const lock = this.agyLock()
        if (lock) {
          try {
            await agyacc.syncCurrentAgyBack(this.agyOps)
          } catch (e) {
            this.log('warn', t('log.agySyncFailed', { error: errMsg(e) }))
          } finally {
            lock.release()
          }
        }
      }
      const cur = await this.refreshAgyCurrent()
      const fetchImpl = this.agyFetchImpl ?? (globalThis.fetch as FetchLike)
      const version = await this.agyVersion()
      for (const slot of agyacc.listAgySlots()) {
        const active = !!cur && this.agyCur?.slotId === slot.id
        const blob = active && cur ? cur.blob : slot.blob
        const p = parseBlob(blob)
        if (!p.accessToken || p.expiryMs === null || p.expiryMs <= this.now() + AGY_TOKEN_MARGIN_MS)
          continue
        const q = await fetchAgyQuota(p.accessToken, version, fetchImpl)
        try {
          if (q.error) {
            // 失敗時保留舊的額度資料與時間，只更新錯誤訊息
            const old = readAgyQuota(slot.id)
            writeAgyQuota(slot.id, old ? { ...old, error: q.error } : q)
          } else {
            writeAgyQuota(slot.id, q)
          }
        } catch (e) {
          this.log('warn', t('log.agyQuotaSaveFailed', { error: errMsg(e) }))
        }
      }
      return true
    } catch (e) {
      this.log('error', t('log.agyQuotaQueryFailed', { error: errMsg(e) }))
      return true
    } finally {
      this.agyQuerying = false
      this.requestPush()
    }
  }

  agyRefreshQuota(): Promise<Result> {
    return this.guard(async () => {
      if (this.pollDisabled) return fail(t('err.agyQuotaDisabled'), 'INVALID')
      if (this.agyQuerying) return fail(t('err.agyQuotaBusy'), 'BUSY')
      await this.agyPollOnce()
      return ok
    })
  }

  /** 在持有 agy 鎖時執行一個 agy 帳號操作。 */
  private async withAgyLock(fn: () => Promise<Result>): Promise<Result> {
    if (this.agyLoginCtx) return fail(t('err.agyAddInProgress'), 'BUSY')
    if (this.agyBusyOp) return fail(t('err.agyOpBusy'), 'BUSY')
    const lock = this.agyLock()
    if (!lock) return fail(agyBusyMsg(), 'BUSY')
    this.agyBusyOp = true
    try {
      return await fn()
    } finally {
      this.agyBusyOp = false
      lock.release()
    }
  }

  private afterAgyChange(): void {
    void this.refreshAgyCurrent().then(() => {
      if (!this.pollDisabled) void this.agyPollOnce()
    })
  }

  agySaveCurrent(name: string): Promise<Result> {
    return this.guard(() =>
      this.withAgyLock(async () => {
        const slot = await agyacc.saveCurrentAgy(this.agyOps, String(name ?? ''))
        this.log('info', t('log.agySaved', { name: slot.name, email: slot.email }))
        this.afterAgyChange()
        return ok
      })
    )
  }

  agySwitch(id: string): Promise<Result> {
    return this.guard(() =>
      this.withAgyLock(async () => {
        const target = agyacc.listAgySlots().find((s) => s.id === id)
        if (!target) return fail(t('err.agyAccountNotFound'), 'INVALID')
        if (dispatchlog.listRunning().length > 0) {
          return fail(t('err.agyDispatchBusy'), 'BUSY')
        }
        try {
          await agyacc.switchAgy(this.agyOps, id, () => this.isAgyRunning())
        } catch (e) {
          if (e instanceof agyacc.AgyBusyError) return fail(t('err.agyCloseBeforeSwitch'), 'BUSY')
          throw e
        }
        this.log('info', t('log.agySwitched', { name: target.name }))
        this.afterAgyChange()
        return ok
      })
    )
  }

  agyRename(id: string, name: string): Promise<Result> {
    return this.guard(async () => {
      await agyacc.renameAgy(id, String(name ?? ''))
      return ok
    })
  }

  agyDelete(id: string): Promise<Result> {
    return this.guard(async () => {
      const slot = agyacc.listAgySlots().find((s) => s.id === id)
      if (!slot) return fail(t('err.agyAccountNotFound'), 'INVALID')
      await agyacc.deleteAgy(id)
      try {
        fs.rmSync(path.join(paths.agyQuotaDir(), `${id}.json`), { force: true })
      } catch {
        /* 忽略 */
      }
      this.log('info', t('log.agyDeleted', { name: slot.name }))
      await this.refreshAgyCurrent()
      return ok
    })
  }

  // ---- 新增 agy 帳號流程（規格 A 與 R-1） ----
  private setAgyLogin(v: AgyLoginView): void {
    this.agyLoginView = v
    this.requestPush()
  }

  /** 正常結束或取消：清計時器、刪 backup 檔、放鎖。 */
  private endAgyLogin(): void {
    const ctx = this.agyLoginCtx
    this.agyLoginCtx = null
    if (this.agyLoginTimer) clearTimeout(this.agyLoginTimer)
    this.agyLoginTimer = null
    try {
      fs.rmSync(paths.agyLoginBackupFile(), { force: true })
    } catch {
      /* 忽略 */
    }
    ctx?.lock.release()
  }

  agyStartLogin(): Promise<Result> {
    return this.guard(async () => {
      if (this.agyLoginCtx || this.agyBusyOp) return fail(t('err.agyLoginInProgress'), 'BUSY')
      if (dispatchlog.listRunning().length > 0) return fail(t('err.agyDispatchBusy'), 'BUSY')
      if (await this.isAgyRunning()) return fail(t('err.agyCloseAll'), 'BUSY')
      const lock = this.agyLock()
      if (!lock) return fail(agyBusyMsg(), 'BUSY')
      if (dispatchlog.listRunning().length > 0) {
        lock.release()
        return fail(t('err.agyDispatchBusy'), 'BUSY')
      }
      let backup: AgyCred | null = null
      try {
        backup = await this.agyOps.read()
        if (backup) {
          const email = parseBlob(backup.blob).email
          if (email) {
            if (agyacc.listAgySlots().some((s) => s.email === email)) {
              await agyacc.syncCurrentAgyBack(this.agyOps)
            } else {
              await agyacc.saveCurrentAgy(this.agyOps, email.split('@')[0])
            }
          }
          storage.writeJsonAtomic(paths.agyLoginBackupFile(), {
            user: backup.user,
            blob: backup.blob,
            started_at: Math.floor(this.nowSec())
          })
        }
        await this.agyOps.remove()
        this.launchAgyLoginFn()
      } catch (e) {
        // 可能已移除登入但無法開啟 agy：還原
        let restoreFailed = false
        try {
          if (backup && !(await this.agyOps.read())) await this.agyOps.write(backup)
        } catch {
          restoreFailed = true
        }
        if (!restoreFailed) {
          try {
            fs.rmSync(paths.agyLoginBackupFile(), { force: true })
          } catch {
            /* 忽略 */
          }
        }
        lock.release()
        const msg = t(restoreFailed ? 'agy.startAddFailedBackup' : 'agy.startAddFailed', { error: errMsg(e) })
        this.setAgyLogin({ state: 'error', email: null, message: msg })
        await this.refreshAgyCurrent()
        return fail(msg)
      }
      this.agyLoginCtx = {
        backup,
        lock,
        startedMs: this.now(),
        sawAgy: false,
        noAgyCount: 0,
        detected: null
      }
      this.agyCur = { email: null, slotId: null, expiryMs: null }
      this.setAgyLogin({ state: 'waiting', email: null, message: t('agy.loginPrompt') })
      this.log('info', t('log.agyAddStarted'))
      this.scheduleAgyLoginPoll()
      return ok
    })
  }

  private scheduleAgyLoginPoll(): void {
    if (this.agyLoginTimer) clearTimeout(this.agyLoginTimer)
    if (this.disposed) return
    this.agyLoginTimer = setTimeout(() => {
      void this.agyLoginTick().then(() => {
        if (this.agyLoginCtx) this.scheduleAgyLoginPoll()
      })
    }, AGY_LOGIN_POLL_MS)
  }

  /** 登入流程輪詢一次（每 2 秒由計時器呼叫；測試可直接呼叫）。 */
  async agyLoginTick(): Promise<void> {
    const ctx = this.agyLoginCtx
    if (!ctx || this.agyLoginBusy) return
    this.agyLoginBusy = true
    try {
      if (this.now() - ctx.startedMs > AGY_LOGIN_TIMEOUT_MS) {
        await this.abortAgyLogin(t('agy.loginTimeout'))
        return
      }
      let running = false
      try {
        running = await this.isAgyRunning()
      } catch {
        return
      }
      if (running) {
        ctx.sawAgy = true
        ctx.noAgyCount = 0
      } else if (ctx.sawAgy) {
        ctx.noAgyCount++
      }
      let cur: AgyCred | null = null
      try {
        cur = await this.agyOps.read()
      } catch {
        return // 暫時讀不到，下次再試
      }
      const email = cur ? parseBlob(cur.blob).email : null
      if (email && (!ctx.detected || ctx.detected.email !== email)) {
        ctx.detected = { email }
        this.setAgyLogin({
          state: 'signed_in',
          email,
          message: t('agy.loggedIn', { email })
        })
      }
      if (ctx.sawAgy && ctx.noAgyCount >= 2) await this.finishAgyLogin()
    } finally {
      this.agyLoginBusy = false
    }
  }

  /** 結束流程：有新登入就先存成 slot，確認存檔成功才還原 backup；沒有新登入則只還原。 */
  private async finishAgyLogin(): Promise<Result> {
    const ctx = this.agyLoginCtx
    if (!ctx) return fail(t('err.agyNoLoginInProgress'), 'INVALID')
    let cur: AgyCred | null = null
    try {
      cur = await this.agyOps.read()
    } catch (e) {
      this.log('warn', t('log.agyReadFailed', { error: errMsg(e) }))
      return fail(t('err.agyReadRetry'))
    }
    const email = cur ? parseBlob(cur.blob).email : null
    if (!email) {
      await this.abortAgyLogin(t('agy.notDetectedAborted'))
      return fail(t('err.agyNotDetected'), 'INVALID')
    }
    let slot: agyacc.AgySlot
    try {
      slot = await agyacc.saveCurrentAgy(this.agyOps, email.split('@')[0])
    } catch (e) {
      this.setAgyLogin({
        state: 'error',
        email,
        message: t('agy.saveNewFailedMsg', { error: errMsg(e) })
      })
      this.log('error', t('log.agySaveNewFailed', { error: errMsg(e) }))
      this.endAgyLogin()
      return fail(t('err.agySaveNewFailed', { error: errMsg(e) }))
    }
    let restored = ''
    if (ctx.backup) {
      try {
        await this.agyOps.write(ctx.backup)
        restored = t('agy.noteRestoredSuffix')
      } catch (e) {
        restored = t('agy.noteRestoreFailedSuffix')
        this.log('error', t('log.agyRestoreLoginFailed', { error: errMsg(e) }))
      }
    }
    this.endAgyLogin()
    this.setAgyLogin({
      state: 'done',
      email,
      message: t('agy.added', { name: slot.name, email, note: restored })
    })
    this.log('info', t('log.agyAdded', { name: slot.name, email, note: restored }))
    this.afterAgyChange()
    return ok
  }

  /** 登入失敗、逾時或取消：認證管理員為空（或內容無法辨識）且有 backup 時還原。 */
  private async abortAgyLogin(message: string): Promise<void> {
    const ctx = this.agyLoginCtx
    if (!ctx) return
    let note = message
    let keepBackup = false
    if (ctx.backup) {
      try {
        const cur = await this.agyOps.read()
        if (!cur || !parseBlob(cur.blob).email) {
          await this.agyOps.write(ctx.backup)
          note += t('agy.noteRestored')
        }
      } catch (e) {
        keepBackup = true
        note += t('agy.noteRestoreFailed')
        this.log('error', t('log.agyRestoreLoginFailed', { error: errMsg(e) }))
      }
    }
    if (keepBackup) {
      this.agyLoginCtx = null
      if (this.agyLoginTimer) clearTimeout(this.agyLoginTimer)
      this.agyLoginTimer = null
      ctx.lock.release()
    } else {
      this.endAgyLogin()
    }
    this.setAgyLogin({ state: 'error', email: null, message: note })
    this.log('warn', note)
    this.afterAgyChange()
  }

  agyCancelLogin(): Promise<Result> {
    return this.guard(async () => {
      if (this.agyLoginCtx) await this.abortAgyLogin(t('agy.addCancelled'))
      this.setAgyLogin({ state: 'idle', email: null, message: null })
      return ok
    })
  }

  /** 使用者按「完成」：已偵測到新登入時不等 agy 視窗關閉。 */
  agyFinishLogin(): Promise<Result> {
    return this.guard(async () => {
      if (!this.agyLoginCtx?.detected) return fail(t('err.agyNotYetDetected'), 'INVALID')
      return this.finishAgyLogin()
    })
  }

  // ---------- 模型分工 ----------
  setRouting(r: Routing): Promise<Result> {
    return this.guard(() => {
      try {
        routingMod.saveRouting(r)
      } catch (e) {
        if (e instanceof routingMod.RoutingError) return fail(e.message, 'INVALID')
        throw e
      }
      this.log('info', t('log.routingSaved'))
      return ok
    })
  }

  // ---------- 狀態 ----------
  buildState(): AppState {
    const nowSec = this.nowSec()
    const slots = accounts.listSlots()
    const currentId = accounts.currentSlotId()
    const acct = accounts.currentAccount()
    const pollSec = Number(this.cfg.usage_poll_seconds) || 120
    const staleAfter = Math.max(600, 3 * pollSec)

    const views: AccountView[] = slots.map((s) => {
      const active = s.id === currentId
      const best = this.pickUsage(s.id, active, 0)
      const api = best?.api ?? readUsageApi(s.id)
      const needsRelogin = !!api && !!api.needs_relogin && api.saved_at === s.saved_at
      let error: string | null = null
      if (api && api.error) {
        error =
          api.error === 'token_expired_active'
            ? t('err.tokenExpiredActive')
            : api.error
      }
      if (needsRelogin && !error) error = t('err.tokenExpired')
      const oauth = isObj(s.credentials) ? s.credentials.claudeAiOauth : null
      const sub =
        isObj(oauth) && typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        active,
        exhaustedUntil: s.exhausted_until || 0,
        savedAt: s.saved_at || 0,
        subscriptionType: sub,
        usage: {
          five_hour: best ? best.five_hour : null,
          seven_day: best ? best.seven_day : null,
          updatedAt: best ? best.ts : null,
          source: best ? best.source : null,
          stale: best ? nowSec - best.ts > staleAfter : false
        },
        needsRelogin,
        error
      }
    })

    const runs: RunView[] = []
    try {
      for (const r of this.launcher.activeRuns()) {
        runs.push({
          runId: r.run_id,
          cwd: typeof r.cwd === 'string' ? r.cwd : '',
          state: r.state === 'waiting' ? 'waiting' : 'running'
        })
      }
    } catch {
      /* 忽略 */
    }

    const allExhausted = slots.length > 0 && slots.every((s) => (s.exhausted_until || 0) > nowSec)
    let installed = false
    let needsUpdate = false
    try {
      needsUpdate = integration.needsUpdate()
      installed = integration.isInstalled()
    } catch {
      /* 忽略 */
    }

    const agySlots = agyacc.listAgySlots()
    const agyViews: AgyAccountView[] = agySlots.map((s) => {
      const active = !!this.agyCur && this.agyCur.slotId === s.id
      const expiry = active && this.agyCur ? this.agyCur.expiryMs : parseBlob(s.blob).expiryMs
      const q = readAgyQuota(s.id)
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        active,
        quota: q
          ? {
              ts: q.ts,
              tier: q.tier,
              models: Object.entries(q.models).map(([id, m]) => ({
                id,
                remaining: m.remaining,
                resetAt: m.resetAt
              })),
              error: q.error
            }
          : null,
        tokenExpired: expiry === null || expiry <= this.now() + AGY_TOKEN_MARGIN_MS
      }
    })
    const routing = routingMod.loadRouting()
    const modelSet = new Set<string>()
    for (const v of agyViews) for (const m of v.quota?.models ?? []) modelSet.add(m.id)
    for (const list of Object.values(routing.roles)) {
      for (const e of list) if (e.provider === 'agy') modelSet.add(e.model)
    }

    let runningViews: DispatchRunningView[] = []
    try {
      runningViews = dispatchlog.listRunning().map((r) => ({
        id: r.id,
        role: r.role,
        model: r.model,
        account: r.account,
        cwd: r.cwd,
        startedAt: r.started_at
      }))
    } catch {
      runningViews = []
    }

    let recentViews: DispatchRecentView[] = []
    try {
      recentViews = dispatchlog.listRecent(20).map((r) => ({
        id: r.id,
        role: r.role,
        status: r.status,
        provider: r.provider,
        model: r.model,
        account: r.agy_account_email ?? r.attempts?.find((a) => a.account)?.account ?? null,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        message: r.message
      }))
    } catch {
      recentViews = []
    }

    return {
      language: getLanguage(),
      agyAccounts: agyViews,
      agyLogin: { ...this.agyLoginView },
      agyCurrent: this.agyCur
        ? { email: this.agyCur.email, unsaved: !!this.agyCur.email && this.agyCur.slotId === null }
        : null,
      agyQuerying: this.agyQuerying,
      routing,
      agyModels: [...modelSet].sort(),
      dispatch: {
        running: runningViews,
        recent: recentViews,
        maxConcurrent: routingMod.maxConcurrent(routing)
      },
      accounts: views,
      current: {
        slotId: currentId,
        email: acct && typeof acct.emailAddress === 'string' ? acct.emailAddress : null,
        unsaved: !!acct && currentId === null
      },
      runs,
      switching: this.switching,
      pending: !!this.cfg.auto_switch && this.monitor.pending,
      usagePolling: this.poller.running,
      lastPollAt: this.lastPollAt,
      earliestReset: allExhausted ? switchplan.earliestReset(slots, nowSec) : null,
      config: {
        threshold: Number(this.cfg.threshold),
        auto_switch: !!this.cfg.auto_switch,
        last_folder: String(this.cfg.last_folder ?? ''),
        login_browser: this.cfg.login_browser,
        usage_poll_seconds: Number(this.cfg.usage_poll_seconds),
        manage_external: !!this.cfg.manage_external,
        continue_prompt: String(this.cfg.continue_prompt ?? ''),
        switch_mode: this.cfg.switch_mode === 'restart' ? 'restart' : 'live',
        close_to_tray: !!this.cfg.close_to_tray,
        launch_at_login: !!this.cfg.launch_at_login,
        language: config.validateLanguage(this.cfg.language) ?? 'auto',
        auto_compact: {
          ...this.cfg.auto_compact,
          folders: [...this.cfg.auto_compact.folders]
        }
      },
      integration: { installed, needsUpdate, nodeFound: this.node() !== null },
      clis: this.clis,
      clisScannedAt: this.clisScannedAt,
      login: { ...this.loginView },
      events: this.events.slice(-MAX_EVENTS)
    }
  }
}

const isInterrupted = (t: sessions.TurnState): boolean => t === 'busy' || t === 'interrupted'

/** planResume 的 args 中 --resume 之前的部分（原本的選項）。 */
function extraArgsOf(args: string[]): string[] {
  const i = args.indexOf('--resume')
  return i < 0 ? [] : args.slice(0, i)
}

function fmtTs(ts: number): string {
  const d = new Date(ts * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
