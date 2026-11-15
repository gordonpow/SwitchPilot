import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as accounts from '../src/core/accounts'
import { eventsDir, pidmapDir, usageDir } from '../src/core/paths'
import { readJson } from '../src/core/storage'
import { extractUrl, openUrl } from '../src/scripts/browser-open'
import { login, useTempEnv } from './helpers'

const SCRIPTS = path.resolve(__dirname, '..', 'resources', 'scripts')
const cjs = (n: string): string => path.join(SCRIPTS, `${n}.cjs`)

// 預設停用 pidmap 查詢，測試不呼叫真的 PowerShell
function run(name: string, args: string[], input: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cjs(name), ...args], {
    input,
    encoding: 'utf-8',
    env: { ...process.env, SWITCHPILOT_DISABLE_PIDMAP: '1', ...env }
  })
}

describe('打包結果', () => {
  it.each(['statusline', 'hook', 'runner', 'browser-open'])('%s.cjs 不含 electron 且小於 300 KB', (n) => {
    const file = cjs(n)
    expect(fs.existsSync(file)).toBe(true)
    const text = fs.readFileSync(file, 'utf-8')
    expect(text).not.toMatch(/require\(["']electron["']\)/)
    expect(fs.statSync(file).size).toBeLessThan(300 * 1024)
  })

  it('hello.cjs 已移除', () => {
    expect(fs.existsSync(path.join(path.resolve(__dirname, '..'), 'src', 'scripts', 'hello.ts'))).toBe(false)
  })
})

describe('statusline.cjs', () => {
  useTempEnv()

  it('已儲存帳號：輸出狀態列並寫用量檔', () => {
    login('t1', 'u1', 'a@x')
    const slot = accounts.saveCurrent('主帳號')
    const input = JSON.stringify({
      session_id: 'sess/1',
      cwd: 'C:\\x',
      rate_limits: {
        five_hour: { used_percentage: 42.4, resets_at: 5000 },
        seven_day: { used_percentage: 10, resets_at: 9000 }
      }
    })
    const r = run('statusline', [], input)
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('[主帳號] 5h 42% · 7d 10%')
    const rec = readJson(path.join(usageDir(), 'sess_1.json')) as Record<string, any>
    expect(rec.slot_id).toBe(slot.id)
    expect(rec.five_hour).toEqual({ used_percentage: 42.4, resets_at: 5000 })
    expect(rec.cwd).toBe('C:\\x')
  })

  it('context_window 寫入 context；缺欄位為 null，整個缺少為 null', () => {
    run(
      'statusline',
      [],
      JSON.stringify({
        session_id: 'c1',
        context_window: { used_percentage: 63.5, total_input_tokens: 127000, context_window_size: 200000 }
      })
    )
    const a = readJson(path.join(usageDir(), 'c1.json')) as Record<string, any>
    expect(a.context).toEqual({ used_percentage: 63.5, total_input_tokens: 127000, context_window_size: 200000 })

    run('statusline', [], JSON.stringify({ session_id: 'c2', context_window: { used_percentage: 10 } }))
    const b = readJson(path.join(usageDir(), 'c2.json')) as Record<string, any>
    expect(b.context).toEqual({ used_percentage: 10, total_input_tokens: null, context_window_size: null })

    run('statusline', [], JSON.stringify({ session_id: 'c3' }))
    const c = readJson(path.join(usageDir(), 'c3.json')) as Record<string, any>
    expect(c.context).toBeNull()
  })

  it('未儲存帳號且無 rate_limits', () => {
    const r = run('statusline', [], JSON.stringify({ session_id: 's' }))
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('[未儲存] 5h -- · 7d --')
    const rec = readJson(path.join(usageDir(), 's.json')) as Record<string, any>
    expect(rec.slot_id).toBeNull()
    expect(rec.five_hour).toBeNull()
  })

  it('SWITCHPILOT_LANG=en 且帳號未儲存：輸出英文字樣', () => {
    const r = run('statusline', [], JSON.stringify({ session_id: 's-en' }), { SWITCHPILOT_LANG: 'en' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('[Unsaved] 5h -- · 7d --')
  })

  it('停用查詢時不寫 pidmap 以外也不會壞：有 session 仍寫失敗標記', () => {
    run('statusline', [], JSON.stringify({ session_id: 's9', cwd: 'C:/x' }))
    const m = readJson(path.join(pidmapDir(), 's9.json')) as Record<string, any>
    expect(m.claude_pid).toBeNull()
    expect(m.session_id).toBe('s9')
  })

  it('claude sessions 目錄存在時不做 pidmap 查詢', () => {
    const root = process.env.SWITCHPILOT_CLAUDE_HOME as string
    fs.mkdirSync(path.join(root, 'sessions'), { recursive: true })
    const fake = path.join(__dirname, 'fixtures', 'fake-procs.cjs')
    const r = run('statusline', [], JSON.stringify({ session_id: 'sn', cwd: 'C:/x' }), {
      SWITCHPILOT_DISABLE_PIDMAP: '',
      SWITCHPILOT_PIDMAP_CMD: fake
    })
    expect(r.status).toBe(0)
    expect(fs.existsSync(path.join(pidmapDir(), 'sn.json'))).toBe(false)
    expect(fs.existsSync(path.join(usageDir(), 'sn.json'))).toBe(true)
  })

  it('pidmap：假查詢找到 claude，寫入 claude_pid／created／shell', () => {
    const fake = path.join(__dirname, 'fixtures', 'fake-procs.cjs')
    const input = JSON.stringify({ session_id: 'sp', cwd: 'C:/x' })
    const r = run('statusline', [], input, { SWITCHPILOT_DISABLE_PIDMAP: '', SWITCHPILOT_PIDMAP_CMD: fake })
    expect(r.status).toBe(0)
    const m = readJson(path.join(pidmapDir(), 'sp.json')) as Record<string, any>
    expect(m).toMatchObject({
      session_id: 'sp',
      cwd: 'C:/x',
      claude_pid: 4002,
      claude_created: 222,
      shell_pid: 4001,
      shell_name: 'powershell.exe'
    })
    expect(JSON.stringify(m)).not.toMatch(/ppid/)
  })

  it('pidmap：claude 仍存活時第二次執行不再查詢（假查詢腳本計數）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-fakeq-'))
    try {
      const counter = path.join(dir, 'count.txt')
      const aliveClaude = process.pid // 用測試程序本身當「存活的 claude」
      const script = path.join(dir, 'count-procs.cjs')
      fs.writeFileSync(
        script,
        [
          "const fs = require('node:fs')",
          `fs.appendFileSync(${JSON.stringify(counter)}, 'x')`,
          'const start = Number(process.env.SWITCHPILOT_PIDMAP_START_PID)',
          'process.stdout.write(JSON.stringify([',
          `  { ProcessId: ${aliveClaude}, ParentProcessId: 1, Name: 'claude.exe', CommandLine: 'claude.exe', Created: 222 },`,
          `  { ProcessId: start, ParentProcessId: ${aliveClaude}, Name: 'node.exe', CommandLine: 'node statusline.cjs', Created: 444 }`,
          ']))'
        ].join('\n')
      )
      const input = JSON.stringify({ session_id: 'sq', cwd: 'C:/x' })
      const env = { SWITCHPILOT_DISABLE_PIDMAP: '', SWITCHPILOT_PIDMAP_CMD: script }
      expect(run('statusline', [], input, env).status).toBe(0)
      expect(fs.readFileSync(counter, 'utf-8')).toBe('x')
      expect((readJson(path.join(pidmapDir(), 'sq.json')) as Record<string, any>).claude_pid).toBe(aliveClaude)
      expect(run('statusline', [], input, env).status).toBe(0)
      expect(fs.readFileSync(counter, 'utf-8')).toBe('x') // 沒有再查詢
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('壞輸入不丟例外：exit 0 並輸出 [switcher]', () => {
    const r = run('statusline', [], '{壞掉')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('[switcher]')
  })

  it('空輸入視為空物件', () => {
    const r = run('statusline', [], '')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('[未儲存] 5h -- · 7d --')
  })
})

describe('hook.cjs', () => {
  useTempEnv()

  const events = (): Record<string, any>[] =>
    fs
      .readdirSync(eventsDir())
      .sort()
      .map((n) => readJson(path.join(eventsDir(), n)) as Record<string, any>)

  it('stopfailure 寫事件檔', () => {
    login('t1', 'u1', 'a@x')
    const slot = accounts.saveCurrent('A')
    const r = run('hook', ['stopfailure'], JSON.stringify({ session_id: 's1', cwd: 'C:\\x', error: 'rate_limit' }))
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    const [e] = events()
    expect(e).toMatchObject({ kind: 'stopfailure', session_id: 's1', cwd: 'C:\\x', error: 'rate_limit', slot_id: slot.id })
    expect(typeof e.ts).toBe('number')
  })

  it('stop 事件 error 為 null，檔名可排序', () => {
    run('hook', ['stop'], JSON.stringify({ session_id: 's1' }))
    run('hook', ['stop'], '')
    const list = events()
    expect(list).toHaveLength(2)
    expect(list[0].error).toBeNull()
    expect(list[0].slot_id).toBeNull()
    const names = fs.readdirSync(eventsDir())
    expect(names.every((n) => /^\d{19}-[0-9a-f]{4}\.json$/.test(n))).toBe(true)
  })

  it('prompt 事件寫檔，不記 ppid', () => {
    run('hook', ['prompt'], JSON.stringify({ session_id: 's1', cwd: 'C:/x' }))
    const [e] = events()
    expect(e).toMatchObject({ kind: 'prompt', session_id: 's1', error: null })
    expect('ppid' in e).toBe(false)
  })

  it('未知種類不寫檔；壞輸入 exit 0', () => {
    expect(run('hook', ['other'], '{}').status).toBe(0)
    expect(fs.existsSync(eventsDir())).toBe(false)
    expect(run('hook', ['stop'], '{壞').status).toBe(0)
    expect(fs.existsSync(eventsDir())).toBe(false)
  })
})

describe('browser-open', () => {
  it('extractUrl', () => {
    expect(extractUrl(['"https://a.b/c?d=1&e=2"'])).toBe('https://a.b/c?d=1&e=2')
    expect(extractUrl(['https://a.b/c?d=1', '&e=2'])).toBe('https://a.b/c?d=1 &e=2')
    expect(extractUrl(['  http://localhost:1/x '])).toBe('http://localhost:1/x')
    expect(extractUrl([])).toBeNull()
    expect(extractUrl(['file:///c:/x'])).toBeNull()
  })

  it('chrome：--incognito', () => {
    const spawn = vi.fn()
    expect(openUrl('https://u', { browser: 'chrome', spawn, chrome: 'C:/chrome.exe', edge: null })).toBe('chrome')
    expect(spawn.mock.calls[0][0]).toBe('C:/chrome.exe')
    expect(spawn.mock.calls[0][1]).toEqual(['--incognito', 'https://u'])
  })

  it('edge：--inprivate', () => {
    const spawn = vi.fn()
    expect(openUrl('https://u', { browser: 'edge', spawn, chrome: 'C:/chrome.exe', edge: 'C:/msedge.exe' })).toBe('edge')
    expect(spawn.mock.calls[0][0]).toBe('C:/msedge.exe')
    expect(spawn.mock.calls[0][1]).toEqual(['--inprivate', 'https://u'])
  })

  it('chrome 找不到退到 edge', () => {
    const spawn = vi.fn()
    expect(openUrl('https://u', { browser: 'chrome', spawn, chrome: null, edge: 'C:/msedge.exe' })).toBe('edge')
  })

  it('default：cmd /c start，網址整段加引號', () => {
    const spawn = vi.fn()
    const url = 'https://a.b/c?d=1&e=2'
    expect(openUrl(url, { browser: 'default', spawn, chrome: 'C:/chrome.exe', edge: 'C:/msedge.exe' })).toBe('default')
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('cmd.exe')
    expect(args).toEqual(['/d', '/s', '/c', `start "" "${url}"`])
    expect(opts.windowsVerbatimArguments).toBe(true)
    expect(opts.detached).toBe(true)
  })

  it('全部找不到時用預設瀏覽器', () => {
    const spawn = vi.fn()
    expect(openUrl('https://u', { browser: 'chrome', spawn, chrome: null, edge: null })).toBe('default')
  })
})

describe('build-scripts', () => {
  it('inject.ps1 原樣複製到 resources/scripts', () => {
    const root = path.resolve(__dirname, '..')
    const a = fs.readFileSync(path.join(root, 'src', 'scripts', 'inject.ps1'))
    const b = fs.readFileSync(path.join(root, 'resources', 'scripts', 'inject.ps1'))
    expect(b.equals(a)).toBe(true)
  })
})
