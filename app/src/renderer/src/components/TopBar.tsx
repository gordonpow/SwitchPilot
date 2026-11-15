import { Loader2, RefreshCw, UserRound } from 'lucide-react'
import type { AppState } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelative } from '@/lib/format'

interface Props {
  state: AppState
  now: number
  onRefresh: () => void
}

export function TopBar({ state, now, onRefresh }: Props): React.JSX.Element {
  const cur = state.current
  const curAccount = state.accounts.find((a) => a.id === cur.slotId)
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2">
      <h1 className="text-base font-semibold text-balance">Claude 帳號切換器</h1>

      <div className="flex min-w-0 items-center gap-2">
        {cur.unsaved ? (
          <Badge variant="outline" className="border-amber-500/50 text-amber-300">
            <UserRound /> 目前登入尚未儲存{cur.email ? `（${cur.email}）` : ''}
          </Badge>
        ) : (
          <Badge variant="secondary" className="max-w-72">
            <UserRound />
            <span className="truncate">
              目前：{curAccount?.name ?? cur.email ?? '未登入'}
            </span>
          </Badge>
        )}
        {state.switching && (
          <Badge variant="outline" className="border-sky-500/50 text-sky-300">
            <Loader2 className="animate-spin" /> 切換中
          </Badge>
        )}
        {state.pending && !state.switching && (
          <Badge variant="outline" className="border-amber-500/50 text-amber-300">
            已達門檻，等待回合結束
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {state.usagePolling
            ? '更新用量中…'
            : state.lastPollAt
              ? `用量 ${formatRelative(state.lastPollAt, now)}更新`
              : ''}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="重新整理用量"
              onClick={onRefresh}
              disabled={state.usagePolling}
            >
              <RefreshCw className={state.usagePolling ? 'animate-spin' : undefined} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>重新整理用量</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
