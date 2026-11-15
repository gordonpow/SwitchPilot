import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import * as paths from '../src/core/paths'
import * as storage from '../src/core/storage'

const KEYS = ['SWITCHPILOT_HOME', 'SWITCHPILOT_CLAUDE_HOME', 'SWITCHPILOT_CLAUDE_JSON']

/** 每個測試使用暫存目錄與環境變數，結束後還原。回傳 root 的取得函式。 */
export function useTempEnv(): () => string {
  let root = ''
  let saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-test-'))
    process.env.SWITCHPILOT_HOME = path.join(root, 'app')
    process.env.SWITCHPILOT_CLAUDE_HOME = path.join(root, 'claude')
    process.env.SWITCHPILOT_CLAUDE_JSON = path.join(root, 'claude.json')
    fs.mkdirSync(path.join(root, 'claude'), { recursive: true })
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    fs.rmSync(root, { recursive: true, force: true })
  })
  return () => root
}

export const creds = (token: string): Record<string, unknown> => ({
  claudeAiOauth: { accessToken: token, refreshToken: 'r-' + token }
})
export const acct = (uuid: string, email: string): Record<string, unknown> => ({
  accountUuid: uuid,
  emailAddress: email
})

export function login(
  token: string,
  uuid: string,
  email: string,
  extra: Record<string, unknown> = {}
): void {
  storage.writeJsonAtomic(paths.credFile(), creds(token))
  storage.writeJsonAtomic(paths.claudeJson(), { oauthAccount: acct(uuid, email), ...extra })
}
