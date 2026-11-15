import type { RoleId, RouteEntry } from '../../../shared/types'

export const ROLE_IDS: RoleId[] = [
  'requirements',
  'spec',
  'spec_review',
  'implement',
  'impl_review',
  'research',
  'docs'
]

export const ROLE_LABELS: Record<RoleId, string> = {
  requirements: '需求定義',
  spec: '規格',
  spec_review: '規格審查',
  implement: '實作',
  impl_review: '實作審查／驗證',
  research: '查資料',
  docs: '文件草稿'
}

export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'] as const

export const MAX_ENTRIES = 5

/** 項目的顯示文字，例如「Claude Opus」「agy · claude-sonnet-4-6」。 */
export function entryLabel(e: RouteEntry): string {
  return e.provider === 'claude'
    ? `Claude ${e.model.charAt(0).toUpperCase()}${e.model.slice(1)}`
    : `agy · ${e.model}`
}
