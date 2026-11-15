// 額度提前恢復（重置卡）：自動清除用完標記，並依等待狀態切換或送繼續。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as accounts from '../src/core/accounts'
import { exhaustedRecovered } from '../src/core/claudeavail'
import * as paths from '../src/core/paths'
import type { ProcInfo } from '../src/core/sessions'
import * as storage from '../src/core/storage'
import { Controller, type LauncherLike } from '../src/main/controller'
import { acct, creds, login, useTempEnv } from './helpers'

const SID = '11111111-2222-3333-4444-555555555555'

describe('exhaustedRecovered', () => {
  const T = 1_000_000
  const slot = { id: 'a', saved_at: 0, exhausted_until: T + 10000, exhausted_at: T }
  const win = (u: number) => ({ used_percentage: u, resets_at: T + 99999 })

  it('新資料低於門檻 → true', () => {
    expect(exhaustedRecovered(slot, { ts: T + 60, five_hour: win(3), seven_day: win(40) }, 95)).toBe(true)
  })
  it('資料太舊 → false', () => {
    expect(exhaustedRecovered(slot, { ts: T + 59, five_hour: win(3), seven_day: null }, 95)).toBe(false)
  })
  it('任一視窗達門檻 → false', () => {
    expect(exhaustedRecovered(slot, { ts: T + 100, five_hour: win(3), seven_day: win(95) }, 95)).toBe(false)
    expect(exhaustedRecovered(slot, { ts: T + 100, five_hour: win(96), seven_day: null }, 95)).toBe(false)
  })
  it('沒資料的視窗不算超過', () => {
    expect(exhaustedRecovered(slot, { ts: T + 100, five_hour: win(3), seven_day: null }, 95)).toBe(true)
  })
  it('舊資料無 exhausted_at：用 exhausted_until - 18000', () => {
    const old = { id: 'a', saved_at: 0, exhausted_until: T + 18000 }
    expect(exhaustedRecovered(old, { ts: T + 59, five_hour: win(3) }, 95)).toBe(false)
    expect(exhaustedRecovered(old, { ts: T + 60, five_hour: win(3) }, 95)).toBe(true)
  })
  it('needs_relogin → false', () => {
    expect(exhaustedRecovered(slot, { ts: T + 100, needs_relogin: true, five_hour: win(3) }, 95)).toBe(false)
  })
})

