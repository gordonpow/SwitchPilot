import type { CliView } from '../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const turnLabel: Record<CliView['turn'], string> = {
  busy: '工作中',
  idle: '閒置',
  interrupted: '中斷',
  unknown: '未知'
}
const turnClass: Record<CliView['turn'], string> = {
  busy: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  idle: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  interrupted: 'border-red-500/40 bg-red-500/10 text-red-300',
  unknown: 'text-muted-foreground'
}
const methodLabel: Record<CliView['method'], string> = {
  runner: '託管',
  inject: '原視窗',
  newtab: '新分頁',
  live: '免重啟',
  none: '無法接續'
}
const methodTip: Record<CliView['method'], string> = {
  runner: '由本程式託管，切換後自動重啟並接續',
  inject: '切換後把接續指令寫回原本的終端機視窗',
  newtab: '無法寫回原視窗，切換後會在新的 Windows Terminal 分頁接續',
  live: '切換後這個 claude 會在下一個請求自動使用新帳號，不需要重啟',
  none: '尚未取得 session，請安裝整合後重新啟動此 CLI'
}

function Row({ cli }: { cli: CliView }): React.JSX.Element {
  const folder = cli.cwd ?? '（未知資料夾）'
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
              {methodLabel[cli.method]}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{methodTip[cli.method]}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span className="tabular-nums">PID {cli.pid}</span>
        <span className="min-w-0 truncate">{cli.slotName ?? '帳號未知'}</span>
        <span className="tabular-nums">
          上下文 {cli.contextPct === null ? '—' : `${cli.contextPct}%`}
        </span>
        {cli.willPrompt && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                會送出提示
              </Badge>
            </TooltipTrigger>
            <TooltipContent>切換後會把「繼續提示」送進這個 claude 的輸入框</TooltipContent>
          </Tooltip>
        )}
        {cli.turn === 'unknown' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className={turnClass.unknown}>
                {turnLabel.unknown}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>重新啟動此 CLI 後可偵測工作狀態</TooltipContent>
          </Tooltip>
        ) : (
          <Badge variant="outline" className={turnClass[cli.turn]}>
            {turnLabel[cli.turn]}
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
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Claude CLI</CardTitle>
        <CardDescription className="text-xs">{mode === 'live' ? '切換帳號時不會結束以下 CLI，下一個請求起自動使用新帳號' : '切換帳號時會結束並接續以下 CLI'}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {clis.length === 0 ? (
          <p className="text-xs text-muted-foreground">目前沒有偵測到 claude CLI</p>
        ) : (
          <ul className={tall ? 'space-y-2' : 'max-h-72 space-y-2 overflow-y-auto'} aria-label="claude CLI 清單">
            {clis.map((c) => (
              <Row key={c.pid} cli={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
