// controller 自動整理上下文（AC-12～AC-15、R-3）：假 CliOps、假 sessions 檔，不碰真實家目錄。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunState } from '../src/core/launcher'
import * as paths from '../src/core/paths'
import type { ClaudeSessionRec, ProcInfo } from '../src/core/sessions'
import * as storage from '../src/core/storage'
import { Controller, type ControllerDeps, type LauncherLike } from '../src/main/controller'
import type { AutoCompactConfig } from '../src/shared/types'
import { useTempEnv } from './helpers'

const SID_A = '11111111-2222-3333-4444-555555555555'
const SID_B = '22222222-2222-3333-4444-555555555555'

interface Sess {
  pid: number
  sid: string
  cwd?: string
  status?: string
  /** 事件：[kind, 距今秒數]，由舊到新 */
  events: [string, number][]
  /** statusline 紀錄：距今秒數與 context；null 表示不寫 */
  usage?: { ago: number; context: Record<string, unknown> | null } | null
}

describe('Controller 自動整理上下文', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  let clock = 0
  let procs: ProcInfo[] = []
  let alive = new Set<number>()
  let recs: ClaudeSessionRec[] = []
  let submits: { pid: number; text: string }[] = []
  let ctrlKeys: { pid: number; letter: string }[] = []
  let submitOk = true
  let submitThrows = false
  let submitDelay = 0
  let seq = 0
  const nowS = (): number => clock / 1000

  function reset(): void {
    clock = Date.now()
    procs = []
    alive = new Set()
    recs = []
    submits = []
    ctrlKeys = []
    submitOk = true
    submitThrows = false
    submitDelay = 0
    seq = 0
  }

  function writeEvent(sid: string, kind: string, ago: number): void {
    storage.writeJsonAtomic(
      path.join(paths.eventsDir(), `${String(++seq).padStart(6, '0')}-e.json`),
      { kind, session_id: sid, ts: nowS() - ago, error: null }
    )
  }

  function writeUsage(sid: string, ago: number, context: Record<string, unknown> | null): void {
    storage.writeJsonAtomic(path.join(paths.usageDir(), `${sid}.json`), {
      session_id: sid,
      cwd: '',
      slot_id: null,
      ts: nowS() - ago,
      five_hour: null,
      seven_day: null,
      context
    })
  }

  const ctx = (pct: number, tokens = 100_000): Record<string, unknown> => ({
    used_percentage: pct,
    total_input_tokens: tokens,
    context_window_size: 200_000
  })

  /** 預設：prompt 100 秒前、stop 50 秒前、上下文 70%、sessions 檔 idle。 */
  function world(list: Sess[]): void {
    for (const s of list) {
      const created = s.pid * 10
      procs.push({ pid: s.pid, ppid: 1, name: 'claude.exe', cmdline: 'claude.exe', created })
      alive.add(s.pid)
      recs.push({
        pid: s.pid,
        sessionId: s.sid,
        cwd: s.cwd ?? 'C:\\Proj\\App',
        procStartMs: created,
        kind: 'interactive',
        entrypoint: '',
        status: s.status ?? 'idle',
        statusUpdatedAt: 0
      })
      for (const [k, ago] of s.events) writeEvent(s.sid, k, ago)
      if (s.usage !== null) {
        const u = s.usage ?? { ago: 40, context: ctx(70) }
        writeUsage(s.sid, u.ago, u.context)
      }
    }
  }
  const base = (over: Partial<Sess> = {}): Sess => ({
    pid: 10,
    sid: SID_A,
    events: [
      ['prompt', 100],
      ['stop', 50]
    ],
    ...over
  })

  const launcher: LauncherLike = {
    launch: (() => 'x') as unknown as LauncherLike['launch'],
    activeRuns: (): RunState[] => [],
    requestRestart: async () => true,
    releaseRestart: () => undefined,
    abortRestart: () => undefined
  }

  function make(
    ac: Partial<AutoCompactConfig> = {},
    cfg: Record<string, unknown> = {},
    deps: ControllerDeps = {}
  ): Controller {
    const scripts = path.join(root(), 'scripts-src')
    fs.mkdirSync(scripts, { recursive: true })
    fs.writeFileSync(path.join(scripts, 'x.cjs'), '// fake')
    storage.writeJsonAtomic(paths.configFile(), {
      switch_mode: 'live',
      auto_compact: { enabled: true, ...ac },
      ...cfg
    })
    const c = new Controller({
      scriptsDir: scripts,
      findNode: () => process.execPath,
      disablePoll: false,
      now: () => clock,
      launcher,
      pidAlive: (pid) => alive.has(pid),
      readClaudeSessions: () => recs.map((r) => ({ ...r })),
      cli: {
        listProcesses: async () => procs.filter((p) => alive.has(p.pid)),
        kill: async () => true,
        inject: async () => true,
        injectSubmit: async (pid, text) => {
          if (submitDelay) await new Promise((r) => setTimeout(r, submitDelay))
          submits.push({ pid, text })
          if (submitThrows) throw new Error('SECRET-CMDLINE ' + text)
          return submitOk
        },
        injectCtrlKey: async (pid, letter) => {
          ctrlKeys.push({ pid, letter })
          return true
        }
      },
      ...deps
    })
    controllers.push(c)
    return c
  }

  type Priv = { scanNow(): Promise<unknown>; liveContinue: unknown; maybeCompact(n: number): Promise<void> }
  async function run(ctl: Controller): Promise<void> {
    await (ctl as unknown as Priv).scanNow()
    await ctl.tick()
  }
  const compactFile = (sid: string): string => path.join(paths.compactDir(), `${sid}.json`)

  it('條件全成立：送一次 /compact、寫 compact 檔、log 含資料夾／PID／百分比；之後不重送', async () => {
    reset()
    world([base()])
    const ctl = make()
    await run(ctl)
    expect(submits).toEqual([{ pid: 10, text: '/compact' }])
    const rec = storage.readJson(compactFile(SID_A)) as { last_compact_ts: number }
    expect(rec.last_compact_ts).toBeCloseTo(nowS(), 3)
    const info = ctl.getState().events.find((e) => e.text.includes('/compact'))!
    expect(info.text).toBe('已在 C:\\Proj\\App（PID 10） 執行 /compact（上下文 70%）')
    clock += 60_000
    await ctl.tick()
    await ctl.tick()
    expect(submits).toHaveLength(1)
  })

  it('重啟後保留 lastCompactTs（讀檔）', async () => {
    reset()
    world([base()])
    const c1 = make()
    await run(c1)
    expect(submits).toHaveLength(1)
    const c2 = make()
    clock += 5000
    await run(c2)
    expect(submits).toHaveLength(1)
  })

  it('條件 1：未啟用不送', async () => {
    reset()
    world([base()])
    await run(make({ enabled: false }))
    expect(submits).toEqual([])
  })

  it('條件 2：最新事件是 stopfailure、或之後有新 prompt 不送', async () => {
    reset()
    world([base({ events: [['prompt', 100], ['stopfailure', 50]] })])
    await run(make())
    expect(submits).toEqual([])
    submits = []
    reset()
    world([base({ events: [['prompt', 100], ['stop', 50], ['prompt', 30]] })])
    await run(make())
    expect(submits).toEqual([])
  })

  it('條件 2：sessions 檔 status 不是 idle 不送；判斷當下重讀（掃描後才變 busy 也不送）', async () => {
    reset()
    world([base({ status: 'busy' })])
    await run(make())
    expect(submits).toEqual([])

    reset()
    world([base()])
    const ctl = make()
    await (ctl as unknown as Priv).scanNow()
    recs[0].status = 'busy' // 掃描之後才變
    await ctl.tick()
    expect(submits).toEqual([])
    recs[0].status = 'idle'
    await ctl.tick()
    expect(submits).toHaveLength(1)
  })

  it('條件 3：沒有新 prompt 不送；整理後 30 秒內的 prompt 不算新 prompt', async () => {
    reset()
    world([base({ events: [['stop', 50]] })])
    await run(make())
    expect(submits).toEqual([])

    reset()
    // 上次整理在 100 秒前；prompt 在 80 秒前（整理後 20 秒內）→ 不算
    storage.writeJsonAtomic(compactFile(SID_A), { last_compact_ts: nowS() - 100 })
    world([base({ events: [['prompt', 80], ['stop', 50]] })])
    await run(make())
    expect(submits).toEqual([])

    reset()
    storage.writeJsonAtomic(compactFile(SID_A), { last_compact_ts: nowS() - 100 })
    world([base({ events: [['prompt', 60], ['stop', 50]] })]) // 整理後 40 秒
    await run(make())
    expect(submits).toHaveLength(1)
  })

  it('條件 4：低於門檻、沒有 context、沒有 usage 不送；tokens 型比 total_input_tokens', async () => {
    for (const usage of [
      { ago: 40, context: ctx(59.9) },
      { ago: 40, context: null },
      null
    ]) {
      reset()
      world([base({ usage })])
      await run(make())
      expect(submits).toEqual([])
    }
    reset()
    world([base({ usage: { ago: 40, context: ctx(10, 150_000) } })])
    await run(make({ threshold_type: 'tokens', threshold: 200_000 }))
    expect(submits).toEqual([])

    reset()
    world([base({ usage: { ago: 40, context: ctx(10, 250_000) } })])
    await run(make({ threshold_type: 'tokens', threshold: 200_000 }))
    expect(submits).toEqual([{ pid: 10, text: '/compact' }])
  })

  it('條件 4：只採用整理後的新 usage 紀錄；沒有就不送，出現後才送', async () => {
    reset()
    storage.writeJsonAtomic(compactFile(SID_A), { last_compact_ts: nowS() - 90 })
    world([base({ events: [['prompt', 50], ['stop', 45]], usage: { ago: 95, context: ctx(90) } })])
    const ctl = make()
    await run(ctl)
    expect(submits).toEqual([])
    writeUsage(SID_A, 30, ctx(65))
    await ctl.tick()
    expect(submits).toHaveLength(1)
  })

  it('條件 5：回合結束後未滿等待秒數不送；滿了才送', async () => {
    reset()
    world([base({ events: [['prompt', 100], ['stop', 10]] })])
    const ctl = make({ wait_seconds: 20 })
    await run(ctl)
    expect(submits).toEqual([])
    clock += 11_000
    await ctl.tick()
    expect(submits).toHaveLength(1)
  })

  it('action=clear：送 /clear', async () => {
    reset()
    world([base()])
    const ctl = make({ action: 'clear' })
    await run(ctl)
    expect(submits).toEqual([{ pid: 10, text: '/clear' }])
    expect(ctl.getState().events.some((e) => e.text.includes('/clear'))).toBe(true)
  })

  it('資料夾過濾：空 = 全部；忽略大小寫與結尾斜線；子資料夾算；不符不送', async () => {
    const cases: [string[], boolean][] = [
      [[], true],
      [['c:/proj/app/'], true],
      [['C:\\PROJ'], true],
      [['C:\\Pro'], false],
      [['D:\\other'], false]
    ]
    for (const [folders, expected] of cases) {
      reset()
      fs.rmSync(paths.compactDir(), { recursive: true, force: true })
      world([base()])
      await run(make({ folders }))
      expect(submits.length, folders.join(',')).toBe(expected ? 1 : 0)
    }
  })

  it('live 視窗：liveContinue 中且該 session 未送過繼續提示不送；done 之後才送', async () => {
    reset()
    world([base()])
    const ctl = make()
    await (ctl as unknown as Priv).scanNow()
    const done = new Set<string>()
    ;(ctl as unknown as Priv).liveContinue = { until: nowS() + 30, done }
    await ctl.tick()
    expect(submits).toEqual([])
    done.add(SID_A)
    await ctl.tick()
    expect(submits).toHaveLength(1)
  })

  it('多個候選：一次只送一個，先送 lastStopTs 最舊者；同時呼叫只送一個（in-flight）', async () => {
    reset()
    world([
      base({ pid: 10, sid: SID_A, events: [['prompt', 100], ['stop', 50]] }),
      base({ pid: 20, sid: SID_B, events: [['prompt', 120], ['stop', 80]] })
    ])
    submitDelay = 20
    const ctl = make()
    await (ctl as unknown as Priv).scanNow()
    await Promise.all([
      (ctl as unknown as Priv).maybeCompact(nowS()),
      (ctl as unknown as Priv).maybeCompact(nowS())
    ])
    expect(submits).toEqual([{ pid: 20, text: '/compact' }])
    await ctl.tick()
    expect(submits.map((s) => s.pid)).toEqual([20, 10])
    await ctl.tick()
    expect(submits).toHaveLength(2)
  })

  it('送出失敗或丟例外：只 warn（不含錯誤內容）、lastCompactTs 仍設定，不會每 tick 重試', async () => {
    reset()
    world([base()])
    submitOk = false
    const ctl = make()
    await run(ctl)
    await ctl.tick()
    expect(submits).toHaveLength(1)
    expect(ctl.getState().events.some((e) => e.level === 'warn' && e.text.includes('無法送出'))).toBe(
      true
    )
    expect(fs.existsSync(compactFile(SID_A))).toBe(true)

    reset()
    world([base()])
    submitThrows = true
    const c2 = make()
    await run(c2)
    expect(JSON.stringify(c2.getState().events)).not.toContain('SECRET')
  })

  it('setConfig：auto_compact 部分更新與驗證；CliView.contextPct', async () => {
    reset()
    world([base()])
    const ctl = make({ enabled: false })
    await (ctl as unknown as Priv).scanNow()
    expect(ctl.getState().clis[0].contextPct).toBe(70)
    expect(await ctl.setConfig({ auto_compact: { enabled: true, threshold: 80 } })).toEqual({
      ok: true
    })
    expect(ctl.getState().config.auto_compact).toMatchObject({
      enabled: true,
      threshold: 80,
      action: 'compact',
      wait_seconds: 20
    })
    expect(await ctl.setConfig({ auto_compact: { threshold: 100 } })).toMatchObject({
      ok: false,
      code: 'INVALID'
    })
    expect(ctl.getState().config.auto_compact.threshold).toBe(80)
  })

  describe('AC-14\' 整理後清除畫面', () => {
    it('compact 後 busy→idle 送 Ctrl+L，並寫入事件紀錄', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])
      expect(ctrlKeys).toEqual([])

      // 狀態變為 busy
      recs[0].status = 'busy'
      await ctl.tick()
      expect(ctrlKeys).toEqual([])

      // 狀態回到 idle
      recs[0].status = 'idle'
      await ctl.tick()
      expect(ctrlKeys).toEqual([{ pid: 10, letter: 'L' }])
      expect(ctl.getState().events.some((e) => e.text === '已清除 C:\\Proj\\App 的畫面')).toBe(true)

      // 再 tick 不會重送
      await ctl.tick()
      expect(ctrlKeys).toHaveLength(1)
    })

    it('context 下降時送 Ctrl+L', async () => {
      reset()
      world([base({ usage: { ago: 40, context: ctx(70) } })])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])
      expect(ctrlKeys).toEqual([])

      // status 保持 idle，但 statusline 的 used_percentage 下降
      writeUsage(SID_A, 5, ctx(30))
      await ctl.tick()
      expect(ctrlKeys).toEqual([{ pid: 10, letter: 'L' }])
      expect(ctl.getState().events.some((e) => e.text === '已清除 C:\\Proj\\App 的畫面')).toBe(true)
    })

    it('在 sentAt+1 寫入 prompt 事件，之後 busy→idle 仍要送 Ctrl+L', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      // 在 sentAt+1 寫入 prompt 事件（COMPACT_IGNORE_S 內視為 /compact 自身產生）
      writeEvent(SID_A, 'prompt', -1)
      clock += 2000
      recs[0].status = 'busy'
      await ctl.tick()
      recs[0].status = 'idle'
      await ctl.tick()
      expect(ctrlKeys).toEqual([{ pid: 10, letter: 'L' }])
    })

    it('在 sentAt+31 之後寫入的 prompt 事件才取消', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      // 在 sentAt+32 寫入 prompt 事件（超過 COMPACT_IGNORE_S 30 秒）
      writeEvent(SID_A, 'prompt', -32)
      clock += 35_000
      recs[0].status = 'busy'
      await ctl.tick()
      recs[0].status = 'idle'
      await ctl.tick()
      expect(ctrlKeys).toEqual([])
    })

    it('超過 600 秒逾時不送 Ctrl+L', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      recs[0].status = 'busy'
      await ctl.tick()
      clock += 601_000
      recs[0].status = 'idle'
      await ctl.tick()
      expect(ctrlKeys).toEqual([])
    })

    it('同 pid 但 sessionId 不符時移除不送', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      recs[0].status = 'busy'
      await ctl.tick()

      // 同 pid 10，但 sessionId 不符
      recs[0].sessionId = SID_B
      recs[0].status = 'idle'
      await ctl.tick()
      expect(ctrlKeys).toEqual([])

      // 即使改回原 sessionId，pending 紀錄已被移除，不應補送
      recs[0].sessionId = SID_A
      await ctl.tick()
      expect(ctrlKeys).toEqual([])
    })

    it('compactInFlight 為 true 時本次 tick 不送（下次再送）', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      recs[0].status = 'busy'
      await ctl.tick()
      recs[0].status = 'idle'

      // compactInFlight 為 true 時本次 tick 不送
      ;(ctl as unknown as { compactInFlight: boolean }).compactInFlight = true
      await ctl.tick()
      expect(ctrlKeys).toEqual([])

      // compactInFlight 還原為 false，下次 tick 再送
      ;(ctl as unknown as { compactInFlight: boolean }).compactInFlight = false
      await ctl.tick()
      expect(ctrlKeys).toEqual([{ pid: 10, letter: 'L' }])
    })

    it('該 session 在 live 模式「繼續」處理中時不送', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      recs[0].status = 'busy'
      await ctl.tick()
      recs[0].status = 'idle'

      // liveContinue 處理中，且 SID_A 尚未完成
      const lc = { until: nowS() + 30, done: new Set<string>() }
      ;(ctl as unknown as { liveContinue: typeof lc | null }).liveContinue = lc
      await ctl.tick()
      expect(ctrlKeys).toEqual([])

      // SID_A 完成後，下次 tick 送出 Ctrl+L
      lc.done.add(SID_A)
      await ctl.tick()
      expect(ctrlKeys).toEqual([{ pid: 10, letter: 'L' }])
    })

    it('程序消失或對不上則移除 pending，不送 Ctrl+L', async () => {
      reset()
      world([base()])
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      // 程序結束
      alive.delete(10)
      recs = []
      await ctl.tick()
      expect(ctrlKeys).toEqual([])

      // 即使後來程序又恢復，pendingClear 已被移除
      alive.add(10)
      recs = [
        {
          pid: 10,
          sessionId: SID_A,
          cwd: 'C:\\Proj\\App',
          procStartMs: 100,
          kind: 'interactive',
          entrypoint: '',
          status: 'idle',
          statusUpdatedAt: 0
        }
      ]
      await ctl.tick()
      expect(ctrlKeys).toEqual([])
    })

    it('injectSubmit 失敗時不建立 pendingClear', async () => {
      reset()
      world([base()])
      submitOk = false
      const ctl = make()
      await run(ctl)
      expect(submits).toEqual([{ pid: 10, text: '/compact' }])

      recs[0].status = 'busy'
      await ctl.tick()
      recs[0].status = 'idle'
      await ctl.tick()
      expect(ctrlKeys).toEqual([])
    })

    it('clear_screen_after 為 false 或 action 為 clear 時不建立 pendingClear', async () => {
      reset()
      world([base()])
      const ctl1 = make({ clear_screen_after: false })
      await run(ctl1)
      recs[0].status = 'busy'
      await ctl1.tick()
      recs[0].status = 'idle'
      await ctl1.tick()
      expect(ctrlKeys).toEqual([])

      reset()
      world([base()])
      const ctl2 = make({ action: 'clear' })
      await run(ctl2)
      recs[0].status = 'busy'
      await ctl2.tick()
      recs[0].status = 'idle'
      await ctl2.tick()
      expect(ctrlKeys).toEqual([])
    })
  })
})
