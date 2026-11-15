import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  abortRestart,
  activeRuns,
  launch,
  normalizeFolder,
  releaseRestart,
  requestRestart
} from '../src/core/launcher'
import { runsDir } from '../src/core/paths'
import { readJson, writeJsonAtomic } from '../src/core/storage'
import { useTempEnv } from './helpers'

describe('launcher.launch', () => {
  const root = useTempEnv()
  const NODE = 'C:\\node\\node.exe'

  it('資料夾含分號丟錯', () => {
    const spawn = vi.fn()
    expect(() => launch('C:\\a;b', false, { spawn, node: NODE, wtPath: null })).toThrow()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('cmd 後備路徑：資料夾含 cmd 特殊字元丟錯，不 spawn', () => {
    for (const ch of ['&', '^', '%', '|', '<', '>', '"']) {
      const spawn = vi.fn()
      expect(() => launch(`C:\\a${ch}calc`, false, { spawn, node: NODE, wtPath: null })).toThrow(
        /特殊字元/
      )
      expect(spawn).not.toHaveBeenCalled()
    }
    // wt 路徑不經 cmd 解析，不受此限
    const spawn = vi.fn()
    launch('C:\\a&b', false, { spawn, node: NODE, wtPath: 'C:\\wt.exe' })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('wt 指令參數', () => {
    const spawn = vi.fn()
    const binDir = path.join(root(), 'bin')
    const rid = launch('C:\\proj', true, { spawn, node: NODE, wtPath: 'C:\\wt.exe', binDir })
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('C:\\wt.exe')
    expect(args.slice(0, 6)).toEqual(['-w', 'new', '--title', 'Claude (switcher)', '-d', 'C:\\proj'])
    expect(args.slice(6, 8)).toEqual([NODE, path.join(binDir, 'runner.cjs')])
    expect(args[args.indexOf('--run-id') + 1]).toBe(rid)
    expect(args[args.indexOf('--cwd') + 1]).toBe('C:\\proj')
    expect(args[args.length - 1]).toBe('--continue')
    expect(opts.detached).toBe(true)
  })

  it('不續接時沒有 --continue', () => {
    const spawn = vi.fn()
    launch('C:\\proj', false, { spawn, node: NODE, wtPath: 'C:\\wt.exe' })
    expect(spawn.mock.calls[0][1]).not.toContain('--continue')
  })

  it('找不到 wt.exe 時用 cmd /c start 開新主控台', () => {
    const spawn = vi.fn()
    launch('C:\\proj', false, { spawn, node: NODE, wtPath: null })
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('cmd.exe')
    expect(args.slice(0, 6)).toEqual(['/d', '/c', 'start', 'Claude (switcher)', '/D', 'C:\\proj'])
    expect(args[6]).toBe(NODE)
    expect(opts.cwd).toBe('C:\\proj')
  })

  it('resume／prompt／extraArgs 轉成 b64 runner 參數', () => {
    const spawn = vi.fn()
    const sid = '123e4567-e89b-12d3-a456-426614174000'
    launch('C:\\proj', false, {
      spawn, node: NODE, wtPath: 'C:\\wt.exe',
      resume: sid, prompt: '繼續', extraArgs: ['--model', 'opus']
    })
    const args: string[] = spawn.mock.calls[0][1]
    const dec = (k: string): string => Buffer.from(args[args.indexOf(k) + 1], 'base64').toString('utf-8')
    expect(args[args.indexOf('--resume') + 1]).toBe(sid)
    expect(dec('--prompt-b64')).toBe('繼續')
    expect(JSON.parse(dec('--extra-args-b64'))).toEqual(['--model', 'opus'])
    expect(args).not.toContain('--continue')
  })

  it('沒有 resume 時不帶 prompt', () => {
    const spawn = vi.fn()
    launch('C:\\proj', false, { spawn, node: NODE, wtPath: 'C:\\wt.exe', prompt: 'x' })
    expect(spawn.mock.calls[0][1]).not.toContain('--prompt-b64')
  })

  it('去掉結尾反斜線，磁碟機根目錄保留', () => {
    expect(normalizeFolder('C:\\proj\\')).toBe('C:\\proj')
    expect(normalizeFolder('C:\\proj\\\\')).toBe('C:\\proj')
    expect(normalizeFolder('C:\\')).toBe('C:\\')
    expect(normalizeFolder('C:/')).toBe('C:\\')
  })

  it.each(['C:\\my project\\a b', 'C:\\專案\\測試', 'C:\\R&D\\x & y'])(
    '路徑原樣傳入參數：%s',
    (folder) => {
      const spawn = vi.fn()
      launch(folder + '\\', false, { spawn, node: NODE, wtPath: 'C:\\wt.exe' })
      const args: string[] = spawn.mock.calls[0][1]
      expect(args[args.indexOf('-d') + 1]).toBe(folder)
      expect(args[args.indexOf('--cwd') + 1]).toBe(folder)
    }
  )
})

describe('launcher state / cmd 檔', () => {
  useTempEnv()

  it('activeRuns 清掉已結束者；restart 指令序號遞增', async () => {
    writeJsonAtomic(path.join(runsDir(), 'r1.state.json'), {
      run_id: 'r1',
      runner_pid: process.pid,
      claude_pid: null,
      state: 'running'
    })
    writeJsonAtomic(path.join(runsDir(), 'r2.state.json'), {
      run_id: 'r2',
      runner_pid: 0,
      state: 'running'
    })
    const runs = activeRuns()
    expect(runs.map((r) => r.run_id)).toEqual(['r1'])
    const fs = await import('node:fs')
    expect(fs.existsSync(path.join(runsDir(), 'r2.state.json'))).toBe(false)

    expect(await requestRestart(runs[0])).toBe(true)
    const cmd = (): { restart: string; seq: number } =>
      readJson(path.join(runsDir(), 'r1.cmd.json')) as { restart: string; seq: number }
    expect(cmd()).toEqual({ restart: 'pending', seq: 1 })
    releaseRestart(runs[0])
    expect(cmd()).toEqual({ restart: 'go', seq: 2 })
    releaseRestart(runs[0], { resume: 'sid', prompt: 'p', extraArgs: ['-x'] })
    expect(cmd()).toEqual({ restart: 'go', seq: 3, resume: 'sid', prompt: 'p', extra_args: ['-x'] })
    abortRestart(runs[0])
    expect(cmd()).toEqual({ restart: 'abort', seq: 4 })
  })
})
