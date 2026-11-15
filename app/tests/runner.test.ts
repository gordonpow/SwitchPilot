import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runsDir } from '../src/core/paths'
import { readJson, writeJsonAtomic } from '../src/core/storage'
import { useTempEnv } from './helpers'

const ROOT = path.resolve(__dirname, '..')
const RUNNER = path.join(ROOT, 'resources', 'scripts', 'runner.cjs')
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.cjs')
const RID = 't1'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('runner.cjs', () => {
  const root = useTempEnv()
  const logFile = (): string => path.join(root(), 'claude.log')
  const cmdFile = (): string => path.join(runsDir(), `${RID}.cmd.json`)
  const state = (): Record<string, unknown> =>
    readJson(path.join(runsDir(), `${RID}.state.json`), {}) as Record<string, unknown>

  const writeCmd = (restart: string, extra: Record<string, unknown> = {}): void =>
    writeJsonAtomic(cmdFile(), { restart, seq: 1, ...extra })
  const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64')
  const jsonLog = (): string => path.join(root(), 'claude.json.log')
  const argvs = (): string[][] =>
    fs
      .readFileSync(jsonLog(), 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[])
  const SID = '123e4567-e89b-12d3-a456-426614174000'
  const SID2 = '223e4567-e89b-12d3-a456-426614174111'

  async function waitFor(pred: () => boolean, timeout = 6000): Promise<boolean> {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (pred()) return true
      await sleep(50)
    }
    return false
  }

  /** claude 為空字串時不傳 --claude，並清空 PATH 以模擬找不到 claude。 */
  function runRunner(
    extra: string[],
    helper?: () => Promise<void>,
    claude = FAKE
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [RUNNER, '--run-id', RID, '--cwd', root(), '--no-pause', ...extra]
      if (claude) args.push('--claude', claude)
      const child = spawn(process.execPath, args, {
        env: { ...process.env, FAKE_CLAUDE_LOG: logFile(), FAKE_CLAUDE_JSON_LOG: jsonLog(), FAKE_CLAUDE_SLEEP: '0.6', PATH: claude.endsWith('.cmd') ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32') : '' },
        stdio: 'ignore'
      })
      child.on('error', reject)
      child.on('exit', (code) => resolve(code ?? -1))
      helper?.().catch(reject)
    })
  }

  const calls = (): string[] => {
    const lines = fs.readFileSync(logFile(), 'utf-8').split(/\r?\n/)
    lines.pop()
    return lines.map((l) => l.trim())
  }

  const running = (): boolean => state().state === 'running'
  const waiting = (): boolean => state().state === 'waiting'

  it('無 cmd 就結束', async () => {
    expect(await runRunner([])).toBe(0)
    expect(calls()).toEqual([''])
    expect(state().state).toBe('exited')
  })

  it('go 以 --continue 重啟', async () => {
    const code = await runRunner([], async () => {
      await waitFor(running)
      writeCmd('go')
    })
    expect(code).toBe(0)
    expect(calls()).toEqual(['', '--continue'])
    expect(state().state).toBe('exited')
    expect(fs.existsSync(cmdFile())).toBe(false)
  })

  it('pending 後 go', async () => {
    await runRunner([], async () => {
      await waitFor(running)
      writeCmd('pending')
      await waitFor(waiting)
      writeCmd('go')
    })
    expect(calls()).toEqual(['', '--continue'])
  })

  it('不重複 --continue', async () => {
    await runRunner(['--continue'], async () => {
      await waitFor(running)
      writeCmd('go')
    })
    expect(calls()).toEqual(['--continue', '--continue'])
  })

  it('pending 後 abort', async () => {
    const code = await runRunner([], async () => {
      await waitFor(running)
      writeCmd('pending')
      await waitFor(waiting)
      writeCmd('abort')
    })
    expect(code).toBe(0)
    expect(calls()).toHaveLength(1)
    expect(state().state).toBe('exited')
  })

  it('等待逾時結束', async () => {
    const code = await runRunner(['--wait-timeout', '1'], async () => {
      await waitFor(running)
      writeCmd('pending')
    })
    expect(code).toBe(0)
    expect(calls()).toHaveLength(1)
    expect(state().state).toBe('exited')
  })

  it('找不到 claude 回傳 1', async () => {
    expect(await runRunner([], undefined, '')).toBe(1)
  })

  const goAfterRunning = (extra: Record<string, unknown> = {}) => async (): Promise<void> => {
    await waitFor(running)
    writeCmd('go', extra)
  }

  it('第一次啟動帶 extra、--resume、prompt', async () => {
    await runRunner([
      '--resume', SID,
      '--prompt-b64', b64('繼續 工作'),
      '--extra-args-b64', b64(JSON.stringify(['--model', 'opus']))
    ])
    expect(argvs()).toEqual([['--model', 'opus', '--resume', SID, '繼續 工作']])
  })

  it('沒有 resume 時 prompt 無效', async () => {
    await runRunner(['--prompt-b64', b64('hi'), '--extra-args-b64', b64('["-x"]')])
    expect(argvs()).toEqual([['-x']])
  })

  it('go 帶 resume／prompt 重啟，沿用啟動時 extra', async () => {
    await runRunner(
      ['--extra-args-b64', b64('["--model","opus"]')],
      goAfterRunning({ resume: SID, prompt: '繼續' })
    )
    expect(argvs()).toEqual([['--model', 'opus'], ['--model', 'opus', '--resume', SID, '繼續']])
  })

  it('cmd 的 extra_args 優先於啟動時 extra；無 prompt', async () => {
    await runRunner(
      ['--extra-args-b64', b64('["--model","opus"]')],
      goAfterRunning({ resume: SID, extra_args: ['--verbose'] })
    )
    expect(argvs()[1]).toEqual(['--verbose', '--resume', SID])
  })

  it('go 不帶 resume 時用 --continue（含 extra）', async () => {
    await runRunner(['--extra-args-b64', b64('["--model","opus"]')], goAfterRunning())
    expect(argvs()[1]).toEqual(['--model', 'opus', '--continue'])
  })

  it('壞 sessionId 視為沒有 resume', async () => {
    await runRunner(['--resume', 'not-a-uuid', '--prompt-b64', b64('x')], goAfterRunning({ resume: 'bad; id', prompt: 'x' }))
    expect(argvs()).toEqual([[], ['--continue']])
  })

  it('go 的 resume 換成另一個 session', async () => {
    await runRunner(['--resume', SID], goAfterRunning({ resume: SID2 }))
    expect(argvs()).toEqual([['--resume', SID], ['--resume', SID2]])
  })

  it('.cmd 遇特殊字元丟掉 extra 與 prompt', async () => {
    const shim = path.join(root(), 'fake.cmd')
    fs.writeFileSync(shim, `@"${process.execPath}" "${FAKE}" %*\r\n`)
    await runRunner(
      ['--resume', SID, '--prompt-b64', b64('a&b'), '--extra-args-b64', b64('["--model","opus"]')],
      undefined,
      shim
    )
    expect(argvs()).toEqual([['--resume', SID]])
  })
})
