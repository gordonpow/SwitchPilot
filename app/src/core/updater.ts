// 自動更新核心邏輯：版本解析、比較、GitHub Release 挑選、安全下載與替換參數建構。
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** 唯一發布倉庫來源。 */
export const UPDATE_REPO = 'gordonpow/SwitchPilot'

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  sha256: string | null
}

export interface LatestRelease {
  version: string
  tag: string
  htmlUrl: string
  notes: string
  publishedAt: string
  asset: ReleaseAsset
}

export interface CheckUpdateResult {
  latest: LatestRelease | null
  available: boolean
}

export interface ApplyArgs {
  scriptPath: string
  waitPids: (number | string)[]
  target: string
  newFile: string
  logFile: string
  noLaunch?: boolean
}

const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * 解析版本號字串（例如 v1.2.3、1.2.3、1.2.3-beta.1）。
 * 若格式不符合語意化版本規則則回傳 null。
 */
export function parseVersion(s: string): ParsedVersion | null {
  if (typeof s !== 'string') return null
  const match = s.trim().match(SEMVER_REGEX)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ?? null
  }
}

/**
 * 比較兩版本（SemVer 規範）。
 * 預覽版優先級低於相同主次修訂號之正式版。
 * a > b 回傳 1，a < b 回傳 -1，相等回傳 0。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) {
    throw new Error(`Invalid version comparison: '${a}' vs '${b}'`)
  }

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1

  // 正式版優先於預覽版
  if (pa.prerelease === null && pb.prerelease === null) return 0
  if (pa.prerelease === null && pb.prerelease !== null) return 1
  if (pa.prerelease !== null && pb.prerelease === null) return -1

  // 兩者皆為預覽版時，以點區隔各段比較
  const segsA = pa.prerelease!.split('.')
  const segsB = pb.prerelease!.split('.')
  const maxLen = Math.max(segsA.length, segsB.length)

  for (let i = 0; i < maxLen; i++) {
    const sa = segsA[i]
    const sb = segsB[i]
    if (sa === undefined) return -1
    if (sb === undefined) return 1
    if (sa === sb) continue

    const isNumA = /^\d+$/.test(sa)
    const isNumB = /^\d+$/.test(sb)

    if (isNumA && isNumB) {
      const diff = parseInt(sa, 10) - parseInt(sb, 10)
      if (diff !== 0) return diff > 0 ? 1 : -1
    } else if (isNumA && !isNumB) {
      // 依 SemVer 規則，純數字識別標籤優先級低於文字標籤
      return -1
    } else if (!isNumA && isNumB) {
      return 1
    } else {
      // 依 SemVer 規則以 ASCII 序比較，不使用 localeCompare
      if (sa !== sb) return sa > sb ? 1 : -1
    }
  }

  return 0
}

/**
 * 檢查資產名稱是否安全且為 exe。
 */
function isValidExeAssetName(name: string): boolean {
  if (typeof name !== 'string') return false
  if (!name.toLowerCase().endsWith('.exe')) return false
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  return path.basename(name) === name
}

/**
 * 解析資產 sha256 雜湊值（例如 digest 欄位為 sha256:<hex>）。
 */
function parseDigestSha256(asset: any): string | null {
  if (typeof asset?.digest === 'string') {
    const match = asset.digest.match(/^sha256:([0-9a-fA-F]{64})$/i)
    if (match) return match[1].toLowerCase()
  }
  return null
}

/**
 * 從 GitHub releases 清單挑選出最新的合格發布版本。
 */
