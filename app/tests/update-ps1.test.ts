import * as child_process from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { useTempEnv } from './helpers'

const isWindows = process.platform === 'win32'

describe.skipIf(!isWindows)('update.ps1 PowerShell script', () => {
  const getRoot = useTempEnv()

  function getScriptPath(): string {
    const resourcesPath = path.resolve(__dirname, '../resources/scripts/update.ps1')
    if (fs.existsSync(resourcesPath)) return resourcesPath
    const srcPath = path.resolve(__dirname, '../src/scripts/update.ps1')
    if (fs.existsSync(srcPath)) return srcPath
    throw new Error('update.ps1 script not found')
  }

  function runUpdateScript(args: {
    waitPids: string
    target: string
    newFile: string
    logFile: string
    timeoutSeconds?: number
  }): child_process.SpawnSyncReturns<string> {
    const scriptPath = getScriptPath()
    const psArgs = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-WaitPids',
      args.waitPids,
      '-Target',
      args.target,
      '-NewFile',
      args.newFile,
      '-LogFile',
      args.logFile,
      '-NoLaunch'
    ]
    if (args.timeoutSeconds !== undefined) {
      psArgs.push('-TimeoutSeconds', String(args.timeoutSeconds))
    }

    return child_process.spawnSync('powershell.exe', psArgs, {
      encoding: 'utf8'
    })
  }

  it('successfully replaces target, preserves .old backup, and removes NewFile', () => {
    const root = getRoot()
    const target = path.join(root, 'app.exe')
    const newFile = path.join(root, 'downloaded.exe')
    const logFile = path.join(root, 'update.log')

    fs.writeFileSync(target, 'ORIGINAL_VERSION_CONTENT')
    fs.writeFileSync(newFile, 'NEW_UPDATED_VERSION_CONTENT')

    // 傳入不存在的 PID (9999999)，應立即確認解鎖並執行替換
    const res = runUpdateScript({
      waitPids: '9999999',
      target,
      newFile,
      logFile
    })

    expect(res.status).toBe(0)
    expect(fs.readFileSync(target, 'utf8')).toBe('NEW_UPDATED_VERSION_CONTENT')
    expect(fs.existsSync(`${target}.old`)).toBe(true)
    expect(fs.readFileSync(`${target}.old`, 'utf8')).toBe('ORIGINAL_VERSION_CONTENT')
    expect(fs.existsSync(newFile)).toBe(false)
    expect(fs.existsSync(logFile)).toBe(true)

    const logContent = fs.readFileSync(logFile, 'utf8')
    expect(logContent).toContain('Update applied successfully')
  })

  it('handles target and newFile paths containing spaces and Chinese characters', () => {
    const root = getRoot()
    const specialDir = path.join(root, '測試 資料 夾 with spaces')
    fs.mkdirSync(specialDir, { recursive: true })

    const target = path.join(specialDir, '帳號 切換器 app.exe')
    const newFile = path.join(specialDir, '更新 檔案 new.exe')
    const logFile = path.join(specialDir, '更新 日誌.log')

    fs.writeFileSync(target, 'OLD_UNICODE_BINARY')
    fs.writeFileSync(newFile, 'NEW_UNICODE_BINARY')

    const res = runUpdateScript({
      waitPids: '9999999',
      target,
      newFile,
      logFile
    })

    expect(res.status).toBe(0)
    expect(fs.readFileSync(target, 'utf8')).toBe('NEW_UNICODE_BINARY')
    expect(fs.existsSync(`${target}.old`)).toBe(true)
    expect(fs.readFileSync(`${target}.old`, 'utf8')).toBe('OLD_UNICODE_BINARY')
    expect(fs.existsSync(newFile)).toBe(false)
  })

  it('aborts and preserves target intact when NewFile does not exist', () => {
    const root = getRoot()
    const target = path.join(root, 'app.exe')
    const nonExistentNewFile = path.join(root, 'missing.exe')
    const logFile = path.join(root, 'update.log')

    fs.writeFileSync(target, 'INTACT_ORIGINAL_EXE')

    const res = runUpdateScript({
      waitPids: '9999999',
      target,
      newFile: nonExistentNewFile,
      logFile
    })

    expect(res.status).not.toBe(0)
    expect(fs.readFileSync(target, 'utf8')).toBe('INTACT_ORIGINAL_EXE')
    expect(fs.existsSync(`${target}.old`)).toBe(false)
  })

  it('times out without modifying files when waiting on running PID', () => {
    const root = getRoot()
    const target = path.join(root, 'app.exe')
    const newFile = path.join(root, 'new.exe')
    const logFile = path.join(root, 'update.log')

    fs.writeFileSync(target, 'ORIGINAL_MUST_NOT_CHANGE')
    fs.writeFileSync(newFile, 'NEW_MUST_NOT_BE_MOVED')

    // 等待當前的 process.pid（正在執行測試中，不可能在 1 秒內結束）
    const res = runUpdateScript({
      waitPids: String(process.pid),
      target,
      newFile,
      logFile,
      timeoutSeconds: 1
    })

    expect(res.status).toBe(1)
    expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL_MUST_NOT_CHANGE')
    expect(fs.existsSync(`${target}.old`)).toBe(false)
    expect(fs.existsSync(newFile)).toBe(true)

    const logContent = fs.readFileSync(logFile, 'utf8')
    expect(logContent).toContain('Timeout exceeded')
    expect(logContent).toContain('Aborting update without modifying files')
  })

  it('Target 被獨占開啟時逾時，Target 內容不變', () => {
    const root = getRoot()
    const target = path.join(root, 'app.exe')
    const newFile = path.join(root, 'new.exe')
    const logFile = path.join(root, 'update.log')
    fs.writeFileSync(target, 'LOCKED_ORIGINAL')
    fs.writeFileSync(newFile, 'SHOULD_NOT_APPLY')

    // fs.openSync 在 Windows 的共用模式不含 FileShare.None 需要的獨占，PowerShell 開啟會失敗
    const fd = fs.openSync(target, 'r+')
    try {
      const res = runUpdateScript({
        waitPids: '9999999',
        target,
        newFile,
        logFile,
        timeoutSeconds: 2
      })
      expect(res.status).toBe(1)
    } finally {
      fs.closeSync(fd)
    }
    expect(fs.readFileSync(target, 'utf8')).toBe('LOCKED_ORIGINAL')
    expect(fs.existsSync(`${target}.old`)).toBe(false)
    expect(fs.existsSync(newFile)).toBe(true)
    expect(fs.readFileSync(logFile, 'utf8')).toContain('Timed out waiting for Target file to unlock')
  }, 30000)

  it('路徑含 [1] 時仍能成功替換', () => {
    const root = getRoot()
    const dir = path.join(root, 'dir[1]')
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, 'app[1].exe')
    const newFile = path.join(dir, 'new[1].exe')
    const logFile = path.join(dir, 'update[1].log')
    fs.writeFileSync(target, 'OLD_BRACKET')
    fs.writeFileSync(newFile, 'NEW_BRACKET_CONTENT')

    const res = runUpdateScript({ waitPids: '9999999', target, newFile, logFile })

    expect(res.status).toBe(0)
    expect(fs.readFileSync(target, 'utf8')).toBe('NEW_BRACKET_CONTENT')
    expect(fs.readFileSync(`${target}.old`, 'utf8')).toBe('OLD_BRACKET')
    expect(fs.existsSync(newFile)).toBe(false)
    expect(fs.existsSync(`${target}.new`)).toBe(false)
  })

  it('改名失敗（Target 唯讀）走還原：Target 內容不變、Target.new 已刪除、log 有還原紀錄', () => {
    const root = getRoot()
    const target = path.join(root, 'app.exe')
    const newFile = path.join(root, 'new.exe')
    const logFile = path.join(root, 'update.log')
    fs.writeFileSync(target, 'READONLY_ORIGINAL')
    fs.writeFileSync(newFile, 'REPLACEMENT_CONTENT')
    // 唯讀屬性讓 File.Replace 無法覆蓋，但解鎖檢查（Read 加 FileShare.None）仍可通過
    fs.chmodSync(target, 0o444)

    try {
      const res = runUpdateScript({ waitPids: '9999999', target, newFile, logFile })
      expect(res.status).toBe(5)
    } finally {
      try {
        fs.chmodSync(target, 0o666)
      } catch {
        /* 忽略 */
      }
    }
    expect(fs.readFileSync(target, 'utf8')).toBe('READONLY_ORIGINAL')
    expect(fs.existsSync(`${target}.new`)).toBe(false)
    const log = fs.readFileSync(logFile, 'utf8')
    expect(log).toContain('Restoring Target')
    expect(log).toContain('Restored Target from')
  }, 60000)
})
