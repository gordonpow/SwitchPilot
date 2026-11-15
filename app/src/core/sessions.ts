// 偵測執行中的 claude CLI 與其 session／父 shell，並產生接續指令。
// 純邏輯 + 可注入的程序列表；不 import electron（statusline 腳本也會打包本檔）。
import { execFile, execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as paths from './paths'

export interface ProcInfo {
  pid: number
  ppid: number
  name: string
  cmdline: string
  /** 程序建立時間（unix 毫秒）；未知為 0 */
  created: number
}
export type TurnState = 'busy' | 'idle' | 'interrupted' | 'unknown'
export type ShellKind = 'powershell' | 'cmd' | 'other'

/** pidmap 檔（statusline 寫入）的內容。claude_pid 為 null 表示查詢失敗的標記。 */
export interface PidmapRec {
  session_id: string
  cwd: string
  claude_pid: number | null
  claude_created: number
  shell_pid: number | null
  shell_name: string | null
  ts: number
}
/** Claude Code 自己維護的 <claudeHome>/sessions/<pid>.json（只保留需要的欄位）。 */
export interface ClaudeSessionRec {
  pid: number
  sessionId: string
  cwd: string
  /** procStart（Windows FILETIME）換算的 unix 毫秒 */
  procStartMs: number
  kind: string
  entrypoint: string
  status: string
  statusUpdatedAt: number
}
export interface TurnRec {
  kind: string
  ts: number
  /** stopfailure 事件的 error（例如 rate_limit）；其他事件為 null／未提供 */
  error?: string | null
}
export interface RunRef {
  runner_pid?: number | null
}
export interface DetectedCli {
  claudePid: number
  created: number
  sessionId: string | null
  cwd: string | null
  turn: TurnState
  shellPid: number | null
  shellKind: ShellKind
  /** false：-p／--print／SDK 等非互動模式，不處理 */
  interactive: boolean
  /** 祖先包含某個 active run 的 runner_pid */
  hosted: boolean
  cmdline: string // 只在記憶體中使用，不得寫入 log 或 AppState
}

export type ResumeMethod = 'runner' | 'inject' | 'newtab' | 'none'
export interface ResumePlan {
  method: ResumeMethod
  line?: string
  args: string[]
}

// ---- 程序查詢 ----

/** PowerShell 程序查詢指令（輸出 UTF-8 JSON；Created 為 unix 毫秒）。 */
export const PS_PROC_QUERY =
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
  'Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ ' +
  'ProcessId=[int]$_.ProcessId; ParentProcessId=[int]$_.ParentProcessId; Name=[string]$_.Name; ' +
  'CommandLine=[string]$_.CommandLine; ' +
  'Created=$(if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }) ' +
  '} } | ConvertTo-Json -Compress'

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-Command', PS_PROC_QUERY]

/**
 * 只沿祖先鏈查詢的 PowerShell 指令（最多 10 層）；找到 claude 後再多查父程序與祖父程序（npm shim）。
 * 輸出格式與 PS_PROC_QUERY 相同。statusline 每個 session 只查一次，不掃全部程序以免太慢。
 */
export function psAncestorQuery(startPid: number): string {
  const n = Math.trunc(Number(startPid))
  if (!Number.isInteger(n) || n <= 0) throw new Error('無效的起始 PID')
  return (
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
    `$id=${n};$list=@();$extra=-1;` +
    'for($i=0;$i -lt 10 -and $id -gt 0;$i++){' +
    '$p=Get-CimInstance Win32_Process -Filter "ProcessId=$id";if(-not $p){break};' +
    '$list+=[pscustomobject]@{ProcessId=[int]$p.ProcessId;ParentProcessId=[int]$p.ParentProcessId;' +
    'Name=[string]$p.Name;CommandLine=[string]$p.CommandLine;' +
    'Created=$(if($p.CreationDate){[DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds()}else{0})};' +
    'if($extra -ge 0){$extra--;if($extra -lt 0){break}}' +
    "elseif($p.Name -ieq 'claude.exe' -or ($p.Name -ieq 'node.exe' -and [string]$p.CommandLine -match 'claude-code')){$extra=1};" +
    '$id=[int]$p.ParentProcessId};' +
    'ConvertTo-Json -Compress -InputObject @($list)'
  )
}

/** 解析 PS_PROC_QUERY 的輸出；單一物件包成陣列，壞輸入回傳空陣列。 */
export function parseProcs(out: string): ProcInfo[] {
  try {
    const parsed: unknown = JSON.parse(out.replace(/^﻿/, '').trim())
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    const list: ProcInfo[] = []
    for (const r of arr) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const pid = Number(o.ProcessId)
      if (!Number.isInteger(pid) || pid <= 0) continue
      list.push({
        pid,
        ppid: Number(o.ParentProcessId) || 0,
        name: String(o.Name ?? ''),
        cmdline: o.CommandLine === null || o.CommandLine === undefined ? '' : String(o.CommandLine),
        created: Number(o.Created) || 0
      })
    }
    return list
  } catch {
    return []
  }
}

