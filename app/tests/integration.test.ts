import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as integration from '../src/core/integration'
import * as paths from '../src/core/paths'
import { useTempEnv } from './helpers'

useTempEnv()

const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const BIN = 'C:\\Users\\me\\.claude-switcher\\bin'
const opts = { nodePath: NODE, binDir: BIN }

const writeSettings = (d: unknown): void =>
  fs.writeFileSync(paths.settingsFile(), JSON.stringify(d), 'utf-8')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readSettings = (): any => JSON.parse(fs.readFileSync(paths.settingsFile(), 'utf-8'))

describe('integration', () => {
  it('install without file', () => {
    integration.install(opts)
    expect(integration.isInstalled(opts)).toBe(true)
    const s = readSettings()
    expect(s.statusLine.type).toBe('command')
    expect(s.hooks.StopFailure[0].matcher).toBe('rate_limit')
  })

  it('forward slashes and node commands', () => {
    integration.install(opts)
    const s = readSettings()
    const cmds: string[] = [s.statusLine.command]
    for (const ev of Object.values<any[]>(s.hooks)) {
      for (const g of ev) for (const h of g.hooks) cmds.push(h.command)
    }
    for (const c of cmds) expect(c).not.toContain('\\')
    expect(s.statusLine.command).toBe(
      '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.claude-switcher/bin/statusline.cjs"'
    )
    expect(s.hooks.Stop[0].hooks[0].command).toBe(
      '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.claude-switcher/bin/hook.cjs" stop'
    )
    expect(s.hooks.StopFailure[0].hooks[0].command).toContain('hook.cjs" stopfailure')
  })

  it('preserves other keys and hooks, makes backup', () => {
    const other = { hooks: [{ type: 'command', command: 'echo hi' }] }
    writeSettings({ model: 'opus', hooks: { Stop: [other], PreToolUse: [other] } })
    integration.install(opts)
    const s = readSettings()
    expect(s.model).toBe('opus')
    expect(s.hooks.PreToolUse).toEqual([other])
    expect(s.hooks.Stop[0]).toEqual(other)
    expect(s.hooks.Stop).toHaveLength(2)
    expect(fs.readdirSync(paths.backupsDir()).some((n) => n.startsWith('settings-'))).toBe(true)
  })

  it('reinstall no duplicates', () => {
    integration.install(opts)
    integration.install(opts)
    const s = readSettings()
    expect(s.hooks.Stop).toHaveLength(1)
    expect(s.hooks.StopFailure).toHaveLength(1)
  })

  it('removes Python-version entries on install', () => {
    const other = { hooks: [{ type: 'command', command: 'echo hi' }] }
    const py = '"C:/Python313/python.exe" "C:/proj/Switching_account/switcher/'
    writeSettings({
      statusLine: { type: 'command', command: py + 'statusline.py"' },
      hooks: {
        Stop: [other, { hooks: [{ type: 'command', command: py + 'hook.py" stop' }] }],
        StopFailure: [
          {
            matcher: 'rate_limit',
            hooks: [{ type: 'command', command: py + 'hook.py" stopfailure' }]
          }
        ]
      }
    })
    expect(integration.isInstalled(opts)).toBe(false) // 舊版不算已安裝新版
    integration.install(opts)
    expect(fs.readFileSync(paths.settingsFile(), 'utf-8')).not.toContain('.py')
    const s = readSettings()
    expect(s.hooks.Stop).toHaveLength(2)
    expect(s.hooks.Stop[0]).toEqual(other)
    expect(s.hooks.StopFailure).toHaveLength(1)
    // 舊版 statusLine 不應被當成「原本的 statusLine」保存
    expect(fs.existsSync(paths.integrationFile())).toBe(false)
    integration.uninstall(opts)
    expect(readSettings()).toEqual({ hooks: { Stop: [other] } })
  })

  it('uninstall restores original statusline', () => {
    const orig = { type: 'command', command: 'my-status' }
    const other = { hooks: [{ type: 'command', command: 'echo hi' }] }
    writeSettings({ statusLine: orig, model: 'x', hooks: { Stop: [other] } })
    integration.install(opts)
    integration.install(opts) // 重裝不得覆蓋原值
    integration.uninstall(opts)
    const s = readSettings()
    expect(s.statusLine).toEqual(orig)
    expect(s.hooks).toEqual({ Stop: [other] })
    expect(s.model).toBe('x')
    expect(integration.isInstalled(opts)).toBe(false)
  })

  it('uninstall removes when no original', () => {
    writeSettings({ model: 'x' })
    integration.install(opts)
    integration.uninstall(opts)
    expect(readSettings()).toEqual({ model: 'x' })
  })

  it('bad json not overwritten', () => {
    fs.writeFileSync(paths.settingsFile(), '{ not json', 'utf-8')
    expect(() => integration.install(opts)).toThrow()
    expect(() => integration.uninstall(opts)).toThrow()
    expect(fs.readFileSync(paths.settingsFile(), 'utf-8')).toBe('{ not json')
    expect(integration.isInstalled(opts)).toBe(false)
  })

  it('non-object settings refused', () => {
    fs.writeFileSync(paths.settingsFile(), '[1,2]', 'utf-8')
    expect(() => integration.install(opts)).toThrow()
    expect(fs.readFileSync(paths.settingsFile(), 'utf-8')).toBe('[1,2]')
  })

  it('default binDir is recognized', () => {
    integration.install({ nodePath: NODE })
    expect(integration.isInstalled()).toBe(true)
    expect(readSettings().statusLine.command).toContain(path.basename(paths.binDir()))
  })
})

