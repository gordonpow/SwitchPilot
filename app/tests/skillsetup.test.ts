import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as skillsetup from '../src/core/skillsetup'
import { useTempEnv } from './helpers'

useTempEnv()

const target = (): string => skillsetup.skillTargetPath()
const put = (s: string): void => {
  fs.mkdirSync(path.dirname(target()), { recursive: true })
  fs.writeFileSync(target(), s)
}

describe('skillsetup.skillStatus', () => {
  it('bundled 為 null → unavailable', () => {
    expect(skillsetup.skillStatus(null)).toBe('unavailable')
  })
  it('目標不存在 → missing', () => {
    expect(skillsetup.skillStatus('a')).toBe('missing')
  })
  it('內容相同 → installed；CRLF 與 LF 視為相同', () => {
    put('line1\r\nline2\r\n')
    expect(skillsetup.skillStatus('line1\nline2\n')).toBe('installed')
  })
  it('內容不同 → outdated', () => {
    put('old')
    expect(skillsetup.skillStatus('new')).toBe('outdated')
  })
  it('目標是目錄 → outdated', () => {
    fs.mkdirSync(target(), { recursive: true })
    expect(skillsetup.skillStatus('new')).toBe('outdated')
  })
})

describe('skillsetup.installSkill', () => {
  it('新裝：建立目錄並寫入', () => {
    expect(skillsetup.installSkill('body', false)).toBe('installed')
    expect(fs.readFileSync(target(), 'utf-8')).toBe('body')
  })
  it('內容相同：不寫、不備份', () => {
    put('same\r\n')
    expect(skillsetup.installSkill('same\n', true)).toBe('installed')
    expect(fs.readFileSync(target(), 'utf-8')).toBe('same\r\n')
    expect(fs.existsSync(target() + '.bak')).toBe(false)
  })
  it('內容不同且不覆蓋：回 exists 且不動檔案', () => {
    put('old')
    expect(skillsetup.installSkill('new', false)).toBe('exists')
    expect(fs.readFileSync(target(), 'utf-8')).toBe('old')
    expect(fs.existsSync(target() + '.bak')).toBe(false)
  })
  it('覆蓋：舊檔原樣備份為 .bak，並覆蓋既有 .bak', () => {
    put('old\r\nx')
    fs.writeFileSync(target() + '.bak', 'older')
    expect(skillsetup.installSkill('new', true)).toBe('installed')
    expect(fs.readFileSync(target(), 'utf-8')).toBe('new')
    expect(fs.readFileSync(target() + '.bak', 'utf-8')).toBe('old\r\nx')
  })
  it('目標是目錄 → 丟錯', () => {
    fs.mkdirSync(target(), { recursive: true })
    expect(() => skillsetup.installSkill('new', true)).toThrow()
  })
})

describe('skillsetup.uninstallSkill', () => {
  it('不存在回 false', () => {
    expect(skillsetup.uninstallSkill()).toBe(false)
  })
  it('沒有 .bak：刪檔並刪空資料夾', () => {
    put('x')
    expect(skillsetup.uninstallSkill()).toBe(true)
    expect(fs.existsSync(path.dirname(target()))).toBe(false)
  })
  it('有 .bak：保留 .bak 與資料夾', () => {
    put('x')
    fs.writeFileSync(target() + '.bak', 'b')
    expect(skillsetup.uninstallSkill()).toBe(true)
    expect(fs.existsSync(target())).toBe(false)
    expect(fs.existsSync(target() + '.bak')).toBe(true)
  })
})

describe('內附 skill 建置產物', () => {
  it('resources/scripts/skills/model-routing/SKILL.md 存在', () => {
    const p = path.resolve(__dirname, '..', 'resources', 'scripts', 'skills', 'model-routing', 'SKILL.md')
    expect(fs.existsSync(p)).toBe(true)
  })
})
