import type { AccountView, AgyAccountView, Api, AppState, Result, Routing } from '../../../shared/types'

// 純瀏覽器預覽用的假 API：window.api 不存在時由 main.tsx 安裝。
const now = (): number => Math.floor(Date.now() / 1000)
const ok: Result = { ok: true }

const defaultRouting = (): Routing => ({
  version: 1,
  max_concurrent_per_account: 2,
  roles: {
    requirements: [{ provider: 'claude', model: 'opus' }],
    spec: [{ provider: 'claude', model: 'opus' }],
    spec_review: [{ provider: 'claude', model: 'sonnet' }],
    implement: [
      { provider: 'agy', model: 'claude-sonnet-4-6', accounts: ['g1'] },
      { provider: 'claude', model: 'sonnet' }
    ],
    impl_review: [{ provider: 'claude', model: 'sonnet' }],
    research: [{ provider: 'claude', model: 'haiku' }],
    docs: [{ provider: 'claude', model: 'haiku' }]
  }
})

function agyInitial(t: number): AgyAccountView[] {
  return [
    {
      id: 'g1',
      name: '主要 agy',
      email: 'work@example.com',
      active: true,
      tokenExpired: false,
      quota: {
        ts: t - 200,
        tier: 'standard-tier',
        models: [
          { id: 'claude-sonnet-4-6', remaining: 0.72, resetAt: t + 3 * 3600 },
          { id: 'claude-opus-4-6-thinking', remaining: 0.08, resetAt: t + 5 * 3600 },
          { id: 'gemini-3.8-flash-tiered', remaining: 1, resetAt: null },
          { id: 'gemini-3.5-pro-high', remaining: 0.35, resetAt: t + 2 * 3600 }
        ],
        error: null
      }
    },
    {
      id: 'g2',
      name: '備用 agy',
      email: 'spare@example.com',
      active: false,
      tokenExpired: true,
      quota: {
        ts: t - 5 * 3600,
        tier: 'free-tier',
        models: [
          { id: 'claude-sonnet-4-6', remaining: 0.4, resetAt: t - 3600 },
          { id: 'gemini-3.8-flash-tiered', remaining: 0.9, resetAt: null }
        ],
        error: null
      }
    }
  ]
}

