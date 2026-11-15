import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildApplyArgs,
  checkForUpdate,
  compareVersions,
  downloadAsset,
  isAllowedDownloadUrl,
  parseVersion,
  pickLatest,
  UPDATE_REPO
} from '../src/core/updater'
import { useTempEnv } from './helpers'

describe('updater core module', () => {
  const getRoot = useTempEnv()

  describe('parseVersion', () => {
    it('parses valid semver versions with or without v prefix', () => {
      expect(parseVersion('v1.2.3')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: null
      })
      expect(parseVersion('1.2.3')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: null
      })
      expect(parseVersion('v1.2.3-beta.1')).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: 'beta.1'
      })
      expect(parseVersion('2.0.0-rc.0')).toEqual({
        major: 2,
        minor: 0,
        patch: 0,
        prerelease: 'rc.0'
      })
    })

    it('returns null for invalid version strings', () => {
      expect(parseVersion('')).toBeNull()
      expect(parseVersion('invalid')).toBeNull()
      expect(parseVersion('v1.2')).toBeNull()
      expect(parseVersion('1.2.3.4')).toBeNull()
      expect(parseVersion('1.2.x')).toBeNull()
    })
  })

  describe('compareVersions', () => {
    it('預覽標籤依 SemVer 比較（數字段比數值、其餘 ASCII 序）', () => {
      expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0)
      expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.9')).toBeGreaterThan(0)
      expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
      expect(compareVersions('1.0.0-Beta', '1.0.0-alpha')).toBeLessThan(0)
    })
    it('compares standard semver versions', () => {
      expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0)
      expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
      expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
      expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
      expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0)
    })

    it('treats release version higher than same prerelease version', () => {
      expect(compareVersions('1.2.3', '1.2.3-beta.1')).toBeGreaterThan(0)
      expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBeLessThan(0)
    })

    it('compares prerelease identifiers properly', () => {
      expect(compareVersions('1.2.3-beta.2', '1.2.3-beta.1')).toBeGreaterThan(0)
      expect(compareVersions('1.2.3-alpha', '1.2.3-beta')).toBeLessThan(0)
      expect(compareVersions('1.2.3-beta', '1.2.3-beta.1')).toBeLessThan(0)
      expect(compareVersions('1.2.3-beta.2', '1.2.3-beta.10')).toBeLessThan(0)
      expect(compareVersions('1.2.3-beta.1', '1.2.3-beta.1')).toBe(0)
    })

    it('throws error when comparing invalid version', () => {
      expect(() => compareVersions('invalid', '1.0.0')).toThrow()
    })
  })

  describe('pickLatest', () => {
    const validAsset = {
      name: 'SwitchPilot-1.1.0.exe',
      browser_download_url: 'https://github.com/gordonpow/SwitchPilot/releases/download/v1.1.0/SwitchPilot-1.1.0.exe',
      size: 50000000,
      digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    }

    it('excludes drafts and releases without exe assets', () => {
      const releases = [
        {
          tag_name: 'v1.1.0',
          draft: true,
          assets: [validAsset]
        },
        {
          tag_name: 'v1.0.9',
          draft: false,
          assets: [{ name: 'source.tar.gz', browser_download_url: 'https://github.com/foo.tar.gz' }]
        }
      ]
      expect(pickLatest(releases, true)).toBeNull()
    })

    it('excludes prereleases when includePrerelease is false', () => {
      const releases = [
        {
          tag_name: 'v1.2.0-beta.1',
          prerelease: true,
          assets: [
            {
              name: 'SwitchPilot-1.2.0-beta.1.exe',
              browser_download_url: 'https://github.com/download/beta.exe',
              size: 100
            }
          ]
        },
        {
          tag_name: 'v1.1.0',
          prerelease: false,
          assets: [validAsset]
        }
      ]
      const latest = pickLatest(releases, false)
      expect(latest).not.toBeNull()
      expect(latest?.version).toBe('1.1.0')

      const latestWithPre = pickLatest(releases, true)
      expect(latestWithPre?.version).toBe('1.2.0-beta.1')
    })

    it('prefers asset matching SwitchPilot-*.exe over other exe assets', () => {
      const releases = [
        {
          tag_name: 'v1.1.0',
          assets: [
            {
              name: 'other-tool.exe',
              browser_download_url: 'https://github.com/other.exe',
              size: 200
            },
            validAsset
          ]
        }
      ]
      const latest = pickLatest(releases, true)
      expect(latest?.asset.name).toBe('SwitchPilot-1.1.0.exe')
    })

    it('accepts the legacy Claude-Account-Switcher-*.exe name, preferring the new name', () => {
      const legacy = {
        name: 'Claude-Account-Switcher-1.1.0.exe',
        browser_download_url: 'https://github.com/gordonpow/SwitchPilot/releases/download/v1.1.0/Claude-Account-Switcher-1.1.0.exe',
        size: 100
      }
      const other = { name: 'other-tool.exe', browser_download_url: 'https://github.com/other.exe', size: 200 }
      expect(pickLatest([{ tag_name: 'v1.1.0', assets: [other, legacy] }], true)?.asset.name).toBe(
        'Claude-Account-Switcher-1.1.0.exe'
      )
      expect(pickLatest([{ tag_name: 'v1.1.0', assets: [legacy, validAsset] }], true)?.asset.name).toBe(
        'SwitchPilot-1.1.0.exe'
      )
    })

    it('falls back to the first exe when no known name matches', () => {
      const other = { name: 'whatever.exe', browser_download_url: 'https://github.com/other.exe', size: 200 }
      expect(pickLatest([{ tag_name: 'v1.1.0', assets: [other] }], true)?.asset.name).toBe('whatever.exe')
    })

    it('rejects insecure asset names containing path traversal', () => {
      const releases = [
        {
          tag_name: 'v1.1.0',
          assets: [
            {
              name: '../dangerous.exe',
              browser_download_url: 'https://github.com/danger.exe',
              size: 100
            },
            {
              name: 'sub/dir.exe',
              browser_download_url: 'https://github.com/dir.exe',
              size: 100
            }
          ]
        }
      ]
      expect(pickLatest(releases, true)).toBeNull()
    })

    it('truncates release notes to 4000 characters', () => {
      const longBody = 'A'.repeat(5000)
      const releases = [
        {
          tag_name: 'v1.1.0',
          body: longBody,
          assets: [validAsset]
        }
      ]
      const latest = pickLatest(releases, true)
      expect(latest?.notes.length).toBe(4000)
    })
  })

  describe('checkForUpdate', () => {
    it('calls github releases API with proper headers and checks version', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: 'v1.2.0',
            assets: [
              {
                name: 'SwitchPilot-1.2.0.exe',
                browser_download_url: 'https://github.com/download/app.exe',
                size: 1000
              }
            ]
          }
        ]
      })

      const res = await checkForUpdate(fakeFetch as any, '1.1.0', true)
      expect(fakeFetch).toHaveBeenCalledWith(
        `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=20`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.github+json',
            'User-Agent': 'switchpilot'
          })
        })
      )
      expect(res.available).toBe(true)
      expect(res.latest?.version).toBe('1.2.0')

      // When current is newer or same
      const resSame = await checkForUpdate(fakeFetch as any, '1.2.0', true)
      expect(resSame.available).toBe(false)
    })

    it('throws error with status code when request fails', async () => {
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403
      })
      await expect(checkForUpdate(fakeFetch as any, '1.0.0', true)).rejects.toThrow('HTTP 403')
    })
  })

  describe('isAllowedDownloadUrl', () => {
    it('accepts allowed github urls', () => {
      expect(isAllowedDownloadUrl('https://github.com/gordonpow/SwitchPilot/releases/download/v1.0.0/app.exe')).toBe(true)
      expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset-2e65be/foo')).toBe(true)
      expect(isAllowedDownloadUrl('https://release.githubusercontent.com/asset.exe')).toBe(true)
    })

    it('rejects disallowed urls', () => {
      expect(isAllowedDownloadUrl('http://github.com/app.exe')).toBe(false) // not https
      expect(isAllowedDownloadUrl('https://malicious.com/app.exe')).toBe(false)
      expect(isAllowedDownloadUrl('invalid-url')).toBe(false)
    })
  })

  describe('downloadAsset', () => {
    function makeReadableStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
      let idx = 0
      return new ReadableStream({
        pull(controller) {
          if (idx < chunks.length) {
            controller.enqueue(chunks[idx++])
          } else {
            controller.close()
          }
        }
      })
    }

    it('successfully downloads asset with valid MZ header and matching SHA-256', async () => {
      const root = getRoot()
      const destDir = path.join(root, 'updates')

      // Content starting with MZ (0x4D, 0x5A)
      const data = Buffer.from([0x4d, 0x5a, 0x01, 0x02, 0x03, 0x04])
      const expectedSha256 = crypto.createHash('sha256').update(data).digest('hex')

      const asset = {
        name: 'test-app.exe',
        url: 'https://github.com/repo/releases/test-app.exe',
        size: data.length,
        sha256: expectedSha256
      }

      const stream = makeReadableStream([data.subarray(0, 3), data.subarray(3)])
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://objects.githubusercontent.com/test-app.exe',
        body: stream
      })

      const progressEvents: number[] = []
      const finalPath = await downloadAsset(
        fakeFetch as any,
        asset,
        destDir,
        (rec, total) => {
          progressEvents.push(rec)
          expect(total).toBe(data.length)
        }
      )

      expect(fs.existsSync(finalPath)).toBe(true)
      expect(fs.existsSync(`${finalPath}.part`)).toBe(false)
      expect(fs.readFileSync(finalPath)).toEqual(data)
      expect(progressEvents.length).toBeGreaterThan(0)
    })

    it('fails and removes .part file if header does not start with MZ', async () => {
      const root = getRoot()
      const destDir = path.join(root, 'updates')

      const data = Buffer.from([0x00, 0x00, 0x01, 0x02])
      const asset = {
        name: 'bad-header.exe',
        url: 'https://github.com/repo/releases/bad-header.exe',
        size: data.length,
        sha256: null
      }

      const stream = makeReadableStream([data])
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: asset.url,
        body: stream
      })

      await expect(downloadAsset(fakeFetch as any, asset, destDir)).rejects.toThrow('MZ magic bytes')
      expect(fs.existsSync(path.join(destDir, `${asset.name}.part`))).toBe(false)
      expect(fs.existsSync(path.join(destDir, asset.name))).toBe(false)
    })

    it('fails and removes .part file if size does not match', async () => {
      const root = getRoot()
      const destDir = path.join(root, 'updates')

      const data = Buffer.from([0x4d, 0x5a, 0x01, 0x02])
      const asset = {
        name: 'size-mismatch.exe',
        url: 'https://github.com/repo/releases/size-mismatch.exe',
        size: 100, // expected 100 but only got 4
        sha256: null
      }

      const stream = makeReadableStream([data])
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: asset.url,
        body: stream
      })

      await expect(downloadAsset(fakeFetch as any, asset, destDir)).rejects.toThrow('size mismatch')
      expect(fs.existsSync(path.join(destDir, `${asset.name}.part`))).toBe(false)
    })

    it('fails and removes .part file if SHA-256 does not match', async () => {
      const root = getRoot()
      const destDir = path.join(root, 'updates')

      const data = Buffer.from([0x4d, 0x5a, 0x01, 0x02])
      const asset = {
        name: 'sha-mismatch.exe',
        url: 'https://github.com/repo/releases/sha-mismatch.exe',
        size: data.length,
        sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      }

      const stream = makeReadableStream([data])
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: asset.url,
        body: stream
      })

      await expect(downloadAsset(fakeFetch as any, asset, destDir)).rejects.toThrow('SHA-256 mismatch')
      expect(fs.existsSync(path.join(destDir, `${asset.name}.part`))).toBe(false)
    })

    it('rejects disallowed redirect URL', async () => {
      const root = getRoot()
      const destDir = path.join(root, 'updates')

      const data = Buffer.from([0x4d, 0x5a, 0x01, 0x02])
      const asset = {
        name: 'redirect-test.exe',
        url: 'https://github.com/repo/releases/redirect-test.exe',
        size: data.length,
        sha256: null
      }

      const stream = makeReadableStream([data])
      const fakeFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://evil.com/redirected.exe',
        body: stream
      })

      await expect(downloadAsset(fakeFetch as any, asset, destDir)).rejects.toThrow('Disallowed redirect URL')
      expect(fs.existsSync(path.join(destDir, `${asset.name}.part`))).toBe(false)
    })

    it('res.ok 為 false：丟錯且不建立任何檔案', async () => {
      const destDir = path.join(getRoot(), 'updates')
      const asset = {
        name: 'notok.exe',
        url: 'https://github.com/repo/releases/notok.exe',
        size: 4,
        sha256: null
      }
      const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, url: asset.url, body: null })
      await expect(downloadAsset(fakeFetch as any, asset, destDir)).rejects.toThrow('HTTP 500')
      expect(fs.existsSync(path.join(destDir, `${asset.name}.part`))).toBe(false)
    })

    it('目的地目錄其實是檔案：丟錯、無 .part 殘留、無 unhandled error', async () => {
      const root = getRoot()
      const destDir = path.join(root, 'updates')
      fs.writeFileSync(destDir, 'I am a file')
      const asset = {
        name: 'werr.exe',
        url: 'https://github.com/repo/releases/werr.exe',
        size: 4,
        sha256: null
      }
      const unhandled: unknown[] = []
      const onErr = (e: unknown): void => void unhandled.push(e)
      process.on('uncaughtException', onErr)
      process.on('unhandledRejection', onErr)
      try {
        const fakeFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          url: asset.url,
          body: makeReadableStream([Buffer.from([0x4d, 0x5a, 1, 2])])
        })
        await expect(downloadAsset(fakeFetch as any, asset, destDir)).rejects.toThrow()
        await new Promise((r) => setTimeout(r, 50))
      } finally {
        process.off('uncaughtException', onErr)
        process.off('unhandledRejection', onErr)
      }
      expect(unhandled).toEqual([])
      expect(fs.existsSync(path.join(root, 'updates.part'))).toBe(false)
    })

    it('寫檔串流錯誤（檔名含非法字元）：reject 且無 unhandled error', async () => {
      const root = getRoot()
      const destDir = path.join(root, 'updates')
      fs.mkdirSync(destDir, { recursive: true })
      const asset = {
        // Windows 不允許檔名含 ?，createWriteStream 會非同步丟出 error 事件
        name: 'serr?.exe',
        url: 'https://github.com/repo/releases/serr.exe',
        size: 4,
        sha256: null
      }
      const unhandled: unknown[] = []
      const onErr = (e: unknown): void => void unhandled.push(e)
      process.on('uncaughtException', onErr)
      process.on('unhandledRejection', onErr)
      try {
        const fakeFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          url: asset.url,
          body: makeReadableStream([Buffer.from([0x4d, 0x5a, 1, 2])])
        })
        await expect(downloadAsset(fakeFetch as any, asset, destDir)).rejects.toThrow()
        await new Promise((r) => setTimeout(r, 50))
      } finally {
        process.off('uncaughtException', onErr)
        process.off('unhandledRejection', onErr)
      }
      expect(unhandled).toEqual([])
      expect(fs.existsSync(path.join(destDir, asset.name))).toBe(false)
    })
  })

  describe('buildApplyArgs', () => {
    it('builds powershell arguments matching specification', () => {
      const args = buildApplyArgs({
        scriptPath: 'C:\\test\\update.ps1',
        waitPids: [1234, 5678],
        target: 'C:\\app\\switcher.exe',
        newFile: 'C:\\app\\updates\\new.exe',
        logFile: 'C:\\app\\updates\\update.log',
        noLaunch: true
      })

      expect(args).toEqual([
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\test\\update.ps1',
        '-WaitPids',
        '1234,5678',
        '-Target',
        'C:\\app\\switcher.exe',
        '-NewFile',
        'C:\\app\\updates\\new.exe',
        '-LogFile',
        'C:\\app\\updates\\update.log',
        '-NoLaunch'
      ])
    })
  })
})
