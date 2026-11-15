import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as storage from '../src/core/storage'
import { useTempEnv } from './helpers'

const root = useTempEnv()

describe('storage', () => {
  it('roundtrip, 2-space indent, no ascii escape, no tmp left', () => {
    const f = path.join(root(), 'd', 'x.json')
    storage.writeJsonAtomic(f, { 名稱: '中文', n: 1.5 })
    expect(fs.readFileSync(f, 'utf-8')).toBe('{\n  "名稱": "中文",\n  "n": 1.5\n}')
    expect(storage.readJson(f)).toEqual({ 名稱: '中文', n: 1.5 })
    expect(fs.readdirSync(path.dirname(f))).toEqual(['x.json'])
  })
  it('readJson fallback, readJsonStrict throws', () => {
    const f = path.join(root(), 'bad.json')
    fs.writeFileSync(f, '{ bad')
    expect(storage.readJson(f, 'dflt')).toBe('dflt')
    expect(storage.readJson(path.join(root(), 'none.json'))).toBeNull()
    expect(() => storage.readJsonStrict(f)).toThrow()
  })
})
