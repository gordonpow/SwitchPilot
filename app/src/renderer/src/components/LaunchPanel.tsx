import { useState } from 'react'
import { FolderOpen, Play, RotateCcw } from 'lucide-react'
import type { RunView } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { act } from '@/lib/use-app-state'
import { useT } from '@/lib/i18n'

interface Props {
  lastFolder: string
  runs: RunView[]
}

export function LaunchPanel({ lastFolder, runs }: Props): React.JSX.Element {
  const t = useT()
  const [folder, setFolder] = useState(lastFolder)
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    const p = await window.api.pickFolder()
    if (p) setFolder(p)
  }
  const launch = async (cont: boolean): Promise<void> => {
    setBusy(true)
    await act(window.api.launch(folder, cont), t('launch.started'))
    setBusy(false)
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t('launch.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="flex gap-2">
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={t('launch.folderPlaceholder')}
            aria-label={t('launch.folderLabel')}
          />
          <Button variant="outline" onClick={pick}>
            <FolderOpen /> {t('launch.browse')}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => launch(false)} disabled={busy || !folder.trim()}>
            <Play /> {t('launch.start')}
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            onClick={() => launch(true)}
            disabled={busy || !folder.trim()}
          >
            <RotateCcw /> {t('launch.continue')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {runs.length > 0
            ? t('launch.managedWithDetails', {
                count: runs.length,
                running: runs.filter((r) => r.state === 'running').length,
                waiting: runs.filter((r) => r.state === 'waiting').length
              })
            : t('launch.managedCount', { count: runs.length })}
        </p>
      </CardContent>
    </Card>
  )
}
