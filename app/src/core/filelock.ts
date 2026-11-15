// 跨程序檔案鎖：以 openSync(path, 'wx') 建立鎖檔，內容 {pid, ts}。不 import electron。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pidAlive } from './procutil'

export interface FileLock {
  /** 釋放鎖（只刪除自己建立的鎖檔；重複呼叫無害）。 */
  release(): void
}

export interface FileLockOptions {
  /** 超過此毫秒數視為過期並接手 */
  staleMs: number
  now?: () => number
  alive?: (pid: number) => boolean
}

function tryCreate(file: string, pid: number, ts: number): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    const fd = fs.openSync(file, 'wx')
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid, ts }))
    } finally {
      fs.closeSync(fd)
    }
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}

/** 取得鎖；已被他人持有（且未過期、持有者存活）回傳 null。 */
export function acquireFileLock(file: string, opts: FileLockOptions): FileLock | null {
  const now = opts.now ?? Date.now
  const alive = opts.alive ?? pidAlive
  const ts = now()
  const pid = process.pid
  let got = tryCreate(file, pid, ts)
  if (!got) {
    let holder: { pid?: unknown; ts?: unknown } | null = null
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf-8')) as { pid?: unknown; ts?: unknown }
    } catch {
      holder = null
    }
    const hp = Number(holder?.pid)
    const hts = Number(holder?.ts)
    const stale =
      !holder ||
      !Number.isFinite(hp) ||
      !alive(hp) ||
      !Number.isFinite(hts) ||
      ts - hts > opts.staleMs
    if (!stale) return null
    try {
      fs.rmSync(file, { force: true })
    } catch {
      return null
    }
    got = tryCreate(file, pid, ts)
    if (!got) return null
  }
  let released = false
  return {
    release() {
      if (released) return
      released = true
      try {
        const cur = JSON.parse(fs.readFileSync(file, 'utf-8')) as { pid?: unknown; ts?: unknown }
        if (cur.pid === pid && cur.ts === ts) fs.rmSync(file, { force: true })
      } catch {
        /* 檔案已不存在或已被接手 */
      }
    }
  }
}
