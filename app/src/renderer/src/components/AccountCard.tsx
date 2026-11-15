import { AlertTriangle, ArrowRightLeft, LogIn, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import type { AccountView } from '../../../shared/types'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { UsageBar } from './UsageBar'

interface Props {
  account: AccountView
  threshold: number
  now: number
  busy: boolean
  onSwitch: () => void
  onRename: () => void
  onDelete: () => void
  onRelogin: () => void
}

export function AccountCard({
  account: a,
  threshold,
  now,
  busy,
  onSwitch,
  onRename,
  onDelete,
  onRelogin
}: Props): React.JSX.Element {
  const u = a.usage
  const sourceLabel = u.source === 'api' ? 'API' : u.source === 'statusline' ? 'statusline' : null
  return (
    <Card className={cn('gap-4 py-4', a.active && 'ring-1 ring-primary/60')}>
      <CardContent className="space-y-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRename}
                title="點擊重新命名"
                className="truncate rounded-sm text-left text-base font-semibold outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {a.name}
              </button>
              {a.active && <Badge>使用中</Badge>}
              <Badge variant="secondary" className="text-[10px]">
                Claude
              </Badge>
              {a.subscriptionType && (
                <Badge variant="outline" className="uppercase">
                  {a.subscriptionType}
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{a.email || '（未知 email）'}</p>
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
              <DropdownMenuItem variant="destructive" disabled={a.active} onSelect={onDelete}>
                <Trash2 /> {a.active ? '刪除（使用中不可刪）' : '刪除'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {a.needsRelogin && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0" />
              需要重新登入
            </span>
            <Button size="xs" variant="outline" onClick={onRelogin} disabled={busy}>
              <LogIn /> 重新登入
            </Button>
          </div>
        )}
        {!a.needsRelogin && a.error && (
          <p className="text-xs text-amber-300" role="status">
            {a.error}
          </p>
        )}

        <div className={cn('space-y-3 transition-opacity', u.stale && 'opacity-50')}>
          <UsageBar label="5 小時" window={u.five_hour} threshold={threshold} />
          <UsageBar label="7 天" window={u.seven_day} threshold={threshold} />
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 tabular-nums">
            {u.updatedAt ? `${formatRelative(u.updatedAt, now)}更新` : '尚無用量資料'}
            {sourceLabel && <Badge variant="secondary">{sourceLabel}</Badge>}
            {u.stale && (
              <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                資料過舊
              </Badge>
            )}
          </span>
          {a.exhaustedUntil > now / 1000 && <span className="text-red-400">已標記用完</span>}
        </div>

        <Button
          className="w-full"
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
