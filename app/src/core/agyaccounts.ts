// agy 帳號 slot 管理：認證管理員 gemini:antigravity <-> ~/.claude-switcher/agy/slots/<id>.json。不 import electron。
//
// 注意：這裡不取跨程序檔案鎖（core/filelock、paths.agyLockFile）。
// switchAgy、saveCurrentAgy、syncCurrentAgyBack 的呼叫端（controller／switcher-run）必須先取得檔案鎖。
// slot 檔含完整 OAuth blob，存於使用者設定目錄（繼承使用者 ACL）。
import { t } from '../shared/i18n'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import * as paths from './paths'
import * as storage from './storage'
import { withSlotLock } from './lock'
import { parseBlob, type AgyCredOps } from './agycred'

export interface AgySlot {
  id: string
  name: string
  email: string
  user: string
  blob: string
  saved_at: number
}

/** agy 執行中，不可切換登入。 */
export class AgyBusyError extends Error {
  constructor() {
    super(t('err.agyRunning'))
    this.name = 'AgyBusyError'
  }
}

const ID_RE = /^[0-9a-f]{6}$/
const lockKey = (id: string): string => 'agy-' + id
const slotFile = (id: string): string => path.join(paths.agySlotsDir(), `${id}.json`)

function toSlot(raw: unknown): AgySlot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.id !== 'string' ||
    !ID_RE.test(r.id) ||
    typeof r.blob !== 'string' ||
    typeof r.email !== 'string'
  )
    return null
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : r.email,
    email: r.email.toLowerCase(),
    user: typeof r.user === 'string' ? r.user : '',
    blob: r.blob,
    saved_at: typeof r.saved_at === 'number' ? r.saved_at : 0
  }
}

export function listAgySlots(): AgySlot[] {
  let names: string[]
  try {
    names = fs.readdirSync(paths.agySlotsDir())
  } catch {
    return []
  }
  const out: AgySlot[] = []
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    const s = toSlot(storage.readJson(path.join(paths.agySlotsDir(), n)))
    if (s) out.push(s)
  }
  return out.sort((a, b) => a.saved_at - b.saved_at || a.id.localeCompare(b.id))
}

function findByEmail(email: string): AgySlot | undefined {
  const e = email.toLowerCase()
  return listAgySlots().find((s) => s.email === e)
}

/** 目前登入的 email 對應的 slot id；沒有登入或沒有對應 slot 回傳 null。 */
export async function currentAgySlotId(ops: AgyCredOps): Promise<string | null> {
  const cur = await ops.read()
  if (!cur) return null
  const email = parseBlob(cur.blob).email
  if (!email) return null
  return findByEmail(email)?.id ?? null
}

/** 把目前登入存成新 slot；email 已存在則更新該 slot 的 user、blob、saved_at。 */
export async function saveCurrentAgy(ops: AgyCredOps, name: string): Promise<AgySlot> {
  const cur = await ops.read()
  if (!cur) throw new Error(t('err.agyNoLogin'))
  const email = parseBlob(cur.blob).email
  if (!email) throw new Error(t('err.agyNoEmail'))
  const existing = findByEmail(email)
  const id = existing?.id ?? randomBytes(3).toString('hex')
  return withSlotLock(lockKey(id), () => {
    const slot: AgySlot = {
      id,
      name: existing?.name ?? (name.trim() || email.split('@')[0]),
      email,
      user: cur.user,
      blob: cur.blob,
      saved_at: Math.floor(Date.now() / 1000)
    }
    storage.writeJsonAtomic(slotFile(id), slot)
    return slot
  })
}

/** 目前登入的 blob 與對應 slot 不同時寫回（agy 自己 refresh 後）。找不到對應 slot 不寫、回傳 false。 */
export async function syncCurrentAgyBack(ops: AgyCredOps): Promise<boolean> {
  const cur = await ops.read()
  if (!cur) return false
  const email = parseBlob(cur.blob).email
  if (!email) return false
  const slot = findByEmail(email)
  if (!slot) return false
  if (slot.blob === cur.blob && slot.user === cur.user) return false
  return withSlotLock(lockKey(slot.id), () => {
    storage.writeJsonAtomic(slotFile(slot.id), {
      ...slot,
      user: cur.user,
      blob: cur.blob,
      saved_at: Math.floor(Date.now() / 1000)
    })
    return true
  })
}

/** 切換登入：先 sync back；agy 執行中丟 AgyBusyError；再寫入目標 slot 的 blob。 */
export async function switchAgy(
  ops: AgyCredOps,
  id: string,
  isAgyRunning: () => boolean | Promise<boolean>
): Promise<void> {
  const target = listAgySlots().find((s) => s.id === id)
  if (!target) throw new Error(t('err.agyNotFound'))
  await syncCurrentAgyBack(ops)
  if (await isAgyRunning()) throw new AgyBusyError()
  // sync back 之後重新讀取目標（目標即目前登入時可能剛被更新）
  const fresh = listAgySlots().find((s) => s.id === id) ?? target
  const curId = await currentAgySlotId(ops)
  if (curId === id) return
  await ops.write({ user: fresh.user, blob: fresh.blob })
}

export function renameAgy(id: string, name: string): Promise<void> {
  return withSlotLock(lockKey(id), () => {
    const slot = listAgySlots().find((s) => s.id === id)
    if (!slot) throw new Error(t('err.agyNotFound'))
    const n = name.trim()
    if (!n) throw new Error(t('err.nameEmpty'))
    storage.writeJsonAtomic(slotFile(id), { ...slot, name: n })
  })
}

/** 只刪 slot 檔，不動認證管理員（含使用中的帳號）。 */
export function deleteAgy(id: string): Promise<void> {
  return withSlotLock(lockKey(id), () => {
    if (!ID_RE.test(id)) throw new Error(t('err.agyNotFound'))
    fs.rmSync(slotFile(id), { force: true })
  })
}
