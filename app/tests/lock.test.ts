import { describe, expect, it } from 'vitest'
import { withSlotLock } from '../src/core/lock'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('withSlotLock', () => {
  it('serializes same slot', async () => {
    const log: string[] = []
    const mk = (n: string, ms: number): Promise<void> =>
      withSlotLock('a', async () => {
        log.push('start-' + n)
        await sleep(ms)
        log.push('end-' + n)
      })
    await Promise.all([mk('1', 30), mk('2', 5), mk('3', 1)])
    expect(log).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
  })

  it('different slots run in parallel', async () => {
    const log: string[] = []
    const p1 = withSlotLock('a', async () => {
      log.push('a-start')
      await sleep(30)
      log.push('a-end')
    })
    const p2 = withSlotLock('b', () => {
      log.push('b-start')
    })
    await Promise.all([p1, p2])
    expect(log.indexOf('b-start')).toBeLessThan(log.indexOf('a-end'))
  })

  it('error does not break queue and result is propagated', async () => {
    const p1 = withSlotLock('a', () => {
      throw new Error('boom')
    })
    const p2 = withSlotLock('a', () => 42)
    await expect(p1).rejects.toThrow('boom')
    await expect(p2).resolves.toBe(42)
  })
})
