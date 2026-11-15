// envVar：新名 SWITCHPILOT_ 優先、舊名 CLAUDE_SWITCHER_ 後備、空字串視為未設定。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { envVar } from '../src/shared/env'

const NEW = 'SWITCHPILOT_ENVTEST'
const OLD = 'CLAUDE_SWITCHER_ENVTEST'

describe('envVar', () => {
  beforeEach(() => {
    delete process.env[NEW]
    delete process.env[OLD]
  })
  afterEach(() => {
    delete process.env[NEW]
    delete process.env[OLD]
  })

  it('兩者都沒設：undefined', () => {
    expect(envVar('ENVTEST')).toBeUndefined()
  })
  it('只設舊名：讀舊名', () => {
    process.env[OLD] = 'old'
    expect(envVar('ENVTEST')).toBe('old')
  })
  it('只設新名：讀新名', () => {
    process.env[NEW] = 'new'
    expect(envVar('ENVTEST')).toBe('new')
  })
  it('兩者都設：新名優先', () => {
    process.env[NEW] = 'new'
    process.env[OLD] = 'old'
    expect(envVar('ENVTEST')).toBe('new')
  })
  it('新名為空字串：退回舊名', () => {
    process.env[NEW] = ''
    process.env[OLD] = 'old'
    expect(envVar('ENVTEST')).toBe('old')
  })
  it('兩者皆空字串：undefined', () => {
    process.env[NEW] = ''
    process.env[OLD] = ''
    expect(envVar('ENVTEST')).toBeUndefined()
  })
})
