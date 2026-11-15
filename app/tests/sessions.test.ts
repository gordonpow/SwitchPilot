import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempEnv } from './helpers'
import * as S from '../src/core/sessions'
import type { PidmapRec, ProcInfo } from '../src/core/sessions'

const SID = '11111111-2222-3333-4444-555555555555'
const SID2 = '99999999-2222-3333-4444-555555555555'

const P = (pid: number, ppid: number, name: string, cmdline = '', created = pid * 10): ProcInfo => ({
  pid,
  ppid,
  name,
  cmdline,
  created
})
const M = (o: Partial<PidmapRec>): PidmapRec => ({
  session_id: SID,
  cwd: 'C:\\proj',
  claude_pid: 100,
  claude_created: 1000,
  shell_pid: 50,
  shell_name: 'pwsh.exe',
  ts: 1,
  ...o
})

describe('parseProcs', () => {
  it('陣列、單一物件、BOM、null CommandLine、壞輸入', () => {
    const one = '{"ProcessId":5,"ParentProcessId":1,"Name":"a.exe","CommandLine":null,"Created":9}'
    expect(S.parseProcs('\uFEFF' + one)).toEqual([{ pid: 5, ppid: 1, name: 'a.exe', cmdline: '', created: 9 }])
    expect(S.parseProcs(`[${one},${one}]`)).toHaveLength(2)
    expect(S.parseProcs('壞')).toEqual([])
    expect(S.parseProcs('')).toEqual([])
  })
})

describe('isClaudeProc / claudeAncestor', () => {
  it('判定', () => {
    expect(S.isClaudeProc(P(1, 0, 'Claude.EXE'))).toBe(true)
    expect(
      S.isClaudeProc(P(1, 0, 'node.exe', 'node C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'))
    ).toBe(true)
    expect(S.isClaudeProc(P(1, 0, 'node.exe', 'node x/claude-code/cli.js'))).toBe(true)
    expect(S.isClaudeProc(P(1, 0, 'node.exe', 'node server.js'))).toBe(false)
    expect(S.isClaudeProc(P(1, 0, 'bash.exe', 'claude.exe'))).toBe(false)
  })

  it('排除 Claude Desktop：--type= 子程序、AnthropicClaude／WindowsApps 路徑', () => {
    expect(S.isClaudeProc(P(1, 0, 'claude.exe', 'claude.exe --type=renderer --lang=en'))).toBe(false)
    expect(
      S.isClaudeProc(P(1, 0, 'claude.exe', '"C:\\Users\\u\\AppData\\Local\\AnthropicClaude\\app-1.0\\claude.exe"'))
    ).toBe(false)
    expect(
      S.isClaudeProc(P(1, 0, 'claude.exe', '"C:\\Program Files\\WindowsApps\\Claude_1.0\\app\\claude.exe"'))
    ).toBe(false)
    expect(S.isClaudeProc(P(1, 0, 'claude.exe', '"C:\\Users\\u\\.local\\bin\\claude.exe" --model x'))).toBe(true)
  })

  it('psAncestorQuery：只沿祖先鏈查、不掃全部程序，起點必須是正整數', () => {
    const q = S.psAncestorQuery(1234)
    expect(q).toContain('$id=1234')
    expect(q).toContain('-Filter "ProcessId=$id"')
    expect(q).toContain('$i -lt 10')
    expect(q).not.toMatch(/Get-CimInstance Win32_Process \|/)
    expect(() => S.psAncestorQuery(0)).toThrow()
    expect(() => S.psAncestorQuery(NaN)).toThrow()
  })

  it('往上找（含自己）、深度限制、循環', () => {
    const procs = [P(1, 0, 'x'), P(2, 1, 'claude.exe'), P(3, 2, 'bash.exe'), P(4, 3, 'bash.exe'), P(5, 4, 'node.exe')]
    const by = new Map(procs.map((p) => [p.pid, p]))
    expect(S.claudeAncestor(5, by)?.pid).toBe(2)
    expect(S.claudeAncestor(2, by)?.pid).toBe(2)
    expect(S.claudeAncestor(5, by, 3)).toBeNull()
    expect(S.claudeAncestor(1, by)).toBeNull()
    const loop = new Map([
      [1, P(1, 2, 'a')],
      [2, P(2, 1, 'b')]
    ])
    expect(S.claudeAncestor(1, loop)).toBeNull()
  })
})