describe('controller 額度提前恢復', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  let clock = 0
  let procs: ProcInfo[] = []
  let submits: { pid: number; text: string }[] = []
  const nowS = (): number => clock / 1000

  const launcher: LauncherLike = {
    launch: (() => 'x') as unknown as LauncherLike['launch'],
    activeRuns: () => [],
    requestRestart: async () => true,
    releaseRestart: () => undefined,
    abortRestart: () => undefined
  }

  function setup() {
    clock = Date.now()
    procs = []
    submits = []
    const a = accounts.addSlot('A', creds('tok-A'), acct('uuid-A', 'A@x'))
    const b = accounts.addSlot('B', creds('tok-B'), acct('uuid-B', 'B@x'))
    login('tok-A', 'uuid-A', 'A@x')
    // 一個因 rate_limit 停下、很久以前的 claude
    procs.push({ pid: 1010, ppid: 1, name: 'pwsh.exe', cmdline: 'pwsh.exe', created: 1 })
    procs.push({ pid: 10, ppid: 1010, name: 'claude.exe', cmdline: 'claude.exe', created: 100 })
    storage.writeJsonAtomic(path.join(paths.pidmapDir(), `${SID}.json`), {
      session_id: SID, cwd: 'C:\p1', claude_pid: 10, claude_created: 100,
      shell_pid: 1010, shell_name: 'pwsh.exe', ts: 100
    })
    storage.writeJsonAtomic(path.join(paths.eventsDir(), '000001-a.json'), {
      kind: 'stopfailure', session_id: SID, ts: nowS() - 7200, error: 'rate_limit'
    })
    const scripts = path.join(root(), 'scripts-src')
    fs.mkdirSync(scripts, { recursive: true })
    fs.writeFileSync(path.join(scripts, 'x.cjs'), '// fake')
    storage.writeJsonAtomic(paths.configFile(), { switch_mode: 'live' })
    const ctl = new Controller({
      scriptsDir: scripts,
      findNode: () => process.execPath,
      disablePoll: false,
      waitIntervalMs: 10,
      waitMaxMs: 150,
      now: () => clock,
      launcher,
      pidAlive: (pid) => procs.some((p) => p.pid === pid),
      cli: {
        listProcesses: async () => procs,
        kill: async () => true,
        inject: async () => true,
        injectSubmit: async (pid, text) => {
          submits.push({ pid, text })
          return true
        }
      }
    })
    controllers.push(ctl)
    return { a, b, ctl, t: nowS() }
  }

  /** 寫入 usage_api 記錄（ts 為現在 + 偏移）。 */
  function api(id: string, used: number, ts: number): void {
    storage.writeJsonAtomic(path.join(paths.usageApiDir(), `${id}.json`), {
      slot_id: id,
      ts,
      five_hour: { used_percentage: used, resets_at: ts + 7200 },
      seven_day: { used_percentage: 10, resets_at: ts + 200000 }
    })
  }
  const stuck = (id: string, t: number): void => {
    accounts.markExhausted(id, t + 7200, t)
  }
  const resumeAtOf = (ctl: Controller): number | null => ctl.getState().resumeAt

  it('其他帳號提前恢復且正在等待：切過去並送繼續一次', async () => {
    const { a, b, ctl, t } = setup()
    stuck(a.id, t)
    stuck(b.id, t)
    ;(ctl as unknown as { resumeAt: number }).resumeAt = t + 7000
    clock += 120_000
    api(a.id, 100, nowS())
    api(b.id, 2, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(accounts.getSlot(b.id)?.exhausted_until).toBe(0)
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
    expect(resumeAtOf(ctl)).toBeNull()
    clock += 3000
    await ctl.tick()
    expect(submits).toHaveLength(1)
    expect(ctl.getState().events.some((e) => e.text.includes('B 的額度已恢復'))).toBe(true)
  })

  it('目前帳號提前恢復且正在等待：送繼續', async () => {
    const { a, ctl, t } = setup()
    stuck(a.id, t)
    ;(ctl as unknown as { resumeAt: number }).resumeAt = t + 7000
    clock += 120_000
    api(a.id, 2, nowS())
    await ctl.tick()
    await ctl.tick()
    expect(accounts.getSlot(a.id)?.exhausted_until).toBe(0)
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
    expect(resumeAtOf(ctl)).toBeNull()
  })

  it('沒在等待：只清標記，不切換、不送', async () => {
    const { a, b, ctl, t } = setup()
    stuck(b.id, t)
    clock += 120_000
    api(b.id, 2, nowS())
    await ctl.tick()
    expect(accounts.getSlot(b.id)?.exhausted_until).toBe(0)
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(submits).toEqual([])
  })

  it('沒有排程（例如 App 重啟過）、目前帳號仍用完、其他帳號恢復：切過去並送繼續', async () => {
    const { a, b, ctl, t } = setup()
    stuck(a.id, t)
    stuck(b.id, t)
    expect(resumeAtOf(ctl)).toBeNull()
    clock += 120_000
    api(a.id, 100, nowS())
    api(b.id, 2, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
  })

  it('沒有排程、目前帳號恢復：送繼續', async () => {
    const { a, ctl, t } = setup()
    stuck(a.id, t)
    expect(resumeAtOf(ctl)).toBeNull()
    clock += 120_000
    api(a.id, 2, nowS())
    await ctl.tick()
    await ctl.tick()
    expect(accounts.getSlot(a.id)?.exhausted_until).toBe(0)
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
  })

  it('restart 模式：只清標記，不切換、不送', async () => {
    const { a, b, ctl, t } = setup()
    storage.writeJsonAtomic(paths.configFile(), { switch_mode: 'restart' })
    await ctl.setConfig({ switch_mode: 'restart' })
    stuck(a.id, t)
    stuck(b.id, t)
    clock += 120_000
    api(a.id, 100, nowS())
    api(b.id, 2, nowS())
    await ctl.tick()
    expect(accounts.getSlot(b.id)?.exhausted_until).toBe(0)
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(submits).toEqual([])
  })

  it('仍達門檻：不清', async () => {
    const { b, ctl, t } = setup()
    stuck(b.id, t)
    clock += 120_000
    api(b.id, 99, nowS())
    await ctl.tick()
    expect(accounts.getSlot(b.id)?.exhausted_until).toBeGreaterThan(0)
  })

  it('使用中帳號恢復：earliestReset 變 null', async () => {
    const { a, b, ctl, t } = setup()
    stuck(a.id, t)
    stuck(b.id, t + 100)
    await ctl.tick()
    expect(ctl.getState().earliestReset).not.toBeNull()
    clock += 120_000
    api(a.id, 2, nowS())
    await ctl.tick()
    expect(ctl.getState().earliestReset).toBeNull()
  })
})