function initial(): AppState {
  const t = now()
  const accounts: AccountView[] = [
    {
      id: 'a1',
      name: '工作帳號',
      email: 'work@example.com',
      active: true,
      exhaustedUntil: 0,
      savedAt: t - 86400,
      subscriptionType: 'max',
      usage: {
        five_hour: { used_percentage: 42, resets_at: t + 3 * 3600 },
        seven_day: { used_percentage: 10, resets_at: t + 4 * 86400 },
        updatedAt: t - 120,
        source: 'statusline',
        stale: false
      },
      needsRelogin: false,
      error: null
    },
    {
      id: 'a2',
      name: '個人帳號',
      email: 'me@example.com',
      active: false,
      exhaustedUntil: 0,
      savedAt: t - 3 * 86400,
      subscriptionType: 'pro',
      usage: {
        five_hour: { used_percentage: 5, resets_at: t + 4 * 3600 },
        seven_day: { used_percentage: 60, resets_at: t + 2 * 86400 },
        updatedAt: t - 90,
        source: 'api',
        stale: false
      },
      needsRelogin: false,
      error: null
    },
    {
      id: 'a3',
      name: '備用帳號',
      email: 'spare@example.com',
      active: false,
      exhaustedUntil: 0,
      savedAt: t - 9 * 86400,
      subscriptionType: null,
      usage: { five_hour: null, seven_day: null, updatedAt: t - 7200, source: 'api', stale: true },
      needsRelogin: true,
      error: 'token 已過期，需要重新登入'
    }
  ]
  const agyAccounts = agyInitial(t)
  return {
    agyAccounts,
    agyLogin: { state: 'idle', email: null, message: null },
    agyCurrent: { email: 'work@example.com', unsaved: false },
    agyQuerying: false,
    routing: defaultRouting(),
    agyModels: ['claude-opus-4-6-thinking', 'claude-sonnet-4-6', 'gemini-3.5-pro-high', 'gemini-3.8-flash-tiered'],
    dispatch: {
      running: [
        {
          id: 'run-mock-1',
          role: 'implement',
          model: 'gemini-3.8-flash-tiered',
          account: 'work@example.com',
          cwd: 'C:\\presonal_project\\Switching_account',
          startedAt: (t - 45) * 1000
        }
      ],
      recent: [
        {
          id: 'recent-mock-1',
          role: 'spec',
          status: 'delegate',
          provider: 'claude',
          model: 'opus',
          account: null,
          startedAt: (t - 600) * 1000,
          endedAt: (t - 598) * 1000,
          message: '請改用 Claude 子代理（model: opus）執行'
        },
        {
          id: 'recent-mock-2',
          role: 'implement',
          status: 'ok',
          provider: 'agy',
          model: 'claude-sonnet-4-6',
          account: 'work@example.com',
          startedAt: (t - 1200) * 1000,
          endedAt: (t - 1140) * 1000,
          message: '執行成功'
        }
      ],
      maxConcurrent: 2
    },
    accounts,
    current: { slotId: 'a1', email: 'work@example.com', unsaved: false },
    runs: [
      { runId: 'r1', cwd: 'C:\\presonal_project\\Switching_account', state: 'running' },
      { runId: 'r2', cwd: 'C:\\work\\demo', state: 'waiting' }
    ],
    language: 'zh-TW',
    switching: false,
    pending: false,
    usagePolling: false,
    lastPollAt: t - 60,
    earliestReset: null,
    config: {
      threshold: 95,
      auto_switch: true,
      last_folder: 'C:\\presonal_project',
      login_browser: 'chrome',
      usage_poll_seconds: 120,
      manage_external: true,
      continue_prompt: '繼續',
      switch_mode: 'live',
      auto_compact: {
        enabled: false,
        threshold_type: 'percent',
        threshold: 60,
        action: 'compact',
        wait_seconds: 20,
        folders: [],
        clear_screen_after: true
      },
      close_to_tray: false,
      launch_at_login: false,
      language: 'auto'
    },
    integration: { installed: true, needsUpdate: false, nodeFound: true },
    clis: [
      { pid: 4242, cwd: 'C:\\presonal_project\\Switching_account', sessionId: 'a', slotName: '工作帳號', turn: 'busy', hosted: true, method: 'runner', willPrompt: false, contextPct: 42 },
      { pid: 5120, cwd: 'C:\\work\\demo', sessionId: 'b', slotName: '工作帳號', turn: 'idle', hosted: false, method: 'inject', willPrompt: false, contextPct: 71 },
      { pid: 6388, cwd: 'C:\\work\\a-very-long-folder-name\\that\\keeps\\going\\and\\going\\project', sessionId: 'c', slotName: '備用帳號', turn: 'interrupted', hosted: false, method: 'newtab', willPrompt: false, contextPct: null },
      { pid: 7001, cwd: null, sessionId: null, slotName: null, turn: 'unknown', hosted: false, method: 'none', willPrompt: false, contextPct: null }
    ],
    clisScannedAt: t - 5,
    login: {
      state: 'idle',
      url: null,
      email: null,
      message: null,
      startedAt: null,
      reloginSlotId: null,
      defaultName: null
    },
    events: [
      { ts: t - 900, text: '已啟動，載入 3 個帳號', level: 'info' },
      { ts: t - 600, text: '「備用帳號」token 已過期，需要重新登入', level: 'warn' },
      { ts: t - 300, text: '用量 API 暫時無法使用，改用 statusline 資料', level: 'warn' },
      { ts: t - 120, text: '已更新 2 個帳號的用量', level: 'info' },
      { ts: t - 30, text: '切換帳號失敗：憑證檔被占用', level: 'error' }
    ]
  }
}