describe('buildPidmap', () => {
  it('找 claude 與父 shell；npm shim 再往上一層', () => {
    const procs = [
      P(10, 0, 'WindowsTerminal.exe'),
      P(20, 10, 'powershell.exe'),
      P(30, 20, 'claude.exe', '', 777),
      P(31, 30, 'bash.exe'),
      P(32, 31, 'node.exe', 'statusline.cjs')
    ]
    const r = S.buildPidmap(procs, 32, 's', 'C:\\x', 5)!
    expect(r).toMatchObject({ claude_pid: 30, claude_created: 777, shell_pid: 20, shell_name: 'powershell.exe', ts: 5 })

    const shim = [
      P(20, 10, 'cmd.exe'),
      P(25, 20, 'cmd.exe', 'C:\\npm\\claude.cmd'),
      P(30, 25, 'node.exe', 'node x\\@anthropic-ai\\claude-code\\cli.js'),
      P(32, 30, 'node.exe', 'statusline.cjs')
    ]
    expect(S.buildPidmap(shim, 32, 's', '', 5)).toMatchObject({ claude_pid: 30, shell_pid: 20, shell_name: 'cmd.exe' })
    expect(S.buildPidmap([P(32, 0, 'node.exe')], 32, 's', '', 5)).toBeNull()
  })
})

describe('tokenize', () => {
  it('引號、反斜線規則', () => {
    expect(S.tokenize('"C:\\Program Files\\claude.exe" --model "a b" x\\y')).toEqual([
      'C:\\Program Files\\claude.exe',
      '--model',
      'a b',
      'x\\y'
    ])
    expect(S.tokenize('a \\"q\\" b')).toEqual(['a', '"q"', 'b'])
    expect(S.tokenize('"a\\\\" b')).toEqual(['a\\', 'b'])
    expect(S.tokenize('  ')).toEqual([])
  })
})

describe('resumeArgs', () => {
  it('保留旗標與值，丟掉 prompt／--continue', () => {
    const cmd = 'claude.exe --dangerously-skip-permissions --model opus -c "做點事" --verbose'
    expect(S.resumeArgs(cmd, SID, null)).toEqual([
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--verbose',
      '--resume',
      SID
    ])
  })

  it('--resume 值被丟掉；後接旗標時不吃', () => {
    expect(S.resumeArgs('claude --resume abc --verbose', SID, null)).toEqual(['--verbose', '--resume', SID])
    expect(S.resumeArgs('claude --verbose -r', SID, null)).toEqual(['--verbose', '--resume', SID])
    expect(S.resumeArgs('claude --session-id x --fork-session --resume=y', SID, null)).toEqual(['--resume', SID])
  })

  it('variadic 吃到下一個旗標；需值選項後接旗標時不吃', () => {
    expect(S.resumeArgs('claude --add-dir a b --model --verbose hi', SID, null)).toEqual([
      '--add-dir',
      'a',
      'b',
      '--model',
      '--verbose',
      '--resume',
      SID
    ])
    expect(S.resumeArgs('claude --allowedTools "Bash(git:*)" Read -x', SID, null)).toEqual([
      '--allowedTools',
      'Bash(git:*)',
      'Read',
      '-x',
      '--resume',
      SID
    ])
  })

  it('--opt=value 保留；未知選項後接非旗標 token 時，兩者一起丟掉', () => {
    expect(S.resumeArgs('claude --effort=high --weird hello', SID, null)).toEqual([
      '--effort=high',
      '--resume',
      SID
    ])
    // 未知旗標後接旗標：不吃，--resume 不會被吃成值
    expect(S.resumeArgs('claude --x --resume abc', SID, null)).toEqual(['--x', '--resume', SID])
    // 已知布林旗標不吃後面的 token
    expect(S.resumeArgs('claude --verbose 做點事', SID, null)).toEqual(['--verbose', '--resume', SID])
    expect(S.resumeArgs('claude --effort high', SID, null)).toEqual(['--effort', 'high', '--resume', SID])
  })

  it('需值選項：後接的值保留，不當 prompt 丟掉', () => {
    const flags = [
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
      '--system-prompt-file',
      '--model'
    ]
    for (const f of flags) {
      expect(S.resumeArgs(`claude ${f} val 做點事`, SID, null)).toEqual([f, 'val', '--resume', SID])
    }
  })

  it('node 版：丟掉腳本路徑與之前的 token；-- 之後都是 prompt', () => {
    const cmd =
      '"C:\\Program Files\\nodejs\\node.exe" --no-warnings C:\\u\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js --model x -- 嗨'
    expect(S.resumeArgs(cmd, SID, null)).toEqual(['--model', 'x', '--resume', SID])
  })

  it('prompt 附在最後；空字串或 null 不附', () => {
    expect(S.resumeArgs('claude', SID, '繼續')).toEqual(['--resume', SID, '繼續'])
    expect(S.resumeArgs('claude', SID, '')).toEqual(['--resume', SID])
  })
})