export function pickLatest(releases: any[], includePrerelease: boolean): LatestRelease | null {
  if (!Array.isArray(releases)) return null

  const candidates: LatestRelease[] = []

  for (const rel of releases) {
    if (!rel || rel.draft === true) continue
    if (!includePrerelease && rel.prerelease === true) continue

    // 解析版本號
    const parsed = parseVersion(rel.tag_name) || parseVersion(rel.name)
    if (!parsed) continue

    const versionStr = parsed.prerelease
      ? `${parsed.major}.${parsed.minor}.${parsed.patch}-${parsed.prerelease}`
      : `${parsed.major}.${parsed.minor}.${parsed.patch}`

    // 篩選合格的 .exe 資產
    if (!Array.isArray(rel.assets) || rel.assets.length === 0) continue

    const exeAssets = rel.assets.filter(
      (a: any) =>
        a &&
        typeof a.name === 'string' &&
        isValidExeAssetName(a.name) &&
        typeof a.browser_download_url === 'string'
    )
    if (exeAssets.length === 0) continue

    // 優先 SwitchPilot-*.exe，其次舊名 Claude-Account-Switcher-*.exe，再其次第一個 exe
    let chosen = exeAssets.find((a: any) => /^SwitchPilot[-. ].*\.exe$/i.test(a.name))
    if (!chosen) {
      chosen = exeAssets.find((a: any) => /^Claude-Account-Switcher-.*\.exe$/i.test(a.name))
    }
    if (!chosen) {
      chosen = exeAssets[0]
    }

    const asset: ReleaseAsset = {
      name: chosen.name,
      url: chosen.browser_download_url,
      size: typeof chosen.size === 'number' ? chosen.size : 0,
      sha256: parseDigestSha256(chosen)
    }

    const notes = typeof rel.body === 'string' ? rel.body.slice(0, 4000) : ''

    candidates.push({
      version: versionStr,
      tag: String(rel.tag_name || ''),
      htmlUrl: String(rel.html_url || ''),
      notes,
      publishedAt: String(rel.published_at || ''),
      asset
    })
  }

  if (candidates.length === 0) return null

  // 排序挑選最高版本
  candidates.sort((a, b) => compareVersions(b.version, a.version))
  return candidates[0]
}

/**
 * 檢查 GitHub 倉庫是否有可用更新。
 */
export async function checkForUpdate(
  fetchFn: typeof fetch,
  current: string,
  includePrerelease: boolean
): Promise<CheckUpdateResult> {
  const url = `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=20`
  const res = await fetchFn(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'switchpilot'
    }
  })

  if (!res.ok) {
    throw new Error(`Failed to check for updates: HTTP ${res.status}`)
  }

  const data = await res.json()
  const latest = pickLatest(data, includePrerelease)
  const available = latest !== null && compareVersions(latest.version, current) > 0
  return { latest, available }
}

/**
 * 檢查下載網址是否為允許的主機（https 協定且為 github.com 或其使用者內容子網域）。
 */
export function isAllowedDownloadUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return host === 'github.com' || host === 'objects.githubusercontent.com' || host.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

/**
 * 下載資產檔案並驗證大小、檔頭（MZ）與雜湊，通過後重新命名為正式名稱。
 */
