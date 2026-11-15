import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAvailable, exhaustedRecovered, slotAvailableAt, slotBlocked } from '../src/core/claudeavail'
import { configFile, slotsDir, usageApiDir } from '../src/core/paths'
import { writeJsonAtomic } from '../src/core/storage'
import { useTempEnv } from './helpers'

describe('claudeavail', () => {
  useTempEnv()

  const now = 10000

  describe('slotBlocked', () => {
    it('exhausted_until 大於當前時間時 blocked', () => {
      const slot = { id: 's1', saved_at: 1000, exhausted_until: now + 500 }
      expect(slotBlocked(slot, null, now, 95)).toBe(true)

      const expiredSlot = { id: 's1', saved_at: 1000, exhausted_until: now - 1 }
      expect(slotBlocked(expiredSlot, null, now, 95)).toBe(false)
    })

    it('needs_relogin 為 true 且 saved_at 相同時 blocked；saved_at 不同時不 blocked', () => {
      const slot = { id: 's1', saved_at: 1000 }
      const recSame = { ts: now - 10, saved_at: 1000, needs_relogin: true }
      expect(slotBlocked(slot, recSame, now, 95)).toBe(true)

      const recDiff = { ts: now - 10, saved_at: 900, needs_relogin: true }
      expect(slotBlocked(slot, recDiff, now, 95)).toBe(false)
    })

    it('快取在有效秒數內且用量達門檻，resets_at 未到時 blocked', () => {
      const slot = { id: 's1', saved_at: 1000 }
      const rec = {
        ts: now - 100, // 100 秒前，在 600 秒內
        saved_at: 1000,
        five_hour: { used_percentage: 96, resets_at: now + 3600 },
        seven_day: { used_percentage: 20, resets_at: now + 86400 }
      }
      expect(slotBlocked(slot, rec, now, 95)).toBe(true)
    })

    it('快取在有效秒數內且 resets_at 為 0、用量達門檻時 blocked', () => {
      const slot = { id: 's1', saved_at: 1000 }
      const rec = {
        ts: now - 100,
        saved_at: 1000,
        five_hour: { used_percentage: 95, resets_at: 0 }
      }
      expect(slotBlocked(slot, rec, now, 95)).toBe(true)
    })

    it('用量已過 resets_at 則不 blocked', () => {
      const slot = { id: 's1', saved_at: 1000 }
      const rec = {
        ts: now - 100,
        saved_at: 1000,
        five_hour: { used_percentage: 98, resets_at: now - 10 }
      }
      expect(slotBlocked(slot, rec, now, 95)).toBe(false)
    })

    it('快取過期（超過 maxAgeSec）即使額度滿也不 blocked', () => {
      const slot = { id: 's1', saved_at: 1000 }
      const rec = {
        ts: now - 601, // 超過 600 秒
        saved_at: 1000,
        five_hour: { used_percentage: 100, resets_at: now + 3600 }
      }
      expect(slotBlocked(slot, rec, now, 95, 600)).toBe(false)
    })

    it('無快取或用量未滿不 blocked', () => {
      const slot = { id: 's1', saved_at: 1000 }
      expect(slotBlocked(slot, null, now, 95)).toBe(false)

      const recUnder = {
        ts: now - 100,
        saved_at: 1000,
        five_hour: { used_percentage: 94, resets_at: now + 3600 }
      }
      expect(slotBlocked(slot, recUnder, now, 95)).toBe(false)
    })
  })

  describe('claudeAvailable', () => {
    it('無任何 Claude slot 時視為可用', () => {
      const res = claudeAvailable(now, 95)
      expect(res.available).toBe(true)
    })

    it('有多個 slot 時，只要有任一可用則可用；全部不可用時為 false', () => {
      // 建立兩個 slots: slot-1, slot-2
      writeJsonAtomic(path.join(slotsDir(), 'slot-1.json'), {
        id: 'slot-1',
        name: 'Account 1',
        saved_at: 1000
      })
      writeJsonAtomic(path.join(slotsDir(), 'slot-2.json'), {
        id: 'slot-2',
        name: 'Account 2',
        saved_at: 1000
      })

      // slot-1 額度已滿（blocked）
      writeJsonAtomic(path.join(usageApiDir(), 'slot-1.json'), {
        slot_id: 'slot-1',
        ts: now - 50,
        saved_at: 1000,
        five_hour: { used_percentage: 99, resets_at: now + 3600 }
      })

      // slot-2 無用量快取（視為可用）
      expect(claudeAvailable(now, 95).available).toBe(true)

      // 現在讓 slot-2 也 blocked（needs_relogin）
      writeJsonAtomic(path.join(usageApiDir(), 'slot-2.json'), {
        slot_id: 'slot-2',
        ts: now - 50,
        saved_at: 1000,
        needs_relogin: true
      })

      // 兩者皆 blocked
      const allBlocked = claudeAvailable(now, 95)
      expect(allBlocked.available).toBe(false)
      expect(allBlocked.reason).toContain('不可用')
    })
  })
})