/** 取得程序列表；失敗回傳空陣列。 */
export function listProcesses(): Promise<ProcInfo[]> {
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell.exe',
        PS_ARGS,
        { windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => resolve(err ? [] : parseProcs(String(stdout)))
      )
    } catch {
      resolve([])
    }
  })
}

/**
 * 同步版（statusline 腳本用，逾時 5 秒）。
 * 環境變數：CLAUDE_SWITCHER_DISABLE_PIDMAP=1 直接回傳空陣列；
 * CLAUDE_SWITCHER_PIDMAP_CMD=<腳本路徑> 改用 node 執行該腳本取代 PowerShell
 * （腳本從 CLAUDE_SWITCHER_PIDMAP_START_PID 取得起點 pid，輸出同 PS_PROC_QUERY 的 JSON）。
 */
export function listProcessesSync(startPid: number): ProcInfo[] {
  if (process.env.CLAUDE_SWITCHER_DISABLE_PIDMAP === '1') return []
  try {
    const fake = process.env.CLAUDE_SWITCHER_PIDMAP_CMD
    const out = fake
      ? execFileSync(process.execPath, [fake], {
          windowsHide: true,
          timeout: 5000,
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_SWITCHER_PIDMAP_START_PID: String(startPid) },
          stdio: ['ignore', 'pipe', 'ignore']
        })
      : execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psAncestorQuery(startPid)], {
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 32 * 1024 * 1024,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        })
    return parseProcs(String(out))
  } catch {
    return []
  }
}

// ---- Claude 的 sessions 檔 ----

/** Windows FILETIME（100ns，自 1601-01-01）轉 unix 毫秒；格式錯回傳 null。 */
export function filetimeToMs(v: unknown): number | null {
  try {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'bigint') return null
    if (typeof v === 'number' && !Number.isSafeInteger(v)) return null
    const ft = BigInt(v)
    if (ft <= 0n) return null
    return Number(ft / 10000n - 11644473600000n)
  } catch {
    return null
  }
}

/** 是否存在 <claudeHome>/sessions 目錄（statusline 用來決定要不要查 pidmap）。 */
export function claudeSessionsDirExists(): boolean {
  try {
    return fs.statSync(path.join(paths.claudeHome(), 'sessions')).isDirectory()
  } catch {
    return false
  }
}

/**
 * 讀取 <claudeHome>/sessions/<數字>.json。只讀檔名完全符合者（.key 檔含 peerToken，絕不讀取）；
 * 欄位缺失或格式錯就略過；不保留 messagingSocketPath 等其他欄位。
 */
export function readClaudeSessions(): ClaudeSessionRec[] {
  const dir = path.join(paths.claudeHome(), 'sessions')
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: ClaudeSessionRec[] = []
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf-8').replace(/^\uFEFF/, '')
      const o: unknown = JSON.parse(raw)
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue
      const r = o as Record<string, unknown>
      const pid = Number(r.pid)
      const procStartMs = filetimeToMs(r.procStart)
      if (!Number.isInteger(pid) || pid <= 0 || procStartMs === null) continue
      if (typeof r.sessionId !== 'string' || !SESSION_ID_RE.test(r.sessionId)) continue
      if (typeof r.cwd !== 'string') continue
      out.push({
        pid,
        sessionId: r.sessionId,
        cwd: r.cwd,
        procStartMs,
        kind: typeof r.kind === 'string' ? r.kind : '',
        entrypoint: typeof r.entrypoint === 'string' ? r.entrypoint : '',
        status: typeof r.status === 'string' ? r.status : '',
        statusUpdatedAt: Number(r.statusUpdatedAt) || 0
      })
    } catch {
      /* 略過壞檔 */
    }
  }
  return out
}

// ---- 程序判定 ----

