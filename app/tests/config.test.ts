import * as fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as config from '../src/core/config'
import * as paths from '../src/core/paths'
import * as storage from '../src/core/storage'
import { useTempEnv } from './helpers'

useTempEnv()

describe('config 背景執行欄位', () => {
  it('預設皆為 false', () => {
    const c = config.load()
    expect(c.close_to_tray).toBe(false)
    expect(c.launch_at_login).toBe(false)
  })
  it('合法 boolean 保留；非 boolean 回預設', () => {
    fs.mkdirSync(paths.appDir(), { recursive: true })
    fs.writeFileSync(
      paths.configFile(),
      JSON.stringify({ close_to_tray: true, launch_at_login: 'yes' })
    )
    const c = config.load()
    expect(c.close_to_tray).toBe(true)
    expect(c.launch_at_login).toBe(false)
    fs.writeFileSync(
      paths.configFile(),
      JSON.stringify({ close_to_tray: 1, launch_at_login: true })
    )
    const d = config.load()
    expect(d.close_to_tray).toBe(false)
    expect(d.launch_at_login).toBe(true)
  })
})

describe('config 新欄位', () => {
  it('預設值', () => {
    const c = config.load()
    expect(c.manage_external).toBe(true)
    expect(c.continue_prompt).toBe('繼續')
  })

  it('既有 config 檔缺新欄位時補預設值，且保留自訂值', () => {
    fs.mkdirSync(paths.appDir(), { recursive: true })
    fs.writeFileSync(paths.configFile(), JSON.stringify({ threshold: 90, manage_external: false }))
    const c = config.load()
    expect(c.threshold).toBe(90)
    expect(c.manage_external).toBe(false)
    expect(c.continue_prompt).toBe('繼續')
  })

  it('validateContinuePrompt', () => {
    const v = config.validateContinuePrompt
    expect(v('  繼續  ')).toBe('繼續')
    expect(v('')).toBe('')
    expect(v('   ')).toBe('')
    expect(v('a'.repeat(200))).toBe('a'.repeat(200))
    expect(v('a'.repeat(201))).toBeNull()
    for (const ch of ['"', '\r', '\n', '%', '^', '&', '|', '<', '>', ';']) {
      expect(v(`a${ch}b`)).toBeNull()
    }
    expect(v(5)).toBeNull()
    for (const ch of ['\t', '\x00', '\x1b', '\x7f']) expect(v(`a${ch}b`)).toBeNull()
  })

  it('load：continue_prompt 不合法（含非字串）時用預設值', () => {
    for (const bad of [5, null, 'a&b', 'x'.repeat(201), 'a\x1bb']) {
      storage.writeJsonAtomic(paths.configFile(), { continue_prompt: bad })
      expect(config.load().continue_prompt).toBe('繼續')
    }
    storage.writeJsonAtomic(paths.configFile(), { continue_prompt: ' 好 ' })
    expect(config.load().continue_prompt).toBe('好')
    storage.writeJsonAtomic(paths.configFile(), { continue_prompt: '' })
    expect(config.load().continue_prompt).toBe('')
  })
})

describe('auto_compact', () => {
  const D = config.AUTO_COMPACT_DEFAULTS

  it('預設值', () => {
    expect(config.load().auto_compact).toEqual({
      enabled: false,
      threshold_type: 'percent',
      threshold: 60,
      action: 'compact',
      wait_seconds: 20,
      folders: [],
      clear_screen_after: true
    })
  })

  it('load：逐欄位合併，缺少的補預設，不合法的用預設', () => {
    storage.writeJsonAtomic(paths.configFile(), {
      auto_compact: {
        enabled: true,
        threshold: 75,
        action: 'bogus',
        wait_seconds: 9999,
        folders: ['C:\\a', 5]
      }
    })
    expect(config.load().auto_compact).toEqual({
      ...D,
      enabled: true,
      threshold: 75,
      folders: ['C:\\a']
    })
    for (const bad of [null, 5, 'x', [], { enabled: 'yes', threshold: 100 }]) {
      storage.writeJsonAtomic(paths.configFile(), { auto_compact: bad })
      expect(config.load().auto_compact).toEqual(D)
    }
  })

  it('mergeAutoCompact：部分更新只改給定欄位', () => {
    const m = config.mergeAutoCompact(D, { enabled: true, folders: [' C:\\x ', ''] })
    expect(m).toEqual({ ...D, enabled: true, folders: ['C:\\x'] })
    expect(config.mergeAutoCompact(m!, { action: 'clear' })).toEqual({
      ...D,
      enabled: true,
      action: 'clear',
      folders: ['C:\\x']
    })
  })

  it('mergeAutoCompact：不合法值回傳 null；threshold 範圍依 threshold_type', () => {
    const bad: unknown[] = [
      { threshold: 0 },
      { threshold: 100 },
      { threshold: 'a' },
      { threshold_type: 'x' },
      { action: 'delete' },
      { wait_seconds: 4 },
      { wait_seconds: 601 },
      { enabled: 1 },
      { folders: 'C:\\a' },
      { folders: [1] },
      { unknown: 1 },
      'x',
      null
    ]
    for (const p of bad) expect(config.mergeAutoCompact(D, p), JSON.stringify(p)).toBeNull()
    expect(config.mergeAutoCompact(D, { threshold_type: 'tokens' })).toBeNull() // 60 不在 token 範圍
    expect(
      config.mergeAutoCompact(D, { threshold_type: 'tokens', threshold: 150000 })
    ).toMatchObject({
      threshold_type: 'tokens',
      threshold: 150000
    })
    expect(config.mergeAutoCompact(D, { threshold_type: 'tokens', threshold: 999 })).toBeNull()
    expect(config.mergeAutoCompact(D, { threshold: 99, wait_seconds: 5 })).toMatchObject({
      threshold: 99,
      wait_seconds: 5
    })
  })

  it('clear_screen_after：預設 true、壞值回預設、mergeAutoCompact 支援', () => {
    expect(config.load().auto_compact.clear_screen_after).toBe(true)
    storage.writeJsonAtomic(paths.configFile(), {
      auto_compact: { clear_screen_after: false }
    })
    expect(config.load().auto_compact.clear_screen_after).toBe(false)
    for (const bad of ['yes', 1, null, 'true', {}]) {
      storage.writeJsonAtomic(paths.configFile(), {
        auto_compact: { clear_screen_after: bad }
      })
      expect(config.load().auto_compact.clear_screen_after).toBe(true)
    }
    const m = config.mergeAutoCompact(D, { clear_screen_after: false })
    expect(m?.clear_screen_after).toBe(false)
    expect(config.mergeAutoCompact(D, { clear_screen_after: 'bad' })).toBeNull()
  })
})

describe('switch_mode', () => {
  it('預設 live；壞值回到預設；validateSwitchMode', () => {
    expect(config.load().switch_mode).toBe('live')
    storage.writeJsonAtomic(paths.configFile(), { switch_mode: 'bogus' })
    expect(config.load().switch_mode).toBe('live')
    storage.writeJsonAtomic(paths.configFile(), { switch_mode: 'restart' })
    expect(config.load().switch_mode).toBe('restart')
    expect(config.validateSwitchMode('live')).toBe('live')
    expect(config.validateSwitchMode('restart')).toBe('restart')
    expect(config.validateSwitchMode('x')).toBeNull()
    expect(config.validateSwitchMode(1)).toBeNull()
  })
})