describe('slotAvailableAt', () => {
  const now = 10000
  const rec = (five: number | null, resets: number) => ({
    ts: now - 10,
    five_hour: five === null ? null : { used_percentage: five, resets_at: resets },
    seven_day: null
  })
  it('只有 exhausted_until', () => {
    expect(slotAvailableAt({ id: 's', saved_at: 1, exhausted_until: now + 500 }, null, now, 95)).toBe(now + 500)
  })
  it('只有 API 超過門檻的視窗', () => {
    expect(slotAvailableAt({ id: 's', saved_at: 1 }, rec(97, now + 800), now, 95)).toBe(now + 800)
    expect(slotAvailableAt({ id: 's', saved_at: 1 }, rec(50, now + 800), now, 95)).toBe(now)
  })
  it('兩者取較晚者', () => {
    const slot = { id: 's', saved_at: 1, exhausted_until: now + 500 }
    expect(slotAvailableAt(slot, rec(97, now + 800), now, 95)).toBe(now + 800)
    expect(slotAvailableAt({ ...slot, exhausted_until: now + 900 }, rec(97, now + 800), now, 95)).toBe(now + 900)
  })
  it('都沒有回 now', () => {
    expect(slotAvailableAt({ id: 's', saved_at: 1 }, null, now, 95)).toBe(now)
    expect(slotAvailableAt({ id: 's', saved_at: 1, exhausted_until: now - 5 }, rec(null, 0), now, 95)).toBe(now)
  })
})

describe('claudeavail 分開門檻', () => {
  useTempEnv()
  const now = 10000
  const thr = { five_hour: 90, seven_day: 60 }
  const mk = (five: number, seven: number) => ({
    ts: now - 10,
    five_hour: { used_percentage: five, resets_at: now + 100 },
    seven_day: { used_percentage: seven, resets_at: now + 500 }
  })
  const slot = { id: 's', saved_at: 1 }

  it('slotBlocked：各視窗比各自門檻', () => {
    expect(slotBlocked(slot, mk(80, 50), now, thr)).toBe(false)
    expect(slotBlocked(slot, mk(80, 70), now, thr)).toBe(true)
    expect(slotBlocked(slot, mk(95, 10), now, thr)).toBe(true)
  })
  it('exhaustedRecovered：週視窗高於週門檻不算恢復', () => {
    const s = { id: 's', saved_at: 1, exhausted_until: now + 1000, exhausted_at: now - 1000 }
    expect(exhaustedRecovered(s, mk(80, 70), thr)).toBe(false)
    expect(exhaustedRecovered(s, mk(80, 50), thr)).toBe(true)
  })
  it('slotAvailableAt：只計超過自己門檻的視窗', () => {
    expect(slotAvailableAt(slot, mk(80, 70), now, thr)).toBe(now + 500)
    expect(slotAvailableAt(slot, mk(80, 50), now, thr)).toBe(now)
  })
  it('claudeAvailable：未傳門檻時讀 config 的兩個門檻', () => {
    writeJsonAtomic(path.join(slotsDir(), 'slot-1.json'), { id: 'slot-1', name: 'A', saved_at: 1000 })
    writeJsonAtomic(path.join(usageApiDir(), 'slot-1.json'), {
      slot_id: 'slot-1',
      ts: now - 50,
      saved_at: 1000,
      five_hour: { used_percentage: 80, resets_at: now + 3600 },
      seven_day: { used_percentage: 70, resets_at: now + 7200 }
    })
    writeJsonAtomic(configFile(), { threshold: 90, threshold_weekly: 60 })
    expect(claudeAvailable(now).available).toBe(false)
    writeJsonAtomic(configFile(), { threshold: 90, threshold_weekly: 80 })
    expect(claudeAvailable(now).available).toBe(true)
  })
})
