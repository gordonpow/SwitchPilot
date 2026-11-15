import type { RoleId, RouteEntry } from '../../../shared/types'
import { t, type MessageKey } from '../../../shared/i18n'

export const ROLE_IDS: RoleId[] = [
  'requirements',
  'spec',
  'spec_review',
  'implement',
  'impl_review',
  'research',
  'docs'
]

export const ROLE_LABEL_KEYS: Record<RoleId, MessageKey> = {
  requirements: 'role.requirements',
  spec: 'role.spec',
  spec_review: 'role.spec_review',
  implement: 'role.implement',
  impl_review: 'role.impl_review',
  research: 'role.research',
  docs: 'role.docs'
}

export function getRoleLabel(role: RoleId): string {
  const key = ROLE_LABEL_KEYS[role]
  return key ? t(key) : role
}

/** 相容舊有以 ROLE_LABELS[role] 存取的寫法，透過 Proxy 動態查字典。 */
export const ROLE_LABELS = new Proxy({} as Record<RoleId, string>, {
  get: (_, prop: string) => {
    const key = ROLE_LABEL_KEYS[prop as RoleId]
    return key ? t(key) : prop
  }
})

export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'] as const

export const MAX_ENTRIES = 5

/** 項目的顯示文字，例如「Claude Opus」「agy · claude-sonnet-4-6」。 */
export function entryLabel(e: RouteEntry): string {
  return e.provider === 'claude'
    ? `Claude ${e.model.charAt(0).toUpperCase()}${e.model.slice(1)}`
    : `agy · ${e.model}`
}
