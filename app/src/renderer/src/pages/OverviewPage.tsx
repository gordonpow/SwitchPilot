import { TriangleAlert } from 'lucide-react'
import type { AgyAccountView, AppState } from '../../../shared/types'
import { AutoSwitchPanel } from '@/components/AutoSwitchPanel'
import { EventLog } from '@/components/EventLog'
import { LaunchPanel } from '@/components/LaunchPanel'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatDateTime, formatReset, usageColor } from '@/lib/format'
import type { Page } from '@/lib/pages'
import { act } from '@/lib/use-app-state'
import { cn } from '@/lib/utils'

function MiniBar({
  label,
  pct,
  color,
  text,
  reset
}: {
  label: string
  pct: number | null
  color: string
  text: string
  reset?: string | null
}): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-baseline justify-between gap-1 text-[11px]">
        <span className="truncate text-muted-foreground" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums">{text}</span>
      </div>
      <Progress
        value={pct ?? 0}
        aria-label={label}
        className="h-1 bg-muted"
        indicatorClassName={pct === null ? 'bg-transparent' : color}
      />
      {reset && (
        <div className="truncate text-[10px] tabular-nums text-muted-foreground" title={reset}>
          {reset}
        </div>
      )}
    </div>
  )
}

function agyMain(a: AgyAccountView): { id: string; remaining: number } | null {
  const ms = a.quota?.models ?? []
  return ms.find((m) => m.id === 'claude-sonnet-4-6') ?? ms[0] ?? null
}

function remainingColor(pct: number): string {
  if (pct <= 10) return 'bg-red-500'
  if (pct <= 30) return 'bg-amber-400'
  return 'bg-emerald-500'
}

function RowShell({
  name,
  active,
  tag,
  onClick,
  children
}: {
  name: string
  active: boolean
  tag: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex w-44 min-w-0 shrink-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {active && <Badge className="text-[10px]">使用中</Badge>}
          <Badge variant="secondary" className="text-[10px]">
            {tag}
          </Badge>
        </span>
        <span className="flex min-w-48 flex-1 items-center gap-3">{children}</span>
      </button>
    </li>
  )
}

export function OverviewPage({
  state,
  onNavigate
}: {
  state: AppState
  onNavigate: (p: Page) => void
}): React.JSX.Element {
  const th = state.config.threshold
  const toAccounts = (): void => onNavigate('accounts')
  return (
    <div className="space-y-4">
      <PageHeader title="總覽" />
      {state.earliestReset && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="text-pretty">
            所有帳號的額度都已用完，不會自動切換。最早重置時間：
            <span className="font-medium tabular-nums"> {formatDateTime(state.earliestReset)}</span>
          </span>
          <Button
            size="xs"
            variant="outline"
            className="ml-auto shrink-0"
            onClick={() => void act(window.api.clearExhausted(), '已清除用完標記')}
          >
            清除用完標記
          </Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">帳號摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-2">
              <section aria-label="Anthropic 摘要">
                <h3 className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
                  Anthropic · {state.accounts.length}
                </h3>
                {state.accounts.length === 0 ? (
                  <p className="px-2 text-xs text-muted-foreground">尚無帳號</p>
                ) : (
                  <ul>
                    {state.accounts.map((a) => {
                      const f = a.usage.five_hour
                      const w = a.usage.seven_day
                      const fp = f ? Math.round(f.used_percentage) : null
                      const wp = w ? Math.round(w.used_percentage) : null
                      return (
                        <RowShell key={a.id} name={a.name} active={a.active} tag="Claude" onClick={toAccounts}>
                          <div className={cn('flex flex-1 gap-3', a.usage.stale && 'opacity-50')}>
                            <MiniBar
                              label="5 小時"
                              pct={fp}
                              color={usageColor(fp ?? 0, th)}
                              text={fp === null ? '無資料' : `${fp}%`}
                              reset={formatReset(f?.resets_at, Date.now())}
                            />
                            <MiniBar
                              label="7 天"
                              pct={wp}
                              color={usageColor(wp ?? 0, th)}
                              text={wp === null ? '無資料' : `${wp}%`}
                              reset={formatReset(w?.resets_at, Date.now())}
                            />
                          </div>
                        </RowShell>
                      )
                    })}
                  </ul>
                )}
              </section>
              <section aria-label="Google 摘要">
                <h3 className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
                  Google · {state.agyAccounts.length}
                </h3>
                {state.agyAccounts.length === 0 ? (
                  <p className="px-2 text-xs text-muted-foreground">尚無帳號</p>
                ) : (
                  <ul>
                    {state.agyAccounts.map((a) => {
                      const m = agyMain(a)
                      const pct = m ? Math.min(100, Math.max(0, Math.round(m.remaining * 100))) : null
                      return (
                        <RowShell key={a.id} name={a.name} active={a.active} tag="agy" onClick={toAccounts}>
                          <MiniBar
                            label={m ? m.id : '額度'}
                            pct={pct}
                            color={remainingColor(pct ?? 0)}
                            text={pct === null ? '無資料' : `剩 ${pct}%`}
                          />
                        </RowShell>
                      )
                    })}
                  </ul>
                )}
              </section>
            </CardContent>
          </Card>
          <EventLog events={state.events} limit={8} onViewAll={() => onNavigate('events')} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <LaunchPanel lastFolder={state.config.last_folder} runs={state.runs} />
          <AutoSwitchPanel config={state.config} pending={state.pending} />
        </div>
      </div>
    </div>
  )
}
