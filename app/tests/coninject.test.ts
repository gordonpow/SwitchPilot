import { describe, expect, it, vi } from 'vitest'
import { injectCtrlKey, injectLine, injectSubmit } from '../src/core/coninject'

describe('injectLine', () => {
  it('組出 powershell 參數，文字為 base64(utf8(line + CR))', async () => {
    const spawn = vi.fn().mockResolvedValue(0)
    const ok = await injectLine(123, "claude '--resume' 'x' '繼續'", {
      spawn,
      ps1Path: 'C:/b/inject.ps1',
      alive: () => true
    })
    expect(ok).toBe(true)
    const [file, args, o] = spawn.mock.calls[0]
    expect(file).toBe('powershell.exe')
    expect(args.slice(0, 6)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:/b/inject.ps1'
    ])
    expect(args[args.indexOf('-TargetPid') + 1]).toBe('123')
    const b64 = args[args.indexOf('-TextB64') + 1]
    expect(Buffer.from(b64, 'base64').toString('utf-8')).toBe("claude '--resume' 'x' '繼續'\r")
    expect(o).toMatchObject({ windowsHide: true, timeout: 15000 })
  })

  it('exit code 非 0 或 null 回傳 false', async () => {
    const mk = (code: number | null) => vi.fn().mockResolvedValue(code)
    expect(await injectLine(1, 'x', { spawn: mk(10), alive: () => true, ps1Path: 'p' })).toBe(false)
    expect(await injectLine(1, 'x', { spawn: mk(null), alive: () => true, ps1Path: 'p' })).toBe(false)
  })

  it('shell 不存活：不呼叫 spawn 並回傳 false', async () => {
    const spawn = vi.fn().mockResolvedValue(0)
    expect(await injectLine(1, 'x', { spawn, alive: () => false, ps1Path: 'p' })).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('預設 spawn 且 inject.ps1 不存在：回傳 false，不啟動程序', async () => {
    expect(await injectLine(process.pid, 'x', { ps1Path: 'C:/no/such/inject.ps1' })).toBe(false)
  })
})

describe('injectSubmit', () => {
  it('分兩次呼叫 spawn：先文字（無換行），再單獨 CR', async () => {
    const spawn = vi.fn().mockResolvedValue(0)
    const alive = vi.fn().mockReturnValue(true)
    const ok = await injectSubmit(77, '繼續', { spawn, alive, ps1Path: 'p', submitDelayMs: 0 })
    expect(ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)
    const dec = (i: number): string => {
      const args = spawn.mock.calls[i][1] as string[]
      expect(args[args.indexOf('-TargetPid') + 1]).toBe('77')
      return Buffer.from(args[args.indexOf('-TextB64') + 1], 'base64').toString('utf-8')
    }
    expect(dec(0)).toBe('繼續')
    expect(dec(1)).toBe('\r')
    expect(alive).toHaveBeenCalledWith(77)
  })

  it('第一次失敗不送 CR；目標不存活不呼叫 spawn', async () => {
    const spawn = vi.fn().mockResolvedValue(12)
    expect(await injectSubmit(1, 'x', { spawn, alive: () => true, ps1Path: 'p', submitDelayMs: 0 })).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(1)
    const s2 = vi.fn().mockResolvedValue(0)
    expect(await injectSubmit(1, 'x', { spawn: s2, alive: () => false, ps1Path: 'p' })).toBe(false)
    expect(s2).not.toHaveBeenCalled()
  })
})

describe('injectCtrlKey', () => {
  it('組出 powershell 參數，包含 -CtrlKey 與大寫字母', async () => {
    const spawn = vi.fn().mockResolvedValue(0)
    const ok = await injectCtrlKey(123, 'l', {
      spawn,
      ps1Path: 'C:/b/inject.ps1',
      alive: () => true
    })
    expect(ok).toBe(true)
    const [file, args, o] = spawn.mock.calls[0]
    expect(file).toBe('powershell.exe')
    expect(args.slice(0, 6)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:/b/inject.ps1'
    ])
    expect(args[args.indexOf('-TargetPid') + 1]).toBe('123')
    expect(args[args.indexOf('-CtrlKey') + 1]).toBe('L')
    expect(o).toMatchObject({ windowsHide: true, timeout: 15000 })
  })

  it('非 A-Z 字母直接回傳 false，不呼叫 spawn', async () => {
    const spawn = vi.fn().mockResolvedValue(0)
    for (const bad of ['1', 'AB', '', '?', ' ', '\n']) {
      expect(await injectCtrlKey(1, bad, { spawn, alive: () => true, ps1Path: 'p' })).toBe(false)
      expect(spawn).not.toHaveBeenCalled()
    }
  })

  it('exit code 非 0 回傳 false；目標不存活不呼叫 spawn', async () => {
    const spawn = vi.fn().mockResolvedValue(2)
    expect(await injectCtrlKey(1, 'L', { spawn, alive: () => true, ps1Path: 'p' })).toBe(false)
    const s2 = vi.fn().mockResolvedValue(0)
    expect(await injectCtrlKey(1, 'L', { spawn: s2, alive: () => false, ps1Path: 'p' })).toBe(false)
    expect(s2).not.toHaveBeenCalled()
  })
})