export async function downloadAsset(
  fetchFn: typeof fetch,
  asset: ReleaseAsset,
  destDir: string,
  onProgress?: (received: number, total: number) => void,
  isAllowedUrl: (url: string) => boolean = isAllowedDownloadUrl
): Promise<string> {
  if (!isValidExeAssetName(asset.name)) {
    throw new Error(`Invalid asset executable name: ${asset.name}`)
  }

  if (!isAllowedUrl(asset.url)) {
    throw new Error(`Disallowed download URL: ${asset.url}`)
  }

  const res = await fetchFn(asset.url, {
    method: 'GET',
    headers: {
      'User-Agent': 'switchpilot'
    }
  })

  if (!res.ok) {
    throw new Error(`Failed to download asset: HTTP ${res.status}`)
  }

  if (res.url && !isAllowedUrl(res.url)) {
    throw new Error(`Disallowed redirect URL: ${res.url}`)
  }

  await fs.promises.mkdir(destDir, { recursive: true })
  const partPath = path.join(destDir, `${asset.name}.part`)
  const finalPath = path.join(destDir, asset.name)

  if (fs.existsSync(partPath)) {
    try {
      fs.unlinkSync(partPath)
    } catch {
      // 忽略刪除暫存檔錯誤
    }
  }

  const hash = crypto.createHash('sha256')
  let received = 0
  let headerBuffer = Buffer.alloc(0)
  const writeStream = fs.createWriteStream(partPath)
  // 常駐 error 監聽：記下第一個錯誤，避免出現 unhandled 'error'，且不累積一次性監聽器
  let streamError: Error | null = null
  let rejectPending: ((e: Error) => void) | null = null
  writeStream.on('error', (e) => {
    streamError ??= e
    rejectPending?.(e)
  })

  const writeChunk = (chunk: Uint8Array): Promise<void> => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    received += buf.length
    hash.update(buf)

    if (headerBuffer.length < 2) {
      headerBuffer = Buffer.concat([headerBuffer, buf]).subarray(0, 2)
    }

    if (onProgress) {
      onProgress(received, asset.size)
    }

    if (streamError) return Promise.reject(streamError)
    if (!writeStream.write(buf)) {
      return new Promise<void>((resolve, reject) => {
        const onDrain = (): void => {
          rejectPending = null
          resolve()
        }
        rejectPending = (e) => {
          writeStream.removeListener('drain', onDrain)
          rejectPending = null
          reject(e)
        }
        writeStream.once('drain', onDrain)
      })
    }
    return Promise.resolve()
  }

  try {
    if (!res.body) {
      throw new Error('Response body is null')
    }

    // 支援 WHATWG ReadableStream 或 Node.js stream
    const bodyAny = res.body as any
    if (typeof bodyAny.getReader === 'function') {
      const reader = bodyAny.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            await writeChunk(value)
          }
        }
      } finally {
        reader.releaseLock?.()
      }
    } else if (Symbol.asyncIterator in bodyAny) {
      for await (const chunk of bodyAny) {
        await writeChunk(chunk)
      }
    } else {
      throw new Error('Unsupported stream type in response body')
    }

    await new Promise<void>((resolve, reject) => {
      if (streamError) {
        reject(streamError)
        return
      }
      rejectPending = reject
      writeStream.end(() => {
        rejectPending = null
        if (streamError) reject(streamError)
        else resolve()
      })
    })

    // 驗證大小
    if (asset.size > 0 && received !== asset.size) {
      throw new Error(`Asset size mismatch: expected ${asset.size}, got ${received}`)
    }

    // 驗證檔頭前兩位元組是否為 MZ (0x4D, 0x5A)
    if (
      headerBuffer.length < 2 ||
      headerBuffer[0] !== 0x4d ||
      headerBuffer[1] !== 0x5a
    ) {
      throw new Error('Invalid executable header: missing MZ magic bytes')
    }

    // 驗證 SHA-256 雜湊
    const calculatedHash = hash.digest('hex').toLowerCase()
    if (asset.sha256) {
      if (calculatedHash !== asset.sha256.toLowerCase()) {
        throw new Error(
          `Asset SHA-256 mismatch: expected ${asset.sha256}, got ${calculatedHash}`
        )
      }
    }

    // 重新命名為正式名稱
    fs.renameSync(partPath, finalPath)
    return finalPath
  } catch (err) {
    // 等 write stream 完全關閉後再刪暫存檔，避免 Windows 檔案仍被占用
    await new Promise<void>((resolve) => {
      if (writeStream.closed) {
        resolve()
        return
      }
      writeStream.once('close', () => resolve())
      try {
        writeStream.destroy()
      } catch {
        resolve()
      }
    })
    if (fs.existsSync(partPath)) {
      try {
        fs.unlinkSync(partPath)
      } catch {
        // 忽略刪除暫存檔錯誤
      }
    }
    throw err
  }
}

/**
 * 建構呼叫 update.ps1 的命令列引數清單。
 */
export function buildApplyArgs(args: ApplyArgs): string[] {
  const result = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    args.scriptPath,
    '-WaitPids',
    args.waitPids.join(','),
    '-Target',
    args.target,
    '-NewFile',
    args.newFile,
    '-LogFile',
    args.logFile
  ]
  if (args.noLaunch) {
    result.push('-NoLaunch')
  }
  return result
}
