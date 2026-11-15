export type Page =
  | 'overview'
  | 'accounts'
  | 'cli'
  | 'dispatch'
  | 'events'
  | 'settings/general'
  | 'settings/switch'
  | 'settings/cli'
  | 'settings/compact'
  | 'settings/routing'
  | 'settings/integration'
  | 'settings/update'

export const PAGES: Page[] = [
  'overview',
  'accounts',
  'cli',
  'dispatch',
  'events',
  'settings/general',
  'settings/switch',
  'settings/cli',
  'settings/compact',
  'settings/routing',
  'settings/integration',
  'settings/update'
]

const STORAGE_KEY = 'switcher.page'

function isPage(v: string | null): v is Page {
  return v !== null && (PAGES as string[]).includes(v)
}

/** 初始頁面：URL ?page= 優先（截圖用），相容舊 ?dialog=，其次 localStorage，最後總覽。 */
export function initialPage(): Page {
  const q = new URLSearchParams(window.location.search)
  const p = q.get('page')
  if (isPage(p)) return p
  const d = q.get('dialog')
  if (d === 'settings') return 'settings/general'
  if (d === 'routing') return 'settings/routing'
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isPage(saved)) return saved
  } catch {
    // localStorage 不可用時忽略
  }
  return 'overview'
}

export function savePage(p: Page): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, p)
  } catch {
    // 忽略
  }
}
