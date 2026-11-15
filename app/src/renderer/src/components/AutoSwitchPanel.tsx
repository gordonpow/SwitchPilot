import { useEffect, useState } from 'react'
import type { AppConfig } from '../../../shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { act } from '@/lib/use-app-state'

interface Props {
  config: AppConfig
  pending: boolean
}

export function AutoSwitchPanel({ config, pending }: Props): React.JSX.Element {
  // 拖曳時只更新本地值，放開才送出
  const [threshold, setThreshold] = useState(config.threshold)
  useEffect(() => setThreshold(config.threshold), [config.threshold])

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">自動切換</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="auto-switch">用量達門檻時自動切換帳號</Label>
          <Switch
            id="auto-switch"
            checked={config.auto_switch}
            onCheckedChange={(v) => void act(window.api.setConfig({ auto_switch: v }))}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <Label>切換門檻</Label>
            <span className="font-medium tabular-nums">{threshold}%</span>
          </div>
          <Slider
            min={50}
            max={100}
            step={1}
            value={[threshold]}
            aria-label="切換門檻"
            disabled={!config.auto_switch}
            onValueChange={(v) => setThreshold(v[0])}
            onValueCommit={(v) => void act(window.api.setConfig({ threshold: v[0] }))}
          />
        </div>
        {pending && (
          <p className="text-xs text-amber-300">已達門檻，等待目前回合結束後切換。</p>
        )}
      </CardContent>
    </Card>
  )
}
