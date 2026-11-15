// 假的程序查詢：模擬 claude -> bash -> node（statusline）的程序鏈，輸出 JSON。
const start = Number(process.env.CLAUDE_SWITCHER_PIDMAP_START_PID)
const procs = [
  { ProcessId: 4001, ParentProcessId: 1, Name: 'powershell.exe', CommandLine: 'powershell.exe', Created: 111 },
  { ProcessId: 4002, ParentProcessId: 4001, Name: 'claude.exe', CommandLine: 'claude.exe', Created: 222 },
  { ProcessId: 4003, ParentProcessId: 4002, Name: 'bash.exe', CommandLine: 'bash.exe', Created: 333 },
  { ProcessId: start, ParentProcessId: 4003, Name: 'node.exe', CommandLine: 'node statusline.cjs', Created: 444 }
]
process.stdout.write(JSON.stringify(procs))
