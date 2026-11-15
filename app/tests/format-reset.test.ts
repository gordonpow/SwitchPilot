// formatReset 測試。
import { describe, expect, it } from 'vitest'
import { formatDateTime, formatReset } from '../src/renderer/src/lib/format'

describe('formatReset', () => {
  const now = new Date(2026, 10, 15, 12, 0, 0).getTime()
  const at = (h: number): number => Math.floor(now / 1000) + h * 3600

  it('24 小時內只顯示時間', () => {
    expect(formatReset(at(2), now)).toMatch(/^\d{2}:\d{2} 重置$/)
  })
  it('超過 24 小時顯示日期＋時間', () => {
    expect(formatReset(at(30), now)).toBe(`${formatDateTime(at(30))} 重置`)
  })
  it('0、null、undefined 不顯示', () => {
    expect(formatReset(0, now)).toBeNull()
    expect(formatReset(null, now)).toBeNull()
    expect(formatReset(undefined, now)).toBeNull()
  })
})