export function isClaudeProc(p: ProcInfo): boolean {
  const n = p.name.toLowerCase()
  const c = p.cmdline.toLowerCase()
  // Claude Desktop（Electron）的子程序與安裝路徑不是 CLI
  if (c.includes('--type=')) return false
  if (c.includes('\\anthropicclaude\\') || c.includes('\\windowsapps\\')) return false
  if (n === 'claude.exe') return true
  if (n !== 'node.exe') return false
  return c.includes('@anthropic-ai/claude-code') || c.includes('claude-code\\cli.js') || c.includes('claude-code/cli.js')
}

/** 從 pid 本身開始往上（含自己）找第一個 claude 程序；循環或找不到回傳 null。 */
export function claudeAncestor(
  pid: number,
  byPid: Map<number, ProcInfo>,
  maxDepth = 8
): ProcInfo | null {
  const seen = new Set<number>()
  let cur = byPid.get(pid)
  for (let i = 0; i < maxDepth && cur; i++) {
    if (seen.has(cur.pid)) return null
    seen.add(cur.pid)
    if (isClaudeProc(cur)) return cur
    cur = byPid.get(cur.ppid)
  }
  return null
}

/** claude 的父 shell；npm shim（node.exe 的父程序是執行 claude.cmd 的 cmd.exe）再往上一層。 */
export function shellOf(claude: ProcInfo, byPid: Map<number, ProcInfo>): ProcInfo | null {
  let parent = byPid.get(claude.ppid) ?? null
  if (
    parent &&
    claude.name.toLowerCase() === 'node.exe' &&
    parent.name.toLowerCase() === 'cmd.exe' &&
    parent.cmdline.toLowerCase().includes('claude.cmd')
  ) {
    parent = byPid.get(parent.ppid) ?? null
  }
  return parent
}

export function shellKindOf(name: string | null | undefined): ShellKind {
  const n = (name ?? '').toLowerCase()
  if (n === 'powershell.exe' || n === 'pwsh.exe') return 'powershell'
  if (n === 'cmd.exe') return 'cmd'
  return 'other'
}

/** statusline 用：從 startPid 往上找 claude，產生 pidmap 內容；找不到回傳 null。 */
export function buildPidmap(
  procs: ProcInfo[],
  startPid: number,
  sessionId: string,
  cwd: string,
  now: number
): PidmapRec | null {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const claude = claudeAncestor(startPid, byPid, 12)
  if (!claude) return null
  const shell = shellOf(claude, byPid)
  return {
    session_id: sessionId,
    cwd,
    claude_pid: claude.pid,
    claude_created: claude.created,
    shell_pid: shell ? shell.pid : null,
    shell_name: shell ? shell.name : null,
    ts: now
  }
}

// ---- 命令列 ----

/** 以 Windows 命令列規則切 token。 */
export function tokenize(cmdline: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let inQ = false
  let i = 0
  const s = cmdline
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      let n = 0
      while (s[i] === '\\') {
        n++
        i++
      }
      if (s[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2))
        if (n % 2 === 1) {
          cur += '"'
          i++
        }
      } else {
        cur += '\\'.repeat(n)
      }
      has = true
      continue
    }
    if (ch === '"') {
      inQ = !inQ
      has = true
      i++
      continue
    }
    if (!inQ && (ch === ' ' || ch === '\t')) {
      if (has) out.push(cur)
      cur = ''
      has = false
      i++
      continue
    }
    cur += ch
    has = true
    i++
  }
  if (has) out.push(cur)
  return out
}

const NON_INTERACTIVE = new Set(['-p', '--print', '--input-format', '--output-format', '--sdk-url'])

/** 命令列是否為互動模式（沒有 -p／--print／--input-format／--output-format／--sdk-url）。 */
export function isInteractive(cmdline: string): boolean {
  return !tokenize(cmdline).some((t) => NON_INTERACTIVE.has(t.split('=')[0]))
}

