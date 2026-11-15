// 執行中派工登記與最近派工紀錄。不 import electron、不 import sessions。
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as paths from './paths'
import type { RoleId } from './routing'
import * as storage from './storage'

export interface RunningRecord {
  id: string
  pid: number
  child_pid?: number
  role: RoleId
  provider: 'agy'
  model: string
  slot_id: string
  account: string // email
  cwd: string
  out: string
  started_at: number // ms
}

export interface DispatchRecord {
  id: string
  status: 'ok' | 'delegate' | 'failed'
  provider: 'claude' | 'agy' | null
  model: string | null
  agy_account_email?: string
  attempts: Array<{
    provider: 'claude' | 'agy'
    model: string
    account?: string
    outcome: string
  }>
  message: string
  role: RoleId
  cwd: string
  started_at: number
  ended_at: number
}

/** 檢查 PID 是否存活。ESRCH 回傳 false，EPERM 或成功回傳 true。 */
export function defaultIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return false
  }
}

/** 登記執行中派工。 */
export function registerRunning(rec: RunningRecord): void {
  const dir = paths.dispatchRunningDir()
  storage.writeJsonAtomic(path.join(dir, `${rec.id}.json`), rec)
}

/** 更新登記中的 child_pid。若記錄不存在則略過。 */
export function updateRunningChildPid(id: string, childPid: number): void {
  try {
    const file = path.join(paths.dispatchRunningDir(), `${id}.json`)
    const rec = storage.readJson(file, null) as RunningRecord | null
    if (rec && typeof rec === 'object' && rec.id === id) {
      storage.writeJsonAtomic(file, { ...rec, child_pid: childPid })
    }
  } catch {
    /* 忽略錯誤 */
  }
}

/** 取消執行中登記。刪除檔案，忽略錯誤。 */
export function unregisterRunning(id: string): void {
  try {
    fs.rmSync(path.join(paths.dispatchRunningDir(), `${id}.json`), { force: true })
  } catch {
    /* 忽略錯誤 */
  }
}

/** 列出所有執行中的派工。過濾 pid 已不存在者，依 started_at 排序。只讀不刪。目錄不存在時回傳空陣列。 */
export function listRunning(isAlive: (pid: number) => boolean = defaultIsAlive): RunningRecord[] {
  const dir = paths.dispatchRunningDir()
  if (!fs.existsSync(dir)) return []
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: RunningRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(dir, name)
    try {
      const rec = storage.readJson(file, null) as RunningRecord | null
      if (
        rec &&
        typeof rec === 'object' &&
        typeof rec.pid === 'number' &&
        typeof rec.started_at === 'number' &&
        isAlive(rec.pid)
      ) {
        out.push(rec)
      }
    } catch {
      /* 壞檔略過 */
    }
  }
  out.sort((a, b) => a.started_at - b.started_at)
  return out
}

/** 清理已死亡 PID 的登記檔案。 */
export function pruneDeadRunning(isAlive: (pid: number) => boolean = defaultIsAlive): void {
  const dir = paths.dispatchRunningDir()
  if (!fs.existsSync(dir)) return
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(dir, name)
    try {
      const rec = storage.readJson(file, null) as RunningRecord | null
      if (!rec || typeof rec.pid !== 'number' || !isAlive(rec.pid)) {
        fs.rmSync(file, { force: true })
      }
    } catch {
      fs.rmSync(file, { force: true })
    }
  }
}

/** 列出最近的派工紀錄。不含子目錄，依檔名倒序排列。壞檔略過。 */
export function listRecent(limit = 20): DispatchRecord[] {
  const dir = paths.dispatchDir()
  if (!fs.existsSync(dir)) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort()
    .reverse()

  const out: DispatchRecord[] = []
  for (const name of jsonFiles) {
    if (out.length >= limit) break
    const file = path.join(dir, name)
    try {
      const raw = storage.readJson(file, null) as Record<string, unknown> | null
      if (raw && typeof raw === 'object' && typeof raw.status === 'string') {
        const id = name.replace(/\.json$/i, '')
        out.push({
          ...(raw as unknown as Omit<DispatchRecord, 'id'>),
          id
        })
      }
    } catch {
      /* 壞檔略過 */
    }
  }
  return out
}
