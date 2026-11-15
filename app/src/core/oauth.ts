// 用量 API、token refresh 與 UsagePoller。
// 任何 log、錯誤訊息都不得包含 token。
import { t } from '../shared/i18n'
import * as path from 'node:path'
import * as accounts from './accounts'
import { withSlotLock } from './lock'
import * as paths from './paths'
import * as storage from './storage'
import type { UsageWindow } from '../shared/types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const TIMEOUT_MS = 15000
const REFRESH_AHEAD_MS = 10 * 60 * 1000
const RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000
/** 收到 403（多為 Cloudflare 擋下）後全部帳號暫停查詢的時間；避免持續請求讓同一 IP 的 claude CLI 也被擋。 */
export const BLOCKED_BACKOFF_MS = 15 * 60 * 1000
/** 誠實標示本程式，不使用 Electron 預設的瀏覽器 User-Agent。 */
export const USER_AGENT = 'claude-account-switcher/1.0'

export type FetchImpl = typeof fetch
type Obj = Record<string, unknown>

export interface ClaudeAiOauth {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes?: string[]
  [key: string]: unknown
}

export interface UsageWindows {
  five_hour: UsageWindow
  seven_day: UsageWindow
}

export interface UsageApiRecord extends UsageWindows {
  slot_id: string
  ts: number // unix 秒
  error: string | null
  needs_relogin: boolean
  saved_at: number
}

export class TokenExpiredError extends Error {
  constructor(message = t('err.tokenExpired')) {
    super(message)
    this.name = 'TokenExpiredError'
  }
}
export class RateLimitedError extends Error {
  constructor(message = t('err.rateLimited')) {
    super(message)
    this.name = 'RateLimitedError'
  }
}
/** HTTP 403：通常是 Cloudflare 擋下（IP 或請求模式），不是 token 問題。 */
export class BlockedError extends Error {
  constructor(message = t('err.forbidden')) {
    super(message)
    this.name = 'BlockedError'
  }
}
export class RefreshFailedError extends Error {
  constructor(message = t('err.refreshFailed')) {
    super(message)
    this.name = 'RefreshFailedError'
  }
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function toWindow(v: unknown): UsageWindow {
  if (!isObj(v)) return null
  const u = v.utilization
  const r = v.resets_at
  if (typeof u !== 'number' || !Number.isFinite(u)) return null
  if (typeof r !== 'string') return null
  const ms = Date.parse(r)
  if (!Number.isFinite(ms)) return null
  return {
    used_percentage: Math.min(100, Math.max(0, u)),
    resets_at: Math.floor(ms / 1000)
  }
}

export async function fetchUsage(
  accessToken: string,
  fetchImpl: FetchImpl = fetch
): Promise<UsageWindows> {
  const res = await fetchImpl(USAGE_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': USER_AGENT
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 401) throw new TokenExpiredError()
  if (res.status === 403) throw new BlockedError()
  if (res.status === 429) throw new RateLimitedError()
  if (res.status !== 200) throw new Error(t('err.usageHttp', { status: res.status }))
  const body: unknown = await res.json()
  const o = isObj(body) ? body : {}
  return { five_hour: toWindow(o.five_hour), seven_day: toWindow(o.seven_day) }
}

export async function refreshToken(
  oauth: ClaudeAiOauth,
  fetchImpl: FetchImpl = fetch,
  now: () => number = Date.now
): Promise<ClaudeAiOauth> {
  const scopes = Array.isArray(oauth.scopes) ? oauth.scopes.join(' ') : ''
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: CLIENT_ID,
      scope: scopes
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 400 || res.status === 401) throw new RefreshFailedError()
  if (res.status === 403) throw new BlockedError()
  if (res.status === 429) throw new RateLimitedError()
  if (res.status !== 200) throw new Error(t('err.refreshHttp', { status: res.status }))
  const body: unknown = await res.json()
  const o = isObj(body) ? body : {}
  if (typeof o.access_token !== 'string' || !o.access_token) {
    throw new Error(t('err.refreshFormat'))
  }
  const expiresIn = typeof o.expires_in === 'number' ? o.expires_in : 3600
  return {
    ...oauth,
    accessToken: o.access_token,
    refreshToken:
      typeof o.refresh_token === 'string' && o.refresh_token ? o.refresh_token : oauth.refreshToken,
    expiresAt: now() + expiresIn * 1000
  }
}

