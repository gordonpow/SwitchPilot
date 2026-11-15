import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as config from '../src/core/config'
import * as paths from '../src/core/paths'
import * as storage from '../src/core/storage'
import { Controller } from '../src/main/controller'
import {
  defaultContinuePrompt,
  getLanguage,
  normalizeLocale,
  resolveLanguage,
  setLanguage,
  t,
  tl
} from '../src/shared/i18n'
import { mainEn, mainZh } from '../src/shared/i18n/main'
import { uiEn, uiZh } from '../src/shared/i18n/ui'
import { useTempEnv } from './helpers'

const root = useTempEnv()

afterEach(() => setLanguage('zh-TW'))

describe('normalizeLocale', () => {
  it('繁中地區與 zh-Hant 為 zh-TW，其他為 en', () => {
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant-TW', 'zh-hant']) {
      expect(normalizeLocale(tag), tag).toBe('zh-TW')
    }
    for (const tag of ['zh-CN', 'en-US', 'ja-JP', '']) expect(normalizeLocale(tag), tag).toBe('en')
  })
})

describe('resolveLanguage', () => {
  const orig = process.env['CLAUDE_SWITCHER_LANG']
  afterEach(() => {
    if (orig === undefined) delete process.env['CLAUDE_SWITCHER_LANG']
    else process.env['CLAUDE_SWITCHER_LANG'] = orig
  })

  it('明確設定優先於環境變數', () => {
    process.env['CLAUDE_SWITCHER_LANG'] = 'zh-TW'
    expect(resolveLanguage('en')).toBe('en')
    process.env['CLAUDE_SWITCHER_LANG'] = 'en'
    expect(resolveLanguage('zh-TW')).toBe('zh-TW')
  })

  it('auto 與壞值用環境變數', () => {
    process.env['CLAUDE_SWITCHER_LANG'] = 'en'
    expect(resolveLanguage('auto')).toBe('en')
    expect(resolveLanguage('xx')).toBe('en')
    process.env['CLAUDE_SWITCHER_LANG'] = 'zh-TW'
    expect(resolveLanguage('auto')).toBe('zh-TW')
    expect(resolveLanguage(undefined)).toBe('zh-TW')
  })
})

describe('t()', () => {
  it('參數取代、缺參數保留、未知鍵回傳鍵名', () => {
    expect(tl('zh-TW', 'tray.tooltip', { name: 'A' })).toBe('Claude 帳號切換器\n目前：A')
    expect(tl('en', 'tray.tooltip', { name: 'A' })).toBe('Claude Account Switcher\nCurrent: A')
    expect(tl('en', 'tray.tooltip')).toContain('{name}')
    expect(tl('en', 'tray.tooltip', {})).toContain('{name}')
    expect(tl('en', 'nope.nothing' as never)).toBe('nope.nothing')
  })

  it('t() 用目前語言', () => {
    setLanguage('en')
    expect(getLanguage()).toBe('en')
    expect(t('tray.quit')).toBe('Quit')
    setLanguage('zh-TW')
    expect(t('tray.quit')).toBe('結束')
  })

  it('defaultContinuePrompt', () => {
    expect(defaultContinuePrompt('zh-TW')).toBe('繼續')
    expect(defaultContinuePrompt('en')).toBe('continue')
  })
})

describe('字典', () => {
  const params = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const [name, zh, en] of [
    ['ui', uiZh, uiEn],
    ['main', mainZh, mainEn]
  ] as const) {
    it(`${name}：鍵一致、參數一致、沒有空字串`, () => {
      const zhK = Object.keys(zh).sort()
      const enK = Object.keys(en).sort()
      expect(enK).toEqual(zhK)
      for (const k of zhK) {
        const a = (zh as Record<string, string>)[k]
        const b = (en as Record<string, string>)[k]
        expect(a.length, k).toBeGreaterThan(0)
        expect(b.length, k).toBeGreaterThan(0)
        expect(params(b), k).toEqual(params(a))
      }
    })
  }

  it('ui 與 main 鍵不重複', () => {
    const dup = Object.keys(uiZh).filter((k) => k in mainZh)
    expect(dup).toEqual([])
  })
})