const VALUED = new Set([
  '--model',
  '--permission-mode',
  '--add-dir',
  '--allowedTools',
  '--allowed-tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--mcp-config',
  '--settings',
  '--agent',
  '--append-system-prompt',
  '--system-prompt',
  '--fallback-model',
  '--effort',
  '--plugin-dir',
  '--setting-sources',
  '--permission-prompt-tool',
  '--max-turns',
  '--betas',
  '--teammate-mode',
  '--agents',
  '--name',
  '-n',
  '--tools',
  '--file',
  '--worktree',
  '-w',
  '--max-budget-usd',
  '--json-schema',
  '--append-system-prompt-file',
  '--system-prompt-file'
])
/** 已知不需值的旗標：保留，且不吃後面的 token */
const BOOLEAN_FLAGS = new Set([
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--verbose',
  '--debug',
  '--ide',
  '--strict-mcp-config',
  '--mcp-debug',
  '--chrome',
  '--no-chrome',
  '--bare'
])
const VARIADIC = new Set([
  '--add-dir',
  '--allowedTools',
  '--allowed-tools',
  '--disallowedTools',
  '--disallowed-tools',
  '--mcp-config',
  '--betas',
  '--plugin-dir'
])
const DROP_FLAGS = new Set(['-c', '--continue', '--fork-session', '-p', '--print'])

/** 由原命令列產生 claude 的參數（不含執行檔）：保留原選項，改成 --resume <id> [prompt]。 */
export function resumeArgs(cmdline: string, sessionId: string, prompt: string | null): string[] {
  let tokens = tokenize(cmdline)
  const first = (tokens[0] ?? '').toLowerCase()
  const isNode = /(^|[\\/])node(\.exe)?$/.test(first)
  tokens = tokens.slice(1)
  if (isNode) {
    const idx = tokens.findIndex((t) => /cli\.m?js$/i.test(t) || t.toLowerCase().includes('claude-code'))
    if (idx >= 0) tokens = tokens.slice(idx + 1)
  }
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--') break // 其後都是 prompt
    if (!t.startsWith('-')) continue // 原本的 prompt
    const dash = (x: string | undefined): boolean => x === undefined || x.startsWith('-')
    if (DROP_FLAGS.has(t)) continue
    if (t === '-r' || t === '--resume' || t === '--session-id') {
      if (!dash(tokens[i + 1])) i++
      continue
    }
    if (t.startsWith('--resume=') || t.startsWith('--session-id=')) continue
    if (t.includes('=')) {
      kept.push(t)
      continue
    }
    if (VALUED.has(t)) {
      kept.push(t)
      if (VARIADIC.has(t)) {
        while (!dash(tokens[i + 1])) kept.push(tokens[++i])
      } else if (!dash(tokens[i + 1])) {
        kept.push(tokens[++i])
      }
    } else if (BOOLEAN_FLAGS.has(t)) {
      kept.push(t)
    } else if (!dash(tokens[i + 1])) {
      // 未知旗標後接非旗標 token：無法判斷是值還是 prompt，一起丟掉（避免重送原本的 prompt）
      i++
    } else {
      kept.push(t)
    }
  }
  kept.push('--resume', sessionId)
  if (prompt) kept.push(prompt)
  return kept
}

