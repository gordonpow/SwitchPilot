import type { AppState, DispatchRecentView } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/routing'
import { useNow } from '@/lib/use-app-state'

const statusClass: Record<DispatchRecentView['status'], string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  delegate: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300'
}

const statusLabel: Record<DispatchRecentView['status'], string> = {
  ok: '成功',
  delegate: '委派 Claude',
  failed: '失敗'
}

function formatElapsed(startedAtMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
  if (diffSec < 60) return `${diffSec} 秒`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分 ${diffSec % 60} 秒`
  return `${Math.floor(diffSec / 3600)} 時 ${Math.floor((diffSec % 3600) / 60)} 分`
}

function formatDuration(startedAtMs: number, endedAtMs: number): string {
  const diffSec = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000))
  if (diffSec < 60) return `${diffSec} 秒`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分 ${diffSec % 60} 秒`
  return `${Math.floor(diffSec / 3600)} 時 ${Math.floor((diffSec % 3600) / 60)} 分`
}

export function DispatchPage({ state }: { state: AppState }): React.JSX.Element {
  const now = useNow(1000)
  const running = state.dispatch?.running ?? []
  const recent = state.dispatch?.recent ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="派工"
        description="檢視執行中的派工任務與最近的派工紀錄。"
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">執行中 ({running.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {running.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">目前沒有執行中的派工</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 font-medium">階段</th>
                    <th className="pb-2 font-medium">供應商</th>
                    <th className="pb-2 font-medium">模型</th>
                    <th className="pb-2 font-medium">帳號</th>
                    <th className="pb-2 font-medium">開始時間</th>
                    <th className="pb-2 font-medium">已執行時間</th>
                    <th className="pb-2 font-medium">資料夾</th>
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
                        {formatElapsed(r.startedAt, now)}
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
          <CardTitle className="text-base font-semibold">最近紀錄 ({recent.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">尚無派工紀錄</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 font-medium">階段</th>
                    <th className="pb-2 font-medium">結果</th>
                    <th className="pb-2 font-medium">供應商與模型</th>
                    <th className="pb-2 font-medium">帳號</th>
                    <th className="pb-2 font-medium">開始時間</th>
                    <th className="pb-2 font-medium">耗時</th>
                    <th className="pb-2 font-medium">訊息</th>
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
                            {statusLabel[rec.status] ?? rec.status}
                          </Badge>
                        </td>
                        <td className="py-2.5">{providerModel}</td>
                        <td className="py-2.5 text-muted-foreground">{rec.account ?? '—'}</td>
                        <td className="py-2.5 tabular-nums text-muted-foreground">
                          {formatDateTime(Math.floor(rec.startedAt / 1000))}
                        </td>
                        <td className="py-2.5 tabular-nums text-muted-foreground">
                          {formatDuration(rec.startedAt, rec.endedAt)}
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