describe('config language', () => {
  it('預設 auto；壞值回 auto；合法值保留', () => {
    expect(config.load().language).toBe('auto')
    for (const bad of ['fr', 5, null, true]) {
      storage.writeJsonAtomic(paths.configFile(), { language: bad })
      expect(config.load().language).toBe('auto')
    }
    for (const ok of ['auto', 'zh-TW', 'en']) {
      storage.writeJsonAtomic(paths.configFile(), { language: ok })
      expect(config.load().language).toBe(ok)
    }
    expect(config.validateLanguage('en')).toBe('en')
    expect(config.validateLanguage('x')).toBeNull()
  })

  it('continue_prompt：內建預設隨語言；自訂與空字串不變', () => {
    storage.writeJsonAtomic(paths.configFile(), { language: 'en', continue_prompt: '繼續' })
    expect(config.load().continue_prompt).toBe('continue')
    storage.writeJsonAtomic(paths.configFile(), { language: 'zh-TW', continue_prompt: 'continue' })
    expect(config.load().continue_prompt).toBe('繼續')
    storage.writeJsonAtomic(paths.configFile(), { language: 'en', continue_prompt: '請繼續' })
    expect(config.load().continue_prompt).toBe('請繼續')
    storage.writeJsonAtomic(paths.configFile(), { language: 'en', continue_prompt: '' })
    expect(config.load().continue_prompt).toBe('')
    storage.writeJsonAtomic(paths.configFile(), { language: 'en', continue_prompt: 5 })
    expect(config.load().continue_prompt).toBe('continue')
  })
})

describe('Controller language', () => {
  const controllers: Controller[] = []
  afterEach(async () => {
    for (const c of controllers.splice(0)) await c.dispose()
  })

  it('setConfig({ language }) 更新狀態並換掉內建的 continue_prompt', async () => {
    const d = path.join(root(), 'scripts-src')
    fs.mkdirSync(d, { recursive: true })
    const c = new Controller({
      scriptsDir: d,
      findNode: () => process.execPath,
      disablePoll: true,
      cli: {
        listProcesses: async () => [],
        kill: async () => true,
        inject: async () => false,
        injectSubmit: async () => false
      }
    })
    controllers.push(c)
    expect(c.getState().language).toBe('zh-TW')
    expect(c.getState().config.continue_prompt).toBe('繼續')

    expect(await c.setConfig({ language: 'en' })).toEqual({ ok: true })
    expect(c.getState().language).toBe('en')
    expect(c.getState().config.language).toBe('en')
    expect(c.getState().config.continue_prompt).toBe('continue')
    expect(config.load().continue_prompt).toBe('continue')

    const bad = await c.setConfig({ language: 'fr' as never })
    expect(bad.ok).toBe(false)
    expect(c.getState().language).toBe('en')

    expect(await c.setConfig({ language: 'zh-TW' })).toEqual({ ok: true })
    expect(c.getState().config.continue_prompt).toBe('繼續')
    setLanguage('zh-TW')
  })
})

describe('resolveLanguageFromConfig（外部腳本用）', () => {
  it('明確設定優先，其次主程式記下的 language_resolved，最後系統語言', async () => {
    const { resolveLanguageFromConfig } = await import('../src/shared/i18n')
    expect(resolveLanguageFromConfig({ language: 'en', language_resolved: 'zh-TW' })).toBe('en')
    expect(resolveLanguageFromConfig({ language: 'auto', language_resolved: 'en' })).toBe('en')
    expect(resolveLanguageFromConfig({ language: 'auto', language_resolved: 'xx' })).toBe('zh-TW')
    expect(resolveLanguageFromConfig(null)).toBe('zh-TW')
  })
})