/** 產生 `claude ...` 一行指令；無法安全引用時回傳 null。 */
export function shellLine(kind: 'powershell' | 'cmd', args: string[]): string | null {
  const parts: string[] = []
  for (const a of args) {
    if (a === '' || a.endsWith('\\') || /[\x00-\x1f\x7f]/.test(a)) return null
    if (kind === 'powershell') {
      if (/["‘’‚‛]/.test(a)) return null
      parts.push(`'${a.replace(/'/g, "''")}'`)
    } else {
      if (/["%^&|<>]/.test(a)) return null
      parts.push(`"${a}"`)
    }
  }
  return ['claude', ...parts].join(' ')
}

// ---- 偵測 ----

const SESSION_ID_RE = /^[0-9a-fA-F-]{36}$/

function turnOf(sessionId: string | null, turns: Map<string, TurnRec>): TurnState {
  if (!sessionId) return 'unknown'
  const t = turns.get(sessionId)
  if (!t) return 'unknown'
  if (t.kind === 'prompt') return 'busy'
  if (t.kind === 'stop') return 'idle'
  if (t.kind === 'stopfailure') return 'interrupted'
  return 'unknown'
}

/** 有 sessions 檔時的 turn：我們的 stopfailure 事件較新就是 interrupted，否則看檔內 status。 */
function turnWithSessionFile(cs: ClaudeSessionRec, turns: Map<string, TurnRec>): TurnState {
  const t = turns.get(cs.sessionId)
  if (t && t.kind === 'stopfailure' && t.ts >= cs.statusUpdatedAt / 1000 - 5) return 'interrupted'
  if (cs.status === 'busy') return 'busy'
  if (cs.status === 'idle') return 'idle'
  return turnOf(cs.sessionId, turns)
}

function hasRunnerAncestor(p: ProcInfo, byPid: Map<number, ProcInfo>, runners: Set<number>): boolean {
  const seen = new Set<number>([p.pid])
  let cur = byPid.get(p.ppid)
  for (let i = 0; i < 8 && cur && !seen.has(cur.pid); i++) {
    if (runners.has(cur.pid)) return true
    seen.add(cur.pid)
    cur = byPid.get(cur.ppid)
  }
  return false
}

export function detect(
  procs: ProcInfo[],
  pidmaps: PidmapRec[],
  turns: Map<string, TurnRec>,
  runs: RunRef[],
  claudeSessions: ClaudeSessionRec[] = []
): DetectedCli[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const runners = new Set(runs.map((r) => Number(r.runner_pid)).filter((n) => n > 0))

  // 每個 claude PID 取 ts 最新的有效 pidmap
  const byClaude = new Map<number, PidmapRec>()
  for (const m of pidmaps) {
    const pid = Number(m.claude_pid)
    if (!m.claude_pid || !Number.isInteger(pid)) continue
    const proc = byPid.get(pid)
    if (!proc || !isClaudeProc(proc) || proc.created !== Number(m.claude_created)) continue
    const old = byClaude.get(pid)
    if (!old || Number(m.ts) > Number(old.ts)) byClaude.set(pid, m)
  }
  // 同一 session_id 對應多個 PID：只留 ts 最新者
  const bySession = new Map<string, number>()
  for (const [pid, m] of byClaude) {
    if (!SESSION_ID_RE.test(String(m.session_id))) continue
    const other = bySession.get(m.session_id)
    if (other === undefined || Number(m.ts) > Number(byClaude.get(other)!.ts)) {
      bySession.set(m.session_id, pid)
    }
  }

  // Claude 自己的 sessions 檔（主要來源）：pid 對得上且啟動時間相符才有效
  const byCs = new Map<number, ClaudeSessionRec>()
  for (const cs of claudeSessions) {
    const proc = byPid.get(cs.pid)
    if (!proc || !isClaudeProc(proc)) continue
    if (!(Math.abs(cs.procStartMs - proc.created) < 1000)) continue
    byCs.set(cs.pid, cs)
  }

  const list: DetectedCli[] = []
  for (const p of procs) {
    if (!isClaudeProc(p)) continue
    const cs = byCs.get(p.pid)
    const m = cs ? undefined : byClaude.get(p.pid)
    const sessionId = cs
      ? cs.sessionId
      : m && bySession.get(m.session_id) === p.pid
        ? m.session_id
        : null
    let shellPid: number | null
    let kind: ShellKind
    if (cs) {
      const sh = shellOf(p, byPid)
      shellPid = sh ? sh.pid : null
      kind = sh ? shellKindOf(sh.name) : 'other'
    } else if (m && m.shell_pid && byPid.has(Number(m.shell_pid))) {
      shellPid = Number(m.shell_pid)
      kind = shellKindOf(m.shell_name)
    } else if (m) {
      shellPid = null
      kind = 'other'
    } else {
      const sh = shellOf(p, byPid)
      shellPid = sh ? sh.pid : null
      kind = sh ? shellKindOf(sh.name) : 'other'
    }
    list.push({
      claudePid: p.pid,
      created: p.created,
      sessionId,
      cwd: cs ? cs.cwd || null : m && m.cwd ? m.cwd : null,
      turn: cs ? turnWithSessionFile(cs, turns) : turnOf(sessionId, turns),
      shellPid,
      shellKind: kind,
      interactive: isInteractive(p.cmdline) && (!cs || cs.kind === 'interactive'),
      hosted: hasRunnerAncestor(p, byPid, runners),
      cmdline: p.cmdline
    })
  }
  return list
}

/** 決定切換後的接續方式與指令；畫面與切換流程共用。 */
export function planResume(cli: DetectedCli, prompt: string | null): ResumePlan {
  const args = cli.sessionId ? resumeArgs(cli.cmdline, cli.sessionId, prompt) : []
  if (cli.hosted) return { method: 'runner', args }
  if (!cli.sessionId || !cli.interactive) return { method: 'none', args: [] }
  if ((cli.shellKind === 'powershell' || cli.shellKind === 'cmd') && cli.shellPid) {
    const line = shellLine(cli.shellKind, args)
    if (line !== null) return { method: 'inject', line, args }
  }
  return { method: cli.cwd ? 'newtab' : 'none', args }
}
