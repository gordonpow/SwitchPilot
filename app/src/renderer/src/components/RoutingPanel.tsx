import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { AgyAccountView, AppState, RoleId, RouteEntry, Routing } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CLAUDE_MODELS, MAX_ENTRIES, ROLE_IDS, ROLE_LABELS, entryLabel } from '@/lib/routing'
import { act } from '@/lib/use-app-state'
import { cn } from '@/lib/utils'

interface Props {
  state: AppState
}

const clone = (r: Routing): Routing => JSON.parse(JSON.stringify(r)) as Routing

/** 勾選帳號；全部不勾代表所有帳號。 */
function AccountPicker({
  accounts,
  value,
  onChange
}: {
  accounts: AgyAccountView[]
  value: string[]
  onChange: (v: string[]) => void
}): React.JSX.Element {
  if (accounts.length === 0) {
    return <p className="text-xs text-muted-foreground">帳號範圍：全部（尚無 agy 帳號）</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">
        帳號範圍：{value.length === 0 ? '全部' : `${value.length} 個`}
      </span>
      {accounts.map((a) => (
        <label key={a.id} className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={value.includes(a.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))
            }
          />
          <span className="max-w-32 truncate" title={a.email}>
            {a.name}
          </span>
        </label>
      ))}
    </div>
  )
}

interface AddForm {
  provider: 'claude' | 'agy'
  model: string
  accounts: string[]
}

