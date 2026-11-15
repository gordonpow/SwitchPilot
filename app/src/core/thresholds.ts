// 用量門檻：5 小時與每週視窗各自一個。純函式，不 import electron。
export interface Thresholds {
  five_hour: number
  seven_day: number
}

const DEFAULT_THRESHOLD = 95

/** number → 兩個視窗同一門檻；物件原樣回傳（欄位不合法時用預設 95）。 */
export function toThresholds(t: number | Thresholds): Thresholds {
  if (typeof t === 'number') return { five_hour: t, seven_day: t }
  return { five_hour: t.five_hour, seven_day: t.seven_day }
}

function validNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 由設定取得門檻；threshold 預設 95；threshold_weekly 缺少或不合法時沿用 threshold。 */
export function thresholdsFromConfig(cfg: {
  threshold?: unknown
  threshold_weekly?: unknown
}): Thresholds {
  const five = validNum(cfg.threshold) ?? DEFAULT_THRESHOLD
  const weekly = validNum(cfg.threshold_weekly) ?? five
  return { five_hour: five, seven_day: weekly }
}
