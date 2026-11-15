// 選下一個帳號、判斷全部用完（純函式）。
export interface PlanSlot {
  id?: string
  exhausted_until?: number
  [key: string]: unknown
}

/** 從 currentId 之後依序循環，回傳第一個可用（非目前、未用完、未被 isBlocked 擋下）的 slot。 */
export function pickNext<T extends PlanSlot>(
  slots: T[],
  currentId: string | null,
  now: number,
  isBlocked?: (slot: T) => boolean
): T | null {
  const n = slots.length
  if (n === 0) return null
  let start = 0
  for (let i = 0; i < n; i++) {
    if (slots[i].id === currentId) {
      start = i + 1
      break
    }
  }
  for (let k = 0; k < n; k++) {
    const s = slots[(start + k) % n]
    if (s.id !== currentId && (s.exhausted_until || 0) <= now && !(isBlocked && isBlocked(s))) {
      return s
    }
  }
  return null
}

/** 所有尚未重置的 exhausted_until 中最小值；沒有則 null。 */
export function earliestReset(slots: PlanSlot[], now: number): number | null {
  const vals = slots.map((s) => s.exhausted_until || 0).filter((v) => v > now)
  return vals.length ? Math.min(...vals) : null
}

/**
 * 全部不可用時挑「最早可用」的 slot：回傳 availableAt 最小者（同時間依清單順序）。
 * isExcluded 為 true 的跳過；回傳的 at 不早於 now。全部被排除時回傳 null。
 */
export function pickEarliest<T>(
  slots: T[],
  now: number,
  availableAt: (s: T) => number,
  isExcluded: (s: T) => boolean
): { slot: T; at: number } | null {
  let best: { slot: T; at: number } | null = null
  for (const s of slots) {
    if (isExcluded(s)) continue
    const at = Math.max(availableAt(s), now)
    if (!best || at < best.at) best = { slot: s, at }
  }
  return best
}
