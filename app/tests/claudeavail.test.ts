import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAvailable, slotBlocked } from '../src/core/claudeavail'
import { slotsDir, usageApiDir } from '../src/core/paths'
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
