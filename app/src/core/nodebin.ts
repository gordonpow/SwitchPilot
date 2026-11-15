// 尋找系統 node 與安裝 scripts（*.cjs、*.ps1）到 binDir。不 import electron。
import { t } from '../shared/i18n'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as paths from './paths'
import * as storage from './storage'

const DEFAULT_NODE = 'C:\\Program Files\\nodejs\\node.exe'

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 依序：環境變數 CLAUDE_SWITCHER_NODE、`where node` 第一行、預設安裝路徑。找不到回傳 null。 */
export function findNode(): string | null {
  const env = process.env.CLAUDE_SWITCHER_NODE
  if (env && isFile(env)) return env
  try {
    const out = execFileSync('where', ['node'], {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000
    })
    const first = out.split(/\r?\n/).find((l) => l.trim())
    if (first && isFile(first.trim())) return first.trim()
  } catch {
    /* 忽略 */
  }
  return isFile(DEFAULT_NODE) ? DEFAULT_NODE : null
}

/**
 * scripts 來源目錄：參數 > 環境變數 CLAUDE_SWITCHER_SCRIPTS_DIR >
 * 打包後 process.resourcesPath/scripts > 開發時 <cwd>/resources/scripts。
 */
export function scriptsSourceDir(override?: string): string {
  if (override) return override
  const env = process.env.CLAUDE_SWITCHER_SCRIPTS_DIR
  if (env) return env
  const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (res) {
    const packed = path.join(res, 'scripts')
    if (fs.existsSync(packed)) return packed
  }
  return path.join(process.cwd(), 'resources', 'scripts')
}

function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

export interface InstallScriptsResult {
  copied: string[]
  unchanged: string[]
}

/** 把來源目錄的 *.cjs 與 *.ps1 複製到 binDir；SHA-256 相同就不複製，不同才以暫存檔 + rename 取代。 */
export function installScripts(
  opts: { sourceDir?: string; binDir?: string } = {}
): InstallScriptsResult {
  const src = scriptsSourceDir(opts.sourceDir)
  const dst = opts.binDir ?? paths.binDir()
  let names: string[]
  try {
    names = fs.readdirSync(src).filter((n) => n.endsWith('.cjs') || n.endsWith('.ps1'))
  } catch {
    throw new Error(t('err.scriptsSrcMissing', { src }))
  }
  fs.mkdirSync(dst, { recursive: true })
  const result: InstallScriptsResult = { copied: [], unchanged: [] }
  for (const name of names) {
    const data = fs.readFileSync(path.join(src, name))
    const target = path.join(dst, name)
    let same = false
    try {
      same = sha256(fs.readFileSync(target)) === sha256(data)
    } catch {
      same = false
    }
    if (same) {
      result.unchanged.push(name)
    } else {
      storage.writeFileAtomic(target, data)
      result.copied.push(name)
    }
  }
  return result
}
