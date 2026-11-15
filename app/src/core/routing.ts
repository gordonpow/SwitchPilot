// 模型分工（routing.json）：每個階段一份有順序的備援清單。不 import electron。
import * as paths from './paths'
import * as storage from './storage'

export type RoleId =
  | 'requirements'
  | 'spec'
  | 'spec_review'
  | 'implement'
  | 'impl_review'
  | 'research'
  | 'docs'

export const ROLE_IDS: readonly RoleId[] = [
  'requirements',
  'spec',
  'spec_review',
  'implement',
  'impl_review',
  'research',
  'docs'
]

export const ROLE_LABELS: Record<RoleId, string> = {
  requirements: '需求定義',
  spec: '規格',
  spec_review: '規格審查',
  implement: '實作',
  impl_review: '實作審查／驗證',
  research: '查資料',
  docs: '文件草稿'
}

export type ClaudeModel = 'opus' | 'sonnet' | 'haiku'

export interface RouteEntry {
  provider: 'claude' | 'agy'
  model: string
  /** agy slot id；空或省略代表全部。Claude 項目第一期忽略。 */
  accounts?: string[]
}

export interface Routing {
  version: 1
  max_concurrent_per_account?: number
  roles: Record<RoleId, RouteEntry[]>
}

export class RoutingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutingError'
  }
}

export const DEFAULT_MAX_CONCURRENT = 2
export const MIN_MAX_CONCURRENT = 1
export const MAX_MAX_CONCURRENT = 8

export function maxConcurrent(r: Routing): number {
  const n = r.max_concurrent_per_account
  if (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= MIN_MAX_CONCURRENT &&
    n <= MAX_MAX_CONCURRENT
  ) {
    return n
  }
  return DEFAULT_MAX_CONCURRENT
}

export const DEFAULT_ROUTING: Routing = {
  version: 1,
  max_concurrent_per_account: 2,
  roles: {
    requirements: [
      { provider: 'claude', model: 'opus' },
      { provider: 'agy', model: 'claude-opus-4-6-thinking' }
    ],
    spec: [
      { provider: 'claude', model: 'opus' },
      { provider: 'agy', model: 'claude-opus-4-6-thinking' }
    ],
    spec_review: [
      { provider: 'claude', model: 'sonnet' },
      { provider: 'agy', model: 'claude-sonnet-4-6' }
    ],
    implement: [
      { provider: 'agy', model: 'gemini-3.8-flash-high' },
      { provider: 'claude', model: 'sonnet' },
      { provider: 'agy', model: 'claude-sonnet-4-6' }
    ],
    impl_review: [
      { provider: 'claude', model: 'sonnet' },
      { provider: 'agy', model: 'claude-sonnet-4-6' }
    ],
    research: [
      { provider: 'claude', model: 'haiku' },
      { provider: 'agy', model: 'gemini-3.8-flash-medium' }
    ],
    docs: [
      { provider: 'claude', model: 'haiku' },
      { provider: 'agy', model: 'gemini-3.8-flash-medium' }
    ]
  }
}

const CLAUDE_MODELS = new Set(['opus', 'sonnet', 'haiku'])
const AGY_MODEL_RE = /^[a-z0-9][a-z0-9.-]{1,63}$/
const MAX_ENTRIES = 5

function cloneDefault(): Routing {
  return JSON.parse(JSON.stringify(DEFAULT_ROUTING)) as Routing
}

/** 驗證單一項目；回傳錯誤訊息或 null。 */
function entryError(e: unknown): string | null {
  if (!e || typeof e !== 'object') return '項目格式不正確'
  const r = e as Record<string, unknown>
  if (r.provider !== 'claude' && r.provider !== 'agy') return '供應商只能是 claude 或 agy'
  if (typeof r.model !== 'string' || !r.model) return '模型不可為空'
  if (r.provider === 'claude' && !CLAUDE_MODELS.has(r.model))
    return 'Claude 模型只能是 opus、sonnet 或 haiku'
  if (r.provider === 'agy' && !AGY_MODEL_RE.test(r.model)) return `agy 模型名稱不合法：${r.model}`
  if (r.accounts !== undefined) {
    if (!Array.isArray(r.accounts) || !r.accounts.every((a) => typeof a === 'string' && a))
      return '帳號範圍必須是字串清單'
  }
  return null
}

function entriesError(list: unknown): string | null {
  if (!Array.isArray(list)) return '必須是清單'
  if (list.length < 1) return '至少需要一項'
  if (list.length > MAX_ENTRIES) return `最多 ${MAX_ENTRIES} 項`
  for (const e of list) {
    const m = entryError(e)
    if (m) return m
  }
  return null
}

function normalizeEntry(e: RouteEntry): RouteEntry {
  const out: RouteEntry = { provider: e.provider, model: e.model }
  if (e.accounts && e.accounts.length > 0) out.accounts = [...e.accounts]
  return out
}

/** 驗證整份設定；不合法丟 RoutingError（繁中訊息）。 */
export function validateRouting(r: unknown): asserts r is Routing {
  if (!r || typeof r !== 'object') throw new RoutingError('模型分工設定格式不正確')
  const obj = r as Record<string, unknown>
  if (obj.max_concurrent_per_account !== undefined) {
    const n = obj.max_concurrent_per_account
    if (
      typeof n !== 'number' ||
      !Number.isInteger(n) ||
      n < MIN_MAX_CONCURRENT ||
      n > MAX_MAX_CONCURRENT
    ) {
      throw new RoutingError('每個帳號同時執行上限必須是 1 到 8 的整數')
    }
  }
  const roles = obj.roles
  if (!roles || typeof roles !== 'object') throw new RoutingError('模型分工設定缺少 roles')
  for (const id of ROLE_IDS) {
    const m = entriesError((roles as Record<string, unknown>)[id])
    if (m) throw new RoutingError(`「${ROLE_LABELS[id]}」${m}`)
  }
}

/** 讀取設定；檔案不存在或壞掉用預設，未知 role 忽略，缺少或不合法的 role 補預設。 */
export function loadRouting(): Routing {
  const out = cloneDefault()
  const raw = storage.readJson(paths.routingFile(), null)
  if (!raw || typeof raw !== 'object') return out
  const rawObj = raw as Record<string, unknown>
  if (
    typeof rawObj.max_concurrent_per_account === 'number' &&
    Number.isInteger(rawObj.max_concurrent_per_account) &&
    rawObj.max_concurrent_per_account >= MIN_MAX_CONCURRENT &&
    rawObj.max_concurrent_per_account <= MAX_MAX_CONCURRENT
  ) {
    out.max_concurrent_per_account = rawObj.max_concurrent_per_account
  } else {
    out.max_concurrent_per_account = DEFAULT_MAX_CONCURRENT
  }
  const roles = rawObj.roles
  if (!roles || typeof roles !== 'object') return out
  for (const id of ROLE_IDS) {
    const list = (roles as Record<string, unknown>)[id]
    if (entriesError(list) === null) out.roles[id] = (list as RouteEntry[]).map(normalizeEntry)
  }
  return out
}

/** 驗證後原子寫入；只保留已知欄位。 */
export function saveRouting(r: Routing): void {
  validateRouting(r)
  const out: Routing = {
    version: 1,
    max_concurrent_per_account: maxConcurrent(r),
    roles: {} as Routing['roles']
  }
  for (const id of ROLE_IDS) out.roles[id] = r.roles[id].map(normalizeEntry)
  storage.writeJsonAtomic(paths.routingFile(), out)
}
