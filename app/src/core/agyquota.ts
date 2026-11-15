// agy 額度查詢（未公開介面）與快取。不 import electron。
import * as path from 'node:path'
import * as paths from './paths'
import * as storage from './storage'
import { errDetail } from './oauth'

export const AGY_BASE = 'https://daily-cloudcode-pa.googleapis.com/v1internal'

export interface AgyQuota {
  /** unix 秒 */
  ts: number
  tier: string | null
  /** remaining 0～1；resetAt unix 秒 */
  models: Record<string, { remaining: number; resetAt: number | null }>
  error: string | null
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export function agyUserAgent(version: string): string {
  return `antigravity/${version} windows/amd64`
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

async function post(
  fetchImpl: FetchLike,
  url: string,
  accessToken: string,
  version: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': agyUserAgent(version)
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new HttpError(res.status)
  const j = (await res.json()) as unknown
  return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

/** 查詢額度；失敗不丟例外，改回傳 error 欄位（models 為空）。 */
export async function fetchAgyQuota(
  accessToken: string,
  version: string,
  fetchImpl: FetchLike
): Promise<AgyQuota> {
  const ts = Math.floor(Date.now() / 1000)
  try {
    const la = await post(fetchImpl, `${AGY_BASE}:loadCodeAssist`, accessToken, version, {
      metadata: { ideType: 'ANTIGRAVITY', pluginType: 'GEMINI' }
    })
    const tierId = isObj(la.currentTier) ? la.currentTier.id : null
    const tier = typeof tierId === 'string' ? tierId : null
    const fm = await post(fetchImpl, `${AGY_BASE}:fetchAvailableModels`, accessToken, version, {})
    const models: AgyQuota['models'] = {}
    if (isObj(fm.models)) {
      for (const [id, m] of Object.entries(fm.models)) {
        if (!isObj(m) || !isObj(m.quotaInfo)) continue
        const q = m.quotaInfo
        // proto3 JSON 會省略值為 0 的欄位，缺少 remainingFraction 視為 0
        const rf = typeof q.remainingFraction === 'number' ? q.remainingFraction : 0
        const rt = typeof q.resetTime === 'string' ? Date.parse(q.resetTime) : NaN
        models[id] = {
          remaining: Math.min(1, Math.max(0, rf)),
          resetAt: Number.isFinite(rt) ? Math.floor(rt / 1000) : null
        }
      }
    }
    return { ts, tier, models, error: null }
  } catch (e) {
    const error =
      e instanceof HttpError && (e.status === 401 || e.status === 403)
        ? `agy 授權失效或已過期（HTTP ${e.status}）`
        : errDetail(e, [accessToken])
    return { ts, tier: null, models: {}, error }
  }
}

// ---- 快取：agy/quota/<slotId>.json ----

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const quotaFile = (slotId: string): string => path.join(paths.agyQuotaDir(), `${slotId}.json`)

export function readAgyQuota(slotId: string): AgyQuota | null {
  if (!SAFE_ID.test(slotId)) return null
  const j = storage.readJson(quotaFile(slotId))
  if (!isObj(j) || typeof j.ts !== 'number' || !isObj(j.models)) return null
  const models: AgyQuota['models'] = {}
  for (const [id, m] of Object.entries(j.models)) {
    if (!isObj(m) || typeof m.remaining !== 'number') continue
    models[id] = { remaining: m.remaining, resetAt: typeof m.resetAt === 'number' ? m.resetAt : null }
  }
  return {
    ts: j.ts,
    tier: typeof j.tier === 'string' ? j.tier : null,
    models,
    error: typeof j.error === 'string' ? j.error : null
  }
}

export function writeAgyQuota(slotId: string, q: AgyQuota): void {
  if (!SAFE_ID.test(slotId)) throw new Error('slot id 不合法')
  storage.writeJsonAtomic(quotaFile(slotId), q)
}
