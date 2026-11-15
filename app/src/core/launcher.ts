// 主程式端：啟動 runner、下重啟指令。不 import electron。
import { t } from '../shared/i18n'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import * as paths from './paths'
import { findNode } from './nodebin'
import { killTree, pidAlive, whichFirst } from './procutil'
import { readJson, writeJsonAtomic } from './storage'

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions
) => { unref?: () => void; on?: (ev: string, cb: (...a: unknown[]) => void) => unknown } | void

export interface LaunchOptions {
  spawn?: SpawnFn
  /** undefined：自動尋找；null：視為找不到 wt.exe。 */
  wtPath?: string | null
  node?: string
  binDir?: string
  /** 以 --resume 接續指定 session（格式由 runner 驗證）。 */
  resume?: string
  prompt?: string
  /** claude 的原始選項，接在執行檔之後、--resume 之前。 */
  extraArgs?: string[]
}

export interface RestartOptions {
  resume?: string
  prompt?: string
  extraArgs?: string[]
}

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64')

export interface RunState {
  run_id: string
  cwd?: string
  runner_pid?: number
  claude_pid?: number | null
  state?: string
  updated?: number
  [key: string]: unknown
}

function findWt(): string | null {
  const local = process.env.LOCALAPPDATA
  const extra = local ? path.join(local, 'Microsoft', 'WindowsApps') : ''
  return whichFirst(['wt.exe'], (process.env.PATH ?? '') + (extra ? ';' + extra : ''))
}

/** 去掉結尾反斜線／斜線（磁碟機根目錄如 C:\ 保留）。 */
export function normalizeFolder(folder: string): string {
  let f = folder
  while (f.length > 3 && /[\\/]$/.test(f)) f = f.slice(0, -1)
  if (/^[A-Za-z]:[\\/]$/.test(f)) f = f.slice(0, 2) + '\\'
  return f
}

/** 開新終端機執行 runner，回傳 run_id。資料夾含分號會丟錯。 */
export function launch(folder: string, cont = false, opts: LaunchOptions = {}): string {
  const dir = normalizeFolder(String(folder))
  if (dir.includes(';')) throw new Error(t('err.dirSemicolon'))
  const node = opts.node ?? findNode()
  if (!node) throw new Error(t('err.nodeNotFound'))
  const runId = randomBytes(4).toString('hex')
  const runner = path.join(opts.binDir ?? paths.binDir(), 'runner.cjs')
  const runnerCmd = [node, runner, '--run-id', runId, '--cwd', dir]
  if (cont) runnerCmd.push('--continue')
  if (opts.resume) {
    runnerCmd.push('--resume', opts.resume)
    if (opts.prompt) runnerCmd.push('--prompt-b64', b64(opts.prompt))
  }
  if (opts.extraArgs?.length) runnerCmd.push('--extra-args-b64', b64(JSON.stringify(opts.extraArgs)))

  const sp = opts.spawn ?? (nodeSpawn as unknown as SpawnFn)
  const wt = opts.wtPath === undefined ? findWt() : opts.wtPath
  const base: SpawnOptions = { env: { ...process.env }, detached: true, stdio: 'ignore' }
  let child
  if (wt) {
    child = sp(wt, ['-w', 'new', '--title', 'Claude (switcher)', '-d', dir, ...runnerCmd], base)
  } else {
    // cmd.exe 後備路徑會把資料夾交給 cmd 解析，含 shell 特殊字元就拒絕，避免命令注入
    if (/[&^%|<>"]/.test(dir)) {
      throw new Error(t('err.dirCmdChars'))
    }
    child = sp(
      'cmd.exe',
      ['/d', '/c', 'start', 'Claude (switcher)', '/D', dir, ...runnerCmd],
      { ...base, cwd: dir }
    )
  }
  if (child) {
    child.on?.('error', () => {})
    child.unref?.()
  }
  return runId
}

function cmdPath(runId: string): string {
  return path.join(paths.runsDir(), `${runId}.cmd.json`)
}

/** 目前還在跑的 runner；順便清掉已結束者的 state／cmd 檔。 */
export function activeRuns(): RunState[] {
  const runs: RunState[] = []
  const d = paths.runsDir()
  let names: string[]
  try {
    names = fs
      .readdirSync(d)
      .filter((n) => n.endsWith('.state.json'))
      .sort()
  } catch {
    return runs
  }
  for (const name of names) {
    const file = path.join(d, name)
    const st = readJson(file, null) as RunState | null
    if (st && typeof st === 'object' && st.state !== 'exited' && pidAlive(st.runner_pid)) {
      runs.push(st)
      continue
    }
    const runId = name.slice(0, -'.state.json'.length)
    for (const victim of [file, cmdPath(runId)]) {
      try {
        fs.unlinkSync(victim)
      } catch {
        /* 忽略 */
      }
    }
  }
  return runs
}

function writeCmd(run: RunState, restart: string, extra: Record<string, unknown> = {}): void {
  const file = cmdPath(run.run_id)
  const prev = readJson(file, null) as { seq?: number } | null
  const seq = prev && typeof prev === 'object' ? Number(prev.seq ?? 0) + 1 : 1
  writeJsonAtomic(file, { restart, seq, ...extra })
}

/** 寫 pending 並結束 claude；回傳 claude 是否已結束。 */
export async function requestRestart(run: RunState): Promise<boolean> {
  writeCmd(run, 'pending')
  const pid = run.claude_pid
  if (pid && pidAlive(pid)) return killTree(pid)
  return true
}

export function releaseRestart(run: RunState, opts: RestartOptions = {}): void {
  const extra: Record<string, unknown> = {}
  if (opts.resume) {
    extra.resume = opts.resume
    if (opts.prompt) extra.prompt = opts.prompt
  }
  if (opts.extraArgs) extra.extra_args = opts.extraArgs
  writeCmd(run, 'go', extra)
}

export function abortRestart(run: RunState): void {
  writeCmd(run, 'abort')
}