function usageApiFile(slotId: string): string {
  return path.join(paths.usageApiDir(), `${slotId}.json`)
}

export function readUsageApi(slotId: string): UsageApiRecord | null {
  const d = storage.readJson(usageApiFile(slotId), null)
  return isObj(d) ? (d as unknown as UsageApiRecord) : null
}

/** 用量紀錄標示需要重新登入，且 saved_at 與 slot 相同（重新登入後 saved_at 會變）。 */
export function needsRelogin(slot: { id: string; saved_at: number }): boolean {
  const rec = readUsageApi(slot.id)
  return !!rec && rec.needs_relogin === true && rec.saved_at === slot.saved_at
}

function oauthOf(creds: unknown): ClaudeAiOauth | null {
  if (!isObj(creds) || !isObj(creds.claudeAiOauth)) return null
  const o = creds.claudeAiOauth
  if (typeof o.accessToken !== 'string' || !o.accessToken) return null
  return o as ClaudeAiOauth
}

export type PollerLog = (level: 'info' | 'warn' | 'error', text: string) => void

export interface PollerDeps {
  fetchImpl?: FetchImpl
  now?: () => number // 毫秒
  isPaused?: () => boolean
  log?: PollerLog
  retryDelayMs?: number // 暫時性錯誤重試前的等待（預設 2000，測試可設 0）
}

export class UsagePoller {
  private retryDelayMs: number
  private fetchImpl: FetchImpl
  private now: () => number
  private isPaused: () => boolean
  private logFn: PollerLog
  private _running = false
  private backoffUntil = new Map<string, number>()
  /** 收到 403 後所有帳號都暫停到此時間（毫秒）。 */
  private blockedUntil = 0

