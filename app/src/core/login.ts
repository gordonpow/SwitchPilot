// 以瀏覽器登入新增帳號：在暫存的 CLAUDE_CONFIG_DIR 下執行 `claude auth login`。不 import electron。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import * as paths from './paths'
import { findNode } from './nodebin'
import { killTree, whichFirst } from './procutil'
import { readJson, sleepSync } from './storage'

const URL_RE = /https:\/\/\S+/

export class LoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoginError'
  }
}

export type LoginBrowser = 'chrome' | 'edge' | 'default'
export type LoginPoll = 'running' | 'done' | 'failed'

export interface LoginOptions {
  /** 完整指令（含 auth login 參數）；未指定時在 PATH 找 claude。 */
  claudeCmd?: string[]
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  node?: string
  binDir?: string
  browser?: LoginBrowser
}

/** 批次檔中 % 要寫成 %%。 */
export function escapeCmdPercent(s: string): string {
  return s.replace(/%/g, '%%')
}

export function openBrowserCmdContent(node: string, binDir: string): string {
  const script = path.join(binDir, 'browser-open.cjs')
  return (
    '@chcp 65001 >nul\r\n' + `@"${escapeCmdPercent(node)}" "${escapeCmdPercent(script)}" %*\r\n`
  )
}

function findClaude(): string[] | null {
  const exe = whichFirst(['claude.exe', 'claude.cmd', 'claude.bat'])
  if (!exe) return null
  if (/\.(cmd|bat)$/i.test(exe)) return ['cmd.exe', '/d', '/c', exe, 'auth', 'login']
  return [exe, 'auth', 'login']
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

export class LoginSession {
  dir: string | null = null
  proc: ChildProcess | null = null
  startedAt = 0
  private lines: string[] = []
  private fallbackUrl: string | null = null
  private exitCode: number | undefined = undefined
  private spawnFailed = false

  constructor(private opts: LoginOptions = {}) {}

  start(): void {
    let cmd = this.opts.claudeCmd
    if (!cmd) {
      cmd = findClaude() ?? undefined
      if (!cmd) throw new LoginError('找不到 claude 指令')
    }
    const node = this.opts.node ?? findNode()
    if (!node) throw new LoginError('找不到 Node.js')
    const binDir = this.opts.binDir ?? paths.binDir()
    const d = path.join(paths.loginDir(), randomBytes(4).toString('hex'))
    fs.mkdirSync(d, { recursive: true })
    this.dir = d
    try {
      const bat = path.join(d, 'open_browser.cmd')
      fs.writeFileSync(bat, openBrowserCmdContent(node, binDir), 'utf-8')
      const env = {
        ...process.env,
        CLAUDE_CONFIG_DIR: d,
        BROWSER: bat,
        CLAUDE_SWITCHER_LOGIN_DIR: d,
        CLAUDE_SWITCHER_BROWSER: this.opts.browser ?? 'chrome'
      }
      const sp = this.opts.spawn ?? (nodeSpawn as unknown as NonNullable<LoginOptions['spawn']>)
      const proc = sp(cmd[0], cmd.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: d,
        windowsHide: true
      })
      this.proc = proc
      proc.on('exit', (code) => {
        this.exitCode = code ?? 1
      })
      proc.on('error', () => {
        this.spawnFailed = true
        if (this.exitCode === undefined) this.exitCode = 1
      })
      this.attach(proc.stdout)
      this.attach(proc.stderr)
      proc.stdin?.on('error', () => {})
    } catch (e) {
      this.cleanup()
      if (e instanceof LoginError) throw e
      throw new LoginError(`無法啟動登入程序：${(e as Error).message}`)
    }
    this.startedAt = Date.now() / 1000
  }

  private attach(stream: NodeJS.ReadableStream | null | undefined): void {
    if (!stream) return
    let buf = ''
    const push = (line: string): void => {
      this.lines.push(line)
      if (this.fallbackUrl === null) {
        const m = URL_RE.exec(line)
        if (m) this.fallbackUrl = m[0]
      }
    }
    stream.setEncoding('utf-8')
    stream.on('data', (chunk: string | Buffer) => {
      buf += chunk.toString()
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      parts.forEach(push)
    })
    stream.on('end', () => {
      if (buf) push(buf)
      buf = ''
    })
    stream.on('error', () => {})
  }

  poll(): LoginPoll {
    if (!this.proc || this.spawnFailed) return 'failed'
    if (this.exitCode === undefined) return 'running'
    return this.exitCode === 0 ? 'done' : 'failed'
  }

  loginUrl(): string | null {
    if (this.dir) {
      try {
        const text = fs.readFileSync(path.join(this.dir, 'browser_url.txt'), 'utf-8').trim()
        if (text) return text
      } catch {
        /* 退回 stdout 抓到的網址 */
      }
    }
    return this.fallbackUrl
  }

  lastLines(n = 5): string[] {
    return this.lines.filter((l) => l.trim()).slice(-n)
  }

  /** 讀出登入結果；缺檔丟 LoginError。 */
  result(): { creds: Record<string, unknown>; account: Record<string, unknown> } {
    const d = this.dir
    let names = ''
    try {
      if (d) names = fs.readdirSync(d).sort().join(', ')
    } catch {
      /* 忽略 */
    }
    const creds = d ? readJson(path.join(d, '.credentials.json'), null) : null
    const cj = d ? readJson(path.join(d, '.claude.json'), null) : null
    const acct = isObj(cj) ? cj.oauthAccount : null
    if (
      !isObj(creds) ||
      !('claudeAiOauth' in creds) ||
      !isObj(acct) ||
      Object.keys(acct).length === 0
    ) {
      throw new LoginError(
        '登入完成但讀不到憑證或帳號資訊。暫存目錄內的檔案：' + (names || '（空）')
      )
    }
    return { creds, account: acct }
  }

  async cancel(): Promise<void> {
    if (this.proc && this.exitCode === undefined && this.proc.pid) {
      await killTree(this.proc.pid)
      // 等 exit 事件送達，讓 poll() 反映結束狀態（最多 1 秒）
      for (let i = 0; i < 20 && this.exitCode === undefined; i++) {
        await new Promise((r) => setTimeout(r, 50))
      }
    }
    this.cleanup()
  }

  cleanup(): void {
    try {
      this.proc?.stdin?.end()
    } catch {
      /* 忽略 */
    }
    const d = this.dir
    if (!d) return
    for (let i = 0; i < 3; i++) {
      fs.rmSync(d, { recursive: true, force: true })
      if (!fs.existsSync(d)) return
      sleepSync(300)
    }
  }
}

/** 刪除 login/ 下殘留的目錄（上次異常結束）。 */
export function cleanupStale(): void {
  fs.rmSync(paths.loginDir(), { recursive: true, force: true })
}
