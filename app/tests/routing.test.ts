import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { routingFile } from '../src/core/paths'
import {
  DEFAULT_ROUTING,
  loadRouting,
  maxConcurrent,
  ROLE_IDS,
  ROLE_LABELS,
  RoutingError,
  saveRouting,
  validateRouting,
  type Routing
} from '../src/core/routing'
import { readJson, writeJsonAtomic } from '../src/core/storage'
import { useTempEnv } from './helpers'

const clone = (): Routing => JSON.parse(JSON.stringify(DEFAULT_ROUTING)) as Routing

describe('routing', () => {
  useTempEnv()

  it('檔案不存在回傳預設', () => {
    expect(loadRouting()).toEqual(DEFAULT_ROUTING)
    expect(DEFAULT_ROUTING.max_concurrent_per_account).toBe(2)
    expect(DEFAULT_ROUTING.roles.implement).toEqual([
      { provider: 'agy', model: 'gemini-3.8-flash-high' },
      { provider: 'claude', model: 'sonnet' },
      { provider: 'agy', model: 'claude-sonnet-4-6' }
    ])
    for (const id of ROLE_IDS) expect(ROLE_LABELS[id]).toBeTruthy()
  })

  it('壞檔回傳預設', () => {
    fs.mkdirSync(path.dirname(routingFile()), { recursive: true })
    fs.writeFileSync(routingFile(), '{ not json')
    expect(loadRouting()).toEqual(DEFAULT_ROUTING)
  })

  it('缺少的 role 補預設、未知 role 忽略、不合法 role 用預設、max_concurrent_per_account 正確讀取', () => {
    writeJsonAtomic(routingFile(), {
      version: 1,
      max_concurrent_per_account: 4,
      roles: {
        research: [{ provider: 'agy', model: 'gemini-3.8-flash-tiered', accounts: ['abc123'] }],
        docs: [{ provider: 'claude', model: 'gpt' }],
        bogus: [{ provider: 'claude', model: 'opus' }]
      }
    })
    const r = loadRouting()
    expect(r.max_concurrent_per_account).toBe(4)
    expect(r.roles.research).toEqual([
      { provider: 'agy', model: 'gemini-3.8-flash-tiered', accounts: ['abc123'] }
    ])
    expect(r.roles.docs).toEqual(DEFAULT_ROUTING.roles.docs)
    expect(r.roles.spec).toEqual(DEFAULT_ROUTING.roles.spec)
    expect(Object.keys(r.roles).sort()).toEqual([...ROLE_IDS].sort())
  })

  it('max_concurrent_per_account 缺值或壞值時回退預設 2', () => {
    writeJsonAtomic(routingFile(), {
      version: 1,
      max_concurrent_per_account: 99,
      roles: DEFAULT_ROUTING.roles
    })
    expect(loadRouting().max_concurrent_per_account).toBe(2)

    writeJsonAtomic(routingFile(), {
      version: 1,
      roles: DEFAULT_ROUTING.roles
    })
    expect(loadRouting().max_concurrent_per_account).toBe(2)
  })

  it('maxConcurrent 函式在有效整數時回傳該值，否則回傳 2', () => {
    expect(maxConcurrent({ version: 1, max_concurrent_per_account: 5, roles: DEFAULT_ROUTING.roles })).toBe(5)
    expect(maxConcurrent({ version: 1, roles: DEFAULT_ROUTING.roles })).toBe(2)
    expect(maxConcurrent({ version: 1, max_concurrent_per_account: 0, roles: DEFAULT_ROUTING.roles })).toBe(2)
    expect(maxConcurrent({ version: 1, max_concurrent_per_account: 9, roles: DEFAULT_ROUTING.roles })).toBe(2)
  })

  it('saveRouting 驗證後寫入並可讀回；空 accounts 不保留；保留 max_concurrent_per_account', () => {
    const r = clone()
    r.max_concurrent_per_account = 3
    r.roles.implement = [{ provider: 'agy', model: 'claude-opus-4-6-thinking', accounts: [] }]
    saveRouting(r)
    const loaded = loadRouting()
    expect(loaded.max_concurrent_per_account).toBe(3)
    expect(loaded.roles.implement).toEqual([
      { provider: 'agy', model: 'claude-opus-4-6-thinking' }
    ])
    expect((readJson(routingFile()) as Routing).version).toBe(1)
  })

  const longList = Array.from({ length: 6 }, () => ({ provider: 'claude' as const, model: 'haiku' }))
  it.each([
    ['供應商不合法', (r: Routing) => ((r.roles.spec[0] as { provider: string }).provider = 'gpt'), '供應商'],
    ['claude 模型不合法', (r: Routing) => (r.roles.spec[0].model = 'gpt-5'), 'Claude 模型'],
    ['agy 模型不合法', (r: Routing) => (r.roles.implement[0].model = 'Bad Model!'), 'agy 模型'],
    ['空清單', (r: Routing) => (r.roles.docs = []), '至少'],
    ['超過 5 項', (r: Routing) => (r.roles.docs = longList), '最多'],
    ['缺少 role', (r: Routing) => delete (r.roles as Partial<Routing['roles']>).docs, '文件草稿'],
    ['max_concurrent_per_account 為 1.5', (r: Routing) => (r.max_concurrent_per_account = 1.5), '每個帳號同時執行上限必須是 1 到 8 的整數'],
    ['max_concurrent_per_account 為字串', (r: Routing) => ((r as unknown as { max_concurrent_per_account: unknown }).max_concurrent_per_account = '2'), '每個帳號同時執行上限必須是 1 到 8 的整數'],
    ['max_concurrent_per_account 為 0', (r: Routing) => (r.max_concurrent_per_account = 0), '每個帳號同時執行上限必須是 1 到 8 的整數'],
    ['max_concurrent_per_account 為 9', (r: Routing) => (r.max_concurrent_per_account = 9), '每個帳號同時執行上限必須是 1 到 8 的整數']
  ])('驗證錯誤：%s', (_n, mutate, msg) => {
    const r = clone()
    mutate(r)
    expect(() => saveRouting(r)).toThrow(RoutingError)
    expect(() => validateRouting(r)).toThrow(msg)
    expect(fs.existsSync(routingFile())).toBe(false)
  })
})
