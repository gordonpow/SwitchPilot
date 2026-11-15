// 系統匣與關閉行為的純決策函式（不得 import electron，方便單元測試）。
import { t } from '../shared/i18n'

export interface CloseDecisionInput {
  /** 正在結束（系統匣「結束」、app.quit()、關機） */
  quitting: boolean
  closeToTray: boolean
  /** 以 --hidden 啟動且尚未顯示過視窗 */
  startedHidden: boolean
  /** 截圖模式 */
  screenshot: boolean
}

/** 按下視窗 X 時是否改為隱藏（而非真的關閉）。 */
export function shouldHideOnClose(i: CloseDecisionInput): boolean {
  if (i.screenshot || i.quitting) return false
  return i.closeToTray || i.startedHidden
}

/** 系統匣是否應存在。 */
export function shouldHaveTray(i: {
  screenshot: boolean
  closeToTray: boolean
  startedHidden: boolean
  windowHidden: boolean
}): boolean {
  if (i.screenshot) return false
  return i.closeToTray || i.startedHidden || i.windowHidden
}

/** tooltip 文字，總長截斷到 120 字元（Windows 上限 127）。 */
export function trayTooltip(accountName: string | null): string {
  const text = t('tray.tooltip', { name: accountName || t('tray.unsaved') })
  return text.length > 120 ? text.slice(0, 119) + '…' : text
}

/** 把舊的 SCREENSHOT_DIALOG 環境變數值（SWITCHPILOT_／CLAUDE_SWITCHER_ 前綴）轉成 page。 */
export function dialogToPage(dialog: string): string {
  if (dialog === 'settings') return 'settings/general'
  if (dialog === 'routing') return 'settings/routing'
  return dialog
}
