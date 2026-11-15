import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  CircleCheck,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X
} from 'lucide-react'
import type { AgyAccountView, AppState } from '../../../shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatRelative } from '@/lib/format'
import { act } from '@/lib/use-app-state'
import { cn } from '@/lib/utils'
import { NameDialog } from './NameDialog'

/** 優先顯示的模型；其餘依快取順序補到最多 5 個。 */
const MAIN_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gemini-3.8-flash-tiered']
const MAX_MODELS = 5

function pickModels(a: AgyAccountView): { id: string; remaining: number; resetAt: number | null }[] {
  const all = a.quota?.models ?? []
  const main = MAIN_MODELS.map((id) => all.find((m) => m.id === id)).filter(
    (m): m is NonNullable<typeof m> => !!m
  )
  const rest = all.filter((m) => !MAIN_MODELS.includes(m.id))
  return [...main, ...rest].slice(0, MAX_MODELS)
}

function remainingColor(pct: number): string {
  if (pct <= 10) return 'bg-red-500'
  if (pct <= 30) return 'bg-amber-400'
  return 'bg-emerald-500'
}

function ModelBar({
  id,
  remaining,
  resetAt
}: {
  id: string
  remaining: number
  resetAt: number | null
}): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, Math.round(remaining * 100)))
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={id}>
          {id}
        </span>
        <span className="shrink-0 font-medium tabular-nums">剩 {pct}%</span>
      </div>
      <Progress
        value={pct}
        aria-label={`${id} 剩餘額度`}
        className="h-1.5 bg-muted"
        indicatorClassName={remainingColor(pct)}
      />
      {resetAt ? (
        <p className="text-right text-[11px] text-muted-foreground tabular-nums">
          {formatDateTime(resetAt)} 重置
        </p>
      ) : null}
    </div>
  )
}

interface CardProps {
  account: AgyAccountView
  busy: boolean
  onRename: () => void
  onDelete: () => void
  onSwitch: () => void
}

