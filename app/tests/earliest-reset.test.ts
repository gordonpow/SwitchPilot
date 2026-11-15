// controller 不重啟（live）模式：切換不 kill／不重啟，只對中斷的 claude 送出提示（假 CliOps、假 launcher）。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as accounts from '../src/core/accounts'
import type { RestartOptions, RunState } from '../src/core/launcher'
import * as paths from '../src/core/paths'
import type { ProcInfo } from '../src/core/sessions'
import * as storage from '../src/core/storage'
import { Controller, type ControllerDeps, type LauncherLike } from '../src/main/controller'
import { acct, creds, login, useTempEnv } from './helpers'

const SID_A = '11111111-2222-3333-4444-555555555555'

interface Cli {
  pid: number
  sid: string
  cwd: string
  turn: 'prompt' | 'stop' | 'stopfailure'
  hostedBy?: number
  cmdline?: string
  /** 事件 ts（unix 秒）；預設為現在 */
  ts?: number
  error?: string | null
}

describe('全部用完換到最早重置的帳號', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  let clock = 0
  let procs: ProcInfo[] = []
  let alive = new Set<number>()
  let runs: RunState[] = []
  let killed: number[] = []
  let submits: { pid: number; text: string }[] = []
  let submitOk = true
  let submitThrows = false
  let calls: string[] = []
  let evSeq = 0

  function reset(): void {
    clock = Date.now()
    procs = []
    alive = new Set()
    runs = []
    killed = []
    submits = []
    submitOk = true
    submitThrows = false
    calls = []
    evSeq = 0
  }
  const nowS = (): number => clock / 1000

  function world(clis: Cli[]): void {
    let ev = 1
    for (const c of clis) {
      const shellPid = c.pid + 1000
      const parent = c.hostedBy ?? shellPid
      const created = c.pid * 10
      if (!c.hostedBy) {
        procs.push({ pid: shellPid, ppid: 1, name: 'pwsh.exe', cmdline: 'pwsh.exe', created: 1 })
        alive.add(shellPid)
      }
      procs.push({
        pid: c.pid,
        ppid: parent,
        name: 'claude.exe',
        cmdline: c.cmdline ?? 'claude.exe',
        created
      })
      alive.add(c.pid)
      storage.writeJsonAtomic(path.join(paths.pidmapDir(), `${c.sid}.json`), {
        session_id: c.sid,
        cwd: c.cwd,
        claude_pid: c.pid,
        claude_created: created,
        shell_pid: c.hostedBy ?? shellPid,
        shell_name: c.hostedBy ? 'node.exe' : 'pwsh.exe',
        ts: 100
      })
      storage.writeJsonAtomic(
        path.join(paths.eventsDir(), `${String(ev++).padStart(6, '0')}-a.json`),
        {
          kind: c.turn,
          session_id: c.sid,
          ts: c.ts ?? nowS(),
          error: c.error === undefined ? null : c.error
        }
      )
    }
  }

  /** 寫一個新事件（檔名遞增，晚於 controller 建構時的水位線）。 */
  function writeFailure(slotId: string, sid: string, ts: number): void {
    storage.writeJsonAtomic(
      path.join(paths.eventsDir(), `9${String(++evSeq).padStart(8, '0')}-f.json`),
      { kind: 'stopfailure', session_id: sid, slot_id: slotId, ts, error: 'rate_limit' }
    )
  }

  const launcher: LauncherLike = {
    launch: vi.fn(() => {
      calls.push('launch')
      return 'x'
    }) as unknown as LauncherLike['launch'],
    activeRuns: () => {
      calls.push('activeRuns')
      return runs
    },
    requestRestart: async () => {
      calls.push('requestRestart')
      return true
    },
    releaseRestart: (_r: RunState, _o?: RestartOptions) => void calls.push('release'),
    abortRestart: () => void calls.push('abort')
  }

  function make(cfg: Record<string, unknown> = {}, deps: ControllerDeps = {}): Controller {
    const scripts = path.join(root(), 'scripts-src')
    fs.mkdirSync(scripts, { recursive: true })
    fs.writeFileSync(path.join(scripts, 'x.cjs'), '// fake')
    storage.writeJsonAtomic(paths.configFile(), { switch_mode: 'live', ...cfg })
    const c = new Controller({
      scriptsDir: scripts,
      findNode: () => process.execPath,
      disablePoll: false,
      waitIntervalMs: 10,
      waitMaxMs: 150,
      now: () => clock,
      launcher,
      pidAlive: (pid) => alive.has(pid),
      cli: {
        listProcesses: async () => procs.filter((p) => alive.has(p.pid)),
        kill: async (pid) => {
          calls.push('kill')
          killed.push(pid)
          return true
        },
        inject: async () => {
          calls.push('inject')
          return true
        },
        injectSubmit: async (pid, text) => {
          calls.push('injectSubmit')
          submits.push({ pid, text })
          if (submitThrows) throw new Error('SECRET-CMDLINE ' + text)
          return submitOk
        }
      },
      ...deps
    })
    controllers.push(c)
    return c
  }

  function slots(): { a: accounts.Slot; b: accounts.Slot } {
    const [a, b] = ['A', 'B'].map((n) =>
      accounts.addSlot(n, creds('tok-' + n), acct('uuid-' + n, `${n}@x`))
    )
    login('tok-A', 'uuid-A', 'A@x')
    return { a, b }
  }

  const CLIS: Cli[] = [{ pid: 10, sid: SID_A, cwd: 'C:\p1', turn: 'stopfailure', error: 'rate_limit' }]

  /** A 為目前帳號且用量達門檻（resets_at = t+aReset 秒）；B 的 exhausted_until = t+bUntil。 */
  function setup(aReset: number, bUntil: number, cfg: Record<string, unknown> = {}, deps: ControllerDeps = {}) {
    reset()
    const { a, b } = slots()
    world(CLIS)
    const ctl = make(cfg, deps)
    const t = nowS()
    accounts.markExhausted(b.id, t + bUntil)
    storage.writeJsonAtomic(path.join(paths.usageDir(), 's.json'), {
      slot_id: a.id,
      ts: t,
      five_hour: { used_percentage: 97, resets_at: t + aReset },
      seven_day: null
    })
    return { a, b, ctl, t }
  }

  it('另一帳號較早重置：切過去、不送提示；可用時間 +60 秒後送一次繼續', async () => {
    const { b, ctl, t } = setup(7200, 1000)
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(submits).toEqual([])
    expect(killed).toEqual([])
    expect(calls).not.toContain('requestRestart')
    expect(ctl.getState().resumeAt).toBeCloseTo(t + 1060, 1)
    const texts = ctl.getState().events.map((e) => e.text)
    expect(texts.some((x) => x.includes('最早重置'))).toBe(true)

    clock += 1000_000
    await ctl.tick()
    expect(submits).toEqual([])
    clock += 61_000
    await ctl.tick()
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
    expect(ctl.getState().resumeAt).toBeNull()
    clock += 2000
    await ctl.tick()
    expect(submits).toHaveLength(1)
  })

  it('目前帳號較早重置：不切換，仍安排繼續', async () => {
    const { a, ctl, t } = setup(1000, 7200)
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(ctl.getState().resumeAt).toBeCloseTo(t + 1060, 1)
    expect(submits).toEqual([])
    clock += 1061_000
    await ctl.tick()
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
  })

  it('可用時間前的 stopfailure 不再切換', async () => {
    const { b, ctl } = setup(7200, 1000)
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    clock += 30_000
    writeFailure(b.id, SID_A, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(submits).toEqual([])
  })

  it('switch_to_earliest 為 false：原行為（不切換、無 resumeAt）', async () => {
    const { a, ctl } = setup(7200, 1000, { switch_to_earliest: false })
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(ctl.getState().resumeAt).toBeNull()
    const texts = ctl.getState().events.map((e) => e.text)
    expect(texts.some((x) => x.includes('所有帳號都已用完'))).toBe(true)
  })

  it('手動切換取消 resumeAt', async () => {
    const { a, ctl } = setup(7200, 1000)
    await ctl.tick()
    expect(ctl.getState().resumeAt).not.toBeNull()
    expect(await ctl.switchTo(a.id, false)).toEqual({ ok: true })
    expect(ctl.getState().resumeAt).toBeNull()
  })

  it('clearExhausted 取消 resumeAt', async () => {
    const { ctl } = setup(7200, 1000)
    await ctl.tick()
    expect(ctl.getState().resumeAt).not.toBeNull()
    await ctl.clearExhausted()
    expect(ctl.getState().resumeAt).toBeNull()
  })

  it('dead 帳號被跳過', async () => {
    reset()
    const { a, b } = slots()
    const c = accounts.addSlot('C', creds('tok-C'), acct('uuid-C', 'C@x'))
    world(CLIS)
    const ctl = make({}, {
      poller: {
        pollAll: async () => true,
        running: false,
        ensureFresh: async (id: string) => (id === b.id ? 'dead' : 'ok')
      }
    })
    const t = nowS()
    accounts.markExhausted(b.id, t + 500)
    accounts.markExhausted(c.id, t + 1000)
    storage.writeJsonAtomic(path.join(paths.usageDir(), 's.json'), {
      slot_id: a.id,
      ts: t,
      five_hour: { used_percentage: 97, resets_at: t + 7200 },
      seven_day: null
    })
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(c.id)
  })

  it('restart 模式：維持原「全部用完」行為，不切換、無 resumeAt', async () => {
    reset()
    const { a, b } = slots()
    world([])
    const ctl = make({ switch_mode: 'restart' })
    const t = nowS()
    accounts.markExhausted(b.id, t + 1000)
    storage.writeJsonAtomic(path.join(paths.usageDir(), 's.json'), {
      slot_id: a.id,
      ts: t,
      five_hour: { used_percentage: 97, resets_at: t + 7200 },
      seven_day: null
    })
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(ctl.getState().resumeAt).toBeNull()
    const texts = ctl.getState().events.map((e) => e.text)
    expect(texts.some((x) => x.includes('最早重置'))).toBe(false)
  })

  it('切換失敗：還原 noTargetUntil 與 resumeAt', async () => {
    const { a, ctl } = setup(7200, 1000)
    const spy = vi.spyOn(accounts, 'switchTo').mockImplementation(() => {
      throw new Error('boom')
    })
    try {
      await ctl.tick()
    } finally {
      spy.mockRestore()
    }
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(ctl.getState().resumeAt).toBeNull()
    expect((ctl as unknown as { noTargetUntil: number }).noTargetUntil).toBe(0)
  })

  it('resume 時：很久以前因 rate_limit 停下的送、error 為空的不送', async () => {
    reset()
    slots()
    const SID_B = '99999999-2222-3333-4444-555555555555'
    const old = nowS() - 7200
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\p1', turn: 'stopfailure', error: 'rate_limit', ts: old },
      { pid: 20, sid: SID_B, cwd: 'C:\p2', turn: 'stopfailure', error: null, ts: old }
    ])
    const ctl = make()
    const t = nowS()
    ;(ctl as unknown as { resumeAt: number }).resumeAt = t + 10
    clock += 20_000
    await ctl.tick()
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
  })

  it('resume 時目前帳號仍被擋：順延不送，解除後才送', async () => {
    const { b, ctl, t } = setup(7200, 1000)
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    accounts.markExhausted(b.id, t + 5000)
    clock += 1061_000
    await ctl.tick()
    expect(submits).toEqual([])
    expect(ctl.getState().resumeAt).toBeCloseTo(t + 5060, 1)
    const texts = ctl.getState().events.map((e) => e.text)
    expect(texts.filter((x) => x.includes('順延')).length).toBe(1)
    clock += 4000_000
    await ctl.tick()
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
  })

  it('可用時間前新增可用帳號：60 秒後的 rate_limit 切到該帳號', async () => {
    const { b, ctl } = setup(7200, 1000)
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    const c = accounts.addSlot('C', creds('tok-C'), acct('uuid-C', 'C@x'))
    clock += 120_000
    writeFailure(b.id, SID_A, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(c.id)
  })
})
