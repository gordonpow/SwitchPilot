// 模型分工 model-routing skill 設定與管理。純 Node 模組，不 import electron。
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as paths from './paths'
import * as storage from './storage'

/** 忽略 CRLF 與 LF 換行字元差異 */
function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

/** model-routing skill 在使用者目錄的安裝路徑 */
export function skillTargetPath(): string {
  return path.join(paths.claudeHome(), 'skills', 'model-routing', 'SKILL.md')
}

export type SkillStatus = 'unavailable' | 'missing' | 'installed' | 'outdated'

/**
 * 檢查目前安裝的 skill 狀態。
 * bundled === null 時回傳 'unavailable'。
 * 目標不存在時回傳 'missing'。
 * 目標存在但讀取失敗（含目標為目錄）時回傳 'outdated'。
 * 內容相同（忽略 CRLF/LF）時回傳 'installed'，否則回傳 'outdated'。
 */
export function skillStatus(bundled: string | null): SkillStatus {
  if (bundled === null) return 'unavailable'
  const target = skillTargetPath()
  if (!fs.existsSync(target)) return 'missing'
  try {
    const stat = fs.statSync(target)
    if (stat.isDirectory()) return 'outdated'
    const content = fs.readFileSync(target, 'utf-8')
    return normalizeEol(content) === normalizeEol(bundled) ? 'installed' : 'outdated'
  } catch {
    return 'outdated'
  }
}

/**
 * 安裝 model-routing skill 到目標位置。
 * 若目標存在且內容不同，在 overwrite 為 false 時回傳 'exists'。
 * 若 overwrite 為 true 且內容不同，先將舊檔備份為 SKILL.md.bak（原樣保留換行），再覆蓋新檔。
 * 若目標為目錄，丟出例外。
 */
export function installSkill(bundled: string, overwrite: boolean): 'installed' | 'exists' {
  const target = skillTargetPath()
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      throw new Error('目標 skill 路徑為目錄，無法安裝')
    }
    const currentContent = fs.readFileSync(target, 'utf-8')
    if (normalizeEol(currentContent) === normalizeEol(bundled)) {
      return 'installed'
    }
    if (!overwrite) {
      return 'exists'
    }
    const bakPath = target + '.bak'
    // 備份原內容（原樣，不轉換換行；.bak 若存在直接覆蓋）
    storage.writeFileAtomic(bakPath, currentContent)
    storage.writeFileAtomic(target, bundled)
    return 'installed'
  }

  storage.writeFileAtomic(target, bundled)
  return 'installed'
}

/**
 * 移除 model-routing skill。
 * 刪除 SKILL.md；若 model-routing 資料夾為空則一併刪除資料夾。
 * 若有 .bak 等其他檔案則保留資料夾，不刪除 .bak。
 * 檔案不存在時回傳 false，成功刪除回傳 true。
 */
export function uninstallSkill(): boolean {
  const target = skillTargetPath()
  try {
    if (!fs.existsSync(target)) return false
    const stat = fs.statSync(target)
    if (stat.isDirectory()) return false
    fs.rmSync(target, { force: true })
    const dir = path.dirname(target)
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
      if (files.length === 0) {
        fs.rmdirSync(dir)
      }
    }
    return true
  } catch {
    return false
  }
}
