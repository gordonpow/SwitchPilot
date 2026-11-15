import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as accounts from '../src/core/accounts'
import * as config from '../src/core/config'
import * as paths from '../src/core/paths'
import * as storage from '../src/core/storage'
import { acct, creds, login, useTempEnv } from './helpers'

useTempEnv()

describe('accounts', () => {
  it('save new', () => {
    login('t1', 'u1', 'a@x')
    const s = accounts.saveCurrent('主帳號')
    expect(s.email).toBe('a@x')
    expect(accounts.listSlots()).toHaveLength(1)
    expect(accounts.currentSlotId()).toBe(s.id)
  })

  it('same uuid updates', () => {
    login('t1', 'u1', 'a@x')
    const s1 = accounts.saveCurrent('A')
    accounts.markExhausted(s1.id, 123)
    login('t2', 'u1', 'a@x')
    const s2 = accounts.saveCurrent('A2')
    expect(s2.id).toBe(s1.id)
    expect(accounts.listSlots()).toHaveLength(1)
    expect(s2.credentials).toEqual(creds('t2'))
    expect(s2.exhausted_until).toBe(123)
  })

  it('match by email without uuid', () => {
    login('t1', '', 'a@x')
    const s1 = accounts.saveCurrent('A')
    const s2 = accounts.saveCurrent('A again')
    expect(s2.id).toBe(s1.id)
    expect(accounts.currentSlotId()).toBe(s1.id)
  })

  it('addSlot new and update by uuid, not touching current login', () => {
    login('cur', 'u0', 'cur@x')
    const before = storage.readJson(paths.credFile())
    const s1 = accounts.addSlot('新', creds('n1'), acct('u9', 'n@x'))
    expect(s1.email).toBe('n@x')
    expect(accounts.getSlot(s1.id)!.credentials).toEqual(creds('n1'))
    accounts.markExhausted(s1.id, 55)
    const s2 = accounts.addSlot('新2', creds('n2'), acct('u9', 'n@x'))
    expect(s2.id).toBe(s1.id)
    expect(s2.exhausted_until).toBe(55)
    expect(accounts.listSlots()).toHaveLength(1)
    expect(storage.readJson(paths.credFile())).toEqual(before)
    expect(accounts.currentAccount()!.accountUuid).toBe('u0')
  })

  it('addSlot matches by email when uuid is empty, no duplicates', () => {
    const a = accounts.addSlot('A', creds('1'), { emailAddress: 'e@x' })
    const b = accounts.addSlot('B', creds('2'), { emailAddress: 'e@x' })
    expect(b.id).toBe(a.id)
    expect(accounts.listSlots()).toHaveLength(1)
    // 有 uuid 時只比 uuid（與 Python 一致）
    const c = accounts.addSlot('C', creds('3'), acct('uX', 'e@x'))
    expect(c.id).not.toBe(a.id)
  })

  it('not logged in', () => {
    expect(() => accounts.saveCurrent('x')).toThrow(accounts.AccountError)
    storage.writeJsonAtomic(paths.credFile(), creds('t'))
    expect(() => accounts.saveCurrent('x')).toThrow(accounts.AccountError)
  })

  it('switch syncs back then replaces', () => {
    const extra = { numStartups: 7, projects: { p: 1 } }
    login('t1', 'u1', 'a@x', extra)
    const a = accounts.saveCurrent('A')
    login('t1', 'u2', 'b@x', extra)
    const b = accounts.saveCurrent('B')
    storage.writeJsonAtomic(paths.credFile(), creds('t2-refreshed'))
    accounts.switchTo(a.id)
    expect(accounts.getSlot(b.id)!.credentials).toEqual(creds('t2-refreshed'))
    expect(storage.readJson(paths.credFile())).toEqual(creds('t1'))
    const cj = storage.readJson(paths.claudeJson()) as Record<string, any>
    expect(cj.oauthAccount.accountUuid).toBe('u1')
    expect(cj.numStartups).toBe(7)
    expect(cj.projects).toEqual({ p: 1 })
    expect(accounts.currentSlotId()).toBe(a.id)
    expect(storage.readJson(paths.activeFile())).toHaveProperty('switched_at')
  })

  it('switch without claude.json', () => {
    login('t1', 'u1', 'a@x')
    const a = accounts.saveCurrent('A')
    fs.rmSync(paths.claudeJson())
    accounts.switchTo(a.id)
    expect(fs.existsSync(paths.claudeJson())).toBe(false)
    expect(storage.readJson(paths.credFile())).toEqual(creds('t1'))
  })

  it('switch unknown slot', () => {
    expect(() => accounts.switchTo('nope')).toThrow(accounts.AccountError)
  })

  it('syncCurrentBack', () => {
    login('t1', 'u1', 'a@x')
    const a = accounts.saveCurrent('A')
    expect(accounts.syncCurrentBack()).toBe(false)
    storage.writeJsonAtomic(paths.credFile(), creds('new'))
    expect(accounts.syncCurrentBack()).toBe(true)
    expect(accounts.getSlot(a.id)!.credentials).toEqual(creds('new'))
  })

  it('syncCurrentBack：憑證檔是其他 slot 的憑證時不寫回', () => {
    login('t1', 'u1', 'a@x')
    const a = accounts.saveCurrent('A')
    const b = accounts.addSlot('B', creds('tB'), acct('u2', 'b@x'))
    // 舊 claude 在切換瞬間 refresh，把 B 的 refresh token 寫進目前（A）的憑證檔
    storage.writeJsonAtomic(paths.credFile(), {
      claudeAiOauth: { accessToken: 'new-access', refreshToken: 'r-tB' }
    })
    expect(accounts.syncCurrentBack()).toBe(false)
    expect(accounts.getSlot(a.id)!.credentials).toEqual(creds('t1'))
    expect(accounts.getSlot(b.id)!.credentials).toEqual(creds('tB'))
    // access token 相同也算
    storage.writeJsonAtomic(paths.credFile(), {
      claudeAiOauth: { accessToken: 'tB', refreshToken: 'other' }
    })
    expect(accounts.syncCurrentBack()).toBe(false)
    // 全新的 token 照常寫回
    storage.writeJsonAtomic(paths.credFile(), creds('fresh'))
    expect(accounts.syncCurrentBack()).toBe(true)
  })

  it('delete current refused', () => {
    login('t1', 'u1', 'a@x')
    const a = accounts.saveCurrent('A')
    expect(() => accounts.deleteSlot(a.id)).toThrow(accounts.AccountError)
    login('t2', 'u2', 'b@x')
    accounts.deleteSlot(a.id)
    expect(accounts.getSlot(a.id)).toBeNull()
    accounts.deleteSlot(a.id) // 已不存在也不丟錯
  })

  it('mark and clear exhausted', () => {
    login('t1', 'u1', 'a@x')
    const a = accounts.saveCurrent('A')
    accounts.markExhausted(a.id, 999.5)
    expect(accounts.getSlot(a.id)!.exhausted_until).toBe(999.5)
    accounts.clearExhausted(a.id)
    expect(accounts.getSlot(a.id)!.exhausted_until).toBe(0)
  })

  it('renameSlot', () => {
    login('t1', 'u1', 'a@x')
    const a = accounts.saveCurrent('A')
    const r = accounts.renameSlot(a.id, '  工作帳號 ')
    expect(r.name).toBe('工作帳號')
    expect(accounts.getSlot(a.id)!.name).toBe('工作帳號')
    expect(accounts.getSlot(a.id)!.credentials).toEqual(creds('t1'))
    expect(() => accounts.renameSlot(a.id, '   ')).toThrow(accounts.AccountError)
    expect(() => accounts.renameSlot('nope', 'x')).toThrow(accounts.AccountError)
  })

  it('reads Python-format slot (float saved_at, Chinese name), switches, writes back', () => {
    // 以 Python json.dump(ensure_ascii=False, indent=2) 產生的格式
    const pySlot =
      '{\n  "id": "ab12cd",\n  "name": "個人帳號",\n  "email": "p@x.com",\n  "account_uuid": "uuid-p",\n' +
      '  "credentials": {\n    "claudeAiOauth": {\n      "accessToken": "tok-p",\n      "refreshToken": "r-p",\n      "expiresAt": 1900000000000,\n      "scopes": ["user:inference"]\n    }\n  },\n' +
      '  "oauth_account": {\n    "accountUuid": "uuid-p",\n    "emailAddress": "p@x.com",\n    "displayName": "小明"\n  },\n' +
      '  "saved_at": 1731459000.123456,\n  "exhausted_until": 0\n}'
    fs.mkdirSync(paths.slotsDir(), { recursive: true })
    const file = path.join(paths.slotsDir(), 'ab12cd.json')
    fs.writeFileSync(file, pySlot, 'utf-8')
    login('cur', 'u-cur', 'cur@x')
    const cur = accounts.saveCurrent('目前')

    const s = accounts.getSlot('ab12cd')!
    expect(s.name).toBe('個人帳號')
    expect(s.saved_at).toBeCloseTo(1731459000.123456, 5)
    // saved_at 舊的在前
    expect(accounts.listSlots().map((x) => x.id)).toEqual(['ab12cd', cur.id])

    accounts.switchTo('ab12cd')
    expect(accounts.currentSlotId()).toBe('ab12cd')
    expect((storage.readJson(paths.credFile()) as any).claudeAiOauth.accessToken).toBe('tok-p')
    expect((storage.readJson(paths.claudeJson()) as any).oauthAccount.displayName).toBe('小明')

    accounts.markExhausted('ab12cd', 1900000000.5)
    accounts.renameSlot('ab12cd', '新名稱')
    const text = fs.readFileSync(file, 'utf-8')
    const back = JSON.parse(text)
    expect(back.id).toBe('ab12cd')
    expect(back.name).toBe('新名稱')
    expect(back.email).toBe('p@x.com')
    expect(back.account_uuid).toBe('uuid-p')
    expect(back.saved_at).toBeCloseTo(1731459000.123456, 5)
    expect(back.exhausted_until).toBe(1900000000.5)
    expect(back.credentials.claudeAiOauth.scopes).toEqual(['user:inference'])
    expect(back.oauth_account.displayName).toBe('小明')
    expect(text).toContain('新名稱') // 中文不得被跳脫
  })
})

describe('config', () => {
  it('defaults and merge', () => {
    expect(config.load()).toEqual({
      threshold: 95,
      threshold_weekly: 95,
      auto_switch: true,
      last_folder: '',
      login_browser: 'chrome',
      usage_poll_seconds: 120,
      manage_external: true,
      continue_prompt: '繼續',
      switch_mode: 'live',
      switch_to_earliest: true,
      auto_compact: config.AUTO_COMPACT_DEFAULTS,
      close_to_tray: false,
      launch_at_login: false,
      language: 'auto',
      routing_enabled: true,
      update_check: true,
      update_include_prerelease: true,
      update_notified_version: ''
    })
    config.save({ threshold: 80 })
    const cfg = config.load()
    expect(cfg.threshold).toBe(80)
    expect(cfg.threshold_weekly).toBe(80)
    expect(cfg.auto_switch).toBe(true)
    expect(cfg.usage_poll_seconds).toBe(120)
  })

  it('bad config falls back to defaults', () => {
    fs.mkdirSync(paths.appDir(), { recursive: true })
    fs.writeFileSync(paths.configFile(), '{ nope')
    expect(config.load().threshold).toBe(95)
  })
})
