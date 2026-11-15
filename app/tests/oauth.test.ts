import { describe, expect, it } from 'vitest'
import * as accounts from '../src/core/accounts'
import * as oauth from '../src/core/oauth'
import * as paths from '../src/core/paths'
import * as storage from '../src/core/storage'
import { acct, login, useTempEnv } from './helpers'

useTempEnv()

const NOW = 1_800_000_000_000
const FAR = NOW + 3600_000

type Handler = (body: Record<string, unknown>, token: string) => Response | Promise<Response>
interface Fake {
  impl: typeof fetch
  usageCalls: string[]
  refreshCalls: string[]
}

const json = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const okUsage = (pct = 50): Response =>
  json(200, {
    five_hour: { utilization: pct, resets_at: '2026-11-12T21:10:00.344194+00:00' },
    seven_day: null
  })

function fake(usage: Handler, refresh: Handler = () => json(500)): Fake {
  const f: Fake = {
    usageCalls: [],
    refreshCalls: [],
    impl: (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/oauth/usage')) {
        const auth = String((init?.headers as Record<string, string>).Authorization)
        const token = auth.replace('Bearer ', '')
        f.usageCalls.push(token)
        return usage({}, token)
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      f.refreshCalls.push(String(body.refresh_token))
      return refresh(body, '')
    }) as unknown as typeof fetch
  }
  return f
}

/** 建立帳號 A（非使用中）與 B（使用中）。 */
function setup(aOauth: Record<string, unknown> = {}): { a: string; b: string } {
  login('a-access', 'ua', 'a@x')
  const a = accounts.saveCurrent('A')
  accounts.updateSlot({
    ...a,
    credentials: {
      other: 'keep',
      claudeAiOauth: {
        accessToken: 'a-access',
        refreshToken: 'a-refresh',
        expiresAt: FAR,
        scopes: ['user:profile', 'user:inference'],
        subscriptionType: 'max',
        ...aOauth
      }
    }
  })
  login('b-access', 'ub', 'b@x')
  storage.writeJsonAtomic(paths.credFile(), {
    claudeAiOauth: { accessToken: 'b-access', refreshToken: 'b-refresh', expiresAt: FAR }
  })
  const b = accounts.saveCurrent('B')
  return { a: a.id, b: b.id }
}

const slotOauth = (id: string): Record<string, unknown> =>
  (accounts.getSlot(id)!.credentials as { claudeAiOauth: Record<string, unknown> }).claudeAiOauth

function poller(f: Fake, extra: Partial<oauth.PollerDeps> = {}): oauth.UsagePoller {
  return new oauth.UsagePoller({ fetchImpl: f.impl, now: () => NOW, retryDelayMs: 0, ...extra })
}

describe('暫時性錯誤', () => {
  it('5xx 或網路錯誤重試一次後成功', async () => {
    const { a } = setup()
    let n = 0
    const f = fake((_b, token) => {
      if (token !== 'a-access') return okUsage(1)
      n += 1
      if (n === 1) throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') })
      return okUsage(33)
    })
    await poller(f).pollAll()
    const rec = oauth.readUsageApi(a)!
    expect(rec.error).toBeNull()
    expect(rec.five_hour?.used_percentage).toBe(33)
    expect(n).toBe(2)
  })

  it('重試仍失敗時錯誤含原因，且遮蔽 token', async () => {
    const { a } = setup()
    const logs: string[] = []
    const f = fake((_b, token) =>
      token === 'a-access' ? json(503) : okUsage(1)
    )
    await poller(f, { log: (_l, t) => logs.push(t) }).pollAll()
    expect(oauth.readUsageApi(a)!.error).toBe('用量 API 暫時無法使用（用量 API 回應 HTTP 503）')
    expect(logs.join('\n')).toContain('HTTP 503')

    const d = oauth.errDetail(new Error('bad a-access here'), ['a-access'])
    expect(d).toBe('bad <token> here')
  })

  it('401／429 不走一般重試', async () => {
    setup()
    const f = fake(() => json(429))
    await poller(f).pollAll()
    expect(f.usageCalls.length).toBe(2) // A、B 各一次，沒有重試
  })
})

