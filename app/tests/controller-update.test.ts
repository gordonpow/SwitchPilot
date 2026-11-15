// controller 自動更新：排程、通知只一次、下載與套用（假 fetch、假 spawn／quit，不碰網路與真實 exe）。
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as config from '../src/core/config'
import * as paths from '../src/core/paths'
import { Controller, type ControllerDeps } from '../src/main/controller'
import { useTempEnv } from './helpers'

const REPO = 'gordonpow/SwitchPilot'
const EXE_BYTES = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2000, 7)])
const SHA = crypto.createHash('sha256').update(EXE_BYTES).digest('hex')

interface Rel {
  tag: string
  prerelease?: boolean
  size?: number
  digest?: string | null
  htmlUrl?: string
}

function releaseJson(r: Rel): Record<string, unknown> {
  const ver = r.tag.replace(/^v/, '')
  const name = `SwitchPilot-${ver}.exe`
  const asset: Record<string, unknown> = {
    name,
    size: r.size ?? EXE_BYTES.length,
    browser_download_url: `https://github.com/${REPO}/releases/download/${r.tag}/${name}`
  }
  if (r.digest !== null) asset.digest = r.digest ?? `sha256:${SHA}`
  return {
    tag_name: r.tag,
    name: r.tag,
    draft: false,
    prerelease: !!r.prerelease,
    html_url: r.htmlUrl ?? `https://github.com/${REPO}/releases/tag/${r.tag}`,
    body: 'notes',
    published_at: '2026-11-15T00:00:00Z',
    assets: [asset]
  }
}

function withUrl(res: Response, url: string): Response {
  Object.defineProperty(res, 'url', { value: url })
  return res
}

/** 假 GitHub：api 回傳 releases；下載回傳 EXE_BYTES。 */
function makeFetch(
  getReleases: () => Rel[],
  opts: { status?: number; gate?: Promise<void> } = {}
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith('https://api.github.com/')) {
      if (opts.status && opts.status !== 200) {
        return withUrl(new Response('nope', { status: opts.status }), url)
      }
      return withUrl(new Response(JSON.stringify(getReleases().map(releaseJson))), url)
    }
    if (opts.gate) await opts.gate
    return withUrl(
      new Response(EXE_BYTES, { headers: { 'content-length': String(EXE_BYTES.length) } }),
      url
    )
  })
}

