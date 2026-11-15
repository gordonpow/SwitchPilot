import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgyCred, AgyCredOps } from '../src/core/agycred'
import * as paths from '../src/core/paths'
import {
  AgyBusyError,
  currentAgySlotId,
  deleteAgy,
  listAgySlots,
  renameAgy,
  saveCurrentAgy,
  switchAgy,
  syncCurrentAgyBack
} from '../src/core/agyaccounts'
import { useTempEnv } from './helpers'

const mkBlob = (email: string | null, tok = 't1'): string =>
  JSON.stringify({ ...(email ? { id_token_email: email } : {}), token: { access_token: tok } })

function fakeOps(init: AgyCred | null): AgyCredOps & { cur: AgyCred | null; writes: number } {
  const o = {
    cur: init,
    writes: 0,
    read: async () => o.cur,
    write: async (c: AgyCred) => {
      o.writes++
      o.cur = c
    },
    remove: async () => {
      o.cur = null
    }
  }
  return o
}

describe('agyaccounts', () => {
  useTempEnv()

  it('saveCurrentAgy：新增 slot，email 小寫，存於 agy/slots', async () => {
    const ops = fakeOps({ user: 'u', blob: mkBlob('Foo@Example.com') })
    const s = await saveCurrentAgy(ops, '')
    expect(s.id).toMatch(/^[0-9a-f]{6}$/)
    expect(s.email).toBe('foo@example.com')
    expect(s.name).toBe('foo')
    expect(fs.existsSync(path.join(paths.agySlotsDir(), `${s.id}.json`))).toBe(true)
    expect(listAgySlots()).toHaveLength(1)
    expect(await currentAgySlotId(ops)).toBe(s.id)
  })

  it('saveCurrentAgy：email 已存在則更新同一 slot 並保留名稱', async () => {
    const ops = fakeOps({ user: 'u', blob: mkBlob('a@x.com', 't1') })
    const s1 = await saveCurrentAgy(ops, '甲')
    ops.cur = { user: 'u2', blob: mkBlob('A@x.com', 't2') }
    const s2 = await saveCurrentAgy(ops, '乙')
    expect(s2.id).toBe(s1.id)
    expect(s2.name).toBe('甲')
    expect(s2.user).toBe('u2')
    expect(listAgySlots()).toHaveLength(1)
    expect(listAgySlots()[0].blob).toContain('t2')
  })

  it('saveCurrentAgy：沒登入或 email 為 null 丟錯', async () => {
    await expect(saveCurrentAgy(fakeOps(null), 'x')).rejects.toThrow('目前沒有 agy 登入')
    await expect(saveCurrentAgy(fakeOps({ user: 'u', blob: mkBlob(null) }), 'x')).rejects.toThrow(
      '無法讀取 agy 登入的 email'
    )
  })

  it('syncCurrentAgyBack：blob 不同才寫回；無對應 slot 回傳 false', async () => {
    const ops = fakeOps({ user: 'u', blob: mkBlob('a@x.com', 't1') })
    expect(await syncCurrentAgyBack(ops)).toBe(false) // 沒有 slot
    await saveCurrentAgy(ops, 'a')
    expect(await syncCurrentAgyBack(ops)).toBe(false) // 相同
    ops.cur = { user: 'u', blob: mkBlob('a@x.com', 'refreshed') }
    expect(await syncCurrentAgyBack(ops)).toBe(true)
    expect(listAgySlots()[0].blob).toContain('refreshed')
    expect(await syncCurrentAgyBack(fakeOps(null))).toBe(false)
  })

  it('switchAgy：先把目前帳號 refresh 後的 blob 存回，再寫入目標', async () => {
    const ops = fakeOps({ user: 'ua', blob: mkBlob('a@x.com', 'a1') })
    const a = await saveCurrentAgy(ops, 'a')
    ops.cur = { user: 'ub', blob: mkBlob('b@x.com', 'b1') }
    const b = await saveCurrentAgy(ops, 'b')
    ops.cur = { user: 'ua', blob: mkBlob('a@x.com', 'a2') }
    await switchAgy(ops, b.id, () => false)
    expect(ops.cur!.user).toBe('ub')
    expect(ops.cur!.blob).toContain('b1')
    expect(listAgySlots().find((s) => s.id === a.id)!.blob).toContain('a2')
    expect(await currentAgySlotId(ops)).toBe(b.id)
  })

  it('switchAgy：agy 執行中丟 AgyBusyError，不寫入', async () => {
    const ops = fakeOps({ user: 'ua', blob: mkBlob('a@x.com') })
    await saveCurrentAgy(ops, 'a')
    ops.cur = { user: 'ub', blob: mkBlob('b@x.com') }
    const b = await saveCurrentAgy(ops, 'b')
    const a = listAgySlots().find((s) => s.email === 'a@x.com')!
    ops.writes = 0
    await expect(switchAgy(ops, a.id, async () => true)).rejects.toBeInstanceOf(AgyBusyError)
    expect(ops.writes).toBe(0)
    expect(await currentAgySlotId(ops)).toBe(b.id)
  })

  it('switchAgy：找不到 slot 丟錯；目標已是目前登入不重寫', async () => {
    const ops = fakeOps({ user: 'u', blob: mkBlob('a@x.com') })
    await expect(switchAgy(ops, 'abcdef', () => false)).rejects.toThrow('找不到 agy 帳號')
    const a = await saveCurrentAgy(ops, 'a')
    await switchAgy(ops, a.id, () => false)
    expect(ops.writes).toBe(0)
  })

  it('renameAgy／deleteAgy：刪除使用中 slot 不動認證管理員', async () => {
    const ops = fakeOps({ user: 'u', blob: mkBlob('a@x.com') })
    const a = await saveCurrentAgy(ops, 'a')
    await renameAgy(a.id, '新名')
    expect(listAgySlots()[0].name).toBe('新名')
    await expect(renameAgy(a.id, ' ')).rejects.toThrow()
    await deleteAgy(a.id)
    expect(listAgySlots()).toHaveLength(0)
    expect(ops.cur).not.toBeNull()
    expect(await currentAgySlotId(ops)).toBeNull()
  })

  it('listAgySlots：忽略壞檔', async () => {
    fs.mkdirSync(paths.agySlotsDir(), { recursive: true })
    fs.writeFileSync(path.join(paths.agySlotsDir(), 'zzzzzz.json'), '{bad')
    fs.writeFileSync(path.join(paths.agySlotsDir(), 'aaaaaa.json'), JSON.stringify({ id: 'aaaaaa' }))
    expect(listAgySlots()).toEqual([])
  })
})