function AgyCard({ account: a, busy, onRename, onDelete, onSwitch }: CardProps): React.JSX.Element {
  const models = pickModels(a)
  const q = a.quota
  return (
    <Card className={cn('gap-3 py-4', a.active && 'ring-1 ring-primary/60')}>
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold">{a.name}</span>
              {a.active && <Badge>使用中</Badge>}
              <Badge variant="secondary" className="text-[10px]">
                agy
              </Badge>
              {q?.tier && (
                <Badge variant="outline" className="max-w-28 truncate">
                  {q.tier}
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{a.email}</p>
          </div>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`${a.name} 的更多操作`}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>更多操作</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRename}>
                <Pencil /> 重新命名
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> 刪除（不影響目前的 agy 登入）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {models.length > 0 ? (
          <div className={cn('space-y-2.5', a.tokenExpired && 'opacity-60')}>
            {models.map((m) => (
              <ModelBar key={m.id} {...m} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">尚無額度資料</p>
        )}

        {q?.error && (
          <p className="text-xs text-pretty text-amber-300" role="status">
            {q.error}
          </p>
        )}
        {a.tokenExpired ? (
          <p
            className="flex items-start gap-1.5 text-xs text-pretty text-amber-300"
            role="status"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="tabular-nums">
              最後更新：{q ? formatDateTime(q.ts) : '無'}（token 已過期，切換到此帳號後更新）
            </span>
          </p>
        ) : (
          q && (
            <p className="text-xs text-muted-foreground tabular-nums">
              最後更新：{formatDateTime(q.ts)}
            </p>
          )
        )}

        <Button
          className="w-full"
          size="sm"
          variant={a.active ? 'secondary' : 'default'}
          disabled={a.active || busy}
          onClick={onSwitch}
        >
          <ArrowRightLeft /> {a.active ? '目前使用中' : '切換到此帳號'}
        </Button>
      </CardContent>
    </Card>
  )
}

function LoginStatus({ login }: { login: AppState['agyLogin'] }): React.JSX.Element | null {
  if (login.state === 'idle') return null
  const base = 'flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm'
  if (login.state === 'waiting' || login.state === 'signed_in') {
    return (
      <div role="status" className={cn(base, 'border-sky-500/40 bg-sky-500/10 text-sky-200')}>
        {login.state === 'waiting' ? (
          <Loader2 className="size-4 shrink-0 animate-spin" />
        ) : (
          <CircleCheck className="size-4 shrink-0 text-emerald-400" />
        )}
        <span className="min-w-0 flex-1 text-pretty">
          {login.state === 'waiting'
            ? '等待登入：請在新開的視窗完成 agy 登入'
            : (login.message ?? `已登入 ${login.email ?? ''}，請關閉 agy 視窗以完成`)}
        </span>
        {login.state === 'signed_in' && (
          <Button
            size="xs"
            onClick={() => void act(window.api.agyFinishLogin(), '已新增 agy 帳號')}
          >
            完成
          </Button>
        )}
        <Button size="xs" variant="outline" onClick={() => void act(window.api.agyCancelLogin())}>
          <X /> 取消
        </Button>
      </div>
    )
  }
  const isDone = login.state === 'done'
  return (
    <div
      role={isDone ? 'status' : 'alert'}
      className={cn(
        base,
        isDone
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : 'border-red-500/40 bg-red-500/10 text-red-300'
      )}
    >
      {isDone ? (
        <CircleCheck className="size-4 shrink-0" />
      ) : (
        <AlertTriangle className="size-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 text-pretty">{login.message}</span>
      <Button size="xs" variant="outline" onClick={() => void act(window.api.agyCancelLogin())}>
        關閉
      </Button>
    </div>
  )
}

export type AgyDialog = 'add' | 'save' | null

interface Props {
  state: AppState
  now: number
  /** 頁首「新增帳號」選單開啟的對話框（新增 agy 帳號／儲存目前 agy 登入）。 */
  dialog: AgyDialog
  onDialogChange: (d: AgyDialog) => void
}

export function AgySection({ state, now, dialog, onDialogChange }: Props): React.JSX.Element {
  const { agyAccounts, agyLogin, agyCurrent, agyQuerying } = state
  const [renaming, setRenaming] = useState<AgyAccountView | null>(null)
  const [deleting, setDeleting] = useState<AgyAccountView | null>(null)
  const savingCurrent = dialog === 'save'
  const confirmAdd = dialog === 'add'
  const flowing = agyLogin.state === 'waiting' || agyLogin.state === 'signed_in'
  const lastQuery = agyAccounts.reduce<number | null>(
    (m, a) => (a.quota && (m === null || a.quota.ts > m) ? a.quota.ts : m),
    null
  )
  return (
    <section aria-label="Google" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold">Google</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{agyAccounts.length} 個</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {agyQuerying
            ? '查詢額度中…'
            : lastQuery
              ? `額度 ${formatRelative(lastQuery, now)}更新`
              : ''}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {agyCurrent?.unsaved && (
            <Button
              size="xs"
              variant="outline"
              className="border-amber-500/50 text-amber-300"
              disabled={flowing}
              onClick={() => onDialogChange('save')}
            >
              <Save /> 儲存目前 agy 登入（{agyCurrent.email}）
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="重新整理 agy 額度"
                disabled={agyQuerying}
                onClick={() => void act(window.api.agyRefreshQuota())}
              >
                <RefreshCw className={agyQuerying ? 'animate-spin' : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重新整理 agy 額度</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <LoginStatus login={agyLogin} />

      {agyAccounts.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-pretty text-muted-foreground">
          還沒有 Google 帳號。從頁首「新增帳號」選 Google，再登入或儲存目前的 agy 登入。
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {agyAccounts.map((a) => (
            <AgyCard
              key={a.id}
              account={a}
              busy={flowing || state.switching}
              onRename={() => setRenaming(a)}
              onDelete={() => setDeleting(a)}
              onSwitch={() => void act(window.api.agySwitch(a.id), `已切換到 agy「${a.name}」`)}
            />
          ))}
        </div>
      )}

      <NameDialog
        open={renaming !== null}
        title="重新命名 agy 帳號"
        initialName={renaming?.name ?? ''}
        submitLabel="儲存"
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (renaming && (await act(window.api.agyRename(renaming.id, name), '已重新命名')))
            setRenaming(null)
        }}
      />
      <NameDialog
        open={savingCurrent}
        title="儲存目前的 agy 登入"
        description={agyCurrent?.email ? `目前登入：${agyCurrent.email}` : undefined}
        initialName={agyCurrent?.email?.split('@')[0] ?? ''}
        submitLabel="儲存"
        onClose={() => onDialogChange(null)}
        onSubmit={async (name) => {
          if (await act(window.api.agySaveCurrent(name), '已儲存 agy 帳號')) onDialogChange(null)
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除 agy 帳號「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              只會移除這裡儲存的登入資料，不會登出目前的 agy。需要時必須重新登入。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void act(window.api.agyDelete(deleting.id), '已刪除 agy 帳號')}
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAdd} onOpenChange={(o) => onDialogChange(o ? 'add' : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>新增 agy 帳號</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              會先把目前的 agy 登入存成帳號並暫時登出，再開新視窗讓你登入新帳號。登入後請關閉
              agy 視窗，程式會儲存新帳號並還原原本的登入。開始前請先關閉所有 agy。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void act(window.api.agyStartLogin())}>
              開始
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
