// 程序工具：存活判斷與結束程序樹（無黑窗）。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'

export function pidAlive(pid: unknown): boolean {
  const n = Number(pid)
  if (!pid || !Number.isInteger(n) || n <= 0) return false
  try {
    process.kill(n, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 結束程序與其子程序；回傳之後該 pid 是否已不存在（最多等 3 秒）。 */
export async function killTree(pid: number): Promise<boolean> {
  await new Promise<void>((resolve) => {
    try {
      execFile(
        'taskkill',
        ['/PID', String(Math.trunc(Number(pid))), '/T', '/F'],
        { windowsHide: true, timeout: 15000 },
        () => resolve()
      )
    } catch {
      resolve()
    }
  })
  const deadline = Date.now() + 3000
  while (pidAlive(pid)) {
    if (Date.now() >= deadline) return false
    await sleep(100)
  }
  return true
}

/** 在 PATH 中找第一個存在的檔案（依 names 順序，如 ['claude.exe', 'claude.cmd']）。 */
export function whichFirst(names: string[], pathEnv = process.env.PATH ?? ''): string | null {
  const dirs = pathEnv.split(';').filter(Boolean)
  for (const name of names) {
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
