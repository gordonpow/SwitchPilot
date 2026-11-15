import { describe, expect, it } from 'vitest'
import {
  dialogToPage,
  shouldHaveTray,
  shouldHideOnClose,
  trayTooltip
} from '../src/main/trayPolicy'

const base = { quitting: false, closeToTray: false, startedHidden: false, screenshot: false }

describe('shouldHideOnClose', () => {
  it('預設關閉視窗不隱藏', () => expect(shouldHideOnClose(base)).toBe(false))
  it('close_to_tray 為 true 時隱藏', () =>
    expect(shouldHideOnClose({ ...base, closeToTray: true })).toBe(true))
  it('--hidden 啟動且未顯示過時隱藏', () =>
    expect(shouldHideOnClose({ ...base, startedHidden: true })).toBe(true))
  it('結束中一律不攔', () => {
    expect(shouldHideOnClose({ ...base, closeToTray: true, quitting: true })).toBe(false)
    expect(shouldHideOnClose({ ...base, startedHidden: true, quitting: true })).toBe(false)
  })
  it('截圖模式不攔', () =>
    expect(shouldHideOnClose({ ...base, closeToTray: true, screenshot: true })).toBe(false))
})

describe('shouldHaveTray', () => {
  const t = { screenshot: false, closeToTray: false, startedHidden: false, windowHidden: false }
  it('全 false 不需要', () => expect(shouldHaveTray(t)).toBe(false))
  it('任一條件成立就需要', () => {
    expect(shouldHaveTray({ ...t, closeToTray: true })).toBe(true)
    expect(shouldHaveTray({ ...t, startedHidden: true })).toBe(true)
    expect(shouldHaveTray({ ...t, windowHidden: true })).toBe(true)
  })
  it('截圖模式不建', () =>
    expect(shouldHaveTray({ ...t, closeToTray: true, screenshot: true })).toBe(false))
})

describe('trayTooltip', () => {
  it('含帳號名稱；沒有則顯示未儲存', () => {
    expect(trayTooltip('a@b.c')).toBe('Claude 帳號切換器\n目前：a@b.c')
    expect(trayTooltip(null)).toBe('Claude 帳號切換器\n目前：未儲存')
  })
  it('截斷到 120 字元', () => expect(trayTooltip('x'.repeat(500)).length).toBe(120))
})

describe('dialogToPage', () => {
  it('舊值轉換', () => {
    expect(dialogToPage('settings')).toBe('settings/general')
    expect(dialogToPage('routing')).toBe('settings/routing')
    expect(dialogToPage('accounts')).toBe('accounts')
  })
})