describe('fetchUsage', () => {
  it('轉換 ISO、限制 0-100、null 與缺欄位', async () => {
    const f = fake(() =>
      json(200, {
        five_hour: { utilization: 53.0, resets_at: '2026-11-12T21:10:00.344194+00:00' },
        seven_day: { utilization: 130, resets_at: '2026-11-19T00:00:00+00:00' },
        other: 1
      })
    )
    const r = await oauth.fetchUsage('tok', f.impl)
    expect(r.five_hour).toEqual({
      used_percentage: 53,
      resets_at: Math.floor(Date.parse('2026-11-12T21:10:00.344194+00:00') / 1000)
    })
    expect(r.seven_day?.used_percentage).toBe(100)

    const neg = await oauth.fetchUsage(
      'tok',
      fake(() => json(200, { five_hour: { utilization: -5, resets_at: '2026-11-12T21:10:00Z' } })).impl
    )
    expect(neg.five_hour?.used_percentage).toBe(0)
    expect(neg.seven_day).toBeNull()

    const nul = await oauth.fetchUsage(
      'tok',
      fake(() => json(200, { five_hour: null, seven_day: { utilization: 1 } })).impl
    )
    expect(nul).toEqual({ five_hour: null, seven_day: null })
  })

  it('401、429、其他錯誤', async () => {
    await expect(oauth.fetchUsage('t', fake(() => json(401)).impl)).rejects.toBeInstanceOf(
      oauth.TokenExpiredError
    )
    await expect(oauth.fetchUsage('t', fake(() => json(429)).impl)).rejects.toBeInstanceOf(
      oauth.RateLimitedError
    )
    await expect(oauth.fetchUsage('t', fake(() => json(500)).impl)).rejects.toThrow('500')
  })
})

describe('refreshToken', () => {
  it('更新三個欄位、保留其他欄位；缺 refresh_token 沿用舊的', async () => {
    let sent: Record<string, unknown> = {}
    const f = fake(
      () => json(500),
      (body) => {
        sent = body
        return json(200, { access_token: 'n-a', expires_in: 100 })
      }
    )
    const r = await oauth.refreshToken(
      { accessToken: 'o', refreshToken: 'o-r', expiresAt: 1, scopes: ['a', 'b'], x: 1 },
      f.impl,
      () => 1000
    )
    expect(r).toMatchObject({ accessToken: 'n-a', refreshToken: 'o-r', expiresAt: 101000, x: 1 })
    expect(sent).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'o-r', scope: 'a b' })
  })

  it('400／401 丟 RefreshFailedError', async () => {
    for (const s of [400, 401]) {
      await expect(
        oauth.refreshToken(
          { accessToken: 'o', refreshToken: 'r', expiresAt: 1 },
          fake(
            () => json(500),
            () => json(s)
          ).impl
        )
      ).rejects.toBeInstanceOf(oauth.RefreshFailedError)
    }
  })
})

