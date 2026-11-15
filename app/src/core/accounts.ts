// 帳號 slot 管理、目前帳號判斷、切換。
// 同步 API；跨 await 的寫入競爭由呼叫端以 lock.withSlotLock 序列化。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import * as paths from './paths'
import * as storage from './storage'

export class AccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountError'
  }
}

export interface Slot {
  id: string
  name: string
  email: string
  account_uuid: string
  credentials: Record<string, unknown>
  oauth_account: Record<string, unknown>
  saved_at: number
  exhausted_until: number
  [key: string]: unknown
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function slotPath(slotId: string): string {
  return path.join(paths.slotsDir(), `${slotId}.json`)
}

/** 依 saved_at、id 排序列出所有 slot。 */
export function listSlots(): Slot[] {
  const result: Slot[] = []
  const dir = paths.slotsDir()
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return result
  }
  for (const n of names) {
    const data = storage.readJson(path.join(dir, n), null)
    if (isObj(data) && data.id) result.push(data as Slot)
  }
  result.sort((a, b) => {
    const d = (a.saved_at || 0) - (b.saved_at || 0)
    if (d !== 0) return d
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return result
}

export function getSlot(slotId: string): Slot | null {
  const data = storage.readJson(slotPath(slotId), null)
  return isObj(data) ? (data as Slot) : null
}

export function updateSlot(slot: Slot): void {
  storage.writeJsonAtomic(slotPath(slot.id), slot)
}

/** ~/.claude.json 的 oauthAccount。 */
export function currentAccount(): Obj | null {
  const data = storage.readJson(paths.claudeJson(), null)
  if (!isObj(data)) return null
  return isObj(data.oauthAccount) ? data.oauthAccount : null
}

export function matchSlot(oauthAccount: Obj | null | undefined): Slot | null {
  if (!oauthAccount || Object.keys(oauthAccount).length === 0) return null
  const uuid = oauthAccount.accountUuid
  const email = oauthAccount.emailAddress
  for (const s of listSlots()) {
    if (uuid) {
      if (s.account_uuid === uuid) return s
    } else if (email && s.email === email) {
      return s
    }
  }
  return null
}

export function currentSlotId(): string | null {
  const s = matchSlot(currentAccount())
  return s ? s.id : null
}

/** 新增或更新 slot（以 accountUuid／email 比對）。不碰 ~/.claude 的任何檔案。 */
export function addSlot(name: string, credentials: Obj, oauthAccount: Obj): Slot {
  const existing = matchSlot(oauthAccount)
  const slot: Slot = {
    id: existing ? existing.id : randomBytes(3).toString('hex'),
    name,
    email: (oauthAccount.emailAddress as string) ?? '',
    account_uuid: (oauthAccount.accountUuid as string) ?? '',
    credentials,
    oauth_account: oauthAccount,
    saved_at: Date.now() / 1000,
    exhausted_until: existing ? existing.exhausted_until || 0 : 0
  }
  updateSlot(slot)
  return slot
}

export function saveCurrent(name: string): Slot {
  const creds = storage.readJson(paths.credFile(), null)
  const acct = currentAccount()
  if (!isObj(creds) || Object.keys(creds).length === 0 || !acct) {
    throw new AccountError('找不到目前登入的帳號，請先在 claude 中 /login')
  }
  return addSlot(name, creds, acct)
}

function oauthTokens(creds: unknown): { refresh: string; access: string } {
  const o = isObj(creds) && isObj(creds.claudeAiOauth) ? creds.claudeAiOauth : {}
  return {
    refresh: typeof o.refreshToken === 'string' ? o.refreshToken : '',
    access: typeof o.accessToken === 'string' ? o.accessToken : ''
  }
}

/** 憑證檔內容是否其實屬於另一個 slot（refresh／access token 與其他 slot 相同）。 */
export function credsBelongToOther(creds: unknown, slotId: string): boolean {
  const t = oauthTokens(creds)
  if (!t.refresh && !t.access) return false
  for (const s of listSlots()) {
    if (s.id === slotId) continue
    const o = oauthTokens(s.credentials)
    if ((t.refresh && o.refresh === t.refresh) || (t.access && o.access === t.access)) return true
  }
  return false
}

/**
 * 目前帳號的憑證若被 claude 更新，寫回對應 slot。回傳是否有寫入。
 * 憑證檔若是別的帳號的憑證（例如舊 claude 在切換瞬間 refresh 後寫回），不寫回、回傳 false。
 */
export function syncCurrentBack(): boolean {
  const acct = currentAccount()
  const slot = matchSlot(acct)
  if (!slot || !acct) return false
  const creds = storage.readJson(paths.credFile(), null)
  if (!isObj(creds) || !('claudeAiOauth' in creds)) return false
  if (isDeepStrictEqual(creds, slot.credentials)) return false
  if (credsBelongToOther(creds, slot.id)) return false
  slot.credentials = creds
  slot.oauth_account = acct
  updateSlot(slot)
  return true
}

export function switchTo(slotId: string): void {
  let slot = getSlot(slotId)
  if (!slot) throw new AccountError('找不到指定的帳號')
  syncCurrentBack()
  // 同步可能更新了目標 slot（目標即目前帳號時），重讀
  slot = getSlot(slotId) ?? slot
  storage.writeJsonAtomic(paths.credFile(), slot.credentials)
  const cj = paths.claudeJson()
  if (fs.existsSync(cj)) {
    const data = storage.readJsonStrict(cj)
    if (isObj(data)) {
      data.oauthAccount = slot.oauth_account
      storage.writeJsonAtomic(cj, data)
    }
  }
  if (!isDeepStrictEqual(storage.readJson(paths.credFile(), null), slot.credentials)) {
    throw new AccountError('切換後驗證失敗：憑證內容與帳號不一致')
  }
  storage.writeJsonAtomic(paths.activeFile(), { switched_at: Date.now() / 1000 })
}

export function deleteSlot(slotId: string): void {
  if (slotId === currentSlotId()) throw new AccountError('無法刪除使用中的帳號')
  try {
    fs.unlinkSync(slotPath(slotId))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

export function renameSlot(slotId: string, name: string): Slot {
  const trimmed = name.trim()
  if (!trimmed) throw new AccountError('名稱不可為空')
  const slot = getSlot(slotId)
  if (!slot) throw new AccountError('找不到指定的帳號')
  slot.name = trimmed
  updateSlot(slot)
  return slot
}

export function markExhausted(slotId: string, untilTs: number): void {
  const slot = getSlot(slotId)
  if (slot) {
    slot.exhausted_until = untilTs
    updateSlot(slot)
  }
}

export function clearExhausted(slotId: string): void {
  markExhausted(slotId, 0)
}