describe('Controller 自動更新', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  afterEach(async () => {
    vi.useRealTimers()
    for (const c of controllers.splice(0)) await c.dispose()
  })

  function make(deps: ControllerDeps = {}): Controller {
    const d = path.join(root(), 'scripts-src')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'x.cjs'), '// fake')
    fs.writeFileSync(path.join(d, 'update.ps1'), '# fake')
    const c = new Controller({
      scriptsDir: d,
      findNode: () => process.execPath,
      disablePoll: true,
      appVersion: '1.0.0',
      cli: {
        listProcesses: async () => [],
        kill: async () => true,
        inject: async () => false,
        injectSubmit: async () => false
      },
      ...deps
    })
    controllers.push(c)
    return c
  }

  /** 非 disablePoll 的控制器（才會排程更新檢查）；其他輪詢全用假的。 */
  function makeScheduled(deps: ControllerDeps = {}): Controller {
    return make({
      disablePoll: false,
      poller: { pollAll: async () => false, running: false },
      agyCred: {
        read: async () => null,
        write: async () => undefined,
        remove: async () => undefined
      },
      agyFetch: (async () => {
        throw new Error('no network')
      }) as typeof fetch,
      ...deps
    })
  }

  it('排程：30 秒後第一次、之後每 600 秒；update_check 關閉不排程', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = makeFetch(() => [])
    const c = makeScheduled({ updateFetch: f as unknown as typeof fetch })
    c.start()
    await vi.advanceTimersByTimeAsync(29_000)
    expect(f).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(f).toHaveBeenCalledTimes(2)
    // 關閉後不再檢查
    await c.setConfig({ update_check: false })
    await vi.advanceTimersByTimeAsync(1_300_000)
    expect(f).toHaveBeenCalledTimes(2)
    // 改回開啟後恢復
    await c.setConfig({ update_check: true })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('排程：設定一開始就關閉、或 disablePoll、或截圖模式都不檢查', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    config.save({ ...config.load(), update_check: false })
    const f1 = makeFetch(() => [])
    makeScheduled({ updateFetch: f1 as unknown as typeof fetch }).start()
    await vi.advanceTimersByTimeAsync(700_000)
    expect(f1).not.toHaveBeenCalled()

    config.save({ ...config.load(), update_check: true })
    const f2 = makeFetch(() => [])
    make({ updateFetch: f2 as unknown as typeof fetch }).start() // disablePoll: true
    await vi.advanceTimersByTimeAsync(700_000)
    expect(f2).not.toHaveBeenCalled()

    process.env.SWITCHPILOT_SCREENSHOT = 'x.png'
    try {
      const f3 = makeFetch(() => [])
      makeScheduled({ updateFetch: f3 as unknown as typeof fetch }).start()
      await vi.advanceTimersByTimeAsync(700_000)
      expect(f3).not.toHaveBeenCalled()
    } finally {
      delete process.env.SWITCHPILOT_SCREENSHOT
    }
  })

  it('找到新版：狀態更新，通知只一次（再檢查與重建控制器都不再通知）', async () => {
    const notify = vi.fn()
    const f = makeFetch(() => [{ tag: 'v1.1.0' }])
    const c = make({ updateFetch: f as unknown as typeof fetch, notify })
    expect(await c.checkUpdate()).toEqual({ ok: true })
    const u = c.getState().update
    expect(u.available).toBe(true)
    expect(u.latest?.version).toBe('1.1.0')
    expect(u.latest?.assetName).toBe('SwitchPilot-1.1.0.exe')
    expect(u.latest?.hasHash).toBe(true)
    expect(u.current).toBe('1.0.0')
    expect(u.checkedAt).not.toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(config.load().update_notified_version).toBe('1.1.0')
    await c.checkUpdate()
    expect(notify).toHaveBeenCalledTimes(1)
    const c2 = make({ updateFetch: f as unknown as typeof fetch, notify })
    await c2.checkUpdate()
    expect(notify).toHaveBeenCalledTimes(1)
    // 更新的版本再通知一次
    const f3 = makeFetch(() => [{ tag: 'v1.2.0' }])
    const c3 = make({ updateFetch: f3 as unknown as typeof fetch, notify })
    await c3.checkUpdate()
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('同版本或較舊：available 為 false，不通知', async () => {
    const notify = vi.fn()
    const f = makeFetch(() => [{ tag: 'v1.0.0' }, { tag: 'v0.9.0' }])
    const c = make({ updateFetch: f as unknown as typeof fetch, notify })
    await c.checkUpdate()
    expect(c.getState().update.available).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('預覽版開關：關閉時只比較正式版', async () => {
    const f = makeFetch(() => [{ tag: 'v1.1.0-beta.1', prerelease: true }])
    const c = make({ updateFetch: f as unknown as typeof fetch })
    await c.checkUpdate()
    expect(c.getState().update.available).toBe(true)
    await c.setConfig({ update_include_prerelease: false })
    await vi.waitFor(() => expect(c.getState().update.available).toBe(false))
    expect(c.getState().config.update_include_prerelease).toBe(false)
  })

  it('網路錯誤：只記錄在 update.error，不影響其他功能', async () => {
    const f = makeFetch(() => [], { status: 403 })
    const c = make({ updateFetch: f as unknown as typeof fetch })
    expect(await c.checkUpdate()).toEqual({ ok: true })
    const u = c.getState().update
    expect(u.error).toContain('403')
    expect(u.available).toBe(false)
    expect(u.checking).toBe(false)
  })

  it('沒有注入 updateFetch：checkUpdate 失敗（UNAVAILABLE）', async () => {
    const c = make()
    const r = await c.checkUpdate()
    expect(r.ok).toBe(false)
  })

  it('下載、套用：呼叫注入的 spawn 與 quit，參數含目標與新檔', async () => {
    const spawnDetached = vi.fn()
    const quitApp = vi.fn()
    const target = path.join(root(), '資料 夾', 'App.exe')
    const c = make({
      updateFetch: makeFetch(() => [{ tag: 'v1.1.0' }]) as unknown as typeof fetch,
      portableExe: target,
      spawnDetached,
      quitApp
    })
    await c.checkUpdate()
    // 還沒下載：拒絕
    const early = await c.applyUpdate()
    expect(early.ok).toBe(false)
    expect(spawnDetached).not.toHaveBeenCalled()

    expect(await c.downloadUpdate()).toEqual({ ok: true })
    const u = c.getState().update
    expect(u.download.state).toBe('ready')
    expect(u.canApply).toBe(true)
    const file = path.join(paths.updatesDir(), 'SwitchPilot-1.1.0.exe')
    expect(fs.readFileSync(file).equals(EXE_BYTES)).toBe(true)
    expect(fs.existsSync(file + '.part')).toBe(false)

    expect(await c.applyUpdate()).toEqual({ ok: true })
    expect(quitApp).toHaveBeenCalledTimes(1)
    expect(spawnDetached).toHaveBeenCalledTimes(1)
    const [exe, args] = spawnDetached.mock.calls[0] as [string, string[]]
    expect(exe).toBe('powershell.exe')
    expect(args).toContain(target)
    expect(args).toContain(file)
    expect(args).toContain(path.join(paths.binDir(), 'update.ps1'))
    expect(args).toContain(path.join(paths.updatesDir(), 'update.log'))
    const pidArg = args[args.indexOf('-WaitPids') + 1].split(',')
    expect(pidArg).toContain(String(process.pid))
    expect(pidArg).toContain(String(process.ppid))
    expect(fs.existsSync(path.join(paths.binDir(), 'update.ps1'))).toBe(true)
    // update.log 記錄版本與檔名
    const log = fs.readFileSync(path.join(paths.updatesDir(), 'update.log'), 'utf-8')
    expect(log).toContain('1.0.0')
    expect(log).toContain('1.1.0')
  })

  it('spawn 失敗（reject 或 false）：回報失敗且不呼叫 quit', async () => {
    for (const spawnDetached of [
      vi.fn(async () => {
        throw new Error('boom')
      }),
      vi.fn(async () => false)
    ]) {
      const quitApp = vi.fn()
      const c = make({
        updateFetch: makeFetch(() => [{ tag: 'v1.1.0' }]) as unknown as typeof fetch,
        portableExe: path.join(root(), 'App.exe'),
        spawnDetached,
        quitApp
      })
      await c.checkUpdate()
      await c.downloadUpdate()
      const r = await c.applyUpdate()
      expect(r.ok).toBe(false)
      expect(spawnDetached).toHaveBeenCalledTimes(1)
      expect(quitApp).not.toHaveBeenCalled()
    }
  })

  it('canApply 為 false（非 portable）：套用被拒絕；可開 release 頁面', async () => {
    const spawnDetached = vi.fn()
    const quitApp = vi.fn()
    const openExternal = vi.fn()
    const c = make({
      updateFetch: makeFetch(() => [{ tag: 'v1.1.0' }]) as unknown as typeof fetch,
      portableExe: null,
      spawnDetached,
      quitApp,
      openExternal
    })
    await c.checkUpdate()
    await c.downloadUpdate()
    expect(c.getState().update.canApply).toBe(false)
    const r = await c.applyUpdate()
    expect(r.ok).toBe(false)
    expect(spawnDetached).not.toHaveBeenCalled()
    expect(quitApp).not.toHaveBeenCalled()
    expect(await c.openReleasePage()).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledWith(`https://github.com/${REPO}/releases/tag/v1.1.0`)
  })

  it('openReleasePage：網址不是 github.com/<repo>/ 就拒絕', async () => {
    const openExternal = vi.fn()
    for (const bad of [
      'https://evil.example.com/' + REPO + '/releases',
      `http://github.com/${REPO}/releases`,
      'https://github.com/other/repo/releases'
    ]) {
      const c = make({
        updateFetch: makeFetch(() => [{ tag: 'v1.1.0', htmlUrl: bad }]) as unknown as typeof fetch,
        openExternal
      })
      await c.checkUpdate()
      const r = await c.openReleasePage()
      expect(r.ok).toBe(false)
    }
    expect(openExternal).not.toHaveBeenCalled()
    // 還沒檢查過也拒絕
    expect((await make({ openExternal }).openReleasePage()).ok).toBe(false)
  })

  it('下載中：拒絕新下載與套用；完成後可套用', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const spawnDetached = vi.fn()
    const c = make({
      updateFetch: makeFetch(() => [{ tag: 'v1.1.0' }], { gate }) as unknown as typeof fetch,
      portableExe: path.join(root(), 'App.exe'),
      spawnDetached,
      quitApp: vi.fn()
    })
    await c.checkUpdate()
    const p = c.downloadUpdate()
    await vi.waitFor(() => expect(c.getState().update.download.state).toBe('downloading'))
    expect((await c.downloadUpdate()).ok).toBe(false)
    expect((await c.applyUpdate()).ok).toBe(false)
    expect(spawnDetached).not.toHaveBeenCalled()
    release()
    expect(await p).toEqual({ ok: true })
    expect(c.getState().update.download.state).toBe('ready')
  })

  it('下載失敗（大小不符）：狀態為 error 並可重試', async () => {
    let size = EXE_BYTES.length + 5
    const f = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) {
        return withUrl(
          new Response(JSON.stringify([releaseJson({ tag: 'v1.1.0', size, digest: null })])),
          url
        )
      }
      return withUrl(new Response(EXE_BYTES), url)
    })
    const c = make({ updateFetch: f as unknown as typeof fetch })
    await c.checkUpdate()
    const r = await c.downloadUpdate()
    expect(r.ok).toBe(false)
    const d = c.getState().update.download
    expect(d.state).toBe('error')
    expect(d.error).toBeTruthy()
    expect(fs.readdirSync(paths.updatesDir()).filter((n) => n.endsWith('.part'))).toEqual([])
    // 資產大小修正後重試成功
    size = EXE_BYTES.length
    await c.checkUpdate()
    expect(await c.downloadUpdate()).toEqual({ ok: true })
    expect(c.getState().update.download.state).toBe('ready')
  })

  it('start 清理：刪 *.part；檢查後刪非目前資產的 exe；符合的檔案還原成 ready', async () => {
    const dir = paths.updatesDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'old.exe.part'), 'x')
    fs.writeFileSync(path.join(dir, 'SwitchPilot-0.9.0.exe'), EXE_BYTES)
    fs.writeFileSync(path.join(dir, 'SwitchPilot-1.1.0.exe'), EXE_BYTES)
    fs.writeFileSync(path.join(dir, 'update.log'), 'log')
    const c = make({ updateFetch: makeFetch(() => [{ tag: 'v1.1.0' }]) as unknown as typeof fetch })
    c.start()
    expect(fs.existsSync(path.join(dir, 'old.exe.part'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'SwitchPilot-0.9.0.exe'))).toBe(true)
    await c.checkUpdate()
    expect(fs.existsSync(path.join(dir, 'SwitchPilot-0.9.0.exe'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'SwitchPilot-1.1.0.exe'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'update.log'))).toBe(true)
    expect(c.getState().update.download.state).toBe('ready')
  })

  it('還原 ready：大小或雜湊不符的檔案不採用', async () => {
    const dir = paths.updatesDir()
    fs.mkdirSync(dir, { recursive: true })
    const bad = Buffer.from(EXE_BYTES)
    bad[100] = 9 // 大小相同、雜湊不同
    fs.writeFileSync(path.join(dir, 'SwitchPilot-1.1.0.exe'), bad)
    const c = make({ updateFetch: makeFetch(() => [{ tag: 'v1.1.0' }]) as unknown as typeof fetch })
    c.start()
    await c.checkUpdate()
    expect(c.getState().update.download.state).toBe('idle')
  })

  it('檢查到更新的版本：ready 的舊檔回到 idle', async () => {
    let rels: Rel[] = [{ tag: 'v1.1.0' }]
    const c = make({
      updateFetch: makeFetch(() => rels) as unknown as typeof fetch,
      portableExe: path.join(root(), 'App.exe')
    })
    await c.checkUpdate()
    await c.downloadUpdate()
    expect(c.getState().update.download.state).toBe('ready')
    rels = [{ tag: 'v1.2.0' }]
    await c.checkUpdate()
    expect(c.getState().update.download.state).toBe('idle')
    expect(c.getState().update.latest?.version).toBe('1.2.0')
    expect(
      fs.existsSync(path.join(paths.updatesDir(), 'SwitchPilot-1.1.0.exe'))
    ).toBe(false)
  })

  it('切換帳號中：拒絕套用', async () => {
    const spawnDetached = vi.fn()
    const c = make({
      updateFetch: makeFetch(() => [{ tag: 'v1.1.0' }]) as unknown as typeof fetch,
      portableExe: path.join(root(), 'App.exe'),
      spawnDetached,
      quitApp: vi.fn()
    })
    await c.checkUpdate()
    await c.downloadUpdate()
    ;(c as unknown as { switching: boolean }).switching = true
    const r = await c.applyUpdate()
    expect(r.ok).toBe(false)
    expect(spawnDetached).not.toHaveBeenCalled()
  })

  it('config 預設與驗證：update_check／update_include_prerelease 預設 true', () => {
    const cfg = config.load()
    expect(cfg.update_check).toBe(true)
    expect(cfg.update_include_prerelease).toBe(true)
    expect(cfg.update_notified_version).toBe('')
    config.save({ ...cfg, update_check: 'x' as unknown as boolean })
    expect(config.load().update_check).toBe(true)
  })
})