describe('shellLine', () => {
  it("powershell：單引號，內部 ' 變 ''", () => {
    expect(S.shellLine('powershell', ['--resume', SID, "it's"])).toBe(`claude '--resume' '${SID}' 'it''s'`)
    expect(S.shellLine('powershell', [])).toBe('claude')
  })
  it('cmd：雙引號', () => {
    expect(S.shellLine('cmd', ['--resume', SID, '繼續'])).toBe(`claude "--resume" "${SID}" "繼續"`)
  })
  it('不安全回傳 null', () => {
    expect(S.shellLine('powershell', ['a"b'])).toBeNull()
    expect(S.shellLine('powershell', ['\u2018x'])).toBeNull()
    expect(S.shellLine('powershell', [''])).toBeNull()
    expect(S.shellLine('powershell', ['C:\\x\\'])).toBeNull()
    expect(S.shellLine('powershell', ['a\nb'])).toBeNull()
    expect(S.shellLine('powershell', ['a\rb'])).toBeNull()
    for (const ch of ['\t', '\x00', '\x1b', '\x7f']) {
      expect(S.shellLine('powershell', [`a${ch}b`])).toBeNull()
      expect(S.shellLine('cmd', [`a${ch}b`])).toBeNull()
    }
    for (const ch of ['"', '%', '^', '&', '|', '<', '>']) expect(S.shellLine('cmd', [`a${ch}`])).toBeNull()
    expect(S.shellLine('cmd', ["it's"])).toBe(`claude "it's"`)
  })
})

describe('isInteractive', () => {
  it.each(['-p', '--print', '--input-format', '--output-format=json', '--sdk-url'])('%s 為非互動', (f) => {
    expect(S.isInteractive(`claude.exe ${f} x`)).toBe(false)
  })
  it('一般為互動', () => expect(S.isInteractive('claude.exe --model p')).toBe(true))
})

