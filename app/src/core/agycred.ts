// agy 登入資料（Windows 認證管理員 gemini:antigravity）的存取。透過 agycred.ps1 呼叫，不 import electron。
// 錯誤訊息不得包含 blob、token、stdout 或 stderr 的內容。
import { t } from '../shared/i18n'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import * as paths from './paths'

export interface AgyCred {
  user: string
  /** UTF-8 JSON 字串（agy 自己的格式） */
  blob: string
}

export interface AgyCredOps {
  read(): Promise<AgyCred | null>
  write(c: AgyCred): Promise<void>
  remove(): Promise<void>
}

/** 執行外部程式。code 為 exit code（無法啟動或逾時為 null）；stderr 不外傳。 */
export type ExecFn = (
  file: string,
  args: string[],
  opts: { windowsHide: boolean; timeout: number },
  input?: string
) => Promise<{ code: number | null; stdout: string }>

const defaultExec: ExecFn = (file, args, opts, input) =>
  new Promise((resolve) => {
    try {
      const child = execFile(file, args, { ...opts, encoding: 'utf8' }, (err, stdout) => {
        if (!err) return resolve({ code: 0, stdout: String(stdout) })
        const code = (err as NodeJS.ErrnoException & { code?: unknown }).code
        resolve({ code: typeof code === 'number' ? code : null, stdout: '' })
      })
      child.stdin?.end(input ?? '')
    } catch {
      resolve({ code: null, stdout: '' })
    }
  })

const TIMEOUT_MS = 15000

export function defaultCredOps(ps1Path?: string, exec: ExecFn = defaultExec): AgyCredOps {
  const run = (action: string, input?: string): ReturnType<ExecFn> =>
    exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ps1Path ?? path.join(paths.binDir(), 'agycred.ps1'),
        '-Action',
        action
      ],
      { windowsHide: true, timeout: TIMEOUT_MS },
      input
    )
  return {
    async read() {
      const r = await run('read')
      if (r.code === 3) return null
      if (r.code !== 0) throw new Error(t('err.agyReadFailed', { code: r.code ?? t('common.timeout') }))
      try {
        const j = JSON.parse(r.stdout.trim()) as { user?: unknown; blob_b64?: unknown }
        if (typeof j.blob_b64 !== 'string') throw new Error('x')
        return {
          user: typeof j.user === 'string' ? j.user : '',
          blob: Buffer.from(j.blob_b64, 'base64').toString('utf-8')
        }
      } catch {
        throw new Error(t('err.agyParse'))
      }
    },
    async write(c) {
      const line = JSON.stringify({
        user: c.user,
        blob_b64: Buffer.from(c.blob, 'utf-8').toString('base64')
      })
      const r = await run('write', line + '\n')
      if (r.code !== 0) throw new Error(t('err.agyWriteFailed', { code: r.code ?? t('common.timeout') }))
    },
    async remove() {
      const r = await run('delete')
      if (r.code !== 0) throw new Error(t('err.agyDeleteFailed', { code: r.code ?? t('common.timeout') }))
    }
  }
}

/** 解析 agy blob：email（轉小寫）、access token 到期時間（毫秒）、access token。格式錯誤回傳全 null。 */
export function parseBlob(blob: string): {
  email: string | null
  expiryMs: number | null
  accessToken: string | null
} {
  const none = { email: null, expiryMs: null, accessToken: null }
  try {
    const j = JSON.parse(blob) as Record<string, unknown> | null
    if (!j || typeof j !== 'object') return none
    const email =
      typeof j.id_token_email === 'string' && j.id_token_email.trim()
        ? j.id_token_email.trim().toLowerCase()
        : null
    const tok = j.token as Record<string, unknown> | null | undefined
    let expiryMs: number | null = null
    let accessToken: string | null = null
    if (tok && typeof tok === 'object') {
      if (typeof tok.expiry === 'string') {
        const t = Date.parse(tok.expiry)
        if (Number.isFinite(t)) expiryMs = t
      }
      if (typeof tok.access_token === 'string' && tok.access_token) accessToken = tok.access_token
    }
    return { email, expiryMs, accessToken }
  } catch {
    return none
  }
}
