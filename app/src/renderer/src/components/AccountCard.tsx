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
import { useT } from '@/lib/i18n'
import { UsageBar } from './UsageBar'

interface Props {
  account: AccountView
  threshold: number
  thresholdWeekly: number
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
  thresholdWeekly,
  now,
  busy,
  onSwitch,
  onRename,
  onDelete,
  onRelogin
}: Props): React.JSX.Element {
  const t = useT()
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
                title={t('accounts.clickRename')}
                className="truncate rounded-sm text-left text-base font-semibold outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {a.name}
              </button>
              {a.active && <Badge>{t('accounts.active')}</Badge>}
              <Badge variant="secondary" className="text-[10px]">
                Claude
              </Badge>
              {a.subscriptionType && (
                <Badge variant="outline" className="uppercase">
                  {a.subscriptionType}
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{a.email || t('accounts.unknownEmail')}</p>
          </div>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t('accounts.moreActionsAria', { name: a.name })}>
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('accounts.moreActions')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRename}>
                <Pencil /> {t('common.rename')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={a.active} onSelect={onDelete}>
                <Trash2 /> {a.active ? t('accounts.deleteActiveDisabled') : t('common.delete')}
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
              {t('accounts.needsRelogin')}
            </span>
            <Button size="xs" variant="outline" onClick={onRelogin} disabled={busy}>
              <LogIn /> {t('accounts.relogin')}
            </Button>
          </div>
        )}
        {!a.needsRelogin && a.error && (
          <p className="text-xs text-amber-300" role="status">
            {a.error}
          </p>
        )}

        <div className={cn('space-y-3 transition-opacity', u.stale && 'opacity-50')}>
          <UsageBar label={t('usage.fiveHour')} window={u.five_hour} threshold={threshold} />
          <UsageBar label={t('usage.sevenDay')} window={u.seven_day} threshold={thresholdWeekly} />
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 tabular-nums">
            {u.updatedAt ? t('accounts.updatedAt', { time: formatRelative(u.updatedAt, now) }) : t('accounts.noUsageData')}
            {sourceLabel && <Badge variant="secondary">{sourceLabel}</Badge>}
            {u.stale && (
              <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                {t('accounts.staleData')}
              </Badge>
            )}
          </span>
          {a.exhaustedUntil > now / 1000 && <span className="text-red-400">{t('accounts.exhausted')}</span>}
        </div>

        <Button
          className="w-full"
          variant={a.active ? 'secondary' : 'default'}
          disabled={a.active || busy}
          onClick={onSwitch}
        >
          <ArrowRightLeft /> {a.active ? t('accounts.currentlyActive') : t('accounts.switchTo')}
        </Button>
      </CardContent>
    </Card>
  )
}
