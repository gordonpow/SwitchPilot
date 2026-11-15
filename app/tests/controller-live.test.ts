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
const SID_B = '22222222-2222-3333-4444-555555555555'
const SID_C = '33333333-2222-3333-4444-555555555555'
const SID_H = '44444444-2222-3333-4444-555555555555'

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

describe('Controller live 模式', () => {
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

  const threeClis: Cli[] = [
    { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stopfailure' },
    { pid: 20, sid: SID_B, cwd: 'C:\\p2', turn: 'prompt' },
    { pid: 30, sid: SID_C, cwd: 'C:\\p3', turn: 'stop' }
  ]

  it('預設為 live；CLI 清單 method 為 live（非互動為 none）', async () => {
    reset()
    slots()
    world([
      ...threeClis,
      { pid: 40, sid: SID_H, cwd: 'C:\\p4', turn: 'stop', cmdline: 'claude.exe -p hi' }
    ])
    const ctl = make()
    expect(ctl.getState().config.switch_mode).toBe('live')
    await (ctl as unknown as { scanNow(): Promise<unknown> }).scanNow()
    const by = (pid: number) => ctl.getState().clis.find((c) => c.pid === pid)!
    expect(by(10).method).toBe('live')
    expect(by(20).method).toBe('live')
    expect(by(40).method).toBe('none')
  })

  it('切換：不 kill、不 requestRestart、不 activeRuns；只有 interrupted 收到提示（目標為 claude PID）', async () => {
    reset()
    const { b } = slots()
    world(threeClis)
    const ctl = make()
    expect(await ctl.switchTo(b.id, true)).toEqual({ ok: true })
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(killed).toEqual([])
    expect(calls).not.toContain('requestRestart')
    expect(calls).not.toContain('release')
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
    const texts = ctl.getState().events.map((e) => e.text)
    expect(texts.some((t) => t.includes('C:\\p1') && t.includes('送出繼續提示'))).toBe(true)
  })

  it('continue_prompt 為空：不送', async () => {
    reset()
    const { b } = slots()
    world(threeClis)
    const ctl = make({ continue_prompt: '' })
    expect(await ctl.switchTo(b.id, false)).toEqual({ ok: true })
    expect(submits).toEqual([])
  })

  it('送出丟例外：只 warn、不含錯誤內容，且不影響其他 session', async () => {
    reset()
    const { b } = slots()
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stopfailure' },
      { pid: 20, sid: SID_B, cwd: 'C:\\p2', turn: 'stopfailure' }
    ])
    const ctl = make()
    submitThrows = true
    expect(await ctl.switchTo(b.id, false)).toEqual({ ok: true })
    expect(submits).toHaveLength(2)
    const warns = ctl.getState().events.filter((e) => e.level === 'warn')
    expect(warns).toHaveLength(2)
    expect(warns[0].text).toContain('無法送出繼續提示')
    expect(JSON.stringify(warns)).not.toContain('SECRET')
  })

  it('manage_external=false：只對託管者送', async () => {
    reset()
    const { b } = slots()
    runs = [{ run_id: 'r1', cwd: 'C:\\h', claude_pid: 500, runner_pid: 900 }]
    procs.push({ pid: 900, ppid: 1, name: 'node.exe', cmdline: 'node runner.cjs', created: 1 })
    alive.add(900)
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stopfailure' },
      { pid: 500, sid: SID_H, cwd: 'C:\\h', hostedBy: 900, turn: 'stopfailure' }
    ])
    const ctl = make({ manage_external: false })
    expect(await ctl.switchTo(b.id, true)).toEqual({ ok: true })
    expect(submits).toEqual([{ pid: 500, text: '繼續' }])
  })

  it('AC-13：30 秒內的 stopfailure 不再切換、改送提示且只送一次；30 秒後照常切換', async () => {
    reset()
    const { a, b } = slots()
    world(threeClis)
    const ctl = make()
    await ctl.tick() // 讀入 world() 的事件
    expect(await ctl.switchTo(b.id, false)).toEqual({ ok: true })
    submits = []

    clock += 5000
    writeFailure(b.id, SID_B, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(submits).toEqual([{ pid: 20, text: '繼續' }])

    clock += 3000
    writeFailure(b.id, SID_B, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(submits).toHaveLength(1)

    clock += 30_000
    writeFailure(b.id, SID_B, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(killed).toEqual([])
    expect(calls).not.toContain('requestRestart')
  })

  it('用量達門檻：立即切換（不 pending）', async () => {
    reset()
    const { a, b } = slots()
    world(threeClis)
    const ctl = make()
    const t = nowS()
    storage.writeJsonAtomic(path.join(paths.usageDir(), 's.json'), {
      slot_id: a.id,
      ts: t,
      five_hour: { used_percentage: 97, resets_at: t + 3600 },
      seven_day: null
    })
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(ctl.getState().pending).toBe(false)
    expect(killed).toEqual([])
  })

  it('2b：statusline 是舊帳號的資料（resets_at 與 usage_api 差 >1h）不觸發切換、不標記用完', async () => {
    reset()
    const { a, b } = slots()
    world(threeClis)
    const ctl = make()
    const t = nowS()
    storage.writeJsonAtomic(path.join(paths.usageApiDir(), `${a.id}.json`), {
      slot_id: a.id,
      ts: t,
      five_hour: { used_percentage: 10, resets_at: t + 3000 },
      seven_day: { used_percentage: 20, resets_at: t + 200_000 },
      error: null,
      needs_relogin: false,
      saved_at: a.saved_at
    })
    storage.writeJsonAtomic(path.join(paths.usageDir(), 's.json'), {
      slot_id: a.id,
      ts: t + 1,
      five_hour: { used_percentage: 100, resets_at: t + 4000 },
      seven_day: { used_percentage: 100, resets_at: t + 100_000 }
    })
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(accounts.getSlot(a.id)!.exhausted_until).toBe(0)
    expect(accounts.getSlot(b.id)!.exhausted_until).toBe(0)
  })

  it('2b：clearExhausted 清除所有 slot 的用完標記', async () => {
    reset()
    const { a, b } = slots()
    const ctl = make()
    accounts.markExhausted(a.id, nowS() + 5000)
    accounts.markExhausted(b.id, nowS() + 6000)
    expect(await ctl.clearExhausted()).toEqual({ ok: true })
    expect(accounts.getSlot(a.id)!.exhausted_until).toBe(0)
    expect(accounts.getSlot(b.id)!.exhausted_until).toBe(0)
  })

  describe('切換安全性（needs_relogin／ensureFresh／通知）', () => {
    function threeSlots(): { a: accounts.Slot; b: accounts.Slot; c: accounts.Slot } {
      const { a, b } = slots()
      const c = accounts.addSlot('C', creds('tok-C'), acct('uuid-C', 'C@x'))
      return { a, b, c }
    }
    function markRelogin(s: accounts.Slot): void {
      storage.writeJsonAtomic(path.join(paths.usageApiDir(), `${s.id}.json`), {
        slot_id: s.id,
        ts: nowS(),
        five_hour: null,
        seven_day: null,
        error: 'token 已過期，需要重新登入',
        needs_relogin: true,
        saved_at: s.saved_at
      })
    }
    function exhaust(a: accounts.Slot): void {
      const t = nowS()
      storage.writeJsonAtomic(path.join(paths.usageDir(), 's.json'), {
        slot_id: a.id,
        ts: t,
        five_hour: { used_percentage: 97, resets_at: t + 3600 },
        seven_day: null
      })
    }
    function fakePoller(
      ensure: (id: string) => 'ok' | 'dead' | 'error'
    ): { poller: NonNullable<ControllerDeps['poller']>; asked: string[] } {
      const asked: string[] = []
      return {
        asked,
        poller: {
          pollAll: async () => true,
          running: false,
          ensureFresh: async (id: string) => {
            asked.push(id)
            return ensure(id)
          }
        }
      }
    }

    it('AC-1：自動切換跳過 needs_relogin 帳號', async () => {
      reset()
      const { a, b, c } = threeSlots()
      world(threeClis)
      markRelogin(b)
      const ctl = make()
      exhaust(a)
      await ctl.tick()
      expect(accounts.currentSlotId()).toBe(c.id)
    })

    it('AC-1：saved_at 不同（已重新登入）的 needs_relogin 不算', async () => {
      reset()
      const { a, b } = threeSlots()
      world(threeClis)
      markRelogin({ ...b, saved_at: b.saved_at - 5 })
      const ctl = make()
      exhaust(a)
      await ctl.tick()
      expect(accounts.currentSlotId()).toBe(b.id)
    })

    it('AC-3：ensureFresh 回 dead 時改挑下一個，並通知（AC-4）', async () => {
      reset()
      const { a, b, c } = threeSlots()
      world(threeClis)
      const { poller, asked } = fakePoller((id) => (id === b.id ? 'dead' : 'ok'))
      const notify = vi.fn()
      const ctl = make({}, { poller, notify })
      exhaust(a)
      await ctl.tick()
      expect(asked).toEqual([b.id, c.id])
      expect(accounts.currentSlotId()).toBe(c.id)
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0][0]).toBe('已自動切換帳號')
      expect(String(notify.mock.calls[0][1])).toContain('「C」')
    })

    it('AC-3：全部 dead 時不切換', async () => {
      reset()
      const { a } = threeSlots()
      world(threeClis)
      const { poller } = fakePoller(() => 'dead')
      const notify = vi.fn()
      const ctl = make({}, { poller, notify })
      exhaust(a)
      await ctl.tick()
      expect(accounts.currentSlotId()).toBe(a.id)
      expect(notify.mock.calls.every((x) => x[0] === '所有帳號都已用完')).toBe(true)
    })

    it('AC-3：ensureFresh 回 error（暫時性）不阻擋切換', async () => {
      reset()
      const { a, b } = threeSlots()
      world(threeClis)
      const { poller } = fakePoller(() => 'error')
      const ctl = make({}, { poller })
      exhaust(a)
      await ctl.tick()
      expect(accounts.currentSlotId()).toBe(b.id)
    })

    it('AC-2：手動切到 needs_relogin 帳號失敗，憑證檔未變、不通知', async () => {
      reset()
      const { b } = threeSlots()
      world([])
      markRelogin(b)
      const notify = vi.fn()
      const ctl = make({}, { notify })
      const before = fs.readFileSync(paths.credFile(), 'utf8')
      const r = await ctl.switchTo(b.id, false)
      expect(r).toMatchObject({ ok: false, error: '此帳號需要重新登入' })
      expect(fs.readFileSync(paths.credFile(), 'utf8')).toBe(before)
      expect(notify).not.toHaveBeenCalled()
    })

    it('AC-3：手動切換時 ensureFresh 回 dead 失敗；ok 則成功且不通知', async () => {
      reset()
      const { b } = threeSlots()
      world([])
      let verdict: 'ok' | 'dead' = 'dead'
      const { poller } = fakePoller(() => verdict)
      const notify = vi.fn()
      const ctl = make({}, { poller, notify })
      const before = fs.readFileSync(paths.credFile(), 'utf8')
      expect(await ctl.switchTo(b.id, false)).toMatchObject({ ok: false })
      expect(fs.readFileSync(paths.credFile(), 'utf8')).toBe(before)
      verdict = 'ok'
      expect(await ctl.switchTo(b.id, false)).toEqual({ ok: true })
      expect(notify).not.toHaveBeenCalled()
    })
  })

  it('提示條件：stopfailure 超過 15 分鐘或 error 非 rate_limit 不送；willPrompt 與實際一致', async () => {
    reset()
    const { b } = slots()
    world([
      { pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stopfailure', error: 'rate_limit' },
      { pid: 20, sid: SID_B, cwd: 'C:\\p2', turn: 'stopfailure', ts: nowS() - 1000 },
      { pid: 30, sid: SID_C, cwd: 'C:\\p3', turn: 'stopfailure', error: 'server_error' }
    ])
    const ctl = make()
    await (ctl as unknown as { scanNow(): Promise<unknown> }).scanNow()
    const by = (pid: number) => ctl.getState().clis.find((c) => c.pid === pid)!
    expect([by(10).willPrompt, by(20).willPrompt, by(30).willPrompt]).toEqual([true, false, false])
    expect(await ctl.switchTo(b.id, false)).toEqual({ ok: true })
    expect(submits).toEqual([{ pid: 10, text: '繼續' }])
  })

  it('willPrompt：setConfig 改相關欄位時用上次掃描結果重算（不重掃）', async () => {
    reset()
    slots()
    world([{ pid: 10, sid: SID_A, cwd: 'C:\\p1', turn: 'stopfailure' }])
    let scans = 0
    const ctl = make(
      {},
      {
        cli: {
          listProcesses: async () => {
            scans++
            return procs.filter((p) => alive.has(p.pid))
          },
          kill: async () => true,
          inject: async () => true,
          injectSubmit: async () => true
        }
      }
    )
    await (ctl as unknown as { scanNow(): Promise<unknown> }).scanNow()
    const will = (): boolean => ctl.getState().clis[0].willPrompt
    expect(will()).toBe(true)
    await ctl.setConfig({ continue_prompt: '' })
    expect(will()).toBe(false)
    await ctl.setConfig({ continue_prompt: '繼續' })
    expect(will()).toBe(true)
    await ctl.setConfig({ manage_external: false })
    expect(will()).toBe(false)
    await ctl.setConfig({ manage_external: true, switch_mode: 'restart' })
    expect(will()).toBe(false)
    expect(scans).toBe(2) // 初次掃描 + 切換模式觸發的一次；其餘設定變更沒有重掃
  })

  it('沒有可切換目標：60 秒內不再嘗試，warn 只記一次；之後有目標就切換', async () => {
    reset()
    const { a, b } = slots()
    world(threeClis)
    const notify = vi.fn()
    const ctl = make({ switch_to_earliest: false }, { notify })
    await ctl.tick()
    accounts.markExhausted(b.id, nowS() + 7200)
    const warnCount = (): number =>
      ctl.getState().events.filter((e) => e.text.includes('所有帳號都已用完')).length
    clock += 1000
    writeFailure(a.id, SID_A, nowS())
    await ctl.tick()
    expect(warnCount()).toBe(1)
    expect(notify).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 3; i++) {
      clock += 3000
      writeFailure(a.id, SID_A, nowS())
      await ctl.tick()
    }
    expect(warnCount()).toBe(1)
    expect(accounts.currentSlotId()).toBe(a.id)

    clock += 60_000
    accounts.markExhausted(b.id, 0)
    writeFailure(a.id, SID_A, nowS())
    await ctl.tick()
    expect(accounts.currentSlotId()).toBe(b.id)
  })

  it('憑證檔是別的帳號的憑證：不寫回 slot，warn 只記一次且不含 token', async () => {
    reset()
    const { a } = slots()
    const ctl = make()
    storage.writeJsonAtomic(paths.credFile(), creds('tok-B'))
    await ctl.tick()
    await ctl.tick()
    expect(accounts.getSlot(a.id)!.credentials).toEqual(creds('tok-A'))
    const warns = ctl.getState().events.filter((e) => e.text.includes('憑證檔與目前帳號不一致'))
    expect(warns).toHaveLength(1)
    expect(JSON.stringify(ctl.getState().events)).not.toContain('tok-')
  })

  it('setConfig：switch_mode 驗證並同步 monitor', async () => {
    reset()
    slots()
    const ctl = make()
    expect(ctl.monitor.waitTurnEnd).toBe(false)
    expect(await ctl.setConfig({ switch_mode: 'x' as never })).toMatchObject({
      ok: false,
      code: 'INVALID'
    })
    expect(await ctl.setConfig({ switch_mode: 'restart' })).toEqual({ ok: true })
    expect(ctl.monitor.waitTurnEnd).toBe(true)
    expect(ctl.getState().config.switch_mode).toBe('restart')
    const saved = storage.readJson(paths.configFile()) as { switch_mode: string }
    expect(saved.switch_mode).toBe('restart')
  })
})