describe('detect', () => {
  const base = (): ProcInfo[] => [P(50, 1, 'pwsh.exe'), P(100, 50, 'claude.exe', 'claude.exe --model opus', 1000)]
  const turns = new Map([[SID, { kind: 'prompt', ts: 5 }]])

  it('有效 pidmap：session、cwd、turn、shell', () => {
    const [c] = S.detect(base(), [M({})], turns, [])
    expect(c).toMatchObject({
      claudePid: 100,
      sessionId: SID,
      cwd: 'C:\\proj',
      turn: 'busy',
      shellPid: 50,
      shellKind: 'powershell',
      interactive: true,
      hosted: false
    })
  })

  it('turn 對應 stop／stopfailure／無事件', () => {
    const t = (kind: string | null): S.TurnState =>
      S.detect(base(), [M({})], kind ? new Map([[SID, { kind, ts: 1 }]]) : new Map(), [])[0].turn
    expect(t('stop')).toBe('idle')
    expect(t('stopfailure')).toBe('interrupted')
    expect(t(null)).toBe('unknown')
  })

  it('created 不符（PID 重用）、非 claude、不存在：視為沒有 session', () => {
    expect(S.detect(base(), [M({ claude_created: 999 })], turns, [])[0].sessionId).toBeNull()
    expect(S.detect(base(), [M({ claude_pid: 50 })], turns, [])).toHaveLength(1)
    expect(S.detect(base(), [M({ claude_pid: 7 })], turns, [])[0].sessionId).toBeNull()
  })

  it('沒有 pidmap 的 claude 仍列出；標記（claude_pid null）略過', () => {
    const [c] = S.detect(base(), [M({ claude_pid: null })], turns, [])
    expect(c).toMatchObject({ sessionId: null, cwd: null, turn: 'unknown', shellPid: 50, shellKind: 'powershell' })
  })

  it('同 PID 多筆取 ts 最新（/clear）', () => {
    const [c] = S.detect(base(), [M({ ts: 1 }), M({ session_id: SID2, ts: 9 })], new Map(), [])
    expect(c.sessionId).toBe(SID2)
  })

  it('同 session 對應多個 PID：只保留 ts 最新者', () => {
    const procs = [...base(), P(200, 50, 'claude.exe', 'claude.exe', 2000)]
    const list = S.detect(procs, [M({ ts: 1 }), M({ claude_pid: 200, claude_created: 2000, ts: 5 })], new Map(), [])
    expect(list.find((c) => c.claudePid === 100)!.sessionId).toBeNull()
    expect(list.find((c) => c.claudePid === 200)!.sessionId).toBe(SID)
  })

  it('session_id 格式不合法視為沒有 session', () => {
    expect(S.detect(base(), [M({ session_id: 'bad id' })], new Map(), [])[0].sessionId).toBeNull()
  })

  it('shell 不存在或名稱未知：other', () => {
    expect(S.detect(base(), [M({ shell_pid: 777 })], new Map(), [])[0].shellKind).toBe('other')
    expect(S.detect(base(), [M({ shell_name: 'bash.exe' })], new Map(), [])[0].shellKind).toBe('other')
    expect(S.detect(base(), [M({ shell_name: 'cmd.exe' })], new Map(), [])[0].shellKind).toBe('cmd')
  })

  it('hosted：祖先含 runner_pid（含 shim）', () => {
    const procs = [
      P(60, 1, 'node.exe', 'runner.cjs'),
      P(61, 60, 'cmd.exe', 'claude.cmd'),
      P(100, 61, 'node.exe', 'x\\claude-code\\cli.js', 1000)
    ]
    expect(S.detect(procs, [], new Map(), [{ runner_pid: 60 }])[0].hosted).toBe(true)
    expect(S.detect(procs, [], new Map(), [{ runner_pid: 99 }])[0].hosted).toBe(false)
  })

  it('非互動', () => {
    const procs = [P(100, 1, 'claude.exe', 'claude.exe -p hi', 1000)]
    expect(S.detect(procs, [], new Map(), [])[0].interactive).toBe(false)
  })
})

describe('planResume', () => {
  const cli = (o: Partial<S.DetectedCli> = {}): S.DetectedCli => ({
    claudePid: 100,
    created: 1,
    sessionId: SID,
    cwd: 'C:\\proj',
    turn: 'idle',
    shellPid: 50,
    shellKind: 'powershell',
    interactive: true,
    hosted: false,
    cmdline: 'claude.exe --model opus',
    ...o
  })

  it('inject：附 line 與 args', () => {
    const p = S.planResume(cli(), '繼續')
    expect(p.method).toBe('inject')
    expect(p.args).toEqual(['--model', 'opus', '--resume', SID, '繼續'])
    expect(p.line).toBe(`claude '--model' 'opus' '--resume' '${SID}' '繼續'`)
  })
  it('hosted → runner', () => expect(S.planResume(cli({ hosted: true }), null).method).toBe('runner'))
  it('無 session 或非互動 → none', () => {
    expect(S.planResume(cli({ sessionId: null }), null).method).toBe('none')
    expect(S.planResume(cli({ interactive: false }), null).method).toBe('none')
  })
  it('other shell 或 line 不安全 → newtab；沒有 cwd → none', () => {
    expect(S.planResume(cli({ shellKind: 'other' }), null).method).toBe('newtab')
    expect(S.planResume(cli({ cmdline: 'claude.exe --append-system-prompt "a\\"b"' }), null).method).toBe('newtab')
    expect(S.planResume(cli({ shellKind: 'other', cwd: null }), null).method).toBe('none')
  })
})

