import type { UsageWindow } from '../../../shared/types'
import { Progress } from '@/components/ui/progress'
import { formatDateTime, usageColor } from '@/lib/format'

interface Props {
  label: string
  window: UsageWindow
  threshold: number
}

export function UsageBar({ label, window: w, threshold }: Props): React.JSX.Element {
  const pct = w ? Math.min(100, Math.max(0, Math.round(w.used_percentage))) : null
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {pct === null || !w ? (
            <span className="text-muted-foreground">無資料</span>
          ) : (
            <>
              <span className="font-medium">{pct}%</span>
              <span className="text-muted-foreground"> · {formatDateTime(w.resets_at)} 重置</span>
            </>
          )}
        </span>
      </div>
      <Progress
        value={pct ?? 0}
        aria-label={`${label}用量`}
        className="h-1.5 bg-muted"
        indicatorClassName={pct === null ? 'bg-transparent' : usageColor(pct, threshold)}
      />
    </div>
  )
}
