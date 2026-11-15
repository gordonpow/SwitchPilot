import { Loader2, RefreshCw, UserRound } from 'lucide-react'
import type { AppState } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelative } from '@/lib/format'
import { useT } from '@/lib/i18n'

interface Props {
  state: AppState
  now: number
  onRefresh: () => void
}

export function TopBar({ state, now, onRefresh }: Props): React.JSX.Element {
  const t = useT()
  const cur = state.current
  const curAccount = state.accounts.find((a) => a.id === cur.slotId)
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2">
      <h1 className="text-base font-semibold text-balance">{t('topbar.title')}</h1>

      <div className="flex min-w-0 items-center gap-2">
        {cur.unsaved ? (
          <Badge variant="outline" className="border-amber-500/50 text-amber-300">
            <UserRound /> {cur.email ? t('topbar.unsavedWithEmail', { email: cur.email }) : t('topbar.unsaved')}
          </Badge>
        ) : (
          <Badge variant="secondary" className="max-w-72">
            <UserRound />
            <span className="truncate">
              {t('topbar.current', { name: curAccount?.name ?? cur.email ?? t('topbar.notLoggedIn') })}
            </span>
          </Badge>
        )}
        {state.switching && (
          <Badge variant="outline" className="border-sky-500/50 text-sky-300">
            <Loader2 className="animate-spin" /> {t('topbar.switching')}
          </Badge>
        )}
        {state.pending && !state.switching && (
          <Badge variant="outline" className="border-amber-500/50 text-amber-300">
            {t('topbar.pending')}
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {state.usagePolling
            ? t('topbar.usagePolling')
            : state.lastPollAt
              ? t('topbar.usageUpdated', { time: formatRelative(state.lastPollAt, now) })
              : ''}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('topbar.refreshUsage')}
              onClick={onRefresh}
              disabled={state.usagePolling}
            >
              <RefreshCw className={state.usagePolling ? 'animate-spin' : undefined} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('topbar.refreshUsage')}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