describe('UserPromptSubmit', () => {
  it('install 寫入 prompt hook（無 matcher）', () => {
    integration.install(opts)
    const g = readSettings().hooks.UserPromptSubmit
    expect(g).toHaveLength(1)
    expect(g[0].matcher).toBeUndefined()
    expect(g[0].hooks[0].command).toBe(
      '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.claude-switcher/bin/hook.cjs" prompt'
    )
  })

  it('缺 UserPromptSubmit：isInstalled false、needsUpdate true；重新安裝後恢復', () => {
    integration.install(opts)
    const s = readSettings()
    delete s.hooks.UserPromptSubmit
    writeSettings(s)
    expect(integration.isInstalled(opts)).toBe(false)
    expect(integration.needsUpdate(opts)).toBe(true)
    integration.install(opts)
    expect(integration.isInstalled(opts)).toBe(true)
    expect(integration.needsUpdate(opts)).toBe(false)
    expect(readSettings().hooks.UserPromptSubmit).toHaveLength(1)
  })

  it('未安裝或舊版：needsUpdate false；uninstall 移除 prompt hook', () => {
    expect(integration.needsUpdate(opts)).toBe(false)
    writeSettings({ statusLine: { type: 'command', command: 'python switcher/statusline.py' } })
    expect(integration.needsUpdate(opts)).toBe(false)
    integration.install(opts)
    integration.uninstall(opts)
    expect(readSettings().hooks).toBeUndefined()
  })
})

describe('usesLegacyBinDir 與新舊 marker', () => {
  const legacyCmd = (f: string): string => `"${NODE}" "C:/Users/me/.claude-switcher/bin/${f}"`
  const newCmd = (f: string): string => `"${NODE}" "C:/Users/me/.switchpilot/bin/${f}"`

  it('statusLine 指向舊路徑：true', () => {
    writeSettings({ statusLine: { type: 'command', command: legacyCmd('statusline.cjs') } })
    expect(integration.usesLegacyBinDir()).toBe(true)
  })

  it('只有 hook 指向舊路徑：true', () => {
    writeSettings({
      statusLine: { type: 'command', command: newCmd('statusline.cjs') },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: legacyCmd('hook.cjs') }] }] }
    })
    expect(integration.usesLegacyBinDir()).toBe(true)
  })

  it('全是新路徑或沒有 settings：false', () => {
    expect(integration.usesLegacyBinDir()).toBe(false)
    writeSettings({
      statusLine: { type: 'command', command: newCmd('statusline.cjs') },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: newCmd('hook.cjs') }] }] }
    })
    expect(integration.usesLegacyBinDir()).toBe(false)
  })

  it('install 會把舊路徑項目換成新路徑，不重複', () => {
    writeSettings({
      statusLine: { type: 'command', command: legacyCmd('statusline.cjs') },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: legacyCmd('hook.cjs') }] }] }
    })
    integration.install({ nodePath: NODE, binDir: 'C:\\Users\\me\\.switchpilot\\bin' })
    const s = readSettings()
    expect(s.statusLine.command).toContain('.switchpilot/bin/statusline.cjs')
    expect(integration.usesLegacyBinDir()).toBe(false)
    expect(s.hooks.Stop).toHaveLength(1)
  })
})