describe('UsagePoller', () => {
  it('正常查詢並寫 usage_api 紀錄', async () => {
    const { a, b } = setup()
    const f = fake(() => okUsage(40))
    expect(await poller(f).pollAll()).toBe(true)
    const rec = oauth.readUsageApi(a)!
    expect(rec).toMatchObject({
      slot_id: a,
      ts: NOW / 1000,
      error: null,
      needs_relogin: false,
      saved_at: accounts.getSlot(a)!.saved_at
    })
    expect(rec.five_hour?.used_percentage).toBe(40)
    expect(rec.seven_day).toBeNull()
    expect(oauth.readUsageApi(b)).not.toBeNull()
  })

  it('401 → refresh → 重試成功，並寫回 slot', async () => {
    const { a } = setup()
    const f = fake(
      (_b, token) => (token === 'new-access' ? okUsage(10) : token === 'b-access' ? okUsage(1) : json(401)),
      () => json(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
    )
    await poller(f).pollAll()
    const rec = oauth.readUsageApi(a)!
    expect(rec.error).toBeNull()
    expect(rec.five_hour?.used_percentage).toBe(10)
    expect(f.refreshCalls).toEqual(['a-refresh'])
    expect(slotOauth(a)).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: NOW + 3600_000,
      subscriptionType: 'max'
    })
  })

  it('10 分鐘內到期就先 refresh', async () => {
    const { a } = setup({ expiresAt: NOW + 5 * 60_000 })
    const f = fake(
      () => okUsage(),
      () => json(200, { access_token: 'n2', expires_in: 3600 })
    )
    await poller(f).pollAll()
    expect(f.refreshCalls).toEqual(['a-refresh'])
    expect(f.usageCalls).toContain('n2')
    expect(slotOauth(a).refreshToken).toBe('a-refresh')
  })

  it('refresh 失敗 → needs_relogin，之後不再重試，saved_at 改變後恢復', async () => {
    const { a } = setup()
    const f = fake(
      (_b, t) => (t === 'b-access' ? okUsage() : json(401)),
      () => json(400)
    )
    const p = poller(f)
    await p.pollAll()
    const rec = oauth.readUsageApi(a)!
    expect(rec.needs_relogin).toBe(true)
    expect(rec.error).toBe('token 已過期，需要重新登入')
    expect(f.refreshCalls).toHaveLength(1)

    await p.pollAll()
    expect(f.refreshCalls).toHaveLength(1)

    const s = accounts.getSlot(a)!
    accounts.updateSlot({ ...s, saved_at: s.saved_at + 10 })
    await p.pollAll()
    expect(f.refreshCalls).toHaveLength(2)
    expect(oauth.readUsageApi(a)!.saved_at).toBe(s.saved_at + 10)
  })

  it('他方已輪替 refresh token：用新的重試一次', async () => {
    const { a } = setup()
    const f = fake(
      (_b, t) => (t === 'a-access' ? json(401) : okUsage(20)),
      (body) => {
        if (body.refresh_token === 'a-refresh') {
          const s = accounts.getSlot(a)!
          accounts.updateSlot({
            ...s,
            credentials: {
              ...s.credentials,
              claudeAiOauth: { ...slotOauth(a), refreshToken: 'a-refresh2' }
            }
          })
          return json(400)
        }
        return json(200, { access_token: 'fresh', refresh_token: 'a-refresh3', expires_in: 60 })
      }
    )
    await poller(f).pollAll()
    expect(f.refreshCalls).toEqual(['a-refresh', 'a-refresh2'])
    expect(oauth.readUsageApi(a)!.needs_relogin).toBe(false)
    expect(slotOauth(a)).toMatchObject({ accessToken: 'fresh', refreshToken: 'a-refresh3' })
  })

  it('他方輪替後重試仍失敗 → needs_relogin（只重試一次）', async () => {
    const { a } = setup()
    const f = fake(
      (_b, t) => (t === 'a-access' ? json(401) : okUsage()),
      (body) => {
        if (body.refresh_token === 'a-refresh') {
          const s = accounts.getSlot(a)!
          accounts.updateSlot({
            ...s,
            credentials: { ...s.credentials, claudeAiOauth: { ...slotOauth(a), refreshToken: 'x2' } }
          })
        }
        return json(400)
      }
    )
    await poller(f).pollAll()
    expect(f.refreshCalls).toEqual(['a-refresh', 'x2'])
    expect(oauth.readUsageApi(a)!.needs_relogin).toBe(true)
  })

  it('429：10 分鐘內不再查', async () => {
    const { a } = setup()
    let t = NOW
    const f = fake((_b, tok) => (tok === 'a-access' ? json(429) : okUsage()))
    const p = new oauth.UsagePoller({ fetchImpl: f.impl, now: () => t })
    await p.pollAll()
    expect(oauth.readUsageApi(a)!.error).toBe('查詢太頻繁，稍後再試')
    const n = f.usageCalls.filter((x) => x === 'a-access').length
    expect(n).toBe(1)
    t = NOW + 60_000
    await p.pollAll()
    expect(f.usageCalls.filter((x) => x === 'a-access')).toHaveLength(1)
    t = NOW + 11 * 60_000
    await p.pollAll()
    expect(f.usageCalls.filter((x) => x === 'a-access')).toHaveLength(2)
  })

  it('使用中帳號不 refresh；已過期則略過', async () => {
    const { a, b } = setup()
    // B 使用中，快到期但未過期：直接查詢、不 refresh
    storage.writeJsonAtomic(paths.credFile(), {
      claudeAiOauth: { accessToken: 'b-access', refreshToken: 'b-refresh', expiresAt: NOW + 60_000 }
    })
    const f = fake(() => okUsage(), () => json(200, { access_token: 'zzz', expires_in: 1 }))
    await poller(f).pollAll()
    expect(f.usageCalls).toContain('b-access')
    expect(oauth.readUsageApi(b)!.error).toBeNull()

    // 已過期：不查、不 refresh
    storage.writeJsonAtomic(paths.credFile(), {
      claudeAiOauth: { accessToken: 'b-access', refreshToken: 'b-refresh', expiresAt: NOW - 1 }
    })
    const f2 = fake(() => okUsage(), () => json(200, { access_token: 'zzz', expires_in: 1 }))
    await poller(f2).pollAll()
    expect(f2.usageCalls).not.toContain('b-access')
    expect(f2.refreshCalls).toEqual([])
    expect(oauth.readUsageApi(b)!.error).toBe('token_expired_active')
    expect(a).not.toBe(b)

    // 使用中帳號收到 401：不 refresh
    storage.writeJsonAtomic(paths.credFile(), {
      claudeAiOauth: { accessToken: 'b-access', refreshToken: 'b-refresh', expiresAt: FAR }
    })
    const f3 = fake((_b, t) => (t === 'b-access' ? json(401) : okUsage()))
    await poller(f3).pollAll()
    expect(f3.refreshCalls).toEqual([])
    expect(oauth.readUsageApi(b)!.error).toBe('token_expired_active')
  })

  it('refresh 後只替換 claudeAiOauth，保留並行修改', async () => {
    const { a } = setup()
    const f = fake(
      (_b, t) => (t === 'a-access' ? json(401) : okUsage()),
      () => {
        const s = accounts.getSlot(a)!
        accounts.updateSlot({ ...s, name: '改名', exhausted_until: 999, extra_field: 'x' })
        return json(200, { access_token: 'n', expires_in: 60 })
      }
    )
    await poller(f).pollAll()
    const s = accounts.getSlot(a)!
    expect(s.name).toBe('改名')
    expect(s.exhausted_until).toBe(999)
    expect(s.extra_field).toBe('x')
    expect((s.credentials as Record<string, unknown>).other).toBe('keep')
    expect(slotOauth(a)).toMatchObject({
      accessToken: 'n',
      refreshToken: 'a-refresh',
      scopes: ['user:profile', 'user:inference'],
      subscriptionType: 'max'
    })
  })

  it('refresh 期間變成使用中：refreshToken 相同 → 同步寫入 cred_file', async () => {
    const { a } = setup()
    const f = fake(
      (_b, t) => (t === 'a-access' ? json(401) : okUsage()),
      () => {
        // 使用者切換到 A：cred_file 為 A 的憑證
        storage.writeJsonAtomic(paths.credFile(), {
          keep: 1,
          claudeAiOauth: { accessToken: 'a-access', refreshToken: 'a-refresh', expiresAt: FAR }
        })
        storage.writeJsonAtomic(paths.claudeJson(), { oauthAccount: acct('ua', 'a@x') })
        return json(200, { access_token: 'n', refresh_token: 'n-r', expires_in: 60 })
      }
    )
    await poller(f).pollAll()
    const cred = storage.readJson(paths.credFile()) as Record<string, any>
    expect(cred.keep).toBe(1)
    expect(cred.claudeAiOauth).toMatchObject({ accessToken: 'n', refreshToken: 'n-r' })
    expect(slotOauth(a)).toMatchObject({ accessToken: 'n', refreshToken: 'n-r' })
    expect(oauth.readUsageApi(a)!.needs_relogin).toBe(false)
  })

  it('refresh 期間變成使用中：refreshToken 不同 → 丟棄並 needs_relogin', async () => {
    const { a } = setup()
    const logs: string[] = []
    const f = fake(
      (_b, t) => (t === 'a-access' ? json(401) : okUsage()),
      () => {
        storage.writeJsonAtomic(paths.credFile(), {
          claudeAiOauth: { accessToken: 'other', refreshToken: 'other-r', expiresAt: FAR }
        })
        storage.writeJsonAtomic(paths.claudeJson(), { oauthAccount: acct('ua', 'a@x') })
        return json(200, { access_token: 'n', refresh_token: 'n-r', expires_in: 60 })
      }
    )
    await poller(f, { log: (_l, t) => logs.push(t) }).pollAll()
    expect(oauth.readUsageApi(a)!.needs_relogin).toBe(true)
    expect(slotOauth(a)).toMatchObject({ accessToken: 'a-access', refreshToken: 'a-refresh' })
    const cred = storage.readJson(paths.credFile()) as Record<string, any>
    expect(cred.claudeAiOauth.accessToken).toBe('other')
    expect(logs.some((l) => l.includes('丟棄'))).toBe(true)
  })

  it('isPaused 中止：帳號之間檢查', async () => {
    const { a, b } = setup()
    let calls = 0
    const f = fake(() => okUsage())
    const p = poller(f, { isPaused: () => calls++ >= 2 }) // 開始前、第一個帳號前通過，第二個前暫停
    expect(await p.pollAll()).toBe(false)
    const n = [a, b].filter((id) => oauth.readUsageApi(id)).length
    expect(n).toBe(1)
    expect(p.running).toBe(false)

    const f2 = fake(() => okUsage())
    expect(await poller(f2, { isPaused: () => true }).pollAll()).toBe(false)
    expect(f2.usageCalls).toEqual([])
  })

  it('log 不含 token', async () => {
    setup()
    const logs: string[] = []
    const failing = fake(
      (_b, t) => (t === 'a-access' ? json(401) : json(500)),
      () => json(400)
    )
    await poller(failing, { log: (l, t) => logs.push(`${l} ${t}`) }).pollAll()
    const ok = fake(
      () => okUsage(),
      () => json(200, { access_token: 'secret-new', refresh_token: 'secret-r', expires_in: 5 })
    )
    const s = accounts.listSlots().find((x) => x.name === 'A')!
    accounts.updateSlot({ ...s, saved_at: s.saved_at + 1 })
    await poller(ok, { log: (l, t) => logs.push(`${l} ${t}`) }).pollAll()
    expect(logs.length).toBeGreaterThan(0)
    const all = logs.join('\n')
    for (const tok of ['a-access', 'a-refresh', 'b-access', 'b-refresh', 'secret-new', 'secret-r']) {
      expect(all).not.toContain(tok)
    }
  })

  it('pollAll 不重疊', async () => {
    setup()
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const f = fake(async () => {
      await gate
      return okUsage()
    })
    const p = poller(f)
    const first = p.pollAll()
    expect(p.running).toBe(true)
    expect(await p.pollAll()).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(p.running).toBe(false)
    expect(f.usageCalls.length).toBe(2) // 兩個帳號各查一次，第二次呼叫沒有多查
  })
})

