import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  agyExhaustedFile,
  agyLockFile,
  agyQuotaDir,
  agySlotsDir,
  dispatchDir,
  dispatchRunningDir,
  routingFile,
  slotsDir,
  usageApiDir
} from '../src/core/paths'
import { readJson, writeJsonAtomic } from '../src/core/storage'
import { useTempEnv } from './helpers'

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'resources', 'scripts', 'switcher-run.cjs')
const FAKE_AGY = path.join(__dirname, 'fixtures', 'fake-agy.cjs')
const MODEL = 'gemini-3.8-flash-high'

interface RunOut {
  code: number
  stdout: string
  stderr: string
  result: Record<string, unknown> & { attempts: Record<string, unknown>[] }
}

const blob = (email: string): string =>
  JSON.stringify({
    id_token_email: email,
    token: {
      access_token: 'SECRET-ACCESS-' + email,
      refresh_token: 'SECRET-REFRESH',
      expiry: '2099-01-01T00:00:00Z'
    }
  })

describe('switcher-run.cjs', () => {
  const root = useTempEnv()
  const f = (n: string): string => path.join(root(), n)
  const credFile = (): string => f('fake-cred.json')
  const agyLog = (): string => f('agy.log.jsonl')
  const promptFile = (): string => f('prompt.txt')
  const outFile = (): string => f('out.txt')

  function addSlot(id: string, email: string): void {
    writeJsonAtomic(path.join(agySlotsDir(), `${id}.json`), {
      id,
      name: email.split('@')[0],
      email,
      user: 'u-' + id,
      blob: blob(email),
      saved_at: 1000 + Number.parseInt(id, 16)
    })
  }
  function setActive(email: string | null): void {
    if (email === null) fs.rmSync(credFile(), { force: true })
    else writeJsonAtomic(credFile(), { user: 'u', blob: blob(email) })
  }
  function addClaudeSlot(id: string, email: string): void {
    writeJsonAtomic(path.join(slotsDir(), `${id}.json`), {
      id,
      name: email.split('@')[0],
      email,
      saved_at: 1000
    })
  }
  const activeEmail = (): string | null => {
    const v = readJson(credFile(), null) as { blob: string } | null
    return v ? (JSON.parse(v.blob) as { id_token_email: string }).id_token_email : null
  }
  const calls = (): { argv: string[]; email: string | null; mode: string }[] =>
    fs.existsSync(agyLog())
      ? fs
          .readFileSync(agyLog(), 'utf-8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { argv: string[]; email: string | null; mode: string })
      : []

  function run(
    extra: string[] = [],
    env: Record<string, string | undefined> = {},
    opts: { prompt?: string; role?: string; promptPath?: string } = {}
  ): Promise<RunOut> {
    fs.writeFileSync(promptFile(), opts.prompt ?? '請實作功能 X')
    const args = [
      SCRIPT,
      '--role',
      opts.role ?? 'implement',
      '--prompt',
      opts.promptPath ?? promptFile(),
      '--out',
      outFile(),
      '--cwd',
      root(),
      '--agy',
      FAKE_AGY,
      ...extra
    ]
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        env: {
          ...process.env,
          CLAUDE_SWITCHER_TEST: '1',
          CLAUDE_SWITCHER_FAKE_AGYCRED: credFile(),
          CLAUDE_SWITCHER_FAKE_PROCS: f('procs.json'),
          FAKE_AGY_LOG: agyLog(),
          FAKE_AGY_COUNTER: f('agy.counter'),
          ...env
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf-8')))
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf-8')))
      child.on('error', reject)
      child.on('close', (code) => {
        const last = stdout.trim().split(/\r?\n/).pop() ?? ''
        let result = {} as RunOut['result']
        try {
          result = JSON.parse(last) as RunOut['result']
        } catch {
          /* 參數錯誤時沒有 JSON */
        }
        resolve({ code: code ?? -1, stdout, stderr, result })
      })
    })
  }

  const quotaOf = (rem: number, reset: number): unknown => ({
    ts: 1,
    tier: null,
    error: null,
    models: { [MODEL]: { remaining: rem, resetAt: reset } }
  })
  const future = (sec: number): number => Math.floor(Date.now() / 1000) + sec

  it('成功：用目前帳號執行、寫 out、傳正確參數、寫 dispatch、釋放鎖且刪除登記檔', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    const r = await run(['--allow', 'npm test'], { FAKE_AGY_MODE: 'ok' })
    expect(r.code).toBe(0)
    expect(r.result.status).toBe('ok')
    expect(r.result.provider).toBe('agy')
    expect(r.result.model).toBe(MODEL)
    expect(r.result.agy_account_email).toBe('a@x.com')
    expect(fs.readFileSync(outFile(), 'utf-8')).toContain('實作完成')
    const [c] = calls()
    expect(c.argv.slice(0, 4)).toEqual(['--mode', 'accept-edits', '--model', MODEL])
    expect(c.argv[c.argv.indexOf('-p') + 1]).toBe('請實作功能 X')
    expect(c.argv[c.argv.indexOf('--log-file') + 1]).toBe(outFile() + '.agy.log')
    expect(fs.existsSync(agyLockFile())).toBe(false)
    const files = fs.readdirSync(dispatchDir()).filter((f) => f.endsWith('.json'))
    expect(files).toHaveLength(1)
    const d = fs.readFileSync(path.join(dispatchDir(), files[0]), 'utf-8')
    expect(d).not.toContain('請實作功能 X')
    expect(d).not.toContain('SECRET')
    expect(JSON.parse(d)).toMatchObject({ role: 'implement', status: 'ok' })
    expect(r.stdout + r.stderr).not.toContain('SECRET')

    // 驗證執行完成後 running 登記已刪除
    const runningFiles = fs.existsSync(dispatchRunningDir())
      ? fs.readdirSync(dispatchRunningDir())
      : []
    expect(runningFiles).toHaveLength(0)
  })

  it('執行前 dead pid 被清除', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    fs.mkdirSync(dispatchRunningDir(), { recursive: true })
    writeJsonAtomic(path.join(dispatchRunningDir(), 'dead.json'), {
      id: 'dead',
      pid: 99999999, // 不存活 PID
      role: 'implement',
      provider: 'agy',
      model: MODEL,
      slot_id: 'aaaaaa',
      account: 'a@x.com',
      cwd: root(),
      out: outFile(),
      started_at: 1000
    })

    const r = await run([], { FAKE_AGY_MODE: 'ok' })
    expect(r.code).toBe(0)
    expect(fs.existsSync(path.join(dispatchRunningDir(), 'dead.json'))).toBe(false)
  })

  it('N 上限：達上限時記 account_busy 並換清單下一項委派 Claude', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    // 設定 N=1
    writeJsonAtomic(routingFile(), {
      version: 1,
      max_concurrent_per_account: 1,
      roles: {
        implement: [
          { provider: 'agy', model: MODEL },
          { provider: 'claude', model: 'sonnet' }
        ]
      }
    })
    // 登記 1 筆正在執行的任務（PID 用自身存活 PID）
    writeJsonAtomic(path.join(dispatchRunningDir(), 'busy1.json'), {
      id: 'busy1',
      pid: process.pid,
      role: 'implement',
      provider: 'agy',
      model: MODEL,
      slot_id: 'aaaaaa',
      account: 'a@x.com',
      cwd: root(),
      out: outFile(),
      started_at: Date.now()
    })

    const r = await run([], { FAKE_AGY_MODE: 'ok' })
    // 因 N=1 且已有 1 筆，記 account_busy，改委派 Claude sonnet（exit 10）
    expect(r.code).toBe(10)
    expect(r.result.attempts[0].outcome).toBe('account_busy')
    expect(r.result.status).toBe('delegate')
    expect(calls()).toHaveLength(0)
  })

  it('無 Claude 備援且 account_busy 時的失敗訊息', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    writeJsonAtomic(routingFile(), {
      version: 1,
      max_concurrent_per_account: 1,
      roles: {
        implement: [{ provider: 'agy', model: MODEL }]
      }
    })
    writeJsonAtomic(path.join(dispatchRunningDir(), 'busy1.json'), {
      id: 'busy1',
      pid: process.pid,
      role: 'implement',
      provider: 'agy',
      model: MODEL,
      slot_id: 'aaaaaa',
      account: 'a@x.com',
      cwd: root(),
      out: outFile(),
      started_at: Date.now()
    })

    const r = await run([], { FAKE_AGY_MODE: 'ok' })
    expect(r.code).toBe(1)
    expect(r.result.status).toBe('failed')
    expect(r.result.message).toBe('agy 帳號同時執行的任務已達上限，且沒有 Claude 備援')
  })

  it('R-3 測試：N=1 時兩個子程序同時進入，第二個得到 account_busy', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    writeJsonAtomic(routingFile(), {
      version: 1,
      max_concurrent_per_account: 1,
      roles: {
        implement: [
          { provider: 'agy', model: MODEL },
          { provider: 'claude', model: 'sonnet' }
        ]
      }
    })

    const out1 = f('out1.txt')
    const out2 = f('out2.txt')
    fs.writeFileSync(promptFile(), 'test prompt')

    // 第一個程序使用 fake-agy 睡 1200ms
    const p1 = run(['--out', out1], { FAKE_AGY_MODE: 'sleep', FAKE_AGY_SLEEP_MS: '1200' })
    // 等待 300ms 確保第一個子程序已取得鎖、完成登記並進入執行
    await new Promise((r) => setTimeout(r, 300))

    // 第二個程序進入
    const p2 = run(['--out', out2], { FAKE_AGY_MODE: 'ok' })

    const [r1, r2] = await Promise.all([p1, p2])

    // 第一個程序成功完成
    expect(r1.code).toBe(0)
    expect(r1.result.status).toBe('ok')

    // 第二個程序因 N=1 得到 account_busy，改委派 Claude（exit 10）
    expect(r2.code).toBe(10)
    expect(r2.result.status).toBe('delegate')
    expect(r2.result.attempts[0].outcome).toBe('account_busy')
  }, 25000)

  it('exit 0 且輸出含 quota／429 字樣仍算成功（R-4）', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    const r = await run([], { FAKE_AGY_MODE: 'quota_text_ok' })
    expect(r.code).toBe(0)
    expect(r.result.status).toBe('ok')
    expect(calls()).toHaveLength(1)
    expect(fs.existsSync(agyExhaustedFile())).toBe(false)
  })

  it('額度錯誤：標記 exhausted（用快取 resetAt）、切換到下一個帳號重跑（R-2: 先 unregister 再取鎖換帳號）', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    const reset = future(7200)
    writeJsonAtomic(path.join(agyQuotaDir(), 'aaaaaa.json'), quotaOf(0.5, reset))
    const r = await run([], { FAKE_AGY_SEQ: 'quota_stderr,ok' })
    expect(r.code).toBe(0)
    expect(r.result.agy_account_email).toBe('b@x.com')
    expect(r.result.attempts.map((a) => a.outcome)).toEqual(['quota_exhausted', 'ok'])
    expect(calls().map((c) => c.email)).toEqual(['a@x.com', 'b@x.com'])
    expect(activeEmail()).toBe('b@x.com')
    const ex = readJson(agyExhaustedFile()) as Record<string, number>
    expect(ex[`aaaaaa|${MODEL}`]).toBe(reset)
    // 結束時無殘留登記
    const runningFiles = fs.existsSync(dispatchRunningDir())
      ? fs.readdirSync(dispatchRunningDir())
      : []
    expect(runningFiles).toHaveLength(0)
  })

  it('log 中的結構化額度字樣（exit 1）也換帳號；無快取時 until 為 now+5h', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    const r = await run([], { FAKE_AGY_SEQ: 'quota_log,ok' })
    expect(r.code).toBe(0)
    const ex = readJson(agyExhaustedFile()) as Record<string, number>
    const until = ex[`aaaaaa|${MODEL}`]
    const now = Math.floor(Date.now() / 1000)
    expect(until).toBeGreaterThan(now + 5 * 3600 - 120)
    expect(until).toBeLessThanOrEqual(now + 5 * 3600 + 5)
  })

  it('快取顯示額度見底的帳號被排除，剩餘多者優先', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    addSlot('cccccc', 'c@x.com')
    setActive(null)
    const reset = future(3600)
    writeJsonAtomic(path.join(agyQuotaDir(), 'aaaaaa.json'), quotaOf(0, reset))
    writeJsonAtomic(path.join(agyQuotaDir(), 'bbbbbb.json'), quotaOf(0.3, reset))
    writeJsonAtomic(path.join(agyQuotaDir(), 'cccccc.json'), quotaOf(0.9, reset))
    const r = await run(['--dry-run'])
    expect(r.result.agy_account_email).toBe('c@x.com')
  })

  it('全部 agy 帳號用完：回 delegate（exit 10）指出 claude 模型', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    const r = await run([], { FAKE_AGY_MODE: 'quota_stderr' })
    expect(r.code).toBe(10)
    expect(r.result).toMatchObject({ status: 'delegate', provider: 'claude', model: 'sonnet' })
    expect(r.result.attempts.map((a) => a.outcome)).toEqual([
      'quota_exhausted',
      'quota_exhausted',
      'delegate'
    ])
    expect(calls()).toHaveLength(2)
    // 再跑一次：兩個帳號都已標記，不再呼叫 agy
    const r2 = await run([], { FAKE_AGY_MODE: 'quota_stderr' })
    expect(r2.code).toBe(10)
    expect(calls()).toHaveLength(2)
  })

  it('權限被拒：回 failed，不換帳號', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    const r = await run([], { FAKE_AGY_MODE: 'noout' })
    expect(r.code).toBe(1)
    expect(r.result.status).toBe('failed')
    expect(r.result.message).toContain('允許清單')
    expect(calls()).toHaveLength(1)
    expect(fs.existsSync(agyExhaustedFile())).toBe(false)
  })

  it('其他失敗：不換帳號，改清單下一項（delegate）', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    const r = await run([], { FAKE_AGY_MODE: 'fail' })
    expect(r.code).toBe(10)
    expect(calls()).toHaveLength(1)
    expect(r.result.attempts[0].outcome).toBe('failed_exit_3')
  })

  it('dry-run：不執行、不切換、不寫 dispatch', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    writeJsonAtomic(agyExhaustedFile(), { [`aaaaaa|${MODEL}`]: future(3600) })
    const r = await run(['--dry-run'])
    expect(r.code).toBe(0)
    expect(r.result.agy_account_email).toBe('b@x.com')
    expect(calls()).toHaveLength(0)
    expect(activeEmail()).toBe('a@x.com')
    expect(fs.existsSync(dispatchDir())).toBe(false)
    expect(fs.existsSync(agyLockFile())).toBe(false)
  })

  it('agy 執行中：不切換到其他帳號', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    writeJsonAtomic(agyExhaustedFile(), { [`aaaaaa|${MODEL}`]: future(3600) })
    writeJsonAtomic(f('procs.json'), [{ pid: 99, ppid: 1, name: 'agy.exe', cmdline: 'agy', created: 0 }])
    const r = await run([], { FAKE_AGY_MODE: 'ok' })
    expect(r.code).toBe(10)
    expect(r.result.attempts[0].outcome).toBe('skipped_agy_running')
    expect(calls()).toHaveLength(0)
    expect(activeEmail()).toBe('a@x.com')
  })

  it('執行中登記（running）存在時也不切換到其他帳號', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    writeJsonAtomic(agyExhaustedFile(), { [`aaaaaa|${MODEL}`]: future(3600) })
    // a@x.com 額度已用完，候選是 b@x.com；但已有 running 任務
    writeJsonAtomic(path.join(dispatchRunningDir(), 'active-run.json'), {
      id: 'active-run',
      pid: process.pid,
      role: 'implement',
      provider: 'agy',
      model: MODEL,
      slot_id: 'aaaaaa',
      account: 'a@x.com',
      cwd: root(),
      out: outFile(),
      started_at: Date.now()
    })
    const r = await run([], { FAKE_AGY_MODE: 'ok' })
    expect(r.code).toBe(10)
    expect(r.result.attempts[0].outcome).toBe('skipped_agy_running')
    expect(calls()).toHaveLength(0)
    expect(activeEmail()).toBe('a@x.com')
  })

  it('鎖被他人持有：不執行 agy、不切換，改清單下一項，且不刪他人的鎖', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    writeJsonAtomic(agyLockFile(), { pid: process.pid, ts: Date.now() })
    const r = await run([], { FAKE_AGY_MODE: 'ok' })
    expect(r.code).toBe(10)
    expect(r.result.attempts[0].outcome).toBe('agy_busy')
    expect(calls()).toHaveLength(0)
    expect(fs.existsSync(agyLockFile())).toBe(true)
  })

  it('持有者已不存活的鎖會被接手並在結束時釋放', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    writeJsonAtomic(agyLockFile(), { pid: 2147483000, ts: Date.now() })
    const r = await run([], { FAKE_AGY_MODE: 'ok' })
    expect(r.code).toBe(0)
    expect(fs.existsSync(agyLockFile())).toBe(false)
  })

  it.each([['a"b'], ['npm *'], ['x?y'], ['a\nb'], ['x'.repeat(201)], ['']])(
    '--allow 不合法（%j）exit 2',
    async (bad) => {
      addSlot('aaaaaa', 'a@x.com')
      setActive('a@x.com')
      const r = await run(['--allow', bad])
      expect(r.code).toBe(2)
      expect(calls()).toHaveLength(0)
    }
  )

  it('無效 role、缺少提示檔、非測試環境用 --agy 都是 exit 2', async () => {
    expect((await run([], {}, { role: 'nope' })).code).toBe(2)
    expect((await run([], {}, { promptPath: f('missing.txt') })).code).toBe(2)
    const r = await run([], { CLAUDE_SWITCHER_TEST: '' })
    expect(r.code).toBe(2)
    expect(calls()).toHaveLength(0)
  })

  it('claude 項目：若 Claude 帳號可用，回 delegate（exit 10）', async () => {
    addClaudeSlot('c1', 'claude@x.com')
    const r = await run([], {}, { role: 'spec_review' })
    expect(r.code).toBe(10)
    expect(r.result).toMatchObject({ status: 'delegate', provider: 'claude', model: 'sonnet' })
  })

  it('AC-13 遞補：全部 Claude 帳號不可用時，改用清單下一個 agy 項目（exit 0）', async () => {
    // spec 預設為 Claude Opus -> agy claude-opus-4-6-thinking
    addClaudeSlot('c1', 'claude@x.com')
    // 標記 c1 額度滿
    writeJsonAtomic(path.join(usageApiDir(), 'c1.json'), {
      slot_id: 'c1',
      ts: Math.floor(Date.now() / 1000) - 10,
      saved_at: 1000,
      five_hour: { used_percentage: 100, resets_at: Math.floor(Date.now() / 1000) + 3600 }
    })

    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')

    const r = await run([], { FAKE_AGY_MODE: 'ok' }, { role: 'spec' })
    expect(r.code).toBe(0)
    expect(r.result.status).toBe('ok')
    expect(r.result.provider).toBe('agy')
    expect(r.result.model).toBe('claude-opus-4-6-thinking')
    expect(r.result.attempts[0]).toMatchObject({
      provider: 'claude',
      model: 'opus',
      outcome: 'claude_exhausted'
    })
    expect(r.result.attempts[1]).toMatchObject({
      provider: 'agy',
      model: 'claude-opus-4-6-thinking',
      outcome: 'ok'
    })
  })

  it('R-9 失敗訊息：Claude 帳號額度用完且 agy 項目無法執行', async () => {
    addClaudeSlot('c1', 'claude@x.com')
    writeJsonAtomic(path.join(usageApiDir(), 'c1.json'), {
      slot_id: 'c1',
      ts: Math.floor(Date.now() / 1000) - 10,
      saved_at: 1000,
      five_hour: { used_percentage: 100, resets_at: Math.floor(Date.now() / 1000) + 3600 }
    })

    // 沒有任何 agy 帳號
    const r = await run([], {}, { role: 'spec' })
    expect(r.code).toBe(1)
    expect(r.result.status).toBe('failed')
    expect(r.result.message).toBe('Claude 帳號額度都已用完，且 agy 項目都無法執行')
  })

  it('長提示改傳檔案路徑（不截斷）', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    const r = await run([], { FAKE_AGY_MODE: 'ok' }, { prompt: '長'.repeat(20001) })
    expect(r.code).toBe(0)
    const argv = calls()[0].argv
    expect(argv[argv.indexOf('-p') + 1]).toBe(`請完整讀取並照做檔案 ${promptFile()} 中的指示。`)
    expect(fs.readFileSync(promptFile(), 'utf-8')).toHaveLength(20001)
  })

  it('settings 為正確 JSON（跳脫反斜線），未指定時用預設允許清單', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    await run(['--allow', 'node C:\\x\\a.js', '--allow', 'npm test'], { FAKE_AGY_MODE: 'ok' })
    let argv = calls()[0].argv
    expect(JSON.parse(argv[argv.indexOf('--settings') + 1])).toEqual({
      permissions: { allow: ['command(node C:\\x\\a.js)', 'command(npm test)'] }
    })
    fs.rmSync(agyLog())
    await run([], { FAKE_AGY_MODE: 'ok' })
    argv = calls()[0].argv
    expect(JSON.parse(argv[argv.indexOf('--settings') + 1]).permissions.allow).toEqual([
      'command(npm test)',
      'command(npm run typecheck)',
      'command(npm run build)'
    ])
  })

  it('逾時：結束 agy 程序樹，不換帳號並釋放鎖', async () => {
    addSlot('aaaaaa', 'a@x.com')
    addSlot('bbbbbb', 'b@x.com')
    setActive('a@x.com')
    const r = await run([], { FAKE_AGY_MODE: 'sleep', CLAUDE_SWITCHER_RUN_TIMEOUT_MS: '800' })
    expect(r.code).toBe(10)
    expect(r.result.attempts[0].outcome).toBe('timeout')
    expect(calls()).toHaveLength(1)
    expect(fs.existsSync(agyLockFile())).toBe(false)
  }, 20000)

  it('dispatch 只保留最近 200 筆', async () => {
    addSlot('aaaaaa', 'a@x.com')
    setActive('a@x.com')
    for (let i = 0; i < 205; i++)
      writeJsonAtomic(path.join(dispatchDir(), `${String(1000 + i).padStart(19, '0')}.json`), {})
    await run([], { FAKE_AGY_MODE: 'ok' })
    const names = fs.readdirSync(dispatchDir()).filter((f) => f.endsWith('.json'))
    expect(names).toHaveLength(200)
    expect(names).not.toContain(`${String(1000).padStart(19, '0')}.json`)
  })
})
