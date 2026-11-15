// migrateAppDir 與 paths.appDir 的新舊資料夾解析（全部在暫存目錄，傳入 from/to）。
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateAppDir } from '../src/core/appdirmigrate'
import * as paths from '../src/core/paths'

let root = ''
let from = ''
let to = ''
const saved: Record<string, string | undefined> = {}
const ENV = ['SWITCHPILOT_HOME', 'CLAUDE_SWITCHER_HOME', 'USERPROFILE', 'HOME']

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-mig-'))
  from = path.join(root, '.claude-switcher')
  to = path.join(root, '.switchpilot')
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  fs.rmSync(root, { recursive: true, force: true })
})

function seedOld(): void {
  fs.mkdirSync(path.join(from, 'slots', 'a'), { recursive: true })
  fs.writeFileSync(path.join(from, 'config.json'), '{"x":1}')
}

describe('migrateAppDir', () => {
  it('舊資料夾實體、新資料夾不存在：搬移並建立 junction', () => {
    seedOld()
    const r = migrateAppDir({ from, to })
    expect(r.status).toBe('migrated')
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf-8')).toBe('{"x":1}')
    if (r.junction) {
      expect(fs.lstatSync(from).isSymbolicLink()).toBe(true)
      // 透過舊路徑仍讀得到同一份資料
      expect(fs.readFileSync(path.join(from, 'config.json'), 'utf-8')).toBe('{"x":1}')
    }
  })

  it('已搬過但舊路徑被殘留腳本建成實體資料夾：改名保留並補建 junction', () => {
    fs.mkdirSync(path.join(to, 'slots'), { recursive: true })
    fs.writeFileSync(path.join(to, 'config.json'), '{"x":2}')
    fs.mkdirSync(path.join(from, 'usage'), { recursive: true })
    fs.writeFileSync(path.join(from, 'usage', 'u.json'), '{}')
    const r = migrateAppDir({ from, to })
    expect(r.status).toBe('migrated')
    expect(r.reason).toBe('repaired')
    const leftovers = fs.readdirSync(root).filter((n) => n.startsWith('.claude-switcher.leftover-'))
    expect(leftovers).toHaveLength(1)
    expect(fs.existsSync(path.join(root, leftovers[0], 'usage', 'u.json'))).toBe(true)
    if (r.junction) expect(fs.readFileSync(path.join(from, 'config.json'), 'utf-8')).toBe('{"x":2}')
  })

  it('新舊資料夾都有效：skipped，不動任何一個', () => {
    seedOld()
    fs.mkdirSync(path.join(to, 'slots'), { recursive: true })
    expect(migrateAppDir({ from, to }).reason).toBe('target-exists')
    expect(fs.existsSync(path.join(from, 'config.json'))).toBe(true)
  })

  it('舊資料夾不存在：skipped', () => {
    expect(migrateAppDir({ from, to }).status).toBe('skipped')
    expect(fs.existsSync(to)).toBe(false)
  })

  it('舊路徑已是 junction：skipped', () => {
    seedOld()
    const first = migrateAppDir({ from, to })
    expect(first.status).toBe('migrated')
    if (!first.junction) return
    // from 現在是 junction；新資料夾不存在時也不得動作
    fs.rmSync(to, { recursive: true, force: true })
    fs.mkdirSync(to)
    fs.rmdirSync(to)
    expect(migrateAppDir({ from, to }).status).toBe('skipped')
  })

  it('新資料夾非空：skipped，不合併', () => {
    seedOld()
    fs.mkdirSync(to)
    fs.writeFileSync(path.join(to, 'config.json'), '{"new":1}')
    expect(migrateAppDir({ from, to }).status).toBe('skipped')
    expect(fs.readFileSync(path.join(from, 'config.json'), 'utf-8')).toBe('{"x":1}')
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf-8')).toBe('{"new":1}')
  })

  it('新資料夾是空資料夾：先移除再搬', () => {
    seedOld()
    fs.mkdirSync(to)
    expect(migrateAppDir({ from, to }).status).toBe('migrated')
    expect(fs.existsSync(path.join(to, 'slots', 'a'))).toBe(true)
  })

  it('rename 失敗（目標上層不存在）：failed，舊資料夾保留', () => {
    seedOld()
    const badTo = path.join(root, 'no-such-parent', '.switchpilot')
    const r = migrateAppDir({ from, to: badTo })
    expect(r.status).toBe('failed')
    expect(r.reason).toBeTruthy()
    expect(fs.existsSync(path.join(from, 'config.json'))).toBe(true)
  })

  it('沒傳 from/to 且有 SWITCHPILOT_HOME：skipped', () => {
    process.env.SWITCHPILOT_HOME = path.join(root, 'x')
    expect(migrateAppDir().status).toBe('skipped')
  })
})

describe('paths.appDir 解析', () => {
  function setHome(): string {
    const h = path.join(root, 'home')
    fs.mkdirSync(h)
    delete process.env.SWITCHPILOT_HOME
    delete process.env.CLAUDE_SWITCHER_HOME
    process.env.USERPROFILE = h
    process.env.HOME = h
    return h
  }

  it('環境變數覆寫優先（新名與舊名）', () => {
    process.env.SWITCHPILOT_HOME = '/x/new'
    process.env.CLAUDE_SWITCHER_HOME = '/x/old'
    expect(paths.appDir()).toBe('/x/new')
    delete process.env.SWITCHPILOT_HOME
    expect(paths.appDir()).toBe('/x/old')
  })

  it('都不存在：新資料夾', () => {
    const h = setHome()
    expect(paths.appDir()).toBe(path.join(h, '.switchpilot'))
    expect(paths.defaultAppDir()).toBe(path.join(h, '.switchpilot'))
    expect(paths.legacyAppDir()).toBe(path.join(h, '.claude-switcher'))
  })

  it('只有舊資料夾：用舊的', () => {
    const h = setHome()
    fs.mkdirSync(path.join(h, '.claude-switcher'))
    expect(paths.appDir()).toBe(path.join(h, '.claude-switcher'))
  })

  it('新資料夾是空的：仍用舊的（R-1）', () => {
    const h = setHome()
    fs.mkdirSync(path.join(h, '.claude-switcher'))
    fs.mkdirSync(path.join(h, '.switchpilot'))
    expect(paths.appDir()).toBe(path.join(h, '.claude-switcher'))
  })

  it('新資料夾含 config.json：用新的', () => {
    const h = setHome()
    fs.mkdirSync(path.join(h, '.claude-switcher'))
    fs.mkdirSync(path.join(h, '.switchpilot'))
    fs.writeFileSync(path.join(h, '.switchpilot', 'config.json'), '{}')
    expect(paths.appDir()).toBe(path.join(h, '.switchpilot'))
  })

  it('homedir 改變時不使用過時快取', () => {
    const h1 = setHome()
    fs.mkdirSync(path.join(h1, '.switchpilot', 'slots'), { recursive: true })
    expect(paths.appDir()).toBe(path.join(h1, '.switchpilot'))
    const h2 = path.join(root, 'home2')
    fs.mkdirSync(path.join(h2, '.claude-switcher'), { recursive: true })
    process.env.USERPROFILE = h2
    process.env.HOME = h2
    expect(paths.appDir()).toBe(path.join(h2, '.claude-switcher'))
  })
})