describe('readClaudeSessions / detect（sessions 檔）', () => {
  const root = useTempEnv()
  // unix 毫秒 → FILETIME 字串
  const ft = (ms: number): string => String((BigInt(ms) + 11644473600000n) * 10000n)
  const T0 = 1794500713297

  function put(name: string, body: unknown): void {
    const d = path.join(root(), 'claude', 'sessions')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, name), typeof body === 'string' ? body : JSON.stringify(body))
  }
  const rec = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    pid: 100,
    sessionId: SID,
    cwd: 'C:\proj',
    procStart: ft(T0),
    kind: 'interactive',
    entrypoint: 'cli',
    status: 'busy',
    statusUpdatedAt: 5000000,
    messagingSocketPath: '\\.\pipe\secret-sock',
    ...o
  })
  const procs = (): ProcInfo[] => [P(50, 1, 'pwsh.exe'), P(100, 50, 'claude.exe', 'claude.exe', T0 + 200)]

  it('filetimeToMs 轉換正確、壞值回傳 null', () => {
    expect(S.filetimeToMs(ft(T0))).toBe(T0)
    expect(S.filetimeToMs('134389743127705145')).toBe(Math.floor(134389743127705145 / 10000) - 11644473600000)
    expect(S.filetimeToMs('abc')).toBeNull()
    expect(S.filetimeToMs(null)).toBeNull()
  })

  it('只讀 <數字>.json：忽略 .key、壞檔、缺欄位；不保留 socket／token', () => {
    put('100.json', rec())
    put('100.abcdef.key', { peerToken: 'SECRET-TOKEN', pid: 101, sessionId: SID2, cwd: 'x', procStart: ft(T0) })
    put('abc.json', rec({ pid: 102 }))
    put('103.json', '{壞')
    put('104.json', rec({ pid: 104, sessionId: 'bad' }))
    put('105.json', rec({ pid: 105, procStart: 'x' }))
    const list = S.readClaudeSessions()
    expect(list.map((r) => r.pid)).toEqual([100])
    expect(JSON.stringify(list)).not.toMatch(/secret|SECRET|pipe/)
    expect(list[0]).toMatchObject({ sessionId: SID, cwd: 'C:\proj', procStartMs: T0, kind: 'interactive' })
  })

  it('目錄不存在回傳空陣列', () => {
    expect(S.readClaudeSessions()).toEqual([])
    expect(S.claudeSessionsDirExists()).toBe(false)
  })

  const det = (cs: Record<string, unknown>[], turns = new Map<string, S.TurnRec>(), pm: PidmapRec[] = []) => {
    cs.forEach((r, i) => put(`${r.pid}.json`.replace('undefined', String(i)), r))
    return S.detect(procs(), pm, turns, [], S.readClaudeSessions())
  }

  it('有效：sessionId／cwd／shell／busy；pidmap 不用', () => {
    const [c] = det([rec()], new Map(), [M({ session_id: SID2, cwd: 'C:\other' })])
    expect(c).toMatchObject({ sessionId: SID, cwd: 'C:\proj', turn: 'busy', shellPid: 50, shellKind: 'powershell', interactive: true })
  })

  it('status idle；其他 status 回頭看事件，再不行 unknown', () => {
    expect(det([rec({ status: 'idle' })])[0].turn).toBe('idle')
    expect(det([rec({ status: 'weird' })])[0].turn).toBe('unknown')
    expect(det([rec({ status: 'weird' })], new Map([[SID, { kind: 'stop', ts: 1 }]]))[0].turn).toBe('idle')
  })

  it('procStart 不符、程序不存在（舊檔）：不採用，退回 pidmap', () => {
    const [c] = det([rec({ procStart: ft(T0 + 5000) }), rec({ pid: 999 })], new Map(), [
      M({ claude_created: T0 + 200 })
    ])
    expect(c.sessionId).toBe(SID)
    expect(c.cwd).toBe('C:\\proj')
    const [d] = det([rec({ procStart: ft(T0 + 5000) })])
    expect(d.sessionId).toBeNull()
  })

  it('kind 非 interactive：interactive 為 false', () => {
    expect(det([rec({ kind: 'sdk' })])[0].interactive).toBe(false)
  })

  it('stopfailure 事件比 statusUpdatedAt 新：interrupted；較舊則看 status', () => {
    const su = 5000000
    expect(det([rec({ status: 'idle', statusUpdatedAt: su })], new Map([[SID, { kind: 'stopfailure', ts: su / 1000 + 1 }]]))[0].turn).toBe('interrupted')
    expect(det([rec({ status: 'idle', statusUpdatedAt: su })], new Map([[SID, { kind: 'stopfailure', ts: su / 1000 - 4 }]]))[0].turn).toBe('interrupted')
    expect(det([rec({ status: 'idle', statusUpdatedAt: su })], new Map([[SID, { kind: 'stopfailure', ts: su / 1000 - 60 }]]))[0].turn).toBe('idle')
  })
})