describe('ensureFresh／needsRelogin', () => {
  it('未到期 → ok，不 refresh', async () => {
    const { a } = setup()
    const f = fake(() => okUsage())
    expect(await poller(f).ensureFresh(a)).toBe('ok')
    expect(f.refreshCalls).toEqual([])
  })

  it('到期 → refresh 成功 → ok 且 slot 更新', async () => {
    const { a } = setup({ expiresAt: NOW + 5 * 60_000 })
    const f = fake(
      () => okUsage(),
      () => json(200, { access_token: 'n2', refresh_token: 'r2', expires_in: 3600 })
    )
    expect(await poller(f).ensureFresh(a)).toBe('ok')
    expect(f.refreshCalls).toEqual(['a-refresh'])
    expect(slotOauth(a).accessToken).toBe('n2')
  })

  it('refresh 400 → dead，寫 needs_relogin，needsRelogin 為 true；saved_at 變動後為 false', async () => {
    const { a } = setup({ expiresAt: NOW - 1000 })
    const f = fake(() => okUsage(), () => json(400))
    expect(await poller(f).ensureFresh(a)).toBe('dead')
    const rec = oauth.readUsageApi(a)!
    expect(rec.needs_relogin).toBe(true)
    expect(rec.error).toBe('token 已過期，需要重新登入')
    const s = accounts.getSlot(a)!
    expect(oauth.needsRelogin(s)).toBe(true)
    expect(oauth.needsRelogin({ id: a, saved_at: s.saved_at + 1 })).toBe(false)
  })

  it('網路錯誤 → error，不寫 needs_relogin，log 不含 token', async () => {
    const { a } = setup({ expiresAt: NOW - 1000 })
    const logs: string[] = []
    const f = fake(
      () => okUsage(),
      () => {
        throw new Error('boom a-refresh')
      }
    )
    const p = poller(f, { log: (_l, t) => logs.push(t) })
    expect(await p.ensureFresh(a)).toBe('error')
    expect(oauth.readUsageApi(a)).toBeNull()
    expect(logs.join('\n')).not.toContain('a-refresh')
  })

  it('使用中帳號 → ok，不打 refresh', async () => {
    const { b } = setup()
    const f = fake(() => okUsage())
    expect(await poller(f).ensureFresh(b)).toBe('ok')
    expect(f.refreshCalls).toEqual([])
  })
})

describe('403 擋下與 User-Agent', () => {
  it('請求帶本程式 User-Agent', async () => {
    let ua = ''
    const impl = (async (_u: string, init?: RequestInit) => {
      ua = String((init?.headers as Record<string, string>)['User-Agent'])
      return okUsage()
    }) as unknown as typeof fetch
    await oauth.fetchUsage('tok', impl)
    expect(ua).toBe(oauth.USER_AGENT)
  })

  it('403 → 不重試、其餘帳號本輪跳過、15 分鐘內不再查詢，之後恢復', async () => {
    setup()
    let now = NOW
    const f = fake(() => json(403))
    const logs: string[] = []
    const p = poller(f, { now: () => now, log: (_l, t) => logs.push(t) })
    await p.pollAll()
    expect(f.usageCalls).toHaveLength(1)
    expect(logs.some((t) => t.includes('403'))).toBe(true)

    now += oauth.BLOCKED_BACKOFF_MS - 1000
    await p.pollAll()
    expect(f.usageCalls).toHaveLength(1)

    now += 2000
    await p.pollAll()
    expect(f.usageCalls.length).toBeGreaterThan(1)
  })
})
