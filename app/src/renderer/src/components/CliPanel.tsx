import type { CliView } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/lib/i18n'
import type { MessageKey } from '../../../shared/i18n'

const turnLabelKeys: Record<CliView['turn'], MessageKey> = {
  busy: 'cli.turn.busy',
  idle: 'cli.turn.idle',
  interrupted: 'cli.turn.interrupted',
  unknown: 'cli.turn.unknown'
}
const turnClass: Record<CliView['turn'], string> = {
  busy: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  idle: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  interrupted: 'border-red-500/40 bg-red-500/10 text-red-300',
  unknown: 'text-muted-foreground'
}
const methodLabelKeys: Record<CliView['method'], MessageKey> = {
  runner: 'cli.method.runner',
  inject: 'cli.method.inject',
  newtab: 'cli.method.newtab',
  live: 'cli.method.live',
  none: 'cli.method.none'
}
const methodTipKeys: Record<CliView['method'], MessageKey> = {
  runner: 'cli.methodTip.runner',
  inject: 'cli.methodTip.inject',
  newtab: 'cli.methodTip.newtab',
  live: 'cli.methodTip.live',
  none: 'cli.methodTip.none'
}

function Row({ cli }: { cli: CliView }): React.JSX.Element {
  const t = useT()
  const folder = cli.cwd ?? t('cli.unknownFolder')
  return (
    <li className="space-y-1.5 rounded-md border p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={folder}>
          {folder}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={cli.method === 'none' ? 'secondary' : 'outline'}
              className={cli.method === 'none' ? 'text-muted-foreground' : undefined}
            >
              {t(methodLabelKeys[cli.method])}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{t(methodTipKeys[cli.method])}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span className="tabular-nums">PID {cli.pid}</span>
        <span className="min-w-0 truncate">{cli.slotName ?? t('cli.unknownSlot')}</span>
        <span className="tabular-nums">
          {t('cli.contextPct', { pct: cli.contextPct === null ? '—' : `${cli.contextPct}%` })}
        </span>
        {cli.willPrompt && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                {t('cli.willPrompt')}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{t('cli.willPromptTip')}</TooltipContent>
          </Tooltip>
        )}
        {cli.turn === 'unknown' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className={turnClass.unknown}>
                {t(turnLabelKeys.unknown)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{t('cli.unknownTurnTip')}</TooltipContent>
          </Tooltip>
        ) : (
          <Badge variant="outline" className={turnClass[cli.turn]}>
            {t(turnLabelKeys[cli.turn])}
          </Badge>
        )}
      </div>
    </li>
  )
}

export function CliPanel({
  clis,
  mode = 'live',
  tall
}: {
  clis: CliView[]
  mode?: 'live' | 'restart'
  /** 全頁模式：清單不設高度上限。 */
  tall?: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t('cli.title')}</CardTitle>
        <CardDescription className="text-xs">{mode === 'live' ? t('cli.modeDescLive') : t('cli.modeDescRestart')}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {clis.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('cli.empty')}</p>
        ) : (
          <ul className={tall ? 'space-y-2' : 'max-h-72 space-y-2 overflow-y-auto'} aria-label={t('cli.listAria')}>
            {clis.map((c) => (
              <Row key={c.pid} cli={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