export function RoutingPanel({ state }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Routing>(() => clone(state.routing))
  const [adding, setAdding] = useState<RoleId | null>(null)
  const [form, setForm] = useState<AddForm>({ provider: 'claude', model: 'sonnet', accounts: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirtyRef = useRef(false)

  // 進入頁面時以目前儲存的設定為準（元件隨頁面掛載）；未編輯時跟著外部更新
  useEffect(() => {
    if (!dirtyRef.current) setDraft(clone(state.routing))
  }, [state.routing])

  const dirty = JSON.stringify(draft) !== JSON.stringify(state.routing)
  dirtyRef.current = dirty

  const setList = (role: RoleId, list: RouteEntry[]): void => {
    setDraft((d) => ({ ...d, roles: { ...d.roles, [role]: list } }))
    setError(null)
  }
  const move = (role: RoleId, i: number, delta: number): void => {
    const list = [...draft.roles[role]]
    const j = i + delta
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    setList(role, list)
  }
  const startAdd = (role: RoleId): void => {
    setAdding(role)
    setForm({ provider: 'claude', model: 'sonnet', accounts: [] })
  }
  const confirmAdd = (role: RoleId): void => {
    const model = form.model.trim()
    if (!model) return
    const entry: RouteEntry =
      form.provider === 'agy' && form.accounts.length > 0
        ? { provider: 'agy', model, accounts: form.accounts }
        : { provider: form.provider, model }
    setList(role, [...draft.roles[role], entry])
    setAdding(null)
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const r = await window.api.setRouting(draft)
      if (r.ok) {
        await act(Promise.resolve(r), '已儲存模型分工')
      } else {
        setError(r.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生未知錯誤')
    }
    setSaving(false)
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="模型分工"
        description="每個階段依序嘗試清單中的項目，前一項額度用完或無法使用時換下一項。Claude 項目一定使用目前的 Claude 帳號。"
      />

      <div className="mb-4 rounded-md border p-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="max-concurrent" className="text-sm font-medium">
              每個 agy 帳號同時執行上限
            </Label>
            <p className="text-xs text-muted-foreground">
              多個派工同時執行時，最多同時在此數量的任務中使用同一個 agy 帳號（1～8）。
            </p>
          </div>
          <Input
            id="max-concurrent"
            aria-label="每個 agy 帳號同時執行上限"
            type="number"
            min={1}
            max={8}
            className="w-24 text-right"
            value={draft.max_concurrent_per_account ?? 2}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              setDraft((d) => ({
                ...d,
                max_concurrent_per_account: Number.isNaN(val) ? undefined : val
              }))
              setError(null)
            }}
          />
        </div>
      </div>

      <ul className="space-y-3" aria-label="模型分工清單">
          {ROLE_IDS.map((role) => {
            const list = draft.roles[role]
            return (
              <li key={role} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{ROLE_LABELS[role]}</span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={list.length >= MAX_ENTRIES || adding === role}
                    onClick={() => startAdd(role)}
                  >
                    <Plus /> 新增
                  </Button>
                </div>

                <ol className="space-y-2">
                  {list.map((e, i) => (
                    <li
                      key={`${e.provider}-${e.model}-${i}`}
                      className="space-y-1.5 rounded-md bg-muted/40 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-4 text-center text-xs text-muted-foreground tabular-nums">
                          {i + 1}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'min-w-0 max-w-full truncate',
                            e.provider === 'agy' && 'border-sky-500/40 text-sky-300'
                          )}
                        >
                          {entryLabel(e)}
                        </Badge>
                        <div className="ml-auto flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="上移"
                            disabled={i === 0}
                            onClick={() => move(role, i, -1)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="下移"
                            disabled={i === list.length - 1}
                            onClick={() => move(role, i, 1)}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="刪除"
                            disabled={list.length <= 1}
                            onClick={() =>
                              setList(
                                role,
                                list.filter((_, k) => k !== i)
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      {e.provider === 'agy' ? (
                        <div className="pl-6">
                          <AccountPicker
                            accounts={state.agyAccounts}
                            value={e.accounts ?? []}
                            onChange={(v) =>
                              setList(
                                role,
                                list.map((x, k) =>
                                  k === i
                                    ? v.length > 0
                                      ? { ...x, accounts: v }
                                      : { provider: x.provider, model: x.model }
                                    : x
                                )
                              )
                            }
                          />
                        </div>
                      ) : (
                        <p className="pl-6 text-xs text-muted-foreground">
                          帳號範圍：目前帳號（指定帳號為「第二期」功能）
                        </p>
                      )}
                    </li>
                  ))}
                </ol>

                {adding === role && (
                  <div className="space-y-2 rounded-md border border-dashed p-2">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">供應商</Label>
                        <Select
                          value={form.provider}
                          onValueChange={(v) =>
                            setForm({
                              provider: v as 'claude' | 'agy',
                              model: v === 'claude' ? 'sonnet' : (state.agyModels[0] ?? ''),
                              accounts: []
                            })
                          }
                        >
                          <SelectTrigger className="w-32" aria-label="供應商">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="claude">Claude</SelectItem>
                            <SelectItem value="agy">agy</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <Label className="text-xs">模型</Label>
                        {form.provider === 'claude' ? (
                          <Select value={form.model} onValueChange={(v) => setForm({ ...form, model: v })}>
                            <SelectTrigger className="w-full" aria-label="模型">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLAUDE_MODELS.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <>
                            <Input
                              aria-label="agy 模型"
                              list="agy-model-options"
                              value={form.model}
                              placeholder="例如 claude-sonnet-4-6"
                              onChange={(e) => setForm({ ...form, model: e.target.value })}
                            />
                            <datalist id="agy-model-options">
                              {state.agyModels.map((m) => (
                                <option key={m} value={m} />
                              ))}
                            </datalist>
                          </>
                        )}
                      </div>
                    </div>
                    {form.provider === 'agy' && (
                      <AccountPicker
                        accounts={state.agyAccounts}
                        value={form.accounts}
                        onChange={(v) => setForm({ ...form, accounts: v })}
                      />
                    )}
                    <div className="flex justify-end gap-2">
                      <Button size="xs" variant="outline" onClick={() => setAdding(null)}>
                        取消
                      </Button>
                      <Button size="xs" disabled={!form.model.trim()} onClick={() => confirmAdd(role)}>
                        加入
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(clone(state.routing))
              setAdding(null)
              setError(null)
            }}
          >
            還原
          </Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            儲存
          </Button>
        </div>
    </div>
  )
}
