// controller 啟動：資料夾搬移事件、settings 仍指向舊 bin 路徑時每次啟動都修正。
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as integration from '../src/core/integration'
import * as paths from '../src/core/paths'
import { Controller, type ControllerDeps } from '../src/main/controller'
import { useTempEnv } from './helpers'

describe('Controller 啟動：資料夾與 settings 路徑', () => {
  const root = useTempEnv()
  const controllers: Controller[] = []
  const saved: Record<string, string | undefined> = {}
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
    for (const k of ['USERPROFILE', 'HOME']) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  /** 把 homedir 指向暫存目錄，並移除資料夾環境變數覆寫，讓 appDir() 解析成 ~/.switchpilot。 */
  function useFakeHome(): string {
    for (const k of ['USERPROFILE', 'HOME']) saved[k] = process.env[k]
    const h = path.join(root(), 'home')
    fs.mkdirSync(path.join(h, '.switchpilot', 'slots'), { recursive: true })
    process.env.USERPROFILE = h
    process.env.HOME = h
    delete process.env.SWITCHPILOT_HOME
    delete process.env.CLAUDE_SWITCHER_HOME
    return h
  }

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

  const legacyCmd = (f: string): string =>
    `"C:/node/node.exe" "C:/Users/me/.claude-switcher/bin/${f}"`
  const entry = (f: string, matcher?: string): Record<string, unknown> => ({
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: 'command', command: legacyCmd(f) }]
  })
  const writeLegacySettings = (): void =>
    fs.writeFileSync(
      paths.settingsFile(),
      JSON.stringify({
        statusLine: { type: 'command', command: legacyCmd('statusline.cjs') },
        hooks: {
          Stop: [entry('hook.cjs')],
          StopFailure: [entry('hook.cjs', 'rate_limit')],
          UserPromptSubmit: [entry('hook.cjs')]
        }
      })
    )

  it('appDir 為新資料夾且 settings 含舊路徑：啟動時改寫', () => {
    useFakeHome()
    writeLegacySettings()
    expect(integration.usesLegacyBinDir()).toBe(true)
    make().start()
    expect(integration.usesLegacyBinDir()).toBe(false)
    const s = fs.readFileSync(paths.settingsFile(), 'utf-8')
    expect(s).toContain('.switchpilot/bin/statusline.cjs')
  })

  it('以環境變數覆寫資料夾時不改寫 settings', () => {
    writeLegacySettings()
    make().start()
    expect(integration.usesLegacyBinDir()).toBe(true)
  })

  it('找不到 node：不改寫也不中斷啟動', () => {
    useFakeHome()
    writeLegacySettings()
    expect(() => make({ findNode: () => null }).start()).not.toThrow()
    expect(integration.usesLegacyBinDir()).toBe(true)
  })

  it('migrated／failed 結果記入事件', () => {
    const a = make({ appDirMigration: { status: 'migrated', junction: true } })
    a.start()
    expect(a.getState().events.some((e) => e.text.includes('.switchpilot'))).toBe(true)
    const b = make({ appDirMigration: { status: 'failed', reason: 'EBUSY' } })
    b.start()
    expect(b.getState().events.some((e) => e.level === 'warn' && e.text.includes('EBUSY'))).toBe(
      true
    )
  })
})
