import { t } from '../../../shared/i18n'

const pad = (n: number): string => String(n).padStart(2, '0')

/** unix 秒 → `MM/DD HH:mm`（本地時間）。 */
export function formatDateTime(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 重置時間：24 小時內顯示「HH:mm 重置」，超過顯示「MM/DD HH:mm 重置」；0 或已無值回傳 null。 */
export function formatReset(resetsAt: number | null | undefined, nowMs: number): string | null {
  if (!resetsAt || resetsAt <= 0) return null
  const d = new Date(resetsAt * 1000)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const within = resetsAt * 1000 - nowMs < 86400_000
  return within
    ? t('format.resetsAt', { time: hm })
    : t('format.resetsAt', { time: formatDateTime(resetsAt) })
}

/** unix 秒 → `HH:mm:ss`（本地時間）。 */
export function formatClock(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** unix 秒 → 「2 分鐘前」。 */
export function formatRelative(unixSec: number, nowMs: number): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000 - unixSec))
  if (diff < 10) return t('format.justNow')
  if (diff < 60) return t('format.secondsAgo', { count: diff })
  if (diff < 3600) return t('format.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('format.hoursAgo', { count: Math.floor(diff / 3600) })
  return t('format.daysAgo', { count: Math.floor(diff / 86400) })
}

/** 用量百分比對應的進度條顏色 class。 */
export function usageColor(pct: number, threshold: number): string {
  if (pct >= threshold) return 'bg-red-500'
  if (pct >= 80) return 'bg-amber-400'
  return 'bg-zinc-400'
}
