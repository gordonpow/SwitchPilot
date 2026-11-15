import { describe, expect, it, vi } from 'vitest'
import { defaultCredOps, parseBlob, type ExecFn } from '../src/core/agycred'

const blob = JSON.stringify({
  id_token_email: 'Foo@Example.com',
  token: { access_token: 'AT-secret', expiry: '2026-11-13T10:00:00Z' }
})

describe('parseBlob', () => {
  it('取出 email（小寫）、到期毫秒、access token', () => {
    expect(parseBlob(blob)).toEqual({
      email: 'foo@example.com',
      expiryMs: Date.parse('2026-11-13T10:00:00Z'),
      accessToken: 'AT-secret'
    })
  })
  it('格式錯誤或缺欄位回傳 null', () => {
    const none = { email: null, expiryMs: null, accessToken: null }
    expect(parseBlob('not json')).toEqual(none)
    expect(parseBlob('null')).toEqual(none)
    expect(parseBlob('{}')).toEqual(none)
    expect(parseBlob('{"token":{"expiry":"x"}}')).toEqual(none)
  })
})

describe('defaultCredOps（假 exec）', () => {
  it('read：組出參數並解 base64', async () => {
    const exec = vi.fn<ExecFn>().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ user: 'u', blob_b64: Buffer.from(blob, 'utf-8').toString('base64') }) + '\r\n'
    })
    const r = await defaultCredOps('C:/b/agycred.ps1', exec).read()
    expect(r).toEqual({ user: 'u', blob })
    const [file, args, opts, input] = exec.mock.calls[0]
    expect(file).toBe('powershell.exe')
    expect(args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:/b/agycred.ps1',
      '-Action',
      'read'
    ])
    expect(opts).toEqual({ windowsHide: true, timeout: 15000 })
    expect(input).toBeUndefined()
  })

  it('read：exit 3 回傳 null', async () => {
    const exec = vi.fn<ExecFn>().mockResolvedValue({ code: 3, stdout: '' })
    expect(await defaultCredOps('p', exec).read()).toBeNull()
  })

  it('write：stdin 為單行 JSON（base64 blob）', async () => {
    const exec = vi.fn<ExecFn>().mockResolvedValue({ code: 0, stdout: '' })
    await defaultCredOps('p', exec).write({ user: 'u', blob })
    const [, args, , input] = exec.mock.calls[0]
    expect(args[args.length - 1]).toBe('write')
    expect(input!.endsWith('\n')).toBe(true)
    const j = JSON.parse(input!.trim())
    expect(j.user).toBe('u')
    expect(Buffer.from(j.blob_b64, 'base64').toString('utf-8')).toBe(blob)
  })

  it('remove：action 為 delete', async () => {
    const exec = vi.fn<ExecFn>().mockResolvedValue({ code: 0, stdout: '' })
    await defaultCredOps('p', exec).remove()
    expect(exec.mock.calls[0][1].slice(-2)).toEqual(['-Action', 'delete'])
  })

  it('失敗訊息不含 blob、token、stdout', async () => {
    const b64 = Buffer.from(blob, 'utf-8').toString('base64')
    const bad = vi.fn<ExecFn>().mockResolvedValue({ code: 4, stdout: 'AT-secret ' + b64 })
    const ops = defaultCredOps('p', bad)
    for (const p of [ops.read(), ops.write({ user: 'u', blob }), ops.remove()]) {
      const e = await p.then(
        () => null,
        (x: Error) => x
      )
      expect(e).toBeInstanceOf(Error)
      expect(e!.message).not.toContain('AT-secret')
      expect(e!.message).not.toContain(b64)
    }
    const garbage = vi.fn<ExecFn>().mockResolvedValue({ code: 0, stdout: 'AT-secret not json' })
    const e = await defaultCredOps('p', garbage)
      .read()
      .then(
        () => null,
        (x: Error) => x
      )
    expect(e!.message).not.toContain('AT-secret')
  })

  it('逾時（code null）丟錯', async () => {
    const exec = vi.fn<ExecFn>().mockResolvedValue({ code: null, stdout: '' })
    await expect(defaultCredOps('p', exec).read()).rejects.toThrow(/逾時/)
  })
})
