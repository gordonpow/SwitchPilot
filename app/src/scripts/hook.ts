// 由 Claude Code 執行的 hook 腳本（stop／stopfailure／prompt）：寫事件檔。絕不丟例外。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import * as paths from '../core/paths'
import * as storage from '../core/storage'
import * as accounts from '../core/accounts'

function main(): void {
  const kind = process.argv[2] ?? 'stop'
  if (kind !== 'stop' && kind !== 'stopfailure' && kind !== 'prompt') return
  let raw = ''
  try {
    raw = fs.readFileSync(0, 'utf-8')
  } catch {
    raw = ''
  }
  let data: Record<string, unknown> = {}
  if (raw.trim()) {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  }

  let slotId: string | null = null
  try {
    slotId = accounts.currentSlotId()
  } catch {
    slotId = null
  }

  const err = data.error
  const event = {
    kind,
    session_id: String(data.session_id || ''),
    cwd: String(data.cwd || ''),
    error: err !== null && err !== undefined ? String(err) : null,
    slot_id: slotId,
    ts: Date.now() / 1000
  }
  // 檔名以奈秒時間戳開頭，字串排序即時間排序
  const ns = BigInt(Date.now()) * 1000000n + (process.hrtime.bigint() % 1000000n)
  const name = `${ns}-${randomBytes(2).toString('hex')}.json`
  storage.writeJsonAtomic(path.join(paths.eventsDir(), name), event)
}

try {
  main()
} catch {
  /* 絕不丟例外 */
}
process.exitCode = 0