export function installMockApi(): void {
  let state = initial()
  const subs = new Set<(s: AppState) => void>()
  const push = (patch: Partial<AppState>): void => {
    state = { ...state, ...patch }
    subs.forEach((cb) => cb(state))
  }
  const done = async (text: string): Promise<Result> => {
    push({ events: [...state.events, { ts: now(), text, level: 'info' }] })
    return ok
  }

  const api: Api = {
    getState: async () => state,
    onState: (cb) => {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
    saveCurrent: (name) => done(`已儲存目前帳號為「${name}」`),
    switchTo: async (id) => {
      push({
        accounts: state.accounts.map((a) => ({ ...a, active: a.id === id })),
        current: { ...state.current, slotId: id }
      })
      return done('已切換帳號')
    },
    renameSlot: async (id, name) => {
      push({ accounts: state.accounts.map((a) => (a.id === id ? { ...a, name } : a)) })
      return ok
    },
    deleteSlot: async (id) => {
      push({ accounts: state.accounts.filter((a) => a.id !== id) })
      return ok
    },
    refreshUsage: async () => {
      push({ usagePolling: true })
      setTimeout(() => push({ usagePolling: false, lastPollAt: now() }), 1000)
      return ok
    },
    clearExhausted: async () => ok,
    startLogin: async (_b, reloginSlotId) => {
      push({
        login: {
          ...state.login,
          state: 'running',
          url: 'https://claude.ai/oauth/authorize?mock=1',
          startedAt: now(),
          reloginSlotId: reloginSlotId ?? null
        }
      })
      setTimeout(
        () =>
          push({
            login: {
              ...state.login,
              state: 'awaiting_name',
              email: 'new@example.com',
              defaultName: 'new@example.com'
            }
          }),
        2500
      )
      return ok
    },
    cancelLogin: async () => {
      push({ login: { ...state.login, state: 'idle' } })
      return ok
    },
    completeLogin: async () => {
      push({ login: { ...state.login, state: 'idle' } })
      return ok
    },
    copyLoginUrl: async () => ok,
    pickFolder: async () => 'C:\\work\\picked',
    launch: (folder) => done(`已啟動 claude：${folder}`),
    setConfig: async (patch) => {
      push({
        config: {
          ...state.config,
          ...patch,
          auto_compact: { ...state.config.auto_compact, ...patch.auto_compact }
        }
      })
      return ok
    },
    installIntegration: async () => {
      push({ integration: { ...state.integration, installed: true } })
      return ok
    },
    uninstallIntegration: async () => {
      push({ integration: { ...state.integration, installed: false } })
      return ok
    },
    agySaveCurrent: (name) => done(`已儲存 agy 帳號「${name}」`),
    agySwitch: async (id) => {
      push({ agyAccounts: state.agyAccounts.map((a) => ({ ...a, active: a.id === id })) })
      return done('已切換 agy 帳號')
    },
    agyRename: async (id, name) => {
      push({ agyAccounts: state.agyAccounts.map((a) => (a.id === id ? { ...a, name } : a)) })
      return ok
    },
    agyDelete: async (id) => {
      push({ agyAccounts: state.agyAccounts.filter((a) => a.id !== id) })
      return ok
    },
    agyStartLogin: async () => {
      push({ agyLogin: { state: 'waiting', email: null, message: '請在開啟的視窗完成 agy 登入' } })
      setTimeout(
        () =>
          push({
            agyLogin: {
              state: 'signed_in',
              email: 'new@example.com',
              message: '已登入 new@example.com，請關閉 agy 視窗以完成'
            }
          }),
        2500
      )
      return ok
    },
    agyCancelLogin: async () => {
      push({ agyLogin: { state: 'idle', email: null, message: null } })
      return ok
    },
    agyFinishLogin: async () => {
      push({ agyLogin: { state: 'done', email: 'new@example.com', message: '已新增 new（new@example.com），已還原原本的登入' } })
      return ok
    },
    agyRefreshQuota: async () => {
      push({ agyQuerying: true })
      setTimeout(() => push({ agyQuerying: false }), 1000)
      return ok
    },
    setRouting: async (r) => {
      push({ routing: r })
      return ok
    }
  }
  window.api = api
}
