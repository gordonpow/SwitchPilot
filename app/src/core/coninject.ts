// 把一行文字寫進指定 shell 的 console 輸入（呼叫 inject.ps1）。不 import electron。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import * as paths from './paths'
import { pidAlive } from './procutil'

/** 執行外部程式並回傳 exit code（逾時或無法啟動回傳 null）。不得把錯誤內容往外傳。 */
export type SpawnFn = (
  file: string,
  args: string[],
  opts: { windowsHide: boolean; timeout: number }
) => Promise<number | null>

const defaultSpawn: SpawnFn = (file, args, opts) =>
  new Promise((resolve) => {
    try {
      execFile(file, args, opts, (err) => {
        if (!err) return resolve(0)
        const code = (err as NodeJS.ErrnoException & { code?: unknown }).code
        resolve(typeof code === 'number' ? code : null)
      })
    } catch {
      resolve(null)
    }
  })

export interface InjectOptions {
  spawn?: SpawnFn
  ps1Path?: string
  /** 注入存活判斷（測試用） */
  alive?: (pid: number) => boolean
  /** injectSubmit：送出文字與送出 Enter 之間的等待毫秒數（預設 500） */
  submitDelayMs?: number
}

/** 把原樣文字寫進 console 輸入（不加換行）；目標程序須存活，exit code 為 0 才回傳 true。 */
async function writeRaw(pid: number, text: string, opts: InjectOptions): Promise<boolean> {
  const alive = opts.alive ?? pidAlive
  if (!alive(pid)) return false
  const ps1 = opts.ps1Path ?? path.join(paths.binDir(), 'inject.ps1')
  if (!opts.spawn && !fs.existsSync(ps1)) return false
  const spawn = opts.spawn ?? defaultSpawn
  const b64 = Buffer.from(text, 'utf-8').toString('base64')
  const code = await spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
      '-TargetPid',
      String(Math.trunc(pid)),
      '-TextB64',
      b64
    ],
    { windowsHide: true, timeout: 15000 }
  )
  return code === 0
}

/** 寫入前 shell 必須存活；exit code 為 0 才回傳 true。 */
export async function injectLine(
  shellPid: number,
  line: string,
  opts: InjectOptions = {}
): Promise<boolean> {
  return writeRaw(shellPid, line + '\r', opts)
}

/**
 * 對目標 console 送出 Ctrl+字母（按下＋放開）。
 * letter 必須為 A-Z（單一字母，小寫會轉大寫），否則回傳 false。
 */
export async function injectCtrlKey(
  targetPid: number,
  letter: string,
  opts: InjectOptions = {}
): Promise<boolean> {
  if (typeof letter !== 'string' || letter.length !== 1) return false
  const upper = letter.toUpperCase()
  if (upper < 'A' || upper > 'Z') return false

  const alive = opts.alive ?? pidAlive
  if (!alive(targetPid)) return false
  const ps1 = opts.ps1Path ?? path.join(paths.binDir(), 'inject.ps1')
  if (!opts.spawn && !fs.existsSync(ps1)) return false
  const spawn = opts.spawn ?? defaultSpawn
  const code = await spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ps1,
      '-TargetPid',
      String(Math.trunc(targetPid)),
      '-CtrlKey',
      upper
    ],
    { windowsHide: true, timeout: 15000 }
  )
  return code === 0
}

/**
 * 對執行中的 claude（targetPid）輸入文字並送出：先送文字（不含換行），等待後再單獨送 \r。
 * 原因：TUI 可能把連續輸入中的換行當成貼上內容而不送出。
 */
export async function injectSubmit(
  targetPid: number,
  text: string,
  opts: InjectOptions = {}
): Promise<boolean> {
  if (!(await writeRaw(targetPid, text, opts))) return false
  const delay = opts.submitDelayMs ?? 500
  if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay))
  return writeRaw(targetPid, '\r', opts)
}
