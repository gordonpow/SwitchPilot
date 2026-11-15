import type { AppState, DispatchRecentView } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/routing'
import { useNow } from '@/lib/use-app-state'
import { useT } from '@/lib/i18n'
import type { MessageKey } from '../../../shared/i18n'

const statusClass: Record<DispatchRecentView['status'], string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  delegate: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300'
}

const statusLabelKeys: Record<DispatchRecentView['status'], MessageKey> = {
  ok: 'dispatch.status.ok',
  delegate: 'dispatch.status.delegate',
  failed: 'dispatch.status.failed'
}

function formatElapsed(startedAtMs: number, nowMs: number, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const diffSec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
  if (diffSec < 60) return t('dispatch.durationSeconds', { s: diffSec })
  if (diffSec < 3600) return t('dispatch.durationMinSec', { m: Math.floor(diffSec / 60), s: diffSec % 60 })
  return t('dispatch.durationHourMin', { h: Math.floor(diffSec / 3600), m: Math.floor((diffSec % 3600) / 60) })
}

function formatDuration(startedAtMs: number, endedAtMs: number, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const diffSec = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000))
  if (diffSec < 60) return t('dispatch.durationSeconds', { s: diffSec })
  if (diffSec < 3600) return t('dispatch.durationMinSec', { m: Math.floor(diffSec / 60), s: diffSec % 60 })
  return t('dispatch.durationHourMin', { h: Math.floor(diffSec / 3600), m: Math.floor((diffSec % 3600) / 60) })
}

export function DispatchPage({ state }: { state: AppState }): React.JSX.Element {
  const t = useT()
  const now = useNow(1000)
  const running = state.dispatch?.running ?? []
  const recent = state.dispatch?.recent ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dispatch.title')}
        description={t('dispatch.description')}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">{t('dispatch.runningTitle', { count: running.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {running.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('dispatch.emptyRunning')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs [&_td]:pr-3 [&_th]:pr-3 [&_th]:whitespace-nowrap [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 font-medium">{t('dispatch.thRole')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thProvider')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thModel')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thAccount')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thStartedAt')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thElapsed')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thFolder')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {running.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="py-2.5 font-medium">{ROLE_LABELS[r.role] ?? r.role}</td>
                      <td className="py-2.5">agy</td>
                      <td className="py-2.5">{r.model}</td>
                      <td className="py-2.5 text-muted-foreground">{r.account || '—'}</td>
                      <td className="py-2.5 tabular-nums text-muted-foreground">
                        {formatDateTime(Math.floor(r.startedAt / 1000))}
                      </td>
                      <td className="py-2.5 tabular-nums text-muted-foreground">
                        {formatElapsed(r.startedAt, now, t)}
                      </td>
                      <td className="max-w-xs truncate py-2.5 text-muted-foreground" title={r.cwd}>
                        {r.cwd}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">{t('dispatch.recentTitle', { count: recent.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('dispatch.emptyRecent')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs [&_td]:pr-3 [&_th]:pr-3 [&_th]:whitespace-nowrap [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 font-medium">{t('dispatch.thRole')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thResult')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thProviderModel')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thAccount')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thStartedAt')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thDuration')}</th>
                    <th className="pb-2 font-medium">{t('dispatch.thMessage')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {recent.map((rec) => {
                    const providerModel =
                      rec.provider && rec.model
                        ? rec.provider === 'claude'
                          ? `Claude ${rec.model}`
                          : `agy · ${rec.model}`
                        : rec.provider ?? rec.model ?? '—'
                    return (
                      <tr key={rec.id} className="hover:bg-muted/30">
                        <td className="py-2.5 font-medium">{ROLE_LABELS[rec.role] ?? rec.role}</td>
                        <td className="py-2.5">
                          <Badge variant="outline" className={statusClass[rec.status] ?? ''}>
                            {t(statusLabelKeys[rec.status]) ?? rec.status}
                          </Badge>
                        </td>
                        <td className="py-2.5">{providerModel}</td>
                        <td className="py-2.5 text-muted-foreground">{rec.account ?? '—'}</td>
                        <td className="py-2.5 tabular-nums text-muted-foreground">
                          {formatDateTime(Math.floor(rec.startedAt / 1000))}
                        </td>
                        <td className="py-2.5 tabular-nums text-muted-foreground">
                          {formatDuration(rec.startedAt, rec.endedAt, t)}
                        </td>
                        <td className="max-w-md truncate py-2.5 text-muted-foreground" title={rec.message}>
                          {rec.message}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
