import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as accounts from '../src/core/accounts'
import type { RunState } from '../src/core/launcher'
import * as paths from '../src/core/paths'
import * as storage from '../src/core/storage'
import { registerRunning, unregisterRunning } from '../src/core/dispatchlog'
import {
  Controller,
  type ControllerDeps,
  type LauncherLike,
  type LoginSessionLike
} from '../src/main/controller'
import { setLanguage } from '../src/shared/i18n'
import type { AppState } from '../src/shared/types'
import { acct, creds, login, useTempEnv } from './helpers'

type FakeLauncher = {
  calls: string[]
  setAlive: (v: boolean) => void
  isAlive: () => boolean
  launcher: LauncherLike & { launch: ReturnType<typeof vi.fn> }
}
type FakeSession = LoginSessionLike & { cancelled: number; cleaned: number }

const nowSec = (): number => Date.now() / 1000

describe('Controller', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []

  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  function scriptsDir(): string {
    const d = path.join(root(), 'scripts-src')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'x.cjs'), '// fake')
    return d
  }

  function make(deps: ControllerDeps = {}): Controller {
    // 既有測試驗證 restart 流程；live 模式見 controller-live.test.ts
    storage.writeJsonAtomic(paths.configFile(), { switch_mode: 'restart' })
    const c = new Controller({
      scriptsDir: scriptsDir(),
      findNode: () => process.execPath,
      disablePoll: false,
      cli: {
        listProcesses: async () => [],
        kill: async () => true,
        inject: async () => false,
        injectSubmit: async () => false
      },
      waitIntervalMs: 10,
      waitMaxMs: 150,
      ...deps
    })
    controllers.push(c)
    return c
  }

  /** 新增 slot；第一個以 login() 設為使用中。 */
  function addSlots(names: string[], activeIdx = 0): accounts.Slot[] {
    const out = names.map((n) =>
      accounts.addSlot(n, creds('tok-' + n), acct('uuid-' + n, `${n}@x`))
    )
    login('tok-' + names[activeIdx], 'uuid-' + names[activeIdx], `${names[activeIdx]}@x`)
    return out
  }

  const writeStatusline = (slotId: string, ts: number, pct: number, resets = ts + 3600): void =>
    storage.writeJsonAtomic(path.join(paths.usageDir(), `s-${slotId}.json`), {
      slot_id: slotId,
      ts,
      five_hour: { used_percentage: pct, resets_at: resets },
      seven_day: null
    })
  const writeApi = (
    slot: accounts.Slot,
    ts: number,
    pct: number,
    extra: Record<string, unknown> = {}
  ): void =>
    storage.writeJsonAtomic(path.join(paths.usageApiDir(), `${slot.id}.json`), {
      slot_id: slot.id,
      ts,
      five_hour: { used_percentage: pct, resets_at: ts + 3600 },
      seven_day: null,
      error: null,
      needs_relogin: false,
      saved_at: slot.saved_at,
      ...extra
    })
  const writeEvent = (name: string, slotId: string, ts: number): void =>
    storage.writeJsonAtomic(path.join(paths.eventsDir(), name), {
      kind: 'stop',
      slot_id: slotId,
      ts,
      error: null
    })

  function fakeLauncher(runs: RunState[] = []): FakeLauncher {
    const calls: string[] = []
    let alive = true
    return {
      calls,
      setAlive: (v: boolean) => {
        alive = v
      },
      isAlive: () => alive,
      launcher: {
        launch: vi.fn(() => 'run1'),
        activeRuns: () => runs,
        requestRestart: async (r: RunState) => {
          calls.push('request:' + r.run_id)
          setTimeout(() => (alive = false), 30)
          return false
        },
        releaseRestart: (r: RunState) => void calls.push('release:' + r.run_id),
        abortRestart: (r: RunState) => void calls.push('abort:' + r.run_id)
      }
    }
  }
  const run1: RunState = { run_id: 'r1', cwd: 'C:\\proj', claude_pid: 4242, state: 'waiting' }

  it('buildState：active、用量來源與 stale、needsRelogin、runs', async () => {
    const [a, b, c, d] = addSlots(['A', 'B', 'C', 'D'])
    const t = nowSec()
    writeStatusline(a.id, t - 5, 30)
    writeApi(a, t - 60, 10, { error: 'token_expired_active' })
    writeApi(b, t - 20, 42)
    writeApi(c, t - 5000, 80, { error: 'token 已過期，需要重新登入', needs_relogin: true })
    writeApi(d, t - 20, 5, { needs_relogin: true, saved_at: d.saved_at - 100 })
    const fl = fakeLauncher([run1])
    const ctl = make({ launcher: fl.launcher })
    ctl.log('info', 'hello')

    const s = ctl.getState()
    expect(s.current).toEqual({ slotId: a.id, email: 'A@x', unsaved: false })
    expect(s.runs).toEqual([{ runId: 'r1', cwd: 'C:\\proj', state: 'waiting' }])
    const [va, vb, vc, vd] = ['A', 'B', 'C', 'D'].map((n) => s.accounts.find((x) => x.name === n)!)
    expect(va.active).toBe(true)
    expect(va.usage.source).toBe('statusline')
    expect(va.usage.five_hour?.used_percentage).toBe(30)
    expect(va.error).toBe('使用中帳號的 token 已過期，改用 statusline 資料')
    expect(va.usage.stale).toBe(false)
    expect(vb.active).toBe(false)
    expect(vb.usage.source).toBe('api')
    expect(vb.usage.updatedAt).toBeCloseTo(t - 20, 0)
    expect(vb.savedAt).toBe(b.saved_at)
    expect(vc.needsRelogin).toBe(true)
    expect(vc.usage.stale).toBe(true)
    expect(vc.error).toBe('token 已過期，需要重新登入')
    expect(vd.needsRelogin).toBe(false) // saved_at 不同
    expect(s.earliestReset).toBeNull()
    expect(s.events.map((e) => e.text)).toContain('hello')
    expect(s.config.threshold).toBe(95)
    expect(s.integration.nodeFound).toBe(true)
  })

  it('buildState：全部用完時有 earliestReset；未儲存的登入標示 unsaved', () => {
    const [a, b] = addSlots(['A', 'B'])
    const t = nowSec()
    accounts.markExhausted(a.id, t + 7200)
    accounts.markExhausted(b.id, t + 3600)
    const ctl = make()
    expect(ctl.getState().earliestReset).toBeCloseTo(t + 3600, 0)

    login('tok-new', 'uuid-new', 'new@x')
    expect(ctl.getState().current).toEqual({ slotId: null, email: 'new@x', unsaved: true })
  })

  it('自動切換全流程：request → 等待 → switchTo → release，並跳過 API 已達門檻的帳號', async () => {
    const [a, b, c] = addSlots(['A', 'B', 'C'])
    const t = nowSec()
    writeApi(b, t, 99) // B 在 API 已達門檻，應被跳過
    const fl = fakeLauncher([run1])
    const ctl = make({ launcher: fl.launcher, pidAlive: fl.isAlive })
    writeStatusline(a.id, t, 96, t + 1800)
    writeEvent('0001.json', a.id, t)

    await ctl.tick()

    expect(fl.calls).toEqual(['request:r1', 'release:r1'])
    expect(accounts.currentSlotId()).toBe(c.id)
    const cred = storage.readJson(paths.credFile()) as ReturnType<typeof creds>
    expect(cred.claudeAiOauth).toMatchObject({ accessToken: 'tok-C' })
    expect(accounts.getSlot(a.id)!.exhausted_until).toBeCloseTo(t + 1800, 0)
    const s = ctl.getState()
    expect(s.switching).toBe(false)
    expect(s.pending).toBe(false)
    expect(s.events.some((e) => e.text.includes('切換：A → C'))).toBe(true)
    expect(ctl.monitor.since).toBeGreaterThanOrEqual(t)
  })

  it('語言為 en 時，事件紀錄與錯誤為英文（結束還原 zh-TW）', async () => {
    login('tok-x', 'uuid-x', 'x@x')
    const ctl = make()
    setLanguage('en')
    try {
      const ok = await ctl.saveCurrent('Main')
      expect(ok.ok).toBe(true)
      expect(ctl.getState().events.some((e) => e.text === 'Saved account: Main (x@x)')).toBe(true)
      const bad = await ctl.saveCurrent('  ')
      expect(bad.ok).toBe(false)
      expect(bad.ok === false && bad.error).toBe('Name cannot be empty')
    } finally {
      setLanguage('zh-TW')
    }
  })

  it('等待 claude 逾時：abort，不切換、不 release', async () => {
    const [a] = addSlots(['A', 'B'])
    const t = nowSec()
    const fl = fakeLauncher([run1])
    fl.setAlive(true)
    const lau = {
      ...fl.launcher,
      requestRestart: async (r: RunState) => {
        fl.calls.push('request:' + r.run_id)
        return false // claude 一直不結束
      }
    }
    const ctl = make({ launcher: lau, pidAlive: () => true, waitMaxMs: 80 })
    writeStatusline(a.id, t, 97)
    writeEvent('0001.json', a.id, t)

    await ctl.tick()

    expect(fl.calls).toEqual(['request:r1', 'abort:r1'])
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(ctl.getState().switching).toBe(false)
    expect(ctl.getState().events.some((e) => e.level === 'error')).toBe(true)
  })

  it('全部用完：只通知一次，並記錄事件', async () => {
    const [a, b] = addSlots(['A', 'B'])
    const t = nowSec()
    accounts.markExhausted(b.id, t + 3600)
    const notify = vi.fn()
    const ctl = make({ notify, launcher: fakeLauncher().launcher })
    writeStatusline(a.id, t, 98, t + 600)
    writeEvent('0001.json', a.id, t)
    await ctl.tick()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toContain('最早重置時間')
    expect(accounts.currentSlotId()).toBe(a.id)

    // 再次觸發：不再通知
    writeStatusline(a.id, t + 10, 98, t + 600)
    writeEvent('0002.json', a.id, t + 10)
    await ctl.tick()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(ctl.getState().earliestReset).toBeCloseTo(t + 600, 0)
    expect(ctl.getState().events.some((e) => e.text.includes('所有帳號都已用完'))).toBe(true)
  })

  it('手動切換：不重啟時直接切換；切換到使用中帳號回 INVALID', async () => {
    const [a, b] = addSlots(['A', 'B'])
    const ctl = make({ launcher: fakeLauncher().launcher })
    const same = await ctl.switchTo(a.id, false)
    expect(same).toMatchObject({ ok: false, code: 'INVALID' })
    expect(await ctl.switchTo('nope', false)).toMatchObject({ ok: false, code: 'INVALID' })
    expect(await ctl.switchTo(b.id, false)).toEqual({ ok: true })
    expect(accounts.currentSlotId()).toBe(b.id)
    expect(await ctl.deleteSlot(b.id)).toMatchObject({ ok: false, code: 'IN_USE' })
  })

  it('refreshUsage：執行中回 BUSY；跑完回 ok 並更新 lastPollAt', async () => {
    addSlots(['A'])
    const busy = make({ poller: { running: true, pollAll: async () => false } })
    expect(await busy.refreshUsage()).toMatchObject({ ok: false, code: 'BUSY' })

    const good = make({ poller: { running: false, pollAll: async () => true } })
    expect(await good.refreshUsage()).toEqual({ ok: true })
    expect(good.getState().lastPollAt).not.toBeNull()

    const skipped = make({ poller: { running: false, pollAll: async () => false } })
    expect(await skipped.refreshUsage()).toMatchObject({ ok: false, code: 'BUSY' })
  })

  function fakeSession(
    poll: 'running' | 'done' | 'failed',
    account = acct('uuid-n', 'n@x')
  ): FakeSession {
    const s = {
      startedAt: nowSec(),
      cancelled: 0,
      cleaned: 0,
      start: vi.fn(),
      poll: () => poll,
      loginUrl: () => 'https://example.test/login',
      lastLines: () => ['boom'],
      result: () => ({ creds: creds('tok-n'), account }),
      cancel: async () => {
        s.cancelled++
      },
      cleanup: () => {
        s.cleaned++
      }
    }
    return s
  }

  it('cancelLogin 在 running 與 failed 都把 login 重設為 idle', async () => {
    const sess = fakeSession('running')
    const ctl = make({ createLogin: () => sess })
    expect(await ctl.startLogin('edge')).toEqual({ ok: true })
    expect(ctl.getState().login.state).toBe('running')
    await ctl.loginTick()
    expect(ctl.getState().login.url).toBe('https://example.test/login')
    expect(await ctl.startLogin()).toMatchObject({ ok: false, code: 'BUSY' })
    await ctl.cancelLogin()
    expect(sess.cancelled).toBe(1)
    expect(ctl.getState().login.state).toBe('idle')

    const bad = fakeSession('failed')
    const ctl2 = make({ createLogin: () => bad })
    await ctl2.startLogin()
    await ctl2.loginTick()
    expect(ctl2.getState().login.state).toBe('failed')
    expect(ctl2.getState().login.message).toContain('boom')
    await ctl2.cancelLogin()
    expect(ctl2.getState().login.state).toBe('idle')
  })

  it('登入完成：awaiting_name → completeLogin 新增帳號；重新登入保留 id 與 exhausted_until', async () => {
    const sess = fakeSession('done')
    const copied: string[] = []
    const ctl = make({ createLogin: () => sess, copyText: (t) => copied.push(t) })
    await ctl.startLogin()
    await ctl.loginTick()
    let l = ctl.getState().login
    expect(l.state).toBe('awaiting_name')
    expect(l.defaultName).toBe('n@x')
    expect(sess.cleaned).toBe(1)
    expect(await ctl.completeLogin('')).toEqual({ ok: true })
    expect(ctl.getState().login.state).toBe('idle')
    const slots = accounts.listSlots()
    expect(slots).toHaveLength(1)
    expect(slots[0].name).toBe('n@x')

    // 重新登入同一帳號
    accounts.markExhausted(slots[0].id, nowSec() + 999)
    const again = fakeSession('done')
    const ctl2 = make({ createLogin: () => again })
    await ctl2.startLogin('chrome', slots[0].id)
    await ctl2.loginTick()
    l = ctl2.getState().login
    expect(l.defaultName).toBe('n@x')
    expect(await ctl2.completeLogin('改名')).toEqual({ ok: true })
    const after = accounts.listSlots()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(slots[0].id)
    expect(after[0].name).toBe('改名')
    expect(after[0].exhausted_until).toBeGreaterThan(nowSec())
    expect(await ctl2.completeLogin('x')).toMatchObject({ ok: false, code: 'INVALID' })

    // 複製網址
    const run = fakeSession('running')
    const ctl3 = make({ createLogin: () => run, copyText: (t) => copied.push(t) })
    expect(await ctl3.copyLoginUrl()).toMatchObject({ ok: false, code: 'INVALID' })
    await ctl3.startLogin()
    await ctl3.loginTick()
    expect(await ctl3.copyLoginUrl()).toEqual({ ok: true })
    expect(copied).toEqual(['https://example.test/login'])
  })

  it('找不到 node：installIntegration、startLogin、launch 回 NODE_MISSING，且不寫 settings.json', async () => {
    const ctl = make({ findNode: () => null })
    expect(await ctl.installIntegration()).toMatchObject({ ok: false, code: 'NODE_MISSING' })
    expect(await ctl.startLogin()).toMatchObject({ ok: false, code: 'NODE_MISSING' })
    expect(await ctl.launch('C:\\x', false)).toMatchObject({ ok: false, code: 'NODE_MISSING' })
    expect(fs.existsSync(paths.settingsFile())).toBe(false)
    expect(ctl.getState().integration.nodeFound).toBe(false)
  })

  it('安裝整合、啟動、設定：成功路徑與驗證', async () => {
    const fl = fakeLauncher()
    const ctl = make({ launcher: fl.launcher })
    expect(await ctl.installIntegration()).toEqual({ ok: true })
    expect(ctl.getState().integration.installed).toBe(true)
    expect(await ctl.uninstallIntegration()).toEqual({ ok: true })
    expect(ctl.getState().integration.installed).toBe(false)
    expect(await ctl.launch('  ', false)).toMatchObject({ code: 'INVALID' })
    expect(await ctl.launch('C:\\proj', true)).toEqual({ ok: true })
    expect(fl.launcher.launch).toHaveBeenCalledTimes(1)
    expect(ctl.getState().config.last_folder).toBe('C:\\proj')
    expect(await ctl.setConfig({ threshold: 20, usage_poll_seconds: 5 })).toEqual({ ok: true })
    const cfg = ctl.getState().config
    expect(cfg.threshold).toBe(50)
    expect(cfg.usage_poll_seconds).toBe(30)
    expect(ctl.monitor.threshold).toBe(50)
    expect(await ctl.setConfig({ login_browser: 'x' as never })).toMatchObject({ code: 'INVALID' })
  })

  it('狀態推送節流，且事件不超過 200 筆', async () => {
    addSlots(['A'])
    const pushed: AppState[] = []
    const ctl = make({ push: (s) => pushed.push(s) })
    for (let i = 0; i < 250; i++) ctl.log('info', 'e' + i)
    expect(pushed).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 350))
    expect(pushed).toHaveLength(1)
    expect(pushed[0].events).toHaveLength(200)
    expect(pushed[0].events[199].text).toBe('e249')
  })

  it('state 含 dispatch 資料', () => {
    const c = make()
    registerRunning({
      id: 'run-test-1',
      pid: process.pid,
      role: 'implement',
      provider: 'agy',
      model: 'gemini-3.8-flash-high',
      slot_id: 'slot-1',
      account: 'test@example.com',
      cwd: 'C:\\test',
      out: 'out.json',
      started_at: 1000
    })
    storage.writeJsonAtomic(path.join(paths.dispatchDir(), '20261115-0001.json'), {
      status: 'ok',
      provider: 'agy',
      model: 'gemini-3.8-flash-high',
      agy_account_email: 'test@example.com',
      attempts: [],
      message: '成功',
      role: 'implement',
      cwd: 'C:\\test',
      started_at: 1000,
      ended_at: 2000
    })

    const state = c.getState()
    expect(state.dispatch).toBeDefined()
    expect(state.dispatch.maxConcurrent).toBe(2)
    expect(state.dispatch.running).toHaveLength(1)
    expect(state.dispatch.running[0]).toEqual({
      id: 'run-test-1',
      role: 'implement',
      model: 'gemini-3.8-flash-high',
      account: 'test@example.com',
      cwd: 'C:\\test',
      startedAt: 1000
    })
    expect(state.dispatch.recent).toHaveLength(1)
    expect(state.dispatch.recent[0]).toMatchObject({
      id: '20261115-0001',
      role: 'implement',
      status: 'ok',
      provider: 'agy',
      model: 'gemini-3.8-flash-high',
      account: 'test@example.com',
      startedAt: 1000,
      endedAt: 2000,
      message: '成功'
    })
    unregisterRunning('run-test-1')
  })
})

describe('Controller fetchImpl', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  it('注入的 fetchImpl 會交給 poller（假 fetch，不打真實 API）', async () => {
    void root
    accounts.addSlot('A', creds('tok-A'), acct('uuid-A', 'A@x'))
    login('tok-A', 'uuid-A', 'A@x')
    const urls: string[] = []
    const fetchImpl = (async (input: unknown) => {
      urls.push(String(input))
      return new Response(
        JSON.stringify({ five_hour: { utilization: 10, resets_at: null }, seven_day: null }),
        { status: 200 }
      )
    }) as unknown as typeof fetch
    const c = new Controller({
      findNode: () => process.execPath,
      disablePoll: false,
      fetchImpl,
      cli: {
        listProcesses: async () => [],
        kill: async () => true,
        inject: async () => false,
        injectSubmit: async () => false
      }
    })
    controllers.push(c)
    await c.refreshUsage()
    expect(urls.length).toBeGreaterThan(0)
    expect(urls[0]).toContain('api.anthropic.com')
  })
})
