// Claude 可用性檢查（AC-13'、R-5）。不 import electron、不 import oauth。
import { t } from '../shared/i18n'
import * as path from 'node:path'
import * as accounts from './accounts'
import * as config from './config'
import * as paths from './paths'
import * as storage from './storage'

export interface SlotLike {
  id: string
  saved_at: number
  exhausted_until?: number
}

export interface UsageWindowLike {
  used_percentage?: number | null
  resets_at?: number | null
}

export interface UsageApiRecordLike {
  ts?: number
  saved_at?: number
  needs_relogin?: boolean
  five_hour?: UsageWindowLike | null
  seven_day?: UsageWindowLike | null
}

export const DEFAULT_API_BLOCK_WINDOW_S = 600

/**
 * 判斷單一 slot 是否被擋下（不可用）。
 * 依 R-5：
 * 1. exhausted_until > nowSec
 * 2. needs_relogin && rec.saved_at === slot.saved_at
 * 3. rec.ts 在 maxAgeSec 內且任一視窗 used_percentage >= threshold && (resets_at === 0 || resets_at > nowSec)
 */
export function slotBlocked(
  slot: SlotLike,
  rec: UsageApiRecordLike | null | undefined,
  nowSec: number,
  threshold: number,
  maxAgeSec: number = DEFAULT_API_BLOCK_WINDOW_S
): boolean {
  if ((slot.exhausted_until || 0) > nowSec) return true

  if (rec && rec.needs_relogin === true && rec.saved_at === slot.saved_at) return true

  if (rec && typeof rec.ts === 'number') {
    if (nowSec - rec.ts <= maxAgeSec) {
      const windows = [rec.five_hour, rec.seven_day]
      for (const w of windows) {
        if (!w) continue
        const used = typeof w.used_percentage === 'number' ? w.used_percentage : null
        const resetsAt = typeof w.resets_at === 'number' ? w.resets_at : 0
        if (used !== null && Number.isFinite(used) && used >= threshold) {
          if (resetsAt === 0 || resetsAt > nowSec) {
            return true
          }
        }
      }
    }
  }

  return false
}

/**
 * 單一 slot 最早可用的時間（unix 秒）：exhausted_until 與「超過門檻且尚未重置」的 API 視窗 resets_at 取較晚者。
 * 判斷條件與 slotBlocked 一致；沒有任何限制時回傳 nowSec。
 */
export function slotAvailableAt(
  slot: SlotLike,
  rec: UsageApiRecordLike | null | undefined,
  nowSec: number,
  threshold: number,
  maxAgeSec: number = DEFAULT_API_BLOCK_WINDOW_S
): number {
  let at = nowSec
  if ((slot.exhausted_until || 0) > at) at = slot.exhausted_until as number
  if (rec && typeof rec.ts === 'number' && nowSec - rec.ts <= maxAgeSec) {
    for (const w of [rec.five_hour, rec.seven_day]) {
      if (!w) continue
      const used = typeof w.used_percentage === 'number' ? w.used_percentage : null
      const resetsAt = typeof w.resets_at === 'number' ? w.resets_at : 0
      if (used !== null && Number.isFinite(used) && used >= threshold && resetsAt > at) {
        at = resetsAt
      }
    }
  }
  return at
}

/**
 * 檢查是否還有可用的 Claude 帳號（AC-13'）。
 * 讀取 accounts.listSlots() 與 usage_api/<id>.json。
 * 沒有任何 Claude slot 時視為可用。
 */
export function claudeAvailable(
  nowSec: number = Math.floor(Date.now() / 1000),
  threshold?: number
): { available: boolean; reason: string } {
  const slots = accounts.listSlots()
  if (slots.length === 0) {
    return { available: true, reason: t('avail.noSaved') }
  }

  const thr = threshold !== undefined ? threshold : Number(config.load().threshold) || 95
  const usageDir = paths.usageApiDir()

  for (const slot of slots) {
    const file = path.join(usageDir, `${slot.id}.json`)
    const rec = storage.readJson(file, null) as UsageApiRecordLike | null
    if (!slotBlocked(slot, rec, nowSec, thr, DEFAULT_API_BLOCK_WINDOW_S)) {
      return { available: true, reason: 'ok' }
    }
  }

  return { available: false, reason: t('avail.allUnavailable') }
}