  constructor(deps: PollerDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init))
    this.now = deps.now ?? Date.now
    this.isPaused = deps.isPaused ?? (() => false)
    this.logFn = deps.log ?? (() => undefined)
    this.retryDelayMs = deps.retryDelayMs ?? 2000
  }

  get running(): boolean {
    return this._running
  }

  /** 回傳 true＝完整跑完；false＝已在執行中、一開始就暫停，或中途被暫停。 */
  async pollAll(): Promise<boolean> {
    if (this._running) return false
    if (this.isPaused()) return false
    this._running = true
    try {
      for (const slot of accounts.listSlots()) {
        if (this.isPaused()) return false
        if (this.blockedUntil > this.now()) break
        try {
          await this.pollSlot(slot.id)
        } catch (e) {
          this.logFn('error', t('log.pollUnexpected', { name: slot.name, kind: errName(e), detail: errDetail(e) }))
        }
      }
      return true
    } finally {
      this._running = false
    }
  }

  private async pollSlot(slotId: string): Promise<void> {
    const slot = accounts.getSlot(slotId)
    if (!slot) return
    const nowMs = this.now()
    if ((this.backoffUntil.get(slotId) ?? 0) > nowMs) return
    const prev = readUsageApi(slotId)
    if (prev && prev.needs_relogin && prev.saved_at === slot.saved_at) return // 等重新登入

    const active = accounts.currentSlotId() === slotId
    // 失敗時沿用上一筆的視窗與 ts（讓畫面依 ts 判斷是否過期）
    const write = (w: UsageWindows | null, error: string | null, needsRelogin = false): void => {
      const keep = !w && prev ? prev : null
      const rec: UsageApiRecord = {
        slot_id: slotId,
        ts: keep ? keep.ts : Math.floor(this.now() / 1000),
        five_hour: w ? w.five_hour : keep ? keep.five_hour : null,
        seven_day: w ? w.seven_day : keep ? keep.seven_day : null,
        error,
        needs_relogin: needsRelogin,
        saved_at: slot.saved_at
      }
      storage.writeJsonAtomic(usageApiFile(slotId), rec)
    }

    let oauth: ClaudeAiOauth | null = null
    try {
      if (active) {
        oauth = oauthOf(storage.readJson(paths.credFile(), null))
        if (!oauth) return write(null, t('err.noCredentials'))
        if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= nowMs) {
          return write(null, 'token_expired_active')
        }
      } else {
        oauth = oauthOf(slot.credentials)
        if (!oauth) return write(null, t('err.noCredentials'))
        if (typeof oauth.expiresAt === 'number' && oauth.expiresAt - nowMs < REFRESH_AHEAD_MS) {
          oauth = await this.refresh(slot.id, slot.name, oauth)
        }
      }
      let usage: UsageWindows
      try {
        try {
          usage = await fetchUsage(oauth.accessToken, this.fetchImpl)
        } catch (first) {
          // 暫時性錯誤（網路、5xx、逾時）等待後重試一次
          if (!isRetryable(first)) throw first
          await new Promise((r) => setTimeout(r, this.retryDelayMs))
          usage = await fetchUsage(oauth.accessToken, this.fetchImpl)
        }
      } catch (e) {
        if (!(e instanceof TokenExpiredError)) throw e
        if (active) return write(null, 'token_expired_active')
        oauth = await this.refresh(slot.id, slot.name, oauth)
        try {
          usage = await fetchUsage(oauth.accessToken, this.fetchImpl)
        } catch (e2) {
          if (e2 instanceof TokenExpiredError) {
            this.logFn('warn', t('log.refreshStillRejected', { name: slot.name }))
            return write(null, t('err.tokenExpired'))
          }
          throw e2
        }
      }
      write(usage, null)
    } catch (e) {
      if (e instanceof BlockedError) {
        this.blockedUntil = this.now() + BLOCKED_BACKOFF_MS
        this.logFn('warn', t('log.usage403'))
        write(null, e.message)
      } else if (e instanceof RateLimitedError) {
        this.backoffUntil.set(slotId, this.now() + RATE_LIMIT_BACKOFF_MS)
        this.logFn('warn', t('log.accountRateLimited', { name: slot.name }))
        write(null, t('err.rateLimited'))
      } else if (e instanceof RefreshFailedError) {
        this.logFn('warn', t('log.refreshFailedRelogin', { name: slot.name }))
        write(null, t('err.tokenExpired'), true)
      } else {
        const slotOauth = oauthOf(slot.credentials)
        const detail = errDetail(e, [
          oauth?.accessToken ?? '',
          oauth?.refreshToken ?? '',
          slotOauth?.accessToken ?? '',
          slotOauth?.refreshToken ?? ''
        ])
        this.logFn('warn', t('log.usageUnavailable', { name: slot.name, detail }))
        write(null, t('err.usageUnavailable', { detail }))
      }
    }
  }

  /**
   * 切換前確保目標帳號 token 有效。使用中帳號絕不 refresh（回 ok）。
   * 不得在 withSlotLock 內呼叫（refresh 自己會取同一把鎖）。
   * 'dead'＝確定失效（已寫入 needs_relogin）；'error'＝暫時性錯誤，token 未確定失效。
   */
  async ensureFresh(slotId: string): Promise<'ok' | 'dead' | 'error'> {
    const slot = accounts.getSlot(slotId)
    if (!slot) return 'dead'
    if (accounts.currentSlotId() === slotId) return 'ok'
    const oauth = oauthOf(slot.credentials)
    if (!oauth) return 'dead'
    const nowMs = this.now()
    // 無 expiresAt 時無從判斷，與 pollSlot 一致視為有效
    if (typeof oauth.expiresAt !== 'number' || oauth.expiresAt - nowMs >= REFRESH_AHEAD_MS) {
      return 'ok'
    }
    try {
      await this.refresh(slot.id, slot.name, oauth)
      return 'ok'
    } catch (e) {
      if (e instanceof RefreshFailedError) {
        const prev = readUsageApi(slotId)
        const rec: UsageApiRecord = {
          slot_id: slotId,
          ts: prev ? prev.ts : Math.floor(nowMs / 1000),
          five_hour: prev ? prev.five_hour : null,
          seven_day: prev ? prev.seven_day : null,
          error: t('err.tokenExpired'),
          needs_relogin: true,
          saved_at: slot.saved_at
        }
        storage.writeJsonAtomic(usageApiFile(slotId), rec)
        this.logFn('warn', t('log.refreshFailedRelogin', { name: slot.name }))
        return 'dead'
      }
      this.logFn(
        'warn',
        t('log.preSwitchRefreshFailed', {
        name: slot.name,
        detail: errDetail(e, [oauth.accessToken, oauth.refreshToken])
      })
      )
      return 'error'
    }
  }

  /** refresh 並寫回。丟 RefreshFailedError 表示需要重新登入。 */
  private async refresh(
    slotId: string,
    name: string,
    sent: ClaudeAiOauth
  ): Promise<ClaudeAiOauth> {
    let used = sent
    let fresh: ClaudeAiOauth
    try {
      fresh = await refreshToken(used, this.fetchImpl, this.now)
    } catch (e) {
      if (!(e instanceof RefreshFailedError)) throw e
      // 被他方輪替了 refresh token：用新的再試一次
      const latest = oauthOf(accounts.getSlot(slotId)?.credentials)
      if (!latest || latest.refreshToken === used.refreshToken) throw e
      used = latest
      fresh = await refreshToken(used, this.fetchImpl, this.now)
    }
    const sentRt = used.refreshToken
    return withSlotLock(slotId, () => {
      const slot = accounts.getSlot(slotId)
      if (!slot) throw new RefreshFailedError()
      if (accounts.currentSlotId() === slotId) {
        const cred = storage.readJson(paths.credFile(), null)
        const credOauth = oauthOf(cred)
        if (!isObj(cred) || !credOauth || credOauth.refreshToken !== sentRt) {
          this.logFn('warn', t('log.refreshDiscarded', { name }))
          throw new RefreshFailedError()
        }
        storage.writeJsonAtomic(paths.credFile(), { ...cred, claudeAiOauth: fresh })
        this.logFn('info', t('log.refreshSynced', { name }))
      } else {
        const slotOauth = oauthOf(slot.credentials)
        if (slotOauth && slotOauth.refreshToken !== sentRt) {
          return slotOauth // 寫回前已被他方更新，保留較新的
        }
      }
      accounts.updateSlot({ ...slot, credentials: { ...slot.credentials, claudeAiOauth: fresh } })
      this.logFn('info', t('log.refreshed', { name }))
      return fresh
    })
  }
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : t('common.unknownError')
}

/** 錯誤的簡短說明（含 HTTP 狀態或網路錯誤原因）；遮蔽 token，最長 120 字。 */
export function errDetail(e: unknown, secrets: string[] = []): string {
  let s = e instanceof Error ? e.message || e.name : String(e)
  const cause = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined
  if (cause instanceof Error && cause.message) s += t('common.detailSep') + cause.message
  for (const tok of secrets) if (tok) s = s.split(tok).join('<token>')
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}

function isRetryable(e: unknown): boolean {
  return !(
    e instanceof TokenExpiredError ||
    e instanceof RateLimitedError ||
    e instanceof BlockedError ||
    e instanceof RefreshFailedError
  )
}
