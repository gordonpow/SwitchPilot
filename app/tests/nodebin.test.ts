import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findNode, installScripts, scriptsSourceDir } from '../src/core/nodebin'
import { useTempEnv } from './helpers'

const root = useTempEnv()

describe('installScripts', () => {
  it('copies only when hash differs', () => {
    const src = path.join(root(), 'src')
    const dst = path.join(root(), 'dst')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'a.cjs'), 'console.log(1)')
    fs.writeFileSync(path.join(src, 'b.cjs'), 'console.log(2)')
    fs.writeFileSync(path.join(src, 'ignore.txt'), 'x')

    let r = installScripts({ sourceDir: src, binDir: dst })
    expect(r.copied.sort()).toEqual(['a.cjs', 'b.cjs'])
    expect(fs.readdirSync(dst).sort()).toEqual(['a.cjs', 'b.cjs'])

    // 相同內容：不複製（目標 mtime 不變）
    const old = new Date(Date.now() - 100000)
    fs.utimesSync(path.join(dst, 'a.cjs'), old, old)
    r = installScripts({ sourceDir: src, binDir: dst })
    expect(r.copied).toEqual([])
    expect(r.unchanged.sort()).toEqual(['a.cjs', 'b.cjs'])
    expect(Math.abs(fs.statSync(path.join(dst, 'a.cjs')).mtimeMs - old.getTime())).toBeLessThan(2000)

    // 內容不同：只複製有變的
    fs.writeFileSync(path.join(src, 'a.cjs'), 'console.log(99)')
    r = installScripts({ sourceDir: src, binDir: dst })
    expect(r.copied).toEqual(['a.cjs'])
    expect(r.unchanged).toEqual(['b.cjs'])
    expect(fs.readFileSync(path.join(dst, 'a.cjs'), 'utf-8')).toBe('console.log(99)')
    expect(fs.readdirSync(dst).some((n) => n.endsWith('.tmp'))).toBe(false)
  })

  it('也複製 *.ps1', () => {
    const src = path.join(root(), 'src2')
    const dst = path.join(root(), 'dst2')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'inject.ps1'), 'param()')
    fs.writeFileSync(path.join(src, 'a.cjs'), '1')
    const r = installScripts({ sourceDir: src, binDir: dst })
    expect(r.copied.sort()).toEqual(['a.cjs', 'inject.ps1'])
    expect(fs.readFileSync(path.join(dst, 'inject.ps1'), 'utf-8')).toBe('param()')
  })

  it('source dir override and missing source', () => {
    const src = path.join(root(), 'nope')
    expect(() => installScripts({ sourceDir: src, binDir: path.join(root(), 'o') })).toThrow()
    process.env.CLAUDE_SWITCHER_SCRIPTS_DIR = 'X:/scripts'
    try {
      expect(scriptsSourceDir()).toBe('X:/scripts')
      expect(scriptsSourceDir('Y:/s')).toBe('Y:/s')
    } finally {
      delete process.env.CLAUDE_SWITCHER_SCRIPTS_DIR
    }
  })
})

describe('findNode', () => {
  it('honors CLAUDE_SWITCHER_NODE', () => {
    const f = path.join(root(), 'fake-node.exe')
    fs.writeFileSync(f, '')
    process.env.CLAUDE_SWITCHER_NODE = f
    try {
      expect(findNode()).toBe(f)
    } finally {
      delete process.env.CLAUDE_SWITCHER_NODE
    }
  })
})
