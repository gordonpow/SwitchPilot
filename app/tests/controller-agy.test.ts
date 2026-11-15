// controller 的 agy 帳號：新增流程（R-1）、切換、額度 poller、模型分工。全部使用假的認證管理員、假程序表、假 fetch。
import * as fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgyCred, AgyCredOps } from '../src/core/agycred'
import { listAgySlots } from '../src/core/agyaccounts'
import { readAgyQuota, writeAgyQuota } from '../src/core/agyquota'
import { acquireFileLock } from '../src/core/filelock'
import * as paths from '../src/core/paths'
import { registerRunning, unregisterRunning } from '../src/core/dispatchlog'
import { DEFAULT_ROUTING } from '../src/core/routing'
import type { ProcInfo } from '../src/core/sessions'
import * as storage from '../src/core/storage'
import { Controller, type ControllerDeps } from '../src/main/controller'
import type { Routing } from '../src/shared/types'
import { useTempEnv } from './helpers'

const FUTURE = Date.now() + 3600_000
const mkBlob = (email: string | null, tok = 'tok', expiryMs: number = FUTURE): string =>
  JSON.stringify({
    ...(email ? { id_token_email: email } : {}),
    token: { access_token: tok, expiry: new Date(expiryMs).toISOString() }
  })

interface FakeOps extends AgyCredOps {
  cur: AgyCred | null
  writes: { blob: string; slotsAtWrite: number }[]
}

function fakeOps(init: AgyCred | null): FakeOps {
  const o: FakeOps = {
    cur: init,
    writes: [],
    read: async () => o.cur,
    write: async (c) => {
      o.writes.push({ blob: c.blob, slotsAtWrite: listAgySlots().length })
      o.cur = c
    },
    remove: async () => {
      o.cur = null
    }
  }
  return o
}

const agyProc: ProcInfo = { pid: 4242, ppid: 1, name: 'agy.exe', cmdline: 'agy.exe', created: 1 }

