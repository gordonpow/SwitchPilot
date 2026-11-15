// 主程序與畫面共用的型別（IPC 契約）。規格：docs/work/electron-rewrite/2-spec.md「IPC 契約」與 R-9～R-11。

/** 單一用量視窗（5 小時或 7 天）。used_percentage 0–100，resets_at 為 unix 秒。 */
export type UsageWindow = { used_percentage: number; resets_at: number } | null

export interface AccountView {
  id: string
  name: string
  email: string
  active: boolean
  exhaustedUntil: number // unix 秒，0 = 無（slot 的 exhausted_until）
  savedAt: number // unix 秒（slot 的 saved_at）
  subscriptionType: string | null // credentials.claudeAiOauth.subscriptionType，例如 "max"
  usage: {
    five_hour: UsageWindow
    seven_day: UsageWindow
    updatedAt: number | null // unix 秒
    source: 'api' | 'statusline' | null
    stale: boolean
  }
  needsRelogin: boolean
  error: string | null // 中文說明
}

export interface LoginView {
  state: 'idle' | 'running' | 'awaiting_name' | 'failed'
  url: string | null
  email: string | null
  message: string | null
  startedAt: number | null
  reloginSlotId: string | null
  defaultName: string | null // awaiting_name 時的預設名稱（重新登入時為原名稱，否則為 email）
}

export interface EventItem {
  ts: number
  text: string
  level: 'info' | 'warn' | 'error'
}

export type LoginBrowser = 'chrome' | 'edge' | 'default'

import type { Lang, LangSetting } from './i18n'

export interface AppConfig {
  threshold: number
  auto_switch: boolean
  last_folder: string
  login_browser: LoginBrowser
  usage_poll_seconds: number
  manage_external: boolean // 切換時一併處理外部 claude CLI
  continue_prompt: string // 中斷後自動送出的提示；空字串 = 不送
  switch_mode: 'live' | 'restart' // live：不重啟；restart：結束並以 --resume 重開
  auto_compact: AutoCompactConfig
  close_to_tray: boolean // 按 X 時縮到系統匣
  launch_at_login: boolean // 開機自動啟動（以 --hidden 在背景啟動）
  language: LangSetting // 介面語言；auto = 依系統語言
}

/** 自動整理上下文設定（與 core/config 的 AutoCompact 同形）。 */
export interface AutoCompactConfig {
  enabled: boolean
  threshold_type: 'percent' | 'tokens'
  threshold: number // percent：1～99；tokens：1000～2000000
  action: 'compact' | 'clear'
  wait_seconds: number // 5～600
  folders: string[] // 空 = 全部
  clear_screen_after: boolean // 整理後清除畫面
}

/** setConfig 的部分更新；auto_compact 可只給部分欄位。 */
export type AppConfigPatch = Omit<Partial<AppConfig>, 'auto_compact'> & {
  auto_compact?: Partial<AutoCompactConfig>
}

export interface RunView {
  runId: string
  cwd: string
  state: 'running' | 'waiting'
}

export interface CliView {
  pid: number
  cwd: string | null
  sessionId: string | null
  slotName: string | null
  turn: 'busy' | 'idle' | 'interrupted' | 'unknown'
  hosted: boolean
  /** 切換時的接續方式 */
  method: 'runner' | 'inject' | 'newtab' | 'live' | 'none'
  /** 切換當下是否會把「繼續提示」送進這個 claude（由 controller 計算） */
  willPrompt: boolean
  /** 最新 statusline 紀錄的上下文使用百分比；沒有資料為 null */
  contextPct: number | null
}

/** agy 額度（畫面用）。remaining 0～1；resetAt、ts 為 unix 秒。 */
export interface AgyQuotaView {
  ts: number
  tier: string | null
  models: { id: string; remaining: number; resetAt: number | null }[]
  error: string | null
}

export interface AgyAccountView {
  id: string
  name: string
  email: string
  active: boolean
  quota: AgyQuotaView | null
  /** access token 已過期（或快到期）：不查額度，畫面顯示最後更新時間 */
  tokenExpired: boolean
}

/** 新增 agy 帳號流程狀態。 */
export interface AgyLoginView {
  state: 'idle' | 'waiting' | 'signed_in' | 'done' | 'error'
  email: string | null
  message: string | null
}

/** 模型分工（與 core/routing 同形）。 */
export type RoleId =
  | 'requirements'
  | 'spec'
  | 'spec_review'
  | 'implement'
  | 'impl_review'
  | 'research'
  | 'docs'

export interface RouteEntry {
  provider: 'claude' | 'agy'
  model: string
  /** agy slot id；空或省略代表全部。Claude 項目第一期忽略。 */
  accounts?: string[]
}

export interface Routing {
  version: 1
  max_concurrent_per_account?: number
  roles: Record<RoleId, RouteEntry[]>
}

