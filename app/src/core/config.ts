// 使用者設定（config.json）。
import * as paths from './paths'
import * as storage from './storage'

export interface Config {
  threshold: number
  auto_switch: boolean
  last_folder: string
  login_browser: 'chrome' | 'edge' | 'default'
  usage_poll_seconds: number
  manage_external: boolean
  continue_prompt: string
  /** live：不重啟，直接換憑證；restart：結束並以 --resume 重開 */
  switch_mode: 'live' | 'restart'
  auto_compact: AutoCompact
  /** 按 X 時縮到系統匣 */
  close_to_tray: boolean
  /** 開機自動啟動（以 --hidden 在背景啟動） */
  launch_at_login: boolean
  [key: string]: unknown
}

/** 自動整理上下文設定。 */
export interface AutoCompact {
  enabled: boolean
  threshold_type: 'percent' | 'tokens'
  /** percent：1～99；tokens：1000～2000000 */
  threshold: number
  action: 'compact' | 'clear'
  /** 5～600 */
  wait_seconds: number
  /** 空 = 全部；比對時忽略大小寫與結尾斜線，子資料夾也算 */
  folders: string[]
  clear_screen_after: boolean
}

export const AUTO_COMPACT_DEFAULTS: AutoCompact = {
  enabled: false,
  threshold_type: 'percent',
  threshold: 60,
  action: 'compact',
  wait_seconds: 20,
  folders: [],
  clear_screen_after: true
}

export const DEFAULTS: Config = {
  threshold: 95,
  auto_switch: true,
  last_folder: '',
  login_browser: 'chrome',
  usage_poll_seconds: 120,
  manage_external: true,
  continue_prompt: '繼續',
  switch_mode: 'live',
  auto_compact: { ...AUTO_COMPACT_DEFAULTS, folders: [] },
  close_to_tray: false,
  launch_at_login: false
}

/** 讀取設定並與預設值合併；檔案不存在或壞掉時回傳預設值。 */
export function load(): Config {
  const cfg: Config = { ...DEFAULTS }
  const data = storage.readJson(paths.configFile(), null)
  if (data && typeof data === 'object' && !Array.isArray(data)) Object.assign(cfg, data)
  cfg.auto_compact = normalizeAutoCompact((data as Record<string, unknown> | null)?.auto_compact)
  if (validateSwitchMode(cfg.switch_mode) === null) cfg.switch_mode = DEFAULTS.switch_mode
  if (typeof cfg.close_to_tray !== 'boolean') cfg.close_to_tray = DEFAULTS.close_to_tray
  if (typeof cfg.launch_at_login !== 'boolean') cfg.launch_at_login = DEFAULTS.launch_at_login
  const cp = validateContinuePrompt(cfg.continue_prompt)
  cfg.continue_prompt = cp === null ? DEFAULTS.continue_prompt : cp
  return cfg
}

export function save(cfg: Partial<Config>): void {
  storage.writeJsonAtomic(paths.configFile(), cfg)
}

/** 驗證切換方式；合法回傳字串，否則 null。 */
export function validateSwitchMode(v: unknown): 'live' | 'restart' | null {
  return v === 'live' || v === 'restart' ? v : null
}

const isPlainObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** 驗證單一 auto_compact 欄位（threshold 需搭配 type）；合法回傳 { v: 正規化值 }，否則 null。 */
function checkAutoCompactField(
  key: string,
  value: unknown,
  type: AutoCompact['threshold_type']
): { v: unknown } | null {
  switch (key) {
    case 'enabled':
      return typeof value === 'boolean' ? { v: value } : null
    case 'threshold_type':
      return value === 'percent' || value === 'tokens' ? { v: value } : null
    case 'threshold': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      const n = Math.round(value)
      const [lo, hi] = type === 'percent' ? [1, 99] : [1000, 2_000_000]
      return n >= lo && n <= hi ? { v: n } : null
    }
    case 'action':
      return value === 'compact' || value === 'clear' ? { v: value } : null
    case 'wait_seconds': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      const n = Math.round(value)
      return n >= 5 && n <= 600 ? { v: n } : null
    }
    case 'folders': {
      if (!Array.isArray(value) || value.length > 50) return null
      const out: string[] = []
      for (const f of value) {
        if (typeof f !== 'string') return null
        const t = f.trim()
        if (t.length > 500 || /[\x00-\x1f\x7f]/.test(t)) return null
        if (t) out.push(t)
      }
      return { v: out }
    }
    case 'clear_screen_after':
      return typeof value === 'boolean' ? { v: value } : null
    default:
      return null
  }
}

const AUTO_COMPACT_KEYS = [
  'enabled',
  'threshold_type',
  'action',
  'wait_seconds',
  'folders',
  'clear_screen_after'
] as const

/**
 * 載入用：逐欄位驗證，不合法的欄位用預設值（threshold 依合併後的 threshold_type 判斷範圍）。
 */
export function normalizeAutoCompact(raw: unknown): AutoCompact {
  const out: AutoCompact = { ...AUTO_COMPACT_DEFAULTS, folders: [] }
  if (!isPlainObj(raw)) return out
  const o = out as unknown as Record<string, unknown>
  for (const k of AUTO_COMPACT_KEYS) {
    if (!(k in raw)) continue
    if (k === 'folders' && Array.isArray(raw.folders)) {
      // 載入時容許部分項目壞掉：只留合法字串
      const ok = raw.folders.filter((f): f is string => typeof f === 'string').slice(0, 50)
      const c = checkAutoCompactField('folders', ok, out.threshold_type)
      if (c) out.folders = c.v as string[]
      continue
    }
    const c = checkAutoCompactField(k, raw[k], out.threshold_type)
    if (c) o[k] = c.v
  }
  if ('threshold' in raw) {
    const c = checkAutoCompactField('threshold', raw.threshold, out.threshold_type)
    if (c) out.threshold = c.v as number
    else if (out.threshold_type === 'tokens') out.threshold = 100_000
  } else if (out.threshold_type === 'tokens') {
    out.threshold = 100_000
  }
  return out
}

/**
 * setConfig 用：把部分更新合併進目前設定並嚴格驗證。有任何不合法欄位（或未知欄位）回傳 null。
 * 切換 threshold_type 但沒給 threshold 時，數值落在新範圍外就視為不合法。
 */
export function mergeAutoCompact(base: AutoCompact, patch: unknown): AutoCompact | null {
  if (!isPlainObj(patch)) return null
  const next: AutoCompact = { ...base, folders: [...base.folders] }
  const n = next as unknown as Record<string, unknown>
  for (const k of Object.keys(patch)) {
    if (k === 'threshold') continue
    if (!(AUTO_COMPACT_KEYS as readonly string[]).includes(k)) return null
    const c = checkAutoCompactField(k, patch[k], next.threshold_type)
    if (!c) return null
    n[k] = c.v
  }
  const t = 'threshold' in patch ? patch.threshold : next.threshold
  const c = checkAutoCompactField('threshold', t, next.threshold_type)
  if (!c) return null
  next.threshold = c.v as number
  return next
}

const PROMPT_FORBIDDEN = /["%^&|<>;\x00-\x1f\x7f]/

/** 驗證接續提示：去頭尾空白、長度 <= 200、不得含特殊字元。合法回傳處理後字串，否則 null（空字串合法）。 */
export function validateContinuePrompt(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t.length > 200 || PROMPT_FORBIDDEN.test(t)) return null
  return t
}
