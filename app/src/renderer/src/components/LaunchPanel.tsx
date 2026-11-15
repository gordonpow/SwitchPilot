import { useState } from 'react'
import { FolderOpen, Play, RotateCcw } from 'lucide-react'
import type { RunView } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { act } from '@/lib/use-app-state'

interface Props {
  lastFolder: string
  runs: RunView[]
}

export function LaunchPanel({ lastFolder, runs }: Props): React.JSX.Element {
  const [folder, setFolder] = useState(lastFolder)
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    const p = await window.api.pickFolder()
    if (p) setFolder(p)
  }
  const launch = async (cont: boolean): Promise<void> => {
    setBusy(true)
    await act(window.api.launch(folder, cont), '已在 Windows Terminal 啟動 claude')
    setBusy(false)
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">啟動 claude</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="flex gap-2">
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="選擇專案資料夾"
            aria-label="專案資料夾"
          />
          <Button variant="outline" onClick={pick}>
            <FolderOpen /> 瀏覽
          </Button>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => launch(false)} disabled={busy || !folder.trim()}>
            <Play /> 啟動
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            onClick={() => launch(true)}
            disabled={busy || !folder.trim()}
          >
            <RotateCcw /> 接續上次
          </Button>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          託管中視窗：{runs.length} 個
          {runs.length > 0 && `（${runs.filter((r) => r.state === 'running').length} 執行中、${runs.filter((r) => r.state === 'waiting').length} 等待中）`}
        </p>
      </CardContent>
    </Card>
  )
}
