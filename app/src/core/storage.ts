// JSON 讀寫。寫入一律原子化（暫存檔 + rename），避免其他程序讀到寫一半的檔案。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** 同步睡眠（只在檔案被鎖時發生，極少）。 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code
}

/** 讀取 JSON；任何錯誤都丟例外（給不得覆寫壞檔的情境使用）。 */
export function readJsonStrict(file: string): unknown {
  let lastErr: unknown
  for (let i = 0; i < 5; i++) {
    try {
      let text = fs.readFileSync(file, 'utf-8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      return JSON.parse(text)
    } catch (e) {
      if (!RETRY_CODES.has(errCode(e) ?? '')) throw e
      lastErr = e
      sleepSync(100)
    }
  }
  throw lastErr
}

/** 讀取 JSON；檔案不存在、被鎖住或內容壞掉時回傳 fallback。 */
export function readJson(file: string, fallback: unknown = null): unknown {
  try {
    return readJsonStrict(file)
  } catch {
    return fallback
  }
}

/** 原子寫入檔案：寫到同目錄暫存檔，再 rename 取代（被鎖時重試 10 次 × 200 ms）。 */
export function writeFileAtomic(file: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeFileSync(fd, data)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.renameSync(tmp, file)
        return
      } catch (e) {
        if (!RETRY_CODES.has(errCode(e) ?? '') || attempt === 9) throw e
        sleepSync(200)
      }
    }
  } finally {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 忽略 */
    }
  }
}

/** 原子寫入 JSON（2 空格縮排、UTF-8、不跳脫非 ASCII）。 */
export function writeJsonAtomic(file: string, data: unknown): void {
  writeFileAtomic(file, JSON.stringify(data, null, 2))
}
