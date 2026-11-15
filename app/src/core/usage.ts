// 讀取 statusline 寫入的用量與 hook 寫入的事件。
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as paths from './paths'
import * as storage from './storage'

export interface UsageFileRecord {
  session_id?: string
  slot_id: string | null
  ts: number
  five_hour: { used_percentage: number; resets_at: number } | null
  seven_day: { used_percentage: number; resets_at: number } | null
  [key: string]: unknown
}

export interface EventFileRecord {
  kind?: string
  _name: string
  [key: string]: unknown
}

function jsonFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 指定 slot 中 ts 最新（且 ts >= since）的 statusline 用量紀錄。 */
export function latestUsage(slotId: string | null, since = 0): UsageFileRecord | null {
  let best: UsageFileRecord | null = null
  const dir = paths.usageDir()
  for (const name of jsonFiles(dir)) {
    const rec = storage.readJson(path.join(dir, name), null)
    if (!isObj(rec) || rec.slot_id !== slotId) continue
    const ts = rec.ts
    if (typeof ts !== 'number' || ts < since) continue
    if (best === null || ts > best.ts) best = rec as UsageFileRecord
  }
  return best
}

type WinLike = { resets_at?: unknown } | null | undefined

/** 兩個視窗的 resets_at 差（秒）；任一邊無法比較（缺值、已過期的 api 視窗）回傳 null。 */
function resetDiff(sl: WinLike, api: WinLike, nowSec: number): number | null {
  const a = Number(api?.resets_at)
  const s = Number(sl?.resets_at)
  if (!api || !sl || !Number.isFinite(a) || !Number.isFinite(s) || a <= nowSec || s <= 0) {
    return null
  }
  return Math.abs(s - a)
}

/**
 * statusline 用量是否屬於別的帳號（live 切換後，執行中 claude 的 statusline 仍是舊帳號的數字）。
 * 優先比 seven_day，無法比較時比 five_hour；兩者皆無法比較則視為非 foreign。
 * 差距超過 3600 秒才算 foreign。
 */
export function isForeignStatusline(
  sl: { five_hour?: WinLike; seven_day?: WinLike } | null | undefined,
  api: { five_hour?: WinLike; seven_day?: WinLike } | null | undefined,
  nowSec: number
): boolean {
  if (!sl || !api) return false
  const d = resetDiff(sl.seven_day, api.seven_day, nowSec) ?? resetDiff(sl.five_hour, api.five_hour, nowSec)
  return d !== null && d > 3600
}

export function isStale(
  record: { ts?: unknown } | null | undefined,
  now: number,
  maxAge = 600
): boolean {
  const ts = Number(record?.ts)
  if (!Number.isFinite(ts)) return true
  return now - ts > maxAge
}

/** 讀取檔名大於 afterName 的事件；回傳事件與新水位線。 */
export function readNewEvents(afterName: string | null): {
  events: EventFileRecord[]
  last: string | null
} {
  const dir = paths.eventsDir()
  const events: EventFileRecord[] = []
  let last = afterName
  for (const name of jsonFiles(dir)) {
    if (afterName !== null && name <= afterName) continue
    const rec = storage.readJson(path.join(dir, name), null)
    if (last === null || name > last) last = name
    if (isObj(rec)) events.push({ ...rec, _name: name })
  }
  return { events, last }
}

export interface PidmapRecord {
  session_id: string
  cwd: string
  /** null：查詢失敗的標記（避免重複查詢） */
  claude_pid: number | null
  claude_created: number
  shell_pid: number | null
  shell_name: string | null
  ts: number
  [key: string]: unknown
}

function readAll(dir: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const name of jsonFiles(dir)) {
    const rec = storage.readJson(path.join(dir, name), null)
    if (isObj(rec)) out.push({ ...rec, _name: name })
  }
  return out
}

/** 讀取全部事件（不動水位線；只在啟動時建立 turn 狀態用）。 */
export function allEvents(): EventFileRecord[] {
  return readAll(paths.eventsDir()) as EventFileRecord[]
}

/** 讀取全部 pidmap 紀錄。 */
export function allPidmaps(): PidmapRecord[] {
  return readAll(paths.pidmapDir()) as unknown as PidmapRecord[]
}

/** 讀取全部 statusline 用量紀錄。 */
export function allUsage(): UsageFileRecord[] {
  return readAll(paths.usageDir()) as unknown as UsageFileRecord[]
}

/** 刪除超過 maxAge 秒未修改的用量、事件與 pidmap 檔。now 為 unix 秒。 */
export function cleanup(now: number, maxAge = 86400): void {
  for (const dir of [paths.usageDir(), paths.eventsDir(), paths.pidmapDir()]) {
    for (const name of jsonFiles(dir)) {
      const p = path.join(dir, name)
      try {
        if (now - fs.statSync(p).mtimeMs / 1000 > maxAge) fs.unlinkSync(p)
      } catch {
        /* 忽略 */
      }
    }
  }
}
