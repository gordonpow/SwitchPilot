import { useEffect, useRef } from 'react'
import type { EventItem } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatClock } from '@/lib/format'
import { cn } from '@/lib/utils'

const levelClass: Record<EventItem['level'], string> = {
  info: 'text-foreground',
  warn: 'text-amber-300',
  error: 'text-red-400'
}

interface Props {
  events: EventItem[]
  /** 只顯示最近 N 筆（總覽用）；未指定顯示全部並填滿高度。 */
  limit?: number
  onViewAll?: () => void
  /** 全頁模式：不顯示卡片標題，捲動區填滿父層高度。 */
  full?: boolean
}

export function EventLog({ events, limit, onViewAll, full }: Props): React.JSX.Element {
  const shown = limit ? events.slice(-limit) : events
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown])

  return (
    <Card className={cn('min-h-0 gap-3 py-4', full && 'h-full')}>
      {!full && (
        <CardHeader className="flex items-center justify-between px-4">
          <CardTitle className="text-sm">{limit ? '最近事件' : '事件紀錄'}</CardTitle>
          {onViewAll && (
            <Button variant="link" size="xs" className="h-auto p-0" onClick={onViewAll}>
              查看全部
            </Button>
          )}
        </CardHeader>
      )}
      <CardContent className="min-h-0 flex-1 px-4">
        <div
          ref={ref}
          role="log"
          aria-label="事件紀錄"
          tabIndex={0}
          className={cn(
            'overflow-y-auto rounded-md bg-muted/40 p-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            full ? 'h-full min-h-48' : limit ? 'max-h-52' : 'h-48'
          )}
        >
          {shown.length === 0 ? (
            <p className="text-muted-foreground">尚無事件</p>
          ) : (
            shown.map((e, i) => (
              <div key={`${e.ts}-${i}`} className={cn('flex gap-2 py-0.5', levelClass[e.level])}>
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatClock(e.ts)}</span>
                <span className="break-words text-pretty">{e.text}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
