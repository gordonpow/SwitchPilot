// controller 的外部 CLI 偵測與切換流程（假程序表、假 CliOps、假 launcher；不碰真實程序與家目錄）。
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
const SID_B = '22222222-2222-3333-4444-555555555555'
const SID_H = '33333333-2222-3333-4444-555555555555'

interface Cli {
  pid: number
  sid: string | null
  cwd: string
  shell?: string // 預設 pwsh.exe
  cmdline?: string
  turn?: 'prompt' | 'stop' | 'stopfailure'
  hostedBy?: number // runner pid
}

describe('Controller 外部 CLI', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  let order: string[] = []
  let alive = new Set<number>()
  let procs: ProcInfo[] = []
  let killed: number[] = []
  let injected: { pid: number; line: string }[] = []
  let launches: { cwd: string; cont: boolean; opts: Record<string, unknown> }[] = []
  let released: { id: string; opts?: RestartOptions }[] = []
  let aborted: string[] = []
  let injectResult = true
  let injectThrows = false
  let runs: RunState[] = []
  let stubbornRun = false

  function reset(): void {
    order = []
    alive = new Set()
    procs = []
    killed = []
    injected = []
    launches = []
    released = []
    aborted = []
    injectResult = true
    injectThrows = false
    runs = []
    stubbornRun = false
  }

  /** 建立 pidmap、事件與程序表。 */
  function world(clis: Cli[], eventBase = 1): void {
    let ev = eventBase
    for (const c of clis) {
      const shellName = c.shell ?? 'pwsh.exe'
      const shellPid = c.pid + 1000
      const parent = c.hostedBy ?? shellPid
      const created = c.pid * 10
      if (!c.hostedBy) {
        procs.push({ pid: shellPid, ppid: 1, name: shellName, cmdline: shellName, created: 1 })
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
      if (c.sid) {
        storage.writeJsonAtomic(path.join(paths.pidmapDir(), `${c.sid}.json`), {
          session_id: c.sid,
          cwd: c.cwd,
          claude_pid: c.pid,
          claude_created: created,
          shell_pid: c.hostedBy ? c.hostedBy : shellPid,
          shell_name: c.hostedBy ? 'node.exe' : shellName,
          ts: 100
        })
        if (c.turn) {
          storage.writeJsonAtomic(path.join(paths.eventsDir(), `${String(ev++).padStart(6, '0')}-a.json`), {
            kind: c.turn,
            session_id: c.sid,
            ts: ev,
            error: null
          })
        }
      }
    }
  }

  const launcher: LauncherLike = {
    launch: vi.fn((folder: string, cont: boolean, opts: Record<string, unknown>) => {
      order.push('launch')
      launches.push({ cwd: folder, cont, opts })
      return 'x'
    }) as unknown as LauncherLike['launch'],
    activeRuns: () => runs,
    requestRestart: async (r: RunState) => {
      order.push('request')
      if (!stubbornRun && r.claude_pid) alive.delete(r.claude_pid)
      return true
    },
    releaseRestart: (r: RunState, opts?: RestartOptions) => {
      order.push('release')
      released.push({ id: r.run_id, opts })
    },
    abortRestart: (r: RunState) => void aborted.push(r.run_id)
  }

  function make(deps: ControllerDeps = {}): Controller {
    const scripts = path.join(root(), 'scripts-src')
    fs.mkdirSync(scripts, { recursive: true })
    fs.writeFileSync(path.join(scripts, 'x.cjs'), '// fake')
    // 本檔驗證 restart 流程；live 模式見 controller-live.test.ts
    storage.writeJsonAtomic(paths.configFile(), { switch_mode: 'restart' })
    const c = new Controller({
      scriptsDir: scripts,
      findNode: () => process.execPath,
      disablePoll: false,
      waitIntervalMs: 10,
      waitMaxMs: 150,
      injectDelayMs: 1,
      launcher,
      pidAlive: (pid) => alive.has(pid),
      cli: {
        listProcesses: async () => {
          order.push('scan')
          return procs.filter((p) => alive.has(p.pid))
        },
        kill: async (pid) => {
          order.push('kill')
          killed.push(pid)
          alive.delete(pid)
          return true
        },
        inject: async (pid, line) => {
          order.push('inject')
          injected.push({ pid, line })
          if (injectThrows) throw new Error('SECRET-CMDLINE ' + line)
          return injectResult
        },
        injectSubmit: async () => false
      },
      ...deps
    })
    controllers.push(c)
    return c
  }

  function slots(): accounts.Slot[] {
    const out = ['A', 'B'].map((n) => accounts.addSlot(n, creds('tok-' + n), acct('uuid-' + n, `${n}@x`)))
    login('tok-A', 'uuid-A', 'A@x')
    return out
  }

  const setup = (): { ctl: Controller; b: accounts.Slot } => {
    reset()
    const [, b] = slots()
    return { ctl: make(), b }
  }

  it('state.clis：session、帳號名稱、turn、method；非互動與無 session 也列出', async () => {
    reset()
    const [a] = slots()
    storage.writeJsonAtomic(path.join(paths.usageDir(), 's.json'), {
      session_id: SID_A,
      slot_id: a.id,
      ts: 5,
      five_hour: null,
      seven_day: null
    })
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'prompt' },
      { pid: 20, sid: SID_B, cwd: 'C:\\p2', shell: 'bash.exe', turn: 'stop' },
      { pid: 30, sid: null, cwd: 'C:\\p3' },
      { pid: 40, sid: null, cwd: 'C:\\p4', cmdline: 'claude.exe -p hi' }
    ])
    const ctl = make()
    await (ctl as unknown as { scanNow(): Promise<unknown> }).scanNow()
    const s = ctl.getState()
    expect(s.clisScannedAt).not.toBeNull()
    const by = (pid: number) => s.clis.find((c) => c.pid === pid)!
    expect(by(10)).toMatchObject({ sessionId: SID_A, slotName: 'A', turn: 'busy', method: 'inject' })
    expect(by(20)).toMatchObject({ turn: 'idle', method: 'newtab', slotName: 'A' })
    expect(by(30)).toMatchObject({ sessionId: null, method: 'none' })
    expect(by(40).method).toBe('none')
    expect(JSON.stringify(s)).not.toContain('claude.exe')
    expect(s.integration.needsUpdate).toBe(false)
  })

  it('disablePoll：不掃描程序', async () => {
    reset()
    slots()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1' }])
    const ctl = make({ disablePoll: true })
    ctl.start()
    await new Promise((r) => setTimeout(r, 30))
    expect(order).not.toContain('scan')
    expect(ctl.getState().clis).toEqual([])
    await ctl.switchTo(accounts.listSlots()[1].id, true)
    expect(order).not.toContain('scan')
  })

  it('AC-2/3：外部與託管都結束；外部 inject 原視窗、託管 release 帶 resume；idle 不帶提示', async () => {
    reset()
    const [, b] = slots()
    runs = [{ run_id: 'r1', cwd: 'C:\\h', claude_pid: 500, runner_pid: 900, state: 'waiting' }]
    procs.push({ pid: 900, ppid: 1, name: 'node.exe', cmdline: 'node runner.cjs', created: 1 })
    alive.add(900)
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stop', cmdline: 'claude.exe --model opus' },
      { pid: 500, sid: SID_H, cwd: 'C:\\h', hostedBy: 900, turn: 'stop' }
    ])
    const ctl = make()
    expect(await ctl.switchTo(b.id, true)).toEqual({ ok: true })
    expect(killed).toEqual([10])
    expect(order.indexOf('scan')).toBeLessThan(order.indexOf('request'))
    expect(order.indexOf('scan')).toBeLessThan(order.indexOf('kill'))
    expect(injected).toHaveLength(1)
    expect(injected[0].pid).toBe(1010)
    expect(injected[0].line).toBe(`claude '--model' 'opus' '--resume' '${SID_A}'`)
    expect(launches).toHaveLength(0)
    expect(released).toEqual([{ id: 'r1', opts: { resume: SID_H } }])
    expect(ctl.getState().events.some((e) => e.text.includes('已在原視窗接續'))).toBe(true)
  })

  it('AC-4：busy／interrupted 帶提示，idle 不帶', async () => {
    const { ctl, b } = setup()
    runs = [{ run_id: 'r1', cwd: 'C:\\h', claude_pid: 500, runner_pid: 900 }]
    procs.push({ pid: 900, ppid: 1, name: 'node.exe', cmdline: 'node runner.cjs', created: 1 })
    alive.add(900)
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'prompt' },
      { pid: 20, sid: SID_B, cwd: 'C:\\p2', turn: 'stopfailure' },
      { pid: 30, sid: '44444444-2222-3333-4444-555555555555', cwd: 'C:\\p3', turn: 'stop' },
      { pid: 500, sid: SID_H, cwd: 'C:\\h', hostedBy: 900, turn: 'prompt' }
    ])
    await ctl.tick() // 讀入 world() 寫的事件
    await ctl.switchTo(b.id, true)
    const lines = injected.map((i) => i.line)
    expect(lines).toHaveLength(3)
    expect(lines.filter((l) => l.endsWith(`'繼續'`))).toHaveLength(2)
    expect(lines.filter((l) => l.includes('繼續'))).toHaveLength(2)
    expect(released[0].opts).toEqual({ resume: SID_H, prompt: '繼續' })
  })

  it('continue_prompt 為空：busy 也不帶提示', async () => {
    const { ctl, b } = setup()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'prompt' }])
    expect(await ctl.setConfig({ continue_prompt: '  ' })).toEqual({ ok: true })
    await ctl.tick() // 讀入 world() 寫的事件
    await ctl.switchTo(b.id, true)
    expect(injected[0].line).toBe(`claude '--resume' '${SID_A}'`)
  })

  it('turn 由 tick 增量更新：啟動後才出現的 prompt 事件會被採用', async () => {
    const { ctl, b } = setup()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stop' }])
    const c2 = make() // 啟動時讀到 stop
    controllers.splice(controllers.indexOf(ctl), 1)
    await ctl.dispose()
    storage.writeJsonAtomic(path.join(paths.eventsDir(), '999999-z.json'), {
      kind: 'prompt',
      session_id: SID_A,
      ts: 999,
      error: null
    })
    await c2.tick()
    await c2.switchTo(b.id, true)
    expect(injected[0].line.endsWith(`'繼續'`)).toBe(true)
  })

  for (const mode of ['false', 'throw']) {
    it(`inject 失敗（${mode}）：改用 launcher.launch，帶 resume、prompt、extraArgs，log 不含命令列`, async () => {
      const { ctl, b } = setup()
      injectResult = false
      injectThrows = mode === 'throw'
      world([{ pid: 10, sid: SID_A, cwd: 'C:\p1', turn: 'prompt', cmdline: 'claude.exe --model opus' }])
      await ctl.tick() // 讀入 world() 寫的事件
      await ctl.switchTo(b.id, true)
      expect(injected).toHaveLength(1)
      expect(launches).toHaveLength(1)
      expect(launches[0].cwd).toBe('C:\p1')
      expect(launches[0].cont).toBe(false)
      expect(launches[0].opts).toMatchObject({
        resume: SID_A,
        prompt: '繼續',
        extraArgs: ['--model', 'opus']
      })
      const logs = JSON.stringify(ctl.getState().events)
      expect(logs).not.toContain('SECRET-CMDLINE')
      expect(logs).not.toContain('--model')
      expect(logs).toContain('已在新視窗接續')
    })
  }

  it('shell 為 other：不 inject，直接 launch', async () => {
    const { ctl, b } = setup()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1', shell: 'bash.exe', turn: 'stop' }])
    await ctl.tick() // 讀入 world() 寫的事件
    await ctl.switchTo(b.id, true)
    expect(injected).toHaveLength(0)
    expect(launches).toHaveLength(1)
    expect(launches[0].opts.prompt).toBeUndefined()
  })

  it('不處理：無 session、非互動 claude', async () => {
    const { ctl, b } = setup()
    world([
      { pid: 10, sid: null, cwd: 'C:\\p1' },
      { pid: 20, sid: SID_B, cwd: 'C:\\p2', cmdline: 'claude.exe -p hello' }
    ])
    await ctl.tick() // 讀入 world() 寫的事件
    await ctl.switchTo(b.id, true)
    expect(killed).toEqual([])
    expect(injected).toHaveLength(0)
  })

  it('AC-6：manage_external=false 不處理外部，託管仍處理；switchTo 不重啟時完全不掃描', async () => {
    const { ctl, b } = setup()
    runs = [{ run_id: 'r1', cwd: 'C:\\h', claude_pid: 500, runner_pid: 900 }]
    procs.push({ pid: 900, ppid: 1, name: 'node.exe', cmdline: 'node runner.cjs', created: 1 })
    alive.add(900)
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stop' },
      { pid: 500, sid: SID_H, cwd: 'C:\\h', hostedBy: 900, turn: 'stop' }
    ])
    await ctl.setConfig({ manage_external: false })
    await ctl.tick() // 讀入 world() 寫的事件
    await ctl.switchTo(b.id, true)
    expect(killed).toEqual([])
    expect(injected).toHaveLength(0)
    expect(released).toHaveLength(1)

    const s2 = setup()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1' }])
    await s2.ctl.switchTo(s2.b.id, false)
    expect(order).not.toContain('scan')
    expect(killed).toEqual([])
  })

  it('逾時：託管 abort、不切換；已結束的外部仍接續', async () => {
    const { ctl, b } = setup()
    stubbornRun = true
    runs = [{ run_id: 'r1', cwd: 'C:\\h', claude_pid: 500, runner_pid: 900 }]
    procs.push({ pid: 900, ppid: 1, name: 'node.exe', cmdline: 'node runner.cjs', created: 1 })
    alive.add(900)
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stop' },
      { pid: 500, sid: SID_H, cwd: 'C:\\h', hostedBy: 900, turn: 'stop' }
    ])
    const r = await ctl.switchTo(b.id, true)
    expect(r).toMatchObject({ ok: false, code: 'BUSY' })
    expect(aborted).toEqual(['r1'])
    expect(released).toHaveLength(0)
    expect(injected).toHaveLength(1)
    expect(accounts.currentSlotId()).not.toBe(b.id)
  })

  it('requestRestart 丟例外：已要求的託管 abort，外部 CLI 不被結束，不切換', async () => {
    const { ctl, b } = setup()
    runs = [
      { run_id: 'r1', cwd: 'C:\\h1', claude_pid: 500, runner_pid: 900 },
      { run_id: 'r2', cwd: 'C:\\h2', claude_pid: 501, runner_pid: 901 }
    ]
    procs.push({ pid: 900, ppid: 1, name: 'node.exe', cmdline: 'node runner.cjs', created: 1 })
    procs.push({ pid: 901, ppid: 1, name: 'node.exe', cmdline: 'node runner.cjs', created: 1 })
    alive.add(900)
    alive.add(901)
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stop' },
      { pid: 500, sid: SID_H, cwd: 'C:\\h1', hostedBy: 900, turn: 'stop' },
      { pid: 501, sid: SID_B, cwd: 'C:\\h2', hostedBy: 901, turn: 'stop' }
    ])
    const spy = vi.spyOn(launcher, 'requestRestart')
    spy.mockImplementationOnce(async () => true)
    spy.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const r = await ctl.switchTo(b.id, true)
    spy.mockRestore()
    expect(r).toMatchObject({ ok: false })
    expect(aborted).toEqual(['r1', 'r2'])
    expect(killed).toEqual([])
    expect(released).toHaveLength(0)
    expect(accounts.currentSlotId()).not.toBe(b.id)
  })

  it('kill 回傳 false：記 warn「無法結束 claude」，不記成已結束', async () => {
    const { ctl, b } = setup()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stop' }])
    const ctl2 = make({
      cli: {
        listProcesses: async () => procs.filter((p) => alive.has(p.pid)),
        kill: async () => false,
        inject: async () => true,
        injectSubmit: async () => false
      }
    })
    controllers.splice(controllers.indexOf(ctl), 1)
    await ctl.dispose()
    const r = await ctl2.switchTo(b.id, true)
    expect(r).toMatchObject({ ok: false, code: 'BUSY' })
    const texts = ctl2.getState().events.map((e) => e.text)
    expect(texts).toContain('無法結束 claude：C:\\p1（PID 10）')
    expect(texts.some((t) => t.includes('已結束外部'))).toBe(false)
  })

  it('切換失敗：託管 abort，已結束的外部仍接續', async () => {
    const { ctl } = setup()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stop' }])
    const spy = vi.spyOn(accounts, 'switchTo').mockImplementation(() => {
      throw new accounts.AccountError('壞掉')
    })
    const r = await ctl.switchTo(accounts.listSlots()[1].id, true)
    spy.mockRestore()
    expect(r).toMatchObject({ ok: false })
    expect(injected).toHaveLength(1)
  })

  it('單一 CLI 失敗不影響其他', async () => {
    const { ctl, b } = setup()
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', shell: 'bash.exe' },
      { pid: 20, sid: SID_B, cwd: 'C:\\p2', shell: 'bash.exe' }
    ])
    ;(launcher.launch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    await ctl.tick() // 讀入 world() 寫的事件
    await ctl.switchTo(b.id, true)
    expect(killed.sort()).toEqual([10, 20])
    expect(launches).toHaveLength(1) // 第二個成功（第一個丟例外前未記錄）
  })

  it('setConfig：新欄位驗證', async () => {
    const { ctl } = setup()
    expect(await ctl.setConfig({ continue_prompt: 'a&b' })).toMatchObject({ ok: false, code: 'INVALID' })
    expect(await ctl.setConfig({ continue_prompt: 'x'.repeat(201) })).toMatchObject({ code: 'INVALID' })
    expect(await ctl.setConfig({ continue_prompt: ' 好的 ', manage_external: false })).toEqual({ ok: true })
    const cfg = ctl.getState().config
    expect(cfg.continue_prompt).toBe('好的')
    expect(cfg.manage_external).toBe(false)
  })
})
