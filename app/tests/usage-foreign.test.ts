// isForeignStatusline 純函式測試。
import { describe, expect, it } from 'vitest'
import { isForeignStatusline } from '../src/core/usage'

const NOW = 1_000_000
const w = (resets_at: number) => ({ used_percentage: 50, resets_at })

describe('isForeignStatusline', () => {
  it('seven_day 相差超過 1 小時：foreign', () => {
    expect(
      isForeignStatusline({ seven_day: w(NOW + 90_000) }, { seven_day: w(NOW + 80_000) }, NOW)
    ).toBe(true)
  })
  it('相差 1 秒：非 foreign', () => {
    expect(
      isForeignStatusline({ seven_day: w(NOW + 80_001) }, { seven_day: w(NOW + 80_000) }, NOW)
    ).toBe(false)
  })
  it('api 視窗已過期：不比', () => {
    expect(
      isForeignStatusline({ seven_day: w(NOW + 90_000) }, { seven_day: w(NOW - 10) }, NOW)
    ).toBe(false)
  })
  it('seven_day 無法比較時用 five_hour', () => {
    expect(
      isForeignStatusline(
        { five_hour: w(NOW + 20_000), seven_day: null },
        { five_hour: w(NOW + 10_000), seven_day: null },
        NOW
      )
    ).toBe(true)
  })
  it('api 為 null：非 foreign', () => {
    expect(isForeignStatusline({ seven_day: w(NOW + 1) }, null, NOW)).toBe(false)
  })
  it('兩者皆無法比較：非 foreign', () => {
    expect(isForeignStatusline({ seven_day: null }, { five_hour: w(NOW + 5) }, NOW)).toBe(false)
  })
})
