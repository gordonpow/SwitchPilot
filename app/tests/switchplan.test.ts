import { describe, expect, it } from 'vitest'
import { earliestReset, pickNext } from '../src/core/switchplan'

const S = (id: string, until = 0) => ({ id, exhausted_until: until })

describe('pickNext', () => {
  it('cycles after current', () => {
    const slots = [S('a'), S('b'), S('c')]
    expect(pickNext(slots, 'b', 100)!.id).toBe('c')
    expect(pickNext(slots, 'c', 100)!.id).toBe('a')
  })
  it('skips exhausted', () => {
    expect(pickNext([S('a'), S('b', 500), S('c')], 'a', 100)!.id).toBe('c')
  })
  it('expired exhaustion is available', () => {
    expect(pickNext([S('a'), S('b', 50)], 'a', 100)!.id).toBe('b')
  })
  it('all exhausted returns null', () => {
    expect(pickNext([S('a'), S('b', 500), S('c', 600)], 'a', 100)).toBeNull()
  })
  it('only current returns null', () => {
    expect(pickNext([S('a')], 'a', 100)).toBeNull()
    expect(pickNext([], null, 100)).toBeNull()
  })
  it('unknown current', () => {
    expect(pickNext([S('a'), S('b')], null, 1)!.id).toBe('a')
  })
  it('isBlocked skips slots', () => {
    const slots = [S('a'), S('b'), S('c')]
    expect(pickNext(slots, 'a', 100, (s) => s.id === 'b')!.id).toBe('c')
    expect(pickNext(slots, 'a', 100, () => true)).toBeNull()
  })
})

describe('earliestReset', () => {
  it('min of future', () => {
    expect(earliestReset([S('a', 900), S('b', 300), S('c', 50)], 100)).toBe(300)
  })
  it('none', () => {
    expect(earliestReset([S('a'), S('b', 50)], 100)).toBeNull()
  })
})
