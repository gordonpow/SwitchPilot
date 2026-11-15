// 帳號層級的 in-process 鎖（Promise 佇列）：同一 slotId 的 fn 依序執行。
const tails = new Map<string, Promise<unknown>>()

export function withSlotLock<T>(slotId: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = tails.get(slotId) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  tails.set(slotId, tail)
  void tail.then(() => {
    if (tails.get(slotId) === tail) tails.delete(slotId)
  })
  return run
}
