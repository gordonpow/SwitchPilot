import { describe, expect, it, vi } from 'vitest'
import {
  AGY_BASE,
  agyUserAgent,
  fetchAgyQuota,
  readAgyQuota,
  writeAgyQuota,
  type AgyQuota
} from '../src/core/agyquota'
import { useTempEnv } from './helpers'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('fetchAgyQuota', () => {
  it('兩個請求、header 與 body 正確，只保留有 quotaInfo 的模型', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith(':loadCodeAssist')) return json(200, { currentTier: { id: 'free-tier' } })
      return json(200, {
        models: {
          'claude-sonnet-4-6': {
            quotaInfo: { remainingFraction: 0.026, resetTime: '2026-11-18T00:00:00Z' }
          },
          'gemini-x': { quotaInfo: { remainingFraction: 1 } },
          'no-quota': { displayName: 'n' },
          zero: { quotaInfo: { resetTime: '2026-11-18T00:00:00Z' } }
        }
      })
    })
    const q = await fetchAgyQuota('TOKEN-ABC', '1.5.8', fetchImpl)
    expect(q.error).toBeNull()
    expect(q.tier).toBe('free-tier')
    expect(Object.keys(q.models).sort()).toEqual(['claude-sonnet-4-6', 'gemini-x', 'zero'])
    expect(q.models['claude-sonnet-4-6']).toEqual({
      remaining: 0.026,
      resetAt: Date.parse('2026-11-18T00:00:00Z') / 1000
    })
    expect(q.models['gemini-x']).toEqual({ remaining: 1, resetAt: null })
    expect(q.models.zero.remaining).toBe(0)

    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      `${AGY_BASE}:loadCodeAssist`,
      `${AGY_BASE}:fetchAvailableModels`
    ])
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer TOKEN-ABC',
      'Content-Type': 'application/json',
      'User-Agent': 'antigravity/1.5.8 windows/amd64'
    })
    expect(JSON.parse(init.body as string)).toEqual({
      metadata: { ideType: 'ANTIGRAVITY', pluginType: 'GEMINI' }
    })
    expect(JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string)).toEqual({})
  })

  it('agyUserAgent 格式', () => {
    expect(agyUserAgent('2.0.1')).toBe('antigravity/2.0.1 windows/amd64')
  })

  it.each([401, 403])('HTTP %i：授權失效訊息', async (status) => {
    const q = await fetchAgyQuota('TOKEN-XYZ', '1.5.8', async () => json(status, {}))
    expect(q.error).toBe(`agy 授權失效或已過期（HTTP ${status}）`)
    expect(q.models).toEqual({})
  })

  it('其他 HTTP 錯誤：HTTP n', async () => {
    const q = await fetchAgyQuota('TOKEN-XYZ', '1.5.8', async () => json(500, {}))
    expect(q.error).toBe('HTTP 500')
  })

  it('第二個請求失敗也回報錯誤', async () => {
    const q = await fetchAgyQuota('TOKEN-XYZ', '1.5.8', async (url) =>
      url.endsWith(':loadCodeAssist') ? json(200, {}) : json(403, {})
    )
    expect(q.error).toContain('403')
  })

  it('網路錯誤訊息遮蔽 token', async () => {
    const q = await fetchAgyQuota('SECRET-TOKEN', '1.5.8', async () => {
      throw new Error('boom SECRET-TOKEN boom')
    })
    expect(q.error).toContain('<token>')
    expect(q.error).not.toContain('SECRET-TOKEN')
  })
})

describe('agy 額度快取', () => {
  useTempEnv()
  it('寫入後可讀回；不存在或壞 id 回傳 null', () => {
    const q: AgyQuota = {
      ts: 100,
      tier: 'free-tier',
      models: { m: { remaining: 0.5, resetAt: 200 } },
      error: null
    }
    expect(readAgyQuota('abc123')).toBeNull()
    writeAgyQuota('abc123', q)
    expect(readAgyQuota('abc123')).toEqual(q)
    expect(readAgyQuota('../evil')).toBeNull()
    expect(() => writeAgyQuota('../evil', q)).toThrow()
  })
})
