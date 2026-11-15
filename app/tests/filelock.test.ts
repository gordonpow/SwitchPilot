import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireFileLock } from '../src/core/filelock'
import { useTempEnv } from './helpers'

describe('acquireFileLock', () => {
  const root = useTempEnv()
  const file = (): string => path.join(root(), 'x', 'a.lock')

  it('取得後鎖檔含 pid／ts，release 刪檔', () => {
    const l = acquireFileLock(file(), { staleMs: 1000, now: () => 5000 })
    expect(l).not.toBeNull()
    expect(JSON.parse(fs.readFileSync(file(), 'utf-8'))).toEqual({ pid: process.pid, ts: 5000 })
    l!.release()
    expect(fs.existsSync(file())).toBe(false)
    l!.release() // 重複釋放無害
  })

  it('持有者存活且未過期：取不到', () => {
    const a = acquireFileLock(file(), { staleMs: 1000, now: () => 5000 })
    const b = acquireFileLock(file(), { staleMs: 1000, now: () => 5500, alive: () => true })
    expect(b).toBeNull()
    a!.release()
  })

  it('持有者 pid 不存活：接手', () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify({ pid: 999999, ts: 5000 }))
    const b = acquireFileLock(file(), { staleMs: 1000, now: () => 5100, alive: () => false })
    expect(b).not.toBeNull()
    b!.release()
  })

  it('超過 staleMs：即使 pid 存活也接手', () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify({ pid: 1, ts: 1000 }))
    const b = acquireFileLock(file(), { staleMs: 1000, now: () => 9000, alive: () => true })
    expect(b).not.toBeNull()
    b!.release()
  })

  it('鎖檔內容壞掉：視為過期', () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), 'garbage')
    expect(acquireFileLock(file(), { staleMs: 1000 })).not.toBeNull()
  })

  it('鎖已被他人接手後，原持有者 release 不刪別人的鎖', () => {
    const a = acquireFileLock(file(), { staleMs: 1000, now: () => 1000 })
    const b = acquireFileLock(file(), { staleMs: 1000, now: () => 9000, alive: () => true })
    expect(b).not.toBeNull()
    a!.release()
    expect(fs.existsSync(file())).toBe(true)
    b!.release()
    expect(fs.existsSync(file())).toBe(false)
  })
})
