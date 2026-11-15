import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultIsAlive,
  listRecent,
  listRunning,
  pruneDeadRunning,
  registerRunning,
  unregisterRunning,
  updateRunningChildPid,
  type RunningRecord
} from '../src/core/dispatchlog'
import { dispatchDir, dispatchRunningDir } from '../src/core/paths'
import { writeJsonAtomic } from '../src/core/storage'
import { useTempEnv } from './helpers'

describe('dispatchlog', () => {
  useTempEnv()

  const makeRecord = (id: string, pid: number, startedAt: number): RunningRecord => ({
    id,
    pid,
    role: 'implement',
    provider: 'agy',
    model: 'gemini-3.8-flash-high',
    slot_id: 's1',
    account: 'test@example.com',
    cwd: process.cwd(),
    out: path.join(process.cwd(), 'out.txt'),
    started_at: startedAt
  })

  it('dispatch/running 不存在時 listRunning 回傳空陣列', () => {
    expect(listRunning()).toEqual([])
  })

  it('登記與讀取：依照 started_at 排序，過濾死亡 PID 且只讀不刪', () => {
    const r1 = makeRecord('r1', 101, 2000)
    const r2 = makeRecord('r2', 102, 1000)
    const r3 = makeRecord('r3', 103, 1500)

    registerRunning(r1)
    registerRunning(r2)
    registerRunning(r3)

    // 102 視為死亡 PID
    const isAlive = (pid: number): boolean => pid !== 102
    const list = listRunning(isAlive)

    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('r3')
    expect(list[1].id).toBe('r1')

    // 驗證只讀不刪：102 的檔案依然存在於磁碟上
    expect(fs.existsSync(path.join(dispatchRunningDir(), 'r2.json'))).toBe(true)
  })

  it('updateRunningChildPid 更新子程序 PID', () => {
    const r = makeRecord('r-child', 201, 1000)
    registerRunning(r)

    updateRunningChildPid('r-child', 9999)
    const list = listRunning(() => true)
    const found = list.find((item) => item.id === 'r-child')
    expect(found?.child_pid).toBe(9999)

    // 記錄不存在時不報錯
    expect(() => updateRunningChildPid('non-existent', 1234)).not.toThrow()
  })

  it('unregisterRunning 刪除登記檔，不存在時不拋錯', () => {
    const r = makeRecord('r-del', 301, 1000)
    registerRunning(r)
    expect(fs.existsSync(path.join(dispatchRunningDir(), 'r-del.json'))).toBe(true)

    unregisterRunning('r-del')
    expect(fs.existsSync(path.join(dispatchRunningDir(), 'r-del.json'))).toBe(false)
    expect(() => unregisterRunning('r-del')).not.toThrow()
  })

  it('pruneDeadRunning 清除已死亡 PID 的檔案，保留存活 PID', () => {
    const rAlive = makeRecord('r-alive', 401, 1000)
    const rDead = makeRecord('r-dead', 402, 1000)
    registerRunning(rAlive)
    registerRunning(rDead)

    pruneDeadRunning((pid) => pid === 401)

    expect(fs.existsSync(path.join(dispatchRunningDir(), 'r-alive.json'))).toBe(true)
    expect(fs.existsSync(path.join(dispatchRunningDir(), 'r-dead.json'))).toBe(false)
  })

  it('defaultIsAlive 正常檢查自身 PID 存活，不存在的 PID 回傳 false', () => {
    expect(defaultIsAlive(process.pid)).toBe(true)
    expect(defaultIsAlive(-1)).toBe(false)
    expect(defaultIsAlive(0)).toBe(false)
    // 99999999 在一般系統上不存在
    expect(defaultIsAlive(99999999)).toBe(false)
  })

  it('listRecent 倒序回傳 dispatch 紀錄，忽略子目錄與壞檔，並支援 limit', () => {
    const dir = dispatchDir()
    fs.mkdirSync(dir, { recursive: true })

    // 建立 running 子目錄（不應被 listRecent 誤讀）
    fs.mkdirSync(dispatchRunningDir(), { recursive: true })

    // 寫入 3 筆正常紀錄
    writeJsonAtomic(path.join(dir, '10000.json'), {
      status: 'ok',
      provider: 'agy',
      model: 'gemini-3.8-flash-high',
      role: 'implement',
      cwd: 'C:/test',
      started_at: 1000,
      ended_at: 1005,
      attempts: [],
      message: 'ok'
    })
    writeJsonAtomic(path.join(dir, '20000.json'), {
      status: 'delegate',
      provider: 'claude',
      model: 'sonnet',
      role: 'spec',
      cwd: 'C:/test',
      started_at: 2000,
      ended_at: 2005,
      attempts: [],
      message: 'delegate'
    })
    writeJsonAtomic(path.join(dir, '30000.json'), {
      status: 'failed',
      provider: null,
      model: null,
      role: 'docs',
      cwd: 'C:/test',
      started_at: 3000,
      ended_at: 3005,
      attempts: [],
      message: 'failed'
    })

    // 寫入壞檔
    fs.writeFileSync(path.join(dir, '99999.json'), '{ broken json')

    const recents = listRecent(2)
    expect(recents).toHaveLength(2)
    // 依檔名倒序：30000 排第一，20000 排第二（99999 是壞檔略過）
    expect(recents[0].id).toBe('30000')
    expect(recents[0].status).toBe('failed')
    expect(recents[1].id).toBe('20000')
    expect(recents[1].status).toBe('delegate')
  })
})
