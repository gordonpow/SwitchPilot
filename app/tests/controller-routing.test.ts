import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Controller, type ControllerDeps } from '../src/main/controller'
import * as paths from '../src/core/paths'
import * as skillsetup from '../src/core/skillsetup'
import * as storage from '../src/core/storage'
import { useTempEnv } from './helpers'

describe('controller 模型分工設定引導', () => {
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
      findAgy: () => null,
      readBundledSkill: () => 'bundled',
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

  it('routingSetup 欄位反映注入的依賴', async () => {
    const c = make({ findNode: () => null, findAgy: () => 'C:/agy.exe' })
    await c.checkRoutingSetup()
    const s = c.getState().routingSetup
    expect(s.nodeFound).toBe(false)
    expect(s.agyInstalled).toBe(true)
    expect(s.agyAccounts).toBe(0)
    expect(s.skill).toBe('missing')
    expect(s.skillPath).toBe(skillsetup.skillTargetPath())
  })

  it('內附檔讀不到 → unavailable，installSkill 回 UNAVAILABLE', async () => {
    const c = make({ readBundledSkill: () => null })
    expect(c.getState().routingSetup.skill).toBe('unavailable')
    const r = await c.installSkill(false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('UNAVAILABLE')
  })

  it('installSkill：成功、不同內容回 EXISTS、覆蓋成功', async () => {
    const c = make()
    expect((await c.installSkill(false)).ok).toBe(true)
    expect(c.getState().routingSetup.skill).toBe('installed')
    expect(fs.readFileSync(skillsetup.skillTargetPath(), 'utf-8')).toBe('bundled')

    fs.writeFileSync(skillsetup.skillTargetPath(), 'different')
    const r = await c.installSkill(false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('EXISTS')
    expect(fs.readFileSync(skillsetup.skillTargetPath(), 'utf-8')).toBe('different')

    expect((await c.installSkill(true)).ok).toBe(true)
    expect(fs.readFileSync(skillsetup.skillTargetPath() + '.bak', 'utf-8')).toBe('different')
    expect(c.getState().routingSetup.skill).toBe('installed')
  })

  it('目標是目錄 → installSkill 轉成失敗結果', async () => {
    const c = make()
    fs.mkdirSync(skillsetup.skillTargetPath(), { recursive: true })
    const r = await c.installSkill(true)
    expect(r.ok).toBe(false)
  })

  it('uninstallSkill 後狀態回 missing', async () => {
    const c = make()
    await c.installSkill(false)
    expect((await c.uninstallSkill()).ok).toBe(true)
    expect(c.getState().routingSetup.skill).toBe('missing')
  })

  it('routing_enabled：預設 true，setConfig 可關閉並寫入 config', async () => {
    const c = make()
    expect(c.getState().config.routing_enabled).toBe(true)
    expect((await c.setConfig({ routing_enabled: false })).ok).toBe(true)
    expect(c.getState().config.routing_enabled).toBe(false)
    const saved = storage.readJson(paths.configFile(), {}) as { routing_enabled?: boolean }
    expect(saved.routing_enabled).toBe(false)
  })
})