export interface DispatchRunningView {
  id: string
  role: RoleId
  model: string
  account: string
  cwd: string
  startedAt: number
}

export interface DispatchRecentView {
  id: string
  role: RoleId
  status: 'ok' | 'delegate' | 'failed'
  provider: 'claude' | 'agy' | null
  model: string | null
  account: string | null
  startedAt: number
  endedAt: number
  message: string
}

export interface AppState {
  /** 實際使用的介面語言（auto 已解析） */
  language: Lang
  accounts: AccountView[]
  current: { slotId: string | null; email: string | null; unsaved: boolean }
  runs: RunView[]
  switching: boolean
  pending: boolean // 已達門檻、等待回合結束
  usagePolling: boolean
  lastPollAt: number | null // unix 秒
  earliestReset: number | null // 所有帳號都用完時的最早重置時間（unix 秒），否則 null
  config: AppConfig
  integration: { installed: boolean; needsUpdate: boolean; nodeFound: boolean }
  clis: CliView[]
  clisScannedAt: number | null // unix 秒
  login: LoginView
  events: EventItem[] // 最新 200 筆
  agyAccounts: AgyAccountView[]
  agyLogin: AgyLoginView
  /** 目前 agy 登入（認證管理員）：email 與是否尚未儲存成帳號；尚未讀取過為 null */
  agyCurrent: { email: string | null; unsaved: boolean } | null
  /** agy 額度查詢是否進行中 */
  agyQuerying: boolean
  routing: Routing
  /** 可選的 agy 模型 id（額度快取出現過的＋目前設定中的） */
  agyModels: string[]
  dispatch: {
    running: DispatchRunningView[]
    recent: DispatchRecentView[]
    maxConcurrent: number
  }
}

export type ErrorCode = 'NODE_MISSING' | 'CLAUDE_MISSING' | 'IN_USE' | 'BUSY' | 'INVALID' | 'UNKNOWN'
export type Result = { ok: true } | { ok: false; error: string; code: ErrorCode }

export interface Api {
  getState(): Promise<AppState>
  onState(cb: (s: AppState) => void): () => void
  saveCurrent(name: string): Promise<Result>
  switchTo(id: string, restartRuns: boolean): Promise<Result>
  renameSlot(id: string, name: string): Promise<Result>
  deleteSlot(id: string): Promise<Result>
  refreshUsage(): Promise<Result>
  /** 清除所有帳號的用完標記 */
  clearExhausted(): Promise<Result>
  startLogin(browser?: LoginBrowser, reloginSlotId?: string): Promise<Result>
  cancelLogin(): Promise<Result>
  completeLogin(name: string): Promise<Result>
  copyLoginUrl(): Promise<Result>
  pickFolder(): Promise<string | null>
  launch(folder: string, cont: boolean): Promise<Result>
  setConfig(patch: AppConfigPatch): Promise<Result>
  installIntegration(): Promise<Result>
  uninstallIntegration(): Promise<Result>
  agySaveCurrent(name: string): Promise<Result>
  agySwitch(id: string): Promise<Result>
  agyRename(id: string, name: string): Promise<Result>
  agyDelete(id: string): Promise<Result>
  agyStartLogin(): Promise<Result>
  agyCancelLogin(): Promise<Result>
  /** 已偵測到新登入，不等 agy 視窗關閉就結束流程 */
  agyFinishLogin(): Promise<Result>
  agyRefreshQuota(): Promise<Result>
  setRouting(r: Routing): Promise<Result>
}

/** IPC channel 名稱（preload 與 main 共用）。 */
export const IPC = {
  getState: 'state:get',
  push: 'state:push',
  saveCurrent: 'accounts:saveCurrent',
  switchTo: 'accounts:switchTo',
  renameSlot: 'accounts:renameSlot',
  deleteSlot: 'accounts:deleteSlot',
  refreshUsage: 'usage:refresh',
  clearExhausted: 'accounts:clearExhausted',
  startLogin: 'login:start',
  cancelLogin: 'login:cancel',
  completeLogin: 'login:complete',
  copyLoginUrl: 'login:copyUrl',
  pickFolder: 'launch:pickFolder',
  launch: 'launch:start',
  setConfig: 'config:set',
  installIntegration: 'integration:install',
  uninstallIntegration: 'integration:uninstall',
  agySaveCurrent: 'agy:saveCurrent',
  agySwitch: 'agy:switch',
  agyRename: 'agy:rename',
  agyDelete: 'agy:delete',
  agyStartLogin: 'agy:startLogin',
  agyCancelLogin: 'agy:cancelLogin',
  agyFinishLogin: 'agy:finishLogin',
  agyRefreshQuota: 'agy:refreshQuota',
  setRouting: 'routing:set'
} as const

declare global {
  interface Window {
    api: Api
  }
}
