// controller 的 applyLoginItem 注入：start 呼叫一次、變更才呼叫、失敗不寫入。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as config from '../src/core/config'
import { Controller, type ControllerDeps } from '../src/main/controller'
import { useTempEnv } from './helpers'

describe('Controller applyLoginItem', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  function make(deps: ControllerDeps = {}): Controller {
    const d = path.join(root(), 'scripts-src')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'x.cjs'), '// fake')
    const c = new Controller({
      scriptsDir: d,
      findNode: () => process.execPath,
      disablePoll: true,
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

  it('start 以目前設定呼叫一次', () => {
    const apply = vi.fn()
    make({ applyLoginItem: apply }).start()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(false)
  })

  it('start 時丟例外不影響啟動', () => {
    const apply = vi.fn(() => {
      throw new Error('boom')
    })
    const c = make({ applyLoginItem: apply })
    expect(() => c.start()).not.toThrow()
    expect(c.getState().events.some((e) => e.level === 'warn' && e.text.includes('boom'))).toBe(
      true
    )
  })

  it('setConfig 值改變才呼叫，同值不呼叫，且寫入兩欄', async () => {
    const apply = vi.fn()
    const c = make({ applyLoginItem: apply })
    expect(await c.setConfig({ launch_at_login: false })).toEqual({ ok: true })
    expect(apply).not.toHaveBeenCalled()
    expect(await c.setConfig({ launch_at_login: true, close_to_tray: true })).toEqual({ ok: true })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenLastCalledWith(true)
    expect(await c.setConfig({ launch_at_login: true })).toEqual({ ok: true })
    expect(apply).toHaveBeenCalledTimes(1)
    const st = c.getState().config
    expect(st.launch_at_login).toBe(true)
    expect(st.close_to_tray).toBe(true)
    expect(config.load().launch_at_login).toBe(true)
  })

  it('apply 丟例外：回傳失敗且設定未寫入', async () => {
    const c = make({
      applyLoginItem: () => {
        throw new Error('denied')
      }
    })
    const r = await c.setConfig({ launch_at_login: true, close_to_tray: true })
    expect(r.ok).toBe(false)
    expect(config.load().launch_at_login).toBe(false)
    expect(config.load().close_to_tray).toBe(false)
    expect(c.getState().config.launch_at_login).toBe(false)
  })
})
