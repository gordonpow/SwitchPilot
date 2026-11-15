// 在 Windows Terminal 中執行，託管 claude；主程式透過 cmd 檔要求重啟。
// 用法：runner.cjs --run-id ID --cwd DIR [--continue] [--resume ID] [--prompt-b64 B] [--extra-args-b64 B]
//        [--claude PATH] [--no-pause] [--wait-timeout SEC]
import { resolveLanguage, setLanguage, t, resolveLanguageFromConfig } from '../shared/i18n'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import * as paths from '../core/paths'
import * as storage from '../core/storage'

interface Args {
  runId: string
  cwd: string
  cont: boolean
  resume: string | null
  prompt: string | null
  extraArgs: string[]
  claude: string | null
  noPause: boolean
  waitTimeout: number
}

const SESSION_RE = /^[0-9a-fA-F-]{36}$/

/** sessionId 格式不符時視為沒有 resume。 */
function validSessionId(v: unknown): string | null {
  return typeof v === 'string' && SESSION_RE.test(v) ? v : null
}

function fromB64(v: string | undefined): string {
  if (!v) return ''
  try {
    return Buffer.from(v, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

function parseStringArray(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return []
  try {
    const v = JSON.parse(text) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseArgs(argv: string[]): Args | null {
  const a: Args = {
    runId: '',
    cwd: '',
    cont: false,
    resume: null,
    prompt: null,
    extraArgs: [],
    claude: null,
    noPause: false,
    waitTimeout: 120
  }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--run-id') a.runId = argv[++i] ?? ''
    else if (k === '--cwd') a.cwd = argv[++i] ?? ''
    else if (k === '--continue') a.cont = true
    else if (k === '--resume') a.resume = validSessionId(argv[++i])
    else if (k === '--prompt-b64') a.prompt = fromB64(argv[++i]) || null
    else if (k === '--extra-args-b64') a.extraArgs = parseStringArray(fromB64(argv[++i]))
    else if (k === '--claude') a.claude = argv[++i] ?? null
    else if (k === '--no-pause') a.noPause = true
    else if (k === '--wait-timeout') a.waitTimeout = Number(argv[++i])
  }
  if (!a.runId || !a.cwd || !Number.isFinite(a.waitTimeout)) return null
  return a
}

const statePath = (id: string): string => path.join(paths.runsDir(), `${id}.state.json`)
const cmdPath = (id: string): string => path.join(paths.runsDir(), `${id}.cmd.json`)

function writeState(runId: string, cwd: string, state: string, claudePid: number | null = null): void {
  storage.writeJsonAtomic(statePath(runId), {
    run_id: runId,
    cwd,
    runner_pid: process.pid,
    claude_pid: claudePid,
    state,
    updated: Date.now() / 1000
  })
}

interface Cmd {
  restart: string
  resume: string | null
  prompt: string | null
  extraArgs: string[] | null
}

function readCmd(runId: string): Cmd | null {
  const d = storage.readJson(cmdPath(runId), null) as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || typeof d.restart !== 'string') return null
  return {
    restart: d.restart,
    resume: validSessionId(d.resume),
    prompt: typeof d.prompt === 'string' && d.prompt ? d.prompt : null,
    extraArgs: Array.isArray(d.extra_args)
      ? d.extra_args.filter((x): x is string => typeof x === 'string')
      : null
  }
}

function findClaude(): string | null {
  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean)
  for (const name of ['claude.exe', 'claude.cmd', 'claude.bat']) {
    for (const dir of dirs) {
      const p = path.join(dir.replace(/^"|"$/g, ''), name)
      try {
        if (fs.statSync(p).isFile()) return p
      } catch {
        /* 繼續找 */
      }
    }
  }
  return null
}

/** 組出啟動指令：.cjs／.js 用目前的 node 執行，.cmd／.bat 透過 cmd.exe。 */
function claudeArgv(claude: string): string[] {
  const lower = claude.toLowerCase()
  if (lower.endsWith('.cjs') || lower.endsWith('.js')) return [process.execPath, claude]
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) return ['cmd.exe', '/d', '/c', claude]
  return [claude]
}

const CMD_SPECIAL = /["%^&|<>]/

/** 組出 claude 之後的參數；.cmd／.bat 遇到特殊字元時降級為只帶 --resume。 */
function buildTail(
  claude: string,
  extra: string[],
  resume: string | null,
  prompt: string | null,
  cont: boolean
): string[] {
  if (!resume) return [...extra, ...(cont ? ['--continue'] : [])]
  const lower = claude.toLowerCase()
  const viaCmd = lower.endsWith('.cmd') || lower.endsWith('.bat')
  if (viaCmd && [...extra, ...(prompt ? [prompt] : [])].some((x) => CMD_SPECIAL.test(x))) {
    console.log(t('runner.cmdSpecial'))
    return ['--resume', resume]
  }
  return [...extra, '--resume', resume, ...(prompt ? [prompt] : [])]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function runClaude(argv: string[], cwd: string): { pid: number | undefined; done: Promise<boolean> } {
  const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', cwd })
  const done = new Promise<boolean>((resolve) => {
    child.on('exit', () => resolve(true))
    child.on('error', () => resolve(false))
  })
  return { pid: child.pid, done }
}

async function pause(): Promise<void> {
  console.log(t('runner.pressEnter'))
  await new Promise<void>((resolve) => {
    try {
      process.stdin.once('data', () => resolve())
      process.stdin.once('end', () => resolve())
      process.stdin.once('error', () => resolve())
      process.stdin.resume()
    } catch {
      resolve()
    }
  })
}

/** 依 config.json 的 language 設定介面語言；沒有檔案或欄位時視同 auto。 */
function initLanguage(): void {
  try {
    setLanguage(resolveLanguageFromConfig(storage.readJson(paths.configFile(), {})))
  } catch {
    setLanguage(resolveLanguage('auto'))
  }
}

async function main(): Promise<number> {
  initLanguage()
  const a = parseArgs(process.argv.slice(2))
  if (!a) {
    console.log(t('runner.badArgs'))
    return 2
  }
  const claude = a.claude || findClaude()
  if (!claude) {
    console.log(t('runner.claudeMissing'))
    if (!a.noPause) await pause()
    return 1
  }

  let cont = a.cont
  let tail = buildTail(claude, a.extraArgs, a.resume, a.prompt, cont)
  for (;;) {
    const argv = [...claudeArgv(claude), ...tail]
    const { pid, done } = runClaude(argv, a.cwd)
    writeState(a.runId, a.cwd, 'running', pid ?? null)
    const started = await done
    if (!started) {
      console.log(t('runner.startFailed'))
      writeState(a.runId, a.cwd, 'exited')
      return 1
    }

    let cmd = readCmd(a.runId)
    if (cmd?.restart === 'pending') {
      writeState(a.runId, a.cwd, 'waiting')
      const deadline = Date.now() + a.waitTimeout * 1000
      while (cmd?.restart === 'pending' && Date.now() < deadline) {
        await sleep(500)
        cmd = readCmd(a.runId)
      }
      if (cmd?.restart !== 'go') {
        console.log(t('runner.aborted'))
        writeState(a.runId, a.cwd, 'exited')
        return 0
      }
    } else if (cmd?.restart !== 'go') {
      writeState(a.runId, a.cwd, 'exited')
      return 0
    }

    try {
      fs.rmSync(cmdPath(a.runId), { force: true })
    } catch {
      /* 忽略 */
    }
    const extra = cmd.extraArgs ?? a.extraArgs
    cont = true
    tail = buildTail(claude, extra, cmd.resume, cmd.prompt, true)
    console.log(
      cmd.resume
        ? t('runner.restartResume')
        : t('runner.restartContinue')
    )
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(t('runner.error'), e instanceof Error ? e.message : e)
    process.exit(1)
  }
)
