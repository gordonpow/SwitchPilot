// 多國語言：字典與 t()。純 TS，不得 import electron 或 node 專屬模組（renderer 也會用）。
import { mainEn, mainZh } from './main'
import { uiEn, uiZh } from './ui'

export type Lang = 'zh-TW' | 'en'
export type LangSetting = 'auto' | Lang
export type MessageKey = keyof typeof uiZh | keyof typeof mainZh

/** 「繼續提示」的內建預設值（各語言）。 */
export const BUILTIN_CONTINUE_PROMPTS = ['繼續', 'continue']

export function defaultContinuePrompt(lang: Lang): string {
  return lang === 'zh-TW' ? '繼續' : 'continue'
}

/** 語言標籤 → 支援的語言：zh-TW／zh-HK／zh-MO／zh-Hant* 為繁中，其餘（含 zh-CN）為英文。 */
export function normalizeLocale(tag: string): Lang {
  const s = String(tag ?? '').toLowerCase()
  if (s === 'zh-tw' || s === 'zh-hk' || s === 'zh-mo' || s.startsWith('zh-hant')) return 'zh-TW'
  return 'en'
}

let sysLocales: string[] = []

/** main 啟動時以 app.getPreferredSystemLanguages() 設定（空陣列忽略）。 */
export function setSystemLocales(list: string[]): void {
  if (Array.isArray(list) && list.length > 0) sysLocales = [...list]
}

/**
 * 系統語言來源。環境變數 CLAUDE_SWITCHER_LANG 為 zh-TW／en 時只取代這個來源
 * （測試與截圖用），不會覆蓋使用者明確設定。
 */
export function systemLocales(): string[] {
  const env = typeof process !== 'undefined' ? process.env?.['CLAUDE_SWITCHER_LANG'] : undefined
  if (env === 'zh-TW' || env === 'en') return [env]
  if (sysLocales.length > 0) return sysLocales
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale]
  } catch {
    return []
  }
}

/** 設定值 → 實際語言；'zh-TW'／'en' 直接用，其他（含 'auto'、壞值）依系統語言。 */
export function resolveLanguage(setting: unknown): Lang {
  if (setting === 'zh-TW' || setting === 'en') return setting
  return normalizeLocale(systemLocales()[0] ?? '')
}

/**
 * 外部腳本用：由 config.json 內容決定語言。明確設定優先；'auto' 時優先用主程式記下的
 * language_resolved（主程式以 Electron 判斷系統語言，腳本的 Intl 結果可能不同）。
 */
export function resolveLanguageFromConfig(cfg: unknown): Lang {
  const o = cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : {}
  if (o['language'] === 'zh-TW' || o['language'] === 'en') return o['language']
  const r = o['language_resolved']
  if (r === 'zh-TW' || r === 'en') return r
  return resolveLanguage('auto')
}

let current: Lang = resolveLanguage('auto')

export function setLanguage(l: Lang): void {
  current = l
}

export function getLanguage(): Lang {
  return current
}

const DICT: Record<Lang, Record<string, string>> = {
  'zh-TW': { ...uiZh, ...mainZh },
  en: { ...uiEn, ...mainEn }
}

/** 指定語言的翻譯；{name} 以 params 取代（缺的參數保留原樣）；找不到鍵回傳鍵名。 */
export function tl(
  lang: Lang,
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const s = DICT[lang][key]
  if (s === undefined) return key
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m
  )
}

/** 目前語言的翻譯。 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return tl(current, key, params)
}
