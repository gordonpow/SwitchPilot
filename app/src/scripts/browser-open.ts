// 由 claude 透過 BROWSER 環境變數呼叫：以無痕模式開啟登入網址。絕不丟例外。
// CLAUDE_SWITCHER_BROWSER：chrome（--incognito）｜edge（--inprivate）｜default（預設瀏覽器）。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'

export type Browser = 'chrome' | 'edge' | 'default'

/** 合併參數、去掉前後引號與空白；不是 http 開頭回傳 null。 */
export function extractUrl(argv: string[]): string | null {
  const url = argv.join(' ').trim().replace(/^["']+|["']+$/g, '').trim()
  return url.toLowerCase().startsWith('http') ? url : null
}

function isFile(p: string | undefined | null): p is string {
  if (!p) return false
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function appPathFromRegistry(exe: string): string | null {
  for (const hive of ['HKLM', 'HKCU']) {
    try {
      const out = execFileSync(
        'reg',
        ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve'],
        { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
      )
      const m = /REG_SZ\s+(.+?)\s*$/m.exec(out)
      if (m && isFile(m[1].trim())) return m[1].trim()
    } catch {
      /* 找下一個 */
    }
  }
  return null
}

function fromEnvDirs(rel: string[], envs: string[]): string | null {
  for (const e of envs) {
    const base = process.env[e]
    if (!base) continue
    const p = path.join(base, ...rel)
    if (isFile(p)) return p
  }
  return null
}

export function findChrome(): string | null {
  return (
    appPathFromRegistry('chrome.exe') ??
    fromEnvDirs(
      ['Google', 'Chrome', 'Application', 'chrome.exe'],
      ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
    )
  )
}

export function findEdge(): string | null {
  return (
    appPathFromRegistry('msedge.exe') ??
    fromEnvDirs(
      ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
      ['ProgramFiles(x86)', 'ProgramFiles']
    )
  )
}

export type OpenSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions
) => { unref?: () => void; on?: (ev: string, cb: (...a: unknown[]) => void) => unknown } | void

export interface OpenOptions {
  browser?: Browser
  spawn?: OpenSpawn
  /** undefined：自動尋找；null：視為找不到。 */
  chrome?: string | null
  edge?: string | null
}

const DETACHED: SpawnOptions = { detached: true, stdio: 'ignore', windowsHide: false }

function run(sp: OpenSpawn, cmd: string, args: string[], extra: SpawnOptions = {}): void {
  const child = sp(cmd, args, { ...DETACHED, ...extra })
  if (child) {
    child.on?.('error', () => {})
    child.unref?.()
  }
}

/**
 * 開啟網址；回傳實際使用的瀏覽器。
 * 找不到指定的 chrome 時退而求其次用 edge（InPrivate），再不行用預設瀏覽器。
 */
export function openUrl(url: string, opts: OpenOptions = {}): Browser {
  const sp = opts.spawn ?? (nodeSpawn as unknown as OpenSpawn)
  const browser = opts.browser ?? 'chrome'
  if (browser === 'chrome') {
    const chrome = opts.chrome === undefined ? findChrome() : opts.chrome
    if (chrome) {
      run(sp, chrome, ['--incognito', url])
      return 'chrome'
    }
  }
  if (browser === 'chrome' || browser === 'edge') {
    const edge = opts.edge === undefined ? findEdge() : opts.edge
    if (edge) {
      run(sp, edge, ['--inprivate', url])
      return 'edge'
    }
  }
  if (url.includes('"')) throw new Error('網址含不安全字元')
  // cmd /c start "" "<url>"；網址整段以引號包住，避免 & 被 cmd 當成分隔
  run(sp, 'cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { windowsVerbatimArguments: true })
  return 'default'
}

function normalizeBrowser(v: string | undefined): Browser {
  const s = (v ?? '').toLowerCase()
  return s === 'edge' || s === 'default' ? s : 'chrome'
}

function main(): void {
  const url = extractUrl(process.argv.slice(2))
  if (!url) return
  const loginDir = process.env.CLAUDE_SWITCHER_LOGIN_DIR
  if (loginDir) {
    try {
      fs.writeFileSync(path.join(loginDir, 'browser_url.txt'), url, 'utf-8')
    } catch {
      /* 忽略 */
    }
  }
  try {
    openUrl(url, { browser: normalizeBrowser(process.env.CLAUDE_SWITCHER_BROWSER) })
  } catch {
    /* 絕不丟例外 */
  }
}

// 只在以 browser-open.cjs 直接執行時啟動（測試 import 時不執行）
if (/browser-open\.cjs$/i.test(process.argv[1] ?? '')) {
  try {
    main()
  } catch {
    /* 忽略 */
  }
  process.exitCode = 0
}
