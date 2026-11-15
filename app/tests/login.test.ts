import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LoginError, LoginSession, cleanupStale, openBrowserCmdContent } from '../src/core/login'
import * as paths from '../src/core/paths'
import { useTempEnv, login } from './helpers'

const FAKE = path.join(__dirname, 'fixtures', 'fake-login.cjs')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('LoginSession', () => {
  const root = useTempEnv()
  const sessions: LoginSession[] = []

  afterEach(() => {
    for (const s of sessions.splice(0)) s.cleanup()
  })

  function session(mode: string, browser: 'chrome' | 'edge' | 'default' = 'chrome'): LoginSession {
    const s = new LoginSession({
      claudeCmd: [process.execPath, FAKE, mode],
      node: process.execPath,
      binDir: path.join(root(), 'bin'),
      browser
    })
    sessions.push(s)
    return s
  }

  async function wait(s: LoginSession, timeout = 15000): Promise<string> {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (s.poll() !== 'running') return s.poll()
      await sleep(50)
    }
    return s.poll()
  }

  it('假登入成功，登入前後真實憑證與 claude.json 不變', async () => {
    login('real', 'real-uuid', 'real@x')
    const before = [paths.credFile(), paths.claudeJson()].map((f) => fs.readFileSync(f, 'utf-8'))

    const s = session('ok')
    s.start()
    const cmd = fs.readFileSync(path.join(s.dir!, 'open_browser.cmd'), 'utf-8')
    expect(cmd).toContain('browser-open.cjs')
    expect(cmd.startsWith('@chcp 65001 >nul\r\n')).toBe(true)
    expect(await wait(s)).toBe('done')
    const { creds, account } = s.result()
    expect(creds).toHaveProperty('claudeAiOauth')
    expect(account.emailAddress).toBe('fake@x')
    await sleep(300)
    expect(s.loginUrl()).toBe('https://example.test/fallback?x=1')
    fs.writeFileSync(path.join(s.dir!, 'browser_url.txt'), 'https://real/url', 'utf-8')
    expect(s.loginUrl()).toBe('https://real/url')
    const dir = s.dir!
    s.cleanup()
    expect(fs.existsSync(dir)).toBe(false)

    const after = [paths.credFile(), paths.claudeJson()].map((f) => fs.readFileSync(f, 'utf-8'))
    expect(after).toEqual(before)
  })

  it('子程序環境變數含 BROWSER 與 SWITCHPILOT_BROWSER', () => {
    let seen: NodeJS.ProcessEnv = {}
    const s = new LoginSession({
      claudeCmd: [process.execPath, FAKE, 'sleep'],
      node: process.execPath,
      binDir: path.join(root(), 'bin'),
      browser: 'edge',
      spawn: (c, a, o) => {
        seen = o.env ?? {}
        return require('node:child_process').spawn(c, a, o)
      }
    })
    sessions.push(s)
    s.start()
    expect(seen.SWITCHPILOT_BROWSER).toBe('edge')
    expect(seen.CLAUDE_CONFIG_DIR).toBe(s.dir)
    expect(seen.BROWSER).toBe(path.join(s.dir!, 'open_browser.cmd'))
    return s.cancel()
  })

  it('失敗', async () => {
    const s = session('fail')
    s.start()
    expect(await wait(s)).toBe('failed')
    await sleep(300)
    expect(s.lastLines()).toContain('login failed')
  })

  it('缺憑證檔丟 LoginError 並列出目錄內容', async () => {
    const s = session('nocreds')
    s.start()
    expect(await wait(s)).toBe('done')
    expect(() => s.result()).toThrow(LoginError)
    expect(() => s.result()).toThrow(/other\.txt/)
  })

  it('cancel 刪除暫存目錄並結束程序', async () => {
    const s = session('sleep')
    s.start()
    expect(s.poll()).toBe('running')
    const dir = s.dir!
    await s.cancel()
    expect(fs.existsSync(dir)).toBe(false)
    expect(s.poll()).not.toBe('running')
  })

  it('找不到 claudeCmd 的指令時 poll 為 failed', async () => {
    const s = new LoginSession({
      claudeCmd: [path.join(root(), 'no-such-claude.exe')],
      node: process.execPath,
      binDir: path.join(root(), 'bin')
    })
    sessions.push(s)
    s.start()
    expect(await wait(s)).toBe('failed')
  })

  it('open_browser.cmd 內容跳脫 %', () => {
    const text = openBrowserCmdContent('C:\\100%\\node.exe', 'C:\\u%USERNAME%\\bin')
    expect(text).toBe(
      '@chcp 65001 >nul\r\n' +
        '@"C:\\100%%\\node.exe" "C:\\u%%USERNAME%%\\bin\\browser-open.cjs" %*\r\n'
    )
  })

  it('open_browser.cmd 實際寫入檔含 %% 跳脫', () => {
    const s = new LoginSession({
      claudeCmd: [process.execPath, FAKE, 'sleep'],
      node: process.execPath,
      binDir: path.join(root(), 'b%IN%')
    })
    sessions.push(s)
    s.start()
    const cmd = fs.readFileSync(path.join(s.dir!, 'open_browser.cmd'), 'utf-8')
    expect(cmd).toContain('b%%IN%%')
    expect(cmd).toContain(' %*')
    return s.cancel()
  })

  it('cleanupStale 刪除 login 目錄', () => {
    fs.mkdirSync(path.join(paths.loginDir(), 'abc'), { recursive: true })
    cleanupStale()
    expect(fs.existsSync(paths.loginDir())).toBe(false)
  })
})