describe('Controller agy', () => {
  useTempEnv()
  const ctls: Controller[] = []
  afterEach(async () => {
    for (const c of ctls.splice(0)) await c.dispose()
  })

  let clock = Date.now()
  let procs: ProcInfo[] = []
  let launches = 0
  let launchThrows = false
  let fetchCalls: string[] = []
  let fetchImpl: (url: string, init: RequestInit) => Promise<Response> = async () => {
    throw new Error('no fetch')
  }

  function make(ops: AgyCredOps, extra: ControllerDeps = {}): Controller {
    clock = Date.now()
    procs = []
    launches = 0
    launchThrows = false
    fetchCalls = []
    const c = new Controller({
      disablePoll: true,
      now: () => clock,
      agyCred: ops,
      agyVersion: async () => '1.5.8',
      agyFetch: (url, init) => {
        fetchCalls.push(url)
        return fetchImpl(url, init)
      },
      launchAgyLogin: () => {
        launches++
        if (launchThrows) throw new Error('wt 不存在')
      },
      cli: {
        listProcesses: async () => procs,
        kill: async () => false,
        inject: async () => false,
        injectSubmit: async () => false
      },
      ...extra
    })
    ctls.push(c)
    return c
  }

  function saveSlot(id: string, email: string, blob: string, name = id): void {
    storage.writeJsonAtomic(`${paths.agySlotsDir()}/${id}.json`, {
      id,
      name,
      email,
      user: 'u',
      blob,
      saved_at: 1
    })
  }

  const backupExists = (): boolean => fs.existsSync(paths.agyLoginBackupFile())
  const lockFree = (): boolean => {
    const l = acquireFileLock(paths.agyLockFile(), { staleMs: 1000 })
    l?.release()
    return !!l
  }

  const A = mkBlob('a@x.com', 'tokA')
  const B = mkBlob('b@x.com', 'tokB')

  describe('新增 agy 帳號流程', () => {
    it('成功：先存新 slot 再還原 backup；見過 agy.exe 後連續兩次沒有才完成', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      const r = await c.agyStartLogin()
      expect(r.ok).toBe(true)
      expect(launches).toBe(1)
      expect(ops.cur).toBeNull()
      expect(backupExists()).toBe(true)
      // 原登入尚未有 slot：先存成 slot
      expect(listAgySlots().map((s) => s.email)).toEqual(['a@x.com'])
      expect(c.getState().agyLogin.state).toBe('waiting')

      await c.agyLoginTick()
      expect(c.getState().agyLogin.state).toBe('waiting')

      ops.cur = { user: 'ub', blob: B }
      procs = [agyProc]
      await c.agyLoginTick()
      expect(c.getState().agyLogin.state).toBe('signed_in')
      expect(c.getState().agyLogin.email).toBe('b@x.com')

      procs = []
      await c.agyLoginTick() // 第 1 次沒有
      expect(c.getState().agyLogin.state).toBe('signed_in')
      await c.agyLoginTick() // 第 2 次沒有
      const st = c.getState()
      expect(st.agyLogin.state).toBe('done')
      expect(listAgySlots().map((s) => s.email).sort()).toEqual(['a@x.com', 'b@x.com'])
      expect(ops.cur?.blob).toBe(A)
      // 還原時新 slot 已存在（2 個 slot）
      expect(ops.writes).toHaveLength(1)
      expect(ops.writes[0].slotsAtWrite).toBe(2)
      expect(backupExists()).toBe(false)
      expect(lockFree()).toBe(true)
      expect(JSON.stringify(st)).not.toContain('tokA')
      expect(JSON.stringify(st)).not.toContain('tokB')
    })

    it('沒見過 agy.exe 不會完成；agy 再出現會重置連續計數', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      await c.agyStartLogin()
      ops.cur = { user: 'ub', blob: B }
      for (let i = 0; i < 4; i++) await c.agyLoginTick()
      expect(c.getState().agyLogin.state).toBe('signed_in')

      procs = [agyProc]
      await c.agyLoginTick()
      procs = []
      await c.agyLoginTick() // 1
      procs = [agyProc]
      await c.agyLoginTick() // 重置
      procs = []
      await c.agyLoginTick() // 1
      expect(c.getState().agyLogin.state).toBe('signed_in')
      await c.agyLoginTick() // 2
      expect(c.getState().agyLogin.state).toBe('done')
    })

    it('使用者按完成：已偵測到登入就結束；未偵測到則拒絕', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      await c.agyStartLogin()
      expect((await c.agyFinishLogin()).ok).toBe(false)
      ops.cur = { user: 'ub', blob: B }
      await c.agyLoginTick()
      expect((await c.agyFinishLogin()).ok).toBe(true)
      expect(c.getState().agyLogin.state).toBe('done')
      expect(ops.cur?.blob).toBe(A)
    })

    it('原本沒有登入：新登入存成 slot，不還原', async () => {
      const ops = fakeOps(null)
      const c = make(ops)
      await c.agyStartLogin()
      expect(backupExists()).toBe(false)
      ops.cur = { user: 'ub', blob: B }
      procs = [agyProc]
      await c.agyLoginTick()
      procs = []
      await c.agyLoginTick()
      await c.agyLoginTick()
      expect(c.getState().agyLogin.state).toBe('done')
      expect(listAgySlots()).toHaveLength(1)
      expect(ops.writes).toHaveLength(0)
      expect(ops.cur?.blob).toBe(B)
    })

    it('登入失敗（沒有新 blob）：還原 backup', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      await c.agyStartLogin()
      procs = [agyProc]
      await c.agyLoginTick()
      procs = []
      await c.agyLoginTick()
      await c.agyLoginTick()
      const st = c.getState()
      expect(st.agyLogin.state).toBe('error')
      expect(st.agyLogin.message).toContain('已還原')
      expect(ops.cur?.blob).toBe(A)
      expect(backupExists()).toBe(false)
      expect(lockFree()).toBe(true)
      expect(listAgySlots().map((s) => s.email)).toEqual(['a@x.com'])
    })

    it('逾時（10 分鐘）：還原 backup', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      await c.agyStartLogin()
      clock += 11 * 60_000
      await c.agyLoginTick()
      expect(c.getState().agyLogin.state).toBe('error')
      expect(c.getState().agyLogin.message).toContain('逾時')
      expect(ops.cur?.blob).toBe(A)
      expect(backupExists()).toBe(false)
      expect(lockFree()).toBe(true)
    })

    it('取消：認證管理員為空時還原，狀態回 idle', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      await c.agyStartLogin()
      expect((await c.agyCancelLogin()).ok).toBe(true)
      expect(c.getState().agyLogin.state).toBe('idle')
      expect(ops.cur?.blob).toBe(A)
      expect(backupExists()).toBe(false)
      expect(lockFree()).toBe(true)
    })

    it('無法開啟 agy：還原並回報失敗', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      launchThrows = true
      const r = await c.agyStartLogin()
      expect(r.ok).toBe(false)
      expect(ops.cur?.blob).toBe(A)
      expect(backupExists()).toBe(false)
      expect(lockFree()).toBe(true)
      expect(c.getState().agyLogin.state).toBe('error')
    })

    it('agy 執行中或鎖被持有：拒絕且不動認證管理員', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      procs = [agyProc]
      const r1 = await c.agyStartLogin()
      expect(r1.ok).toBe(false)
      expect(!r1.ok && r1.error).toContain('關閉所有 agy')
      procs = []
      const held = acquireFileLock(paths.agyLockFile(), { staleMs: 60_000 })
      expect(held).not.toBeNull()
      const r2 = await c.agyStartLogin()
      expect(!r2.ok && r2.error).toContain('派工')
      held?.release()
      expect(ops.cur?.blob).toBe(A)
      expect(launches).toBe(0)
      expect(backupExists()).toBe(false)
    })

    it('啟動時 login-backup 還原：認證管理員為空才還原，否則只刪檔', async () => {
      storage.writeJsonAtomic(paths.agyLoginBackupFile(), { user: 'ua', blob: A, started_at: 1 })
      const ops = fakeOps(null)
      const c = make(ops)
      await c.restoreAgyLoginBackup()
      expect(ops.cur?.blob).toBe(A)
      expect(backupExists()).toBe(false)

      storage.writeJsonAtomic(paths.agyLoginBackupFile(), { user: 'ua', blob: A, started_at: 1 })
      const ops2 = fakeOps({ user: 'ub', blob: B })
      const c2 = make(ops2)
      await c2.restoreAgyLoginBackup()
      expect(ops2.cur?.blob).toBe(B)
      expect(ops2.writes).toHaveLength(0)
      expect(backupExists()).toBe(false)
      expect(lockFree()).toBe(true)
    })

    it('取鎖後才出現登記也會被擋：新增 agy 帳號流程釋放鎖並回傳 BUSY', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      const origAgyLock = (c as unknown as { agyLock: () => ReturnType<typeof acquireFileLock> }).agyLock.bind(c)
      let registeredId: string | null = null
      ;(c as unknown as { agyLock: () => ReturnType<typeof acquireFileLock> }).agyLock = () => {
        const lock = origAgyLock()
        if (lock) {
          registeredId = 'rec-race-login'
          registerRunning({
            id: registeredId,
            pid: process.pid,
            role: 'implement',
            provider: 'agy',
            model: 'gemini-3.8-flash-high',
            slot_id: 'aaaaaa',
            account: 'a@x.com',
            cwd: 'C:\\test',
            out: 'out.json',
            started_at: Date.now()
          })
        }
        return lock
      }

      const r = await c.agyStartLogin()
      expect(r.ok).toBe(false)
      expect(!r.ok && r.code).toBe('BUSY')
      expect(!r.ok && r.error).toBe('有派工正在使用 agy，請稍後再試')
      expect(lockFree()).toBe(true)
      expect(launches).toBe(0)
      expect(backupExists()).toBe(false)
      if (registeredId) unregisterRunning(registeredId)
    })

    it('取鎖後才出現登記也會被擋：啟動還原 login-backup 釋放鎖並略過還原', async () => {
      storage.writeJsonAtomic(paths.agyLoginBackupFile(), { user: 'ua', blob: A, started_at: 1 })
      const ops = fakeOps(null)
      const c = make(ops)
      const origAgyLock = (c as unknown as { agyLock: () => ReturnType<typeof acquireFileLock> }).agyLock.bind(c)
      let registeredId: string | null = null
      ;(c as unknown as { agyLock: () => ReturnType<typeof acquireFileLock> }).agyLock = () => {
        const lock = origAgyLock()
        if (lock) {
          registeredId = 'rec-race-restore'
          registerRunning({
            id: registeredId,
            pid: process.pid,
            role: 'implement',
            provider: 'agy',
            model: 'gemini-3.8-flash-high',
            slot_id: 'aaaaaa',
            account: 'a@x.com',
            cwd: 'C:\\test',
            out: 'out.json',
            started_at: Date.now()
          })
        }
        return lock
      }

      await c.restoreAgyLoginBackup()
      expect(ops.cur).toBeNull()
      expect(backupExists()).toBe(true)
      expect(lockFree()).toBe(true)
      expect(c.getState().events.some((e) => e.text.includes('有派工正在使用 agy，略過還原暫存登入'))).toBe(true)
      if (registeredId) unregisterRunning(registeredId)
    })
  })

  describe('切換與儲存', () => {
    it('切換成功寫入目標 blob，並先把目前登入寫回 slot', async () => {
      saveSlot('aaaaaa', 'a@x.com', A, '甲')
      saveSlot('bbbbbb', 'b@x.com', B, '乙')
      const refreshedA = mkBlob('a@x.com', 'tokA2')
      const ops = fakeOps({ user: 'ua', blob: refreshedA })
      const c = make(ops)
      const r = await c.agySwitch('bbbbbb')
      expect(r.ok).toBe(true)
      expect(ops.cur?.blob).toBe(B)
      expect(listAgySlots().find((s) => s.id === 'aaaaaa')?.blob).toBe(refreshedA)
      expect(lockFree()).toBe(true)
    })

    it('鎖被持有：拒絕；agy 執行中：拒絕且不寫入', async () => {
      saveSlot('aaaaaa', 'a@x.com', A)
      saveSlot('bbbbbb', 'b@x.com', B)
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      const held = acquireFileLock(paths.agyLockFile(), { staleMs: 60_000 })
      const r1 = await c.agySwitch('bbbbbb')
      expect(!r1.ok && r1.error).toContain('派工')
      held?.release()

      procs = [agyProc]
      const r2 = await c.agySwitch('bbbbbb')
      expect(r2.ok).toBe(false)
      expect(!r2.ok && r2.code).toBe('BUSY')
      expect(ops.writes).toHaveLength(0)
      expect(ops.cur?.blob).toBe(A)
      expect(lockFree()).toBe(true)
    })

    it('有執行中登記時：GUI 切換 agy 被拒', async () => {
      saveSlot('aaaaaa', 'a@x.com', A)
      saveSlot('bbbbbb', 'b@x.com', B)
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)

      registerRunning({
        id: 'rec-busy-1',
        pid: process.pid,
        role: 'implement',
        provider: 'agy',
        model: 'gemini-3.8-flash-high',
        slot_id: 'aaaaaa',
        account: 'a@x.com',
        cwd: 'C:\\test',
        out: 'out.json',
        started_at: Date.now()
      })

      const r = await c.agySwitch('bbbbbb')
      expect(r.ok).toBe(false)
      expect(!r.ok && r.code).toBe('BUSY')
      expect(!r.ok && r.error).toBe('有派工正在使用 agy，請稍後再試')
      expect(ops.writes).toHaveLength(0)
      expect(ops.cur?.blob).toBe(A)

      unregisterRunning('rec-busy-1')
      const r2 = await c.agySwitch('bbbbbb')
      expect(r2.ok).toBe(true)
      expect(ops.cur?.blob).toBe(B)
    })

    it('有執行中登記時：新增 agy 帳號流程被拒', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      registerRunning({
        id: 'rec-busy-2',
        pid: process.pid,
        role: 'implement',
        provider: 'agy',
        model: 'gemini-3.8-flash-high',
        slot_id: 'aaaaaa',
        account: 'a@x.com',
        cwd: 'C:\\test',
        out: 'out.json',
        started_at: Date.now()
      })
      const r = await c.agyStartLogin()
      expect(r.ok).toBe(false)
      expect(!r.ok && r.code).toBe('BUSY')
      expect(!r.ok && r.error).toBe('有派工正在使用 agy，請稍後再試')
      unregisterRunning('rec-busy-2')
    })

    it('找不到帳號：INVALID', async () => {
      const c = make(fakeOps(null))
      const r = await c.agySwitch('cccccc')
      expect(!r.ok && r.code).toBe('INVALID')
    })

    it('agySaveCurrent、rename、delete', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      expect((await c.agySaveCurrent('我的 agy')).ok).toBe(true)
      const id = listAgySlots()[0].id
      expect(listAgySlots()[0].name).toBe('我的 agy')
      expect((await c.agyRename(id, '改名')).ok).toBe(true)
      expect(listAgySlots()[0].name).toBe('改名')
      expect((await c.agyRename(id, '  ')).ok).toBe(false)
      writeAgyQuota(id, { ts: 1, tier: null, models: {}, error: null })
      expect((await c.agyDelete(id)).ok).toBe(true)
      expect(listAgySlots()).toHaveLength(0)
      expect(readAgyQuota(id)).toBeNull()
      expect(ops.cur?.blob).toBe(A) // 不動認證管理員
    })

    it('目前登入未儲存：agyCurrent.unsaved 為 true', async () => {
      const ops = fakeOps({ user: 'ua', blob: A })
      const c = make(ops)
      expect(c.getState().agyCurrent).toBeNull()
      await c.agyPollOnce()
      expect(c.getState().agyCurrent).toEqual({ email: 'a@x.com', unsaved: true })
      await c.agySaveCurrent('')
      await new Promise((r) => setTimeout(r, 20))
      const st = c.getState()
      expect(st.agyCurrent).toEqual({ email: 'a@x.com', unsaved: false })
      expect(st.agyAccounts[0].active).toBe(true)
    })
  })

  describe('額度 poller', () => {
    const okFetch = async (url: string): Promise<Response> =>
      new Response(
        JSON.stringify(
          url.endsWith(':loadCodeAssist')
            ? { currentTier: { id: 'standard-tier' } }
            : {
                models: {
                  'claude-sonnet-4-6': {
                    quotaInfo: { remainingFraction: 0.5, resetTime: '2030-01-01T00:00:00Z' }
                  }
                }
              }
        ),
        { status: 200 }
      )

    it('token 有效就查並寫快取；過期不查、保留舊快取', async () => {
      saveSlot('aaaaaa', 'a@x.com', mkBlob('a@x.com', 'tokA'))
      saveSlot('bbbbbb', 'b@x.com', mkBlob('b@x.com', 'tokB', Date.now() - 1000))
      writeAgyQuota('bbbbbb', {
        ts: 111,
        tier: 'old',
        models: { 'claude-sonnet-4-6': { remaining: 0.3, resetAt: null } },
        error: null
      })
      fetchImpl = okFetch
      const c = make(fakeOps(null))
      await c.agyPollOnce()
      expect(fetchCalls.length).toBe(2) // 只有 a：loadCodeAssist＋fetchAvailableModels
      expect(readAgyQuota('aaaaaa')?.models['claude-sonnet-4-6'].remaining).toBe(0.5)
      expect(readAgyQuota('bbbbbb')?.ts).toBe(111)
      const st = c.getState()
      expect(st.agyAccounts.find((a) => a.id === 'bbbbbb')?.tokenExpired).toBe(true)
      expect(st.agyAccounts.find((a) => a.id === 'aaaaaa')?.tokenExpired).toBe(false)
      expect(st.agyModels).toContain('claude-sonnet-4-6')
    })

    it('鎖被持有：跳過 syncBack 但仍查額度', async () => {
      saveSlot('aaaaaa', 'a@x.com', mkBlob('a@x.com', 'old'))
      const fresh = mkBlob('a@x.com', 'fresh')
      fetchImpl = okFetch
      const c = make(fakeOps({ user: 'u', blob: fresh }))
      const held = acquireFileLock(paths.agyLockFile(), { staleMs: 60_000 })
      await c.agyPollOnce()
      held?.release()
      expect(listAgySlots()[0].blob).toContain('old') // 沒寫回
      expect(fetchCalls.length).toBe(2)
      expect(readAgyQuota('aaaaaa')).not.toBeNull()
    })

    it('鎖空閒：先 syncBack 再查', async () => {
      saveSlot('aaaaaa', 'a@x.com', mkBlob('a@x.com', 'old'))
      const fresh = mkBlob('a@x.com', 'fresh')
      fetchImpl = okFetch
      const c = make(fakeOps({ user: 'u', blob: fresh }))
      await c.agyPollOnce()
      expect(listAgySlots()[0].blob).toBe(fresh)
      expect(lockFree()).toBe(true)
    })

    it('錯誤訊息遮蔽 token，且保留舊額度', async () => {
      saveSlot('aaaaaa', 'a@x.com', mkBlob('a@x.com', 'SECRET-TOKEN-123'))
      writeAgyQuota('aaaaaa', {
        ts: 5,
        tier: 't',
        models: { m1: { remaining: 0.2, resetAt: null } },
        error: null
      })
      fetchImpl = async () => {
        throw new Error('connect failed Bearer SECRET-TOKEN-123')
      }
      const c = make(fakeOps(null))
      await c.agyPollOnce()
      const q = readAgyQuota('aaaaaa')
      expect(q?.ts).toBe(5)
      expect(q?.models.m1.remaining).toBe(0.2)
      expect(q?.error).toBeTruthy()
      expect(JSON.stringify(q)).not.toContain('SECRET-TOKEN-123')
      expect(JSON.stringify(c.getState())).not.toContain('SECRET-TOKEN-123')
      expect(JSON.stringify(c.getState().events)).not.toContain('SECRET-TOKEN-123')
    })

    it('agyRefreshQuota：停用輪詢時回 INVALID', async () => {
      const c = make(fakeOps(null))
      const r = await c.agyRefreshQuota()
      expect(!r.ok && r.code).toBe('INVALID')
    })
  })

  describe('setRouting', () => {
    const clone = (): Routing => JSON.parse(JSON.stringify(DEFAULT_ROUTING)) as Routing

    it('合法設定寫檔並反映在 state', async () => {
      const c = make(fakeOps(null))
      const r = clone()
      r.roles.docs = [
        { provider: 'agy', model: 'gemini-3.8-flash-tiered', accounts: ['aaaaaa'] },
        { provider: 'claude', model: 'haiku' }
      ]
      expect((await c.setRouting(r)).ok).toBe(true)
      expect(storage.readJson(paths.routingFile(), null)).toMatchObject({ version: 1 })
      const st = c.getState()
      expect(st.routing.roles.docs[0].model).toBe('gemini-3.8-flash-tiered')
      expect(st.agyModels).toContain('gemini-3.8-flash-tiered')
    })

    it('不合法：回 INVALID 且不寫檔', async () => {
      const c = make(fakeOps(null))
      const bad1 = clone()
      bad1.roles.spec = []
      const r1 = await c.setRouting(bad1)
      expect(!r1.ok && r1.code).toBe('INVALID')
      const bad2 = clone()
      bad2.roles.spec = [{ provider: 'claude', model: 'gpt' }]
      expect((await c.setRouting(bad2)).ok).toBe(false)
      const bad3 = clone()
      bad3.roles.spec = [{ provider: 'agy', model: 'Bad Model!' }]
      expect((await c.setRouting(bad3)).ok).toBe(false)
      expect((await c.setRouting(null as unknown as Routing)).ok).toBe(false)
      expect(fs.existsSync(paths.routingFile())).toBe(false)
    })
  })
})
