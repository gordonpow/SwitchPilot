import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as paths from '../src/core/paths'
import * as usage from '../src/core/usage'
import { useTempEnv } from './helpers'

useTempEnv()

function putUsage(sid: string, slot: string, ts: number): void {
  fs.mkdirSync(paths.usageDir(), { recursive: true })
  fs.writeFileSync(
    path.join(paths.usageDir(), sid + '.json'),
    JSON.stringify({ session_id: sid, slot_id: slot, ts, five_hour: null, seven_day: null })
  )
}
function putEvent(name: string, rec: object): void {
  fs.mkdirSync(paths.eventsDir(), { recursive: true })
  fs.writeFileSync(path.join(paths.eventsDir(), name), JSON.stringify(rec))
}

describe('usage', () => {
  it('latestUsage by slot and since', () => {
    expect(usage.latestUsage('a')).toBeNull()
    putUsage('s1', 'a', 100)
    putUsage('s2', 'a', 200)
    putUsage('s3', 'b', 300)
    expect(usage.latestUsage('a')!.session_id).toBe('s2')
    expect(usage.latestUsage('b')!.session_id).toBe('s3')
    expect(usage.latestUsage('c')).toBeNull()
    expect(usage.latestUsage('a', 250)).toBeNull()
    expect(usage.latestUsage('a', 150)!.session_id).toBe('s2')
  })

  it('isStale', () => {
    expect(usage.isStale({ ts: 1000 }, 1500)).toBe(false)
    expect(usage.isStale({ ts: 1000 }, 1700)).toBe(true)
    expect(usage.isStale({ ts: 1000 }, 1200, 100)).toBe(true)
    expect(usage.isStale({}, 1)).toBe(true)
    expect(usage.isStale(null, 1)).toBe(true)
  })

  it('readNewEvents watermark', () => {
    expect(usage.readNewEvents(null)).toEqual({ events: [], last: null })
    expect(usage.readNewEvents('5-a.json')).toEqual({ events: [], last: '5-a.json' })
    putEvent('1-aaaa.json', { kind: 'stop' })
    putEvent('2-bbbb.json', { kind: 'stopfailure' })
    const r1 = usage.readNewEvents(null)
    expect(r1.events.map((e) => e._name)).toEqual(['1-aaaa.json', '2-bbbb.json'])
    expect(r1.last).toBe('2-bbbb.json')
    const r2 = usage.readNewEvents(r1.last)
    expect(r2.events).toEqual([])
    expect(r2.last).toBe(r1.last)
    putEvent('3-cccc.json', { kind: 'stop' })
    const r3 = usage.readNewEvents(r1.last)
    expect(r3.events.map((e) => e.kind)).toEqual(['stop'])
    expect(r3.last).toBe('3-cccc.json')
  })

  it('cleanup', () => {
    putUsage('old', 'a', 1)
    putUsage('new', 'a', 2)
    putEvent('1-aaaa.json', { kind: 'stop' })
    const old = new Date(Date.now() - 200000 * 1000)
    fs.utimesSync(path.join(paths.usageDir(), 'old.json'), old, old)
    fs.utimesSync(path.join(paths.eventsDir(), '1-aaaa.json'), old, old)
    usage.cleanup(Date.now() / 1000)
    expect(fs.existsSync(path.join(paths.usageDir(), 'old.json'))).toBe(false)
    expect(fs.existsSync(path.join(paths.usageDir(), 'new.json'))).toBe(true)
    expect(fs.existsSync(path.join(paths.eventsDir(), '1-aaaa.json'))).toBe(false)
  })
})

describe('allEvents／allPidmaps／allUsage／pidmap cleanup', () => {
  it('讀取全部且不動水位線', () => {
    putEvent('1-aaaa.json', { kind: 'prompt', session_id: 's' })
    putEvent('2-bbbb.json', { kind: 'stop', session_id: 's' })
    expect(usage.allEvents().map((e) => e.kind)).toEqual(['prompt', 'stop'])
    expect(usage.readNewEvents(null).events).toHaveLength(2)
    putUsage('u1', 'a', 5)
    expect(usage.allUsage().map((u) => u.session_id)).toEqual(['u1'])
    expect(usage.allPidmaps()).toEqual([])
    fs.mkdirSync(paths.pidmapDir(), { recursive: true })
    fs.writeFileSync(path.join(paths.pidmapDir(), 'p1.json'), JSON.stringify({ session_id: 'p1', claude_pid: 7 }))
    fs.writeFileSync(path.join(paths.pidmapDir(), 'bad.json'), '{壞')
    expect(usage.allPidmaps().map((p) => p.claude_pid)).toEqual([7])
    const old = new Date(Date.now() - 200000 * 1000)
    fs.utimesSync(path.join(paths.pidmapDir(), 'p1.json'), old, old)
    usage.cleanup(Date.now() / 1000)
    expect(fs.existsSync(path.join(paths.pidmapDir(), 'p1.json'))).toBe(false)
  })
})
