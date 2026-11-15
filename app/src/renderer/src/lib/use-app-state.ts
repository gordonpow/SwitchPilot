import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AppState, Result } from '../../../shared/types'
import { t } from '../../../shared/i18n'

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.getState().then((s) => alive && setState(s))
    const off = window.api.onState((s) => alive && setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** 每 intervalMs 觸發重新渲染，供相對時間使用。 */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** 執行 IPC 動作；失敗時 toast 顯示錯誤，回傳是否成功。 */
export async function act(p: Promise<Result>, successMsg?: string): Promise<boolean> {
  try {
    const r = await p
    if (r.ok) {
      if (successMsg) toast.success(successMsg)
      return true
    }
    if (r.code === 'NODE_MISSING') {
      toast.error(r.error, { description: t('error.nodeMissingDesc') })
    } else {
      toast.error(r.error)
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('common.unknownErrorLong'))
  }
  return false
}
