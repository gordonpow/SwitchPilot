// 自動切換判斷（純邏輯，不讀檔）。移植自 Python monitor.py。

export type Window = { used_percentage: number; resets_at: number } | null

export type UsageRecord = {
  session_id?: string
  slot_id: string | null
  ts: number
  five_hour: Window
  seven_day: Window
}

export type EventRecord = {
  kind: 'stop' | 'stopfailure' | 'prompt'
  session_id?: string
  cwd?: string
  error: string | null
  slot_id: string | null
  ts: number
  _name: string
}

export type Action = {
  kind: 'none' | 'pending' | 'switch_now'
  reason: string
  exhaustedUntil: number
}

type Win = { used_percentage?: unknown; resets_at?: unknown }

/** 轉成有限數字；null、空字串、無法轉換者回傳 null。 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function overWindows(record: UsageRecord | null, threshold: number): Win[] {
  if (!record) return []
  const out: Win[] = []
  for (const key of ['five_hour', 'seven_day'] as const) {
    const w = record[key] as Win | null | undefined
    if (!w || typeof w !== 'object') continue
    const used = num(w.used_percentage)
    if (used !== null && used >= threshold) out.push(w)
  }
  return out
}

function maxReset(windows: Win[]): number {
  let best = 0
  for (const w of windows) {
    const r = num(w.resets_at ?? 0)
    if (r !== null) best = Math.max(best, r)
  }
  return best
}

const act = (kind: Action['kind'], reason = '', exhaustedUntil = 0): Action => ({
  kind,
  reason,
  exhaustedUntil
})

export class Monitor {
  since = 0
  pending = false
  pendingSince = 0
  exhaustedUntil = 0
  /** false：達門檻立即 switch_now，不等回合結束（不重啟模式）。 */
  waitTurnEnd = true
  /** unix 秒；規則 1 忽略 ts 小於此值的 stopfailure（切換後舊帳號造成的失敗）。 */
  ignoreFailuresUntil = 0

  constructor(
    public threshold = 95,
    public pendingTimeout = 600
  ) {}

  reset(since: number): void {
    this.pending = false
    this.pendingSince = 0
    this.exhaustedUntil = 0
    this.since = since
  }

  tick(
    now: number,
    activeSlotId: string | null,
    usage: UsageRecord | null,
    events: EventRecord[]
  ): Action {
    let rec = usage
    if (rec !== null && (rec.slot_id !== activeSlotId || (num(rec.ts) ?? 0) < this.since)) {
      rec = null
    }
    const evs = (events ?? []).filter(
      (e) => e.slot_id === activeSlotId && (num(e.ts) ?? 0) >= this.since
    )
    const over = overWindows(rec, this.threshold)

    // 規則 1：rate_limit 事件立即切換
    if (evs.some(
        (e) =>
          e.kind === 'stopfailure' &&
          e.error === 'rate_limit' &&
          (num(e.ts) ?? 0) >= this.ignoreFailuresUntil
      )) {
      const until = maxReset(over) || now + 5 * 3600
      this.pending = false
      return act('switch_now', '收到 rate_limit 錯誤', until)
    }

    // 規則 2：用量達門檻，進入或維持 pending
    if (over.length > 0) {
      if (!this.pending) {
        this.pending = true
        this.pendingSince = now
      }
      this.exhaustedUntil = maxReset(over) || this.exhaustedUntil
    } else if (this.pending && rec !== null) {
      // 規則 3：用量降回門檻以下，取消 pending
      this.pending = false
      this.exhaustedUntil = 0
      return act('none', '用量已降回門檻以下')
    }

    if (!this.pending) return act('none')

    const until = this.exhaustedUntil || now + 5 * 3600
    if (!this.waitTurnEnd) {
      this.pending = false
      return act('switch_now', '已達門檻', until)
    }
    // 規則 4：pending 中回合結束（含同一 tick 才進 pending）
    if (evs.some((e) => e.kind === 'stop' || e.kind === 'stopfailure')) {
      this.pending = false
      return act('switch_now', '已達門檻，回合已結束', until)
    }
    // 規則 5：pending 逾時
    if (now - this.pendingSince > this.pendingTimeout) {
      this.pending = false
      return act('switch_now', '已達門檻，等待回合結束逾時', until)
    }
    return act('pending', '已達門檻，等待回合結束後切換', until)
  }
}
