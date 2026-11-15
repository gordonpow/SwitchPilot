import { describe, expect, it } from 'vitest'
import { Monitor, type EventRecord, type UsageRecord } from '../src/core/monitor'

const NOW = 1000

function usage(
  o: Partial<{ slot: string; five: number; seven: number; ts: number; r5: number; r7: number }> = {}
): UsageRecord {
  const { slot = 'a', five = 10, seven = 10, ts = NOW, r5 = 5000, r7 = 9000 } = o
  return {
    slot_id: slot,
    ts,
    five_hour: { used_percentage: five, resets_at: r5 },
    seven_day: { used_percentage: seven, resets_at: r7 }
  }
}

function ev(
  kind: 'stop' | 'stopfailure' = 'stop',
  slot = 'a',
  ts = NOW,
  error: string | null = null
): EventRecord {
  return { kind, slot_id: slot, ts, error, _name: `${ts}.json` }
}

describe('Monitor', () => {
  it('低於門檻 none', () => {
    expect(new Monitor().tick(NOW, 'a', usage({ five: 50 }), []).kind).toBe('none')
  })

  it('達門檻進 pending', () => {
    const act = new Monitor().tick(NOW, 'a', usage({ five: 96 }), [])
    expect(act.kind).toBe('pending')
    expect(act.exhaustedUntil).toBe(5000)
  })

  it('pending 取視窗最大 resets_at', () => {
    const act = new Monitor().tick(NOW, 'a', usage({ five: 96, seven: 97 }), [])
    expect(act.exhaustedUntil).toBe(9000)
  })

  it('pending 後 stop 事件 switch_now', () => {
    const m = new Monitor()
    m.tick(NOW, 'a', usage({ five: 96 }), [])
    const act = m.tick(NOW + 5, 'a', usage({ five: 96 }), [ev('stop', 'a', NOW + 4)])
    expect(act.kind).toBe('switch_now')
    expect(act.exhaustedUntil).toBe(5000)
  })

  it('同一 tick 進 pending 且有 stop 事件立即 switch_now', () => {
    const act = new Monitor().tick(NOW, 'a', usage({ five: 96 }), [ev('stop')])
    expect(act.kind).toBe('switch_now')
  })

  it('用量降回門檻以下取消 pending', () => {
    const m = new Monitor()
    m.tick(NOW, 'a', usage({ five: 96 }), [])
    expect(m.tick(NOW + 5, 'a', usage({ five: 20, ts: NOW + 5 }), []).kind).toBe('none')
    const act = m.tick(NOW + 6, 'a', usage({ five: 20, ts: NOW + 6 }), [ev('stop', 'a', NOW + 6)])
    expect(act.kind).toBe('none')
  })

  it('rate_limit 事件立即切換（有用量）', () => {
    const act = new Monitor().tick(NOW, 'a', usage({ five: 99 }), [
      ev('stopfailure', 'a', NOW, 'rate_limit')
    ])
    expect(act.kind).toBe('switch_now')
    expect(act.exhaustedUntil).toBe(5000)
  })

  it('rate_limit 事件立即切換（無用量，預設 5 小時）', () => {
    const act = new Monitor().tick(NOW, 'a', null, [ev('stopfailure', 'a', NOW, 'rate_limit')])
    expect(act.kind).toBe('switch_now')
    expect(act.exhaustedUntil).toBe(NOW + 5 * 3600)
  })

  it('其他錯誤不立即切換', () => {
    const act = new Monitor().tick(NOW, 'a', null, [ev('stopfailure', 'a', NOW, 'overloaded')])
    expect(act.kind).toBe('none')
  })

  it('忽略其他帳號', () => {
    const m = new Monitor()
    expect(m.tick(NOW, 'a', usage({ slot: 'b', five: 99 }), []).kind).toBe('none')
    expect(m.tick(NOW, 'a', null, [ev('stopfailure', 'b', NOW, 'rate_limit')]).kind).toBe('none')
  })

  it('忽略 since 之前的資料', () => {
    const m = new Monitor()
    m.reset(NOW)
    expect(m.tick(NOW + 1, 'a', usage({ five: 99, ts: NOW - 1 }), []).kind).toBe('none')
    const act = m.tick(NOW + 1, 'a', null, [ev('stopfailure', 'a', NOW - 1, 'rate_limit')])
    expect(act.kind).toBe('none')
  })

  it('pending 逾時', () => {
    const m = new Monitor(95, 600)
    m.tick(NOW, 'a', usage({ five: 96 }), [])
    expect(m.tick(NOW + 300, 'a', usage({ five: 96 }), []).kind).toBe('pending')
    expect(m.tick(NOW + 601, 'a', usage({ five: 96 }), []).kind).toBe('switch_now')
  })

  it('reset 清除 pending', () => {
    const m = new Monitor()
    m.tick(NOW, 'a', usage({ five: 96 }), [])
    m.reset(NOW + 10)
    expect(m.pending).toBe(false)
    expect(m.since).toBe(NOW + 10)
    expect(m.tick(NOW + 11, 'a', null, [ev('stop', 'a', NOW + 11)]).kind).toBe('none')
  })

  it('視窗為 null 或無 used_percentage 時略過', () => {
    const rec = usage()
    rec.five_hour = null
    ;(rec.seven_day as unknown as Record<string, unknown>).used_percentage = null
    expect(new Monitor().tick(NOW, 'a', rec, []).kind).toBe('none')
  })
})

describe('Monitor prompt 事件', () => {
  it('prompt 事件不觸發切換也不影響 pending', () => {
    const m = new Monitor()
    const p: EventRecord = { kind: 'prompt', slot_id: 'a', ts: NOW, error: null, _name: `${NOW}.json` }
    expect(m.tick(NOW, 'a', usage({ five: 50 }), [p]).kind).toBe('none')
    const m2 = new Monitor()
    expect(m2.tick(NOW, 'a', usage({ five: 96 }), []).kind).toBe('pending')
    // pending 時只有 prompt 事件：仍等待（規則 4 只看 stop／stopfailure）
    expect(m2.tick(NOW + 1, 'a', usage({ five: 96 }), [{ ...p, ts: NOW + 1 }]).kind).toBe('pending')
  })
})

describe('Monitor 不重啟模式', () => {
  it('waitTurnEnd=false：達門檻立即 switch_now', () => {
    const m = new Monitor()
    m.waitTurnEnd = false
    const a = m.tick(NOW, 'a', usage({ five: 96 }), [])
    expect(a.kind).toBe('switch_now')
    expect(a.reason).toBe('已達門檻')
    expect(a.exhaustedUntil).toBe(5000)
    expect(m.pending).toBe(false)
  })

  it('waitTurnEnd=true 維持 pending', () => {
    expect(new Monitor().tick(NOW, 'a', usage({ five: 96 }), []).kind).toBe('pending')
  })

  it('ignoreFailuresUntil 內的 rate_limit stopfailure 不觸發，之後照常', () => {
    const m = new Monitor()
    m.ignoreFailuresUntil = NOW + 30
    const early = ev('stopfailure', 'a', NOW + 10, 'rate_limit')
    expect(m.tick(NOW + 11, 'a', usage({ five: 10, ts: NOW + 11 }), [early]).kind).toBe('none')
    const late = ev('stopfailure', 'a', NOW + 31, 'rate_limit')
    expect(m.tick(NOW + 32, 'a', usage({ five: 10, ts: NOW + 32 }), [late]).kind).toBe('switch_now')
  })
})

describe('Monitor 分開門檻', () => {
  it('5 小時與每週各依自己的門檻', () => {
    const m = new Monitor({ five_hour: 90, seven_day: 60 })
    m.reset(0)
    expect(m.tick(NOW, 'a', usage({ five: 85, seven: 55 }), []).kind).toBe('none')
    expect(m.tick(NOW, 'a', usage({ five: 85, seven: 65 }), []).kind).toBe('pending')
    const m2 = new Monitor({ five_hour: 90, seven_day: 60 })
    m2.reset(0)
    expect(m2.tick(NOW, 'a', usage({ five: 91, seven: 10 }), []).kind).toBe('pending')
  })
  it('數字門檻兩個視窗相同', () => {
    const m = new Monitor(80)
    expect(m.threshold).toEqual({ five_hour: 80, seven_day: 80 })
  })
})
