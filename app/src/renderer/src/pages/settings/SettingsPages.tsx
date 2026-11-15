import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { AppConfig, AppState, AutoCompactConfig, LoginBrowser } from '../../../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AutoSwitchPanel } from '@/components/AutoSwitchPanel'
import { PageHeader } from '@/components/PageHeader'
import { act } from '@/lib/use-app-state'

const browsers: { value: LoginBrowser; label: string }[] = [
  { value: 'chrome', label: 'Chrome 無痕視窗' },
  { value: 'edge', label: 'Edge InPrivate' },
  { value: 'default', label: '系統預設瀏覽器' }
]
const intervals = [
  { value: 60, label: '1 分鐘' },
  { value: 120, label: '2 分鐘（預設）' },
  { value: 300, label: '5 分鐘' },
  { value: 600, label: '10 分鐘' },
  { value: 1800, label: '30 分鐘' }
]

/** 自動整理上下文設定：數值與資料夾在失焦或按 Enter 時才送出。 */
function AutoCompactSection({ ac }: { ac: AutoCompactConfig }): React.JSX.Element {
  const [threshold, setThreshold] = useState(String(ac.threshold))
  const [wait, setWait] = useState(String(ac.wait_seconds))
  const [folders, setFolders] = useState(ac.folders.join('\n'))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setThreshold(String(ac.threshold)), [ac.threshold])
  useEffect(() => setWait(String(ac.wait_seconds)), [ac.wait_seconds])
  useEffect(() => setFolders(ac.folders.join('\n')), [ac.folders])

  const patch = async (p: Partial<AutoCompactConfig>): Promise<void> => {
    try {
      const r = await window.api.setConfig({ auto_compact: p })
      setError(r.ok ? null : r.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : '發生未知錯誤')
    }
  }
  const commitNum = (key: 'threshold' | 'wait_seconds', text: string, cur: number): void => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) {
      setError('請輸入數字')
      return
    }
    if (n !== cur) void patch({ [key]: Math.round(n) })
  }
  const commitFolders = (): void => {
    const list = folders
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (JSON.stringify(list) !== JSON.stringify(ac.folders)) void patch({ folders: list })
  }
  const isPct = ac.threshold_type === 'percent'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="auto-compact">自動整理上下文</Label>
        <Switch
          id="auto-compact"
          checked={ac.enabled}
          onCheckedChange={(v) => void patch({ enabled: v })}
        />
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        回合結束且閒置一段時間後，上下文超過門檻就自動對該 claude 輸入 /compact 或 /clear。預設關閉。
      </p>
      {ac.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>門檻類型</Label>
              <Select
                value={ac.threshold_type}
                onValueChange={(v) =>
                  void patch({
                    threshold_type: v as 'percent' | 'tokens',
                    threshold: v === 'percent' ? 60 : 120000
                  })
                }
              >
                <SelectTrigger className="w-full" aria-label="門檻類型">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">百分比</SelectItem>
                  <SelectItem value="tokens">token 數</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="compact-threshold">
                {isPct ? '門檻（1～99 %）' : '門檻（1000～2000000 token）'}
              </Label>
              <Input
                id="compact-threshold"
                inputMode="numeric"
                value={threshold}
                onChange={(e) => {
                  setThreshold(e.target.value)
                  setError(null)
                }}
                onBlur={() => commitNum('threshold', threshold, ac.threshold)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && commitNum('threshold', threshold, ac.threshold)
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>動作</Label>
              <Select
                value={ac.action}
                onValueChange={(v) => void patch({ action: v as 'compact' | 'clear' })}
              >
                <SelectTrigger className="w-full" aria-label="動作">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">/compact（摘要後保留）</SelectItem>
                  <SelectItem value="clear">/clear（清除）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="compact-wait">等待秒數（5～600）</Label>
              <Input
                id="compact-wait"
                inputMode="numeric"
                value={wait}
                onChange={(e) => {
                  setWait(e.target.value)
                  setError(null)
                }}
                onBlur={() => commitNum('wait_seconds', wait, ac.wait_seconds)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && commitNum('wait_seconds', wait, ac.wait_seconds)
                }
              />
            </div>
          </div>
          {ac.action === 'clear' && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="text-pretty">/clear 會清除該 claude 的全部上下文，無法復原。</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="space-y-0.5">
              <Label
                htmlFor="compact-clear-screen"
                className={ac.action === 'clear' ? 'text-muted-foreground' : ''}
              >
                整理後清除畫面
              </Label>
              <p className="text-xs text-pretty text-muted-foreground">
                /compact 完成後自動送出 Ctrl+L 清除畫面並保留對話。
              </p>
            </div>
            <Switch
              id="compact-clear-screen"
              checked={ac.clear_screen_after}
              disabled={ac.action === 'clear'}
              onCheckedChange={(v) => void patch({ clear_screen_after: v })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="compact-folders">套用資料夾（一行一個；留空代表全部，子資料夾也算）</Label>
            <Textarea
              id="compact-folders"
              rows={3}
              className="font-mono text-xs"
              placeholder="C:\work\project-a"
              value={folders}
              onChange={(e) => setFolders(e.target.value)}
              onBlur={commitFolders}
            />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}


/** 設定頁共用的列：左側標題與說明，右側控制項。 */
function Row({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <p className="mt-1 text-xs text-pretty text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="max-w-2xl divide-y rounded-lg border px-4">{children}</div>
}

export function GeneralPage({ config }: { config: AppConfig }): React.JSX.Element {
  const intervalOptions = intervals.some((i) => i.value === config.usage_poll_seconds)
    ? intervals
    : [...intervals, { value: config.usage_poll_seconds, label: `${config.usage_poll_seconds} 秒` }]
  return (
    <>
      <PageHeader title="一般" description="啟動、視窗行為、登入方式與用量更新頻率。" />
      <Panel>
        <Row
          label="開機時自動啟動"
          htmlFor="launch-at-login"
          hint="登入 Windows 後在背景啟動，只顯示在系統匣；用量輪詢與自動切換照常運作。"
        >
          <Switch
            id="launch-at-login"
            checked={config.launch_at_login}
            onCheckedChange={(v) => void act(window.api.setConfig({ launch_at_login: v }))}
          />
        </Row>
        <Row
          label="關閉視窗時縮到系統匣"
          htmlFor="close-to-tray"
          hint="按視窗右上角 X 時程式繼續在背景執行；從系統匣圖示可重新開啟或結束。"
        >
          <Switch
            id="close-to-tray"
            checked={config.close_to_tray}
            onCheckedChange={(v) => void act(window.api.setConfig({ close_to_tray: v }))}
          />
        </Row>
        <Row label="登入瀏覽器">
          <Select
            value={config.login_browser}
            onValueChange={(v) => void act(window.api.setConfig({ login_browser: v as LoginBrowser }))}
          >
            <SelectTrigger className="w-52" aria-label="登入瀏覽器">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {browsers.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="用量更新間隔">
          <Select
            value={String(config.usage_poll_seconds)}
            onValueChange={(v) => void act(window.api.setConfig({ usage_poll_seconds: Number(v) }))}
          >
            <SelectTrigger className="w-52" aria-label="用量更新間隔">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {intervalOptions.map((i) => (
                <SelectItem key={i.value} value={String(i.value)}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Panel>
    </>
  )
}

export function SwitchSettingsPage({
  config,
  pending
}: {
  config: AppConfig
  pending: boolean
}): React.JSX.Element {
  return (
    <>
      <PageHeader title="帳號切換" description="自動切換的條件與切換方式。" />
      <div className="max-w-2xl space-y-4">
        <AutoSwitchPanel config={config} pending={pending} />
        <Panel>
          <div className="space-y-2 py-3">
            <Label>切換方式</Label>
            <Select
              value={config.switch_mode}
              onValueChange={(v) =>
                void act(window.api.setConfig({ switch_mode: v as 'live' | 'restart' }))
              }
            >
              <SelectTrigger className="w-full" aria-label="切換方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">不重啟（建議）</SelectItem>
                <SelectItem value="restart">結束並重開</SelectItem>
              </SelectContent>
            </Select>
            {config.switch_mode === 'live' && (
              <p className="text-xs text-pretty text-muted-foreground">
                切換後執行中的 claude 會在下一個請求自動使用新帳號；因額度用完而停下的 CLI 會自動送出提示
              </p>
            )}
          </div>
        </Panel>
      </div>
    </>
  )
}

export function CliSettingsPage({ config }: { config: AppConfig }): React.JSX.Element {
  const [prompt, setPrompt] = useState(config.continue_prompt)
  const [promptError, setPromptError] = useState<string | null>(null)
  useEffect(() => setPrompt(config.continue_prompt), [config.continue_prompt])
  const commitPrompt = async (): Promise<void> => {
    if (prompt === config.continue_prompt) return
    try {
      const r = await window.api.setConfig({ continue_prompt: prompt })
      setPromptError(r.ok ? null : r.error)
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : '發生未知錯誤')
    }
  }
  return (
    <>
      <PageHeader title="Claude CLI" description="切換帳號時如何處理執行中的外部 claude CLI。" />
      <Panel>
        <Row label="切換時一併處理外部 CLI" htmlFor="manage-external">
          <Switch
            id="manage-external"
            checked={config.manage_external}
            onCheckedChange={(v) => void act(window.api.setConfig({ manage_external: v }))}
          />
        </Row>
        <div className="space-y-2 py-3">
          <Label htmlFor="continue-prompt">中斷後自動送出的提示（留空則不送）</Label>
          <Input
            id="continue-prompt"
            value={prompt}
            maxLength={200}
            aria-invalid={promptError !== null}
            onChange={(e) => {
              setPrompt(e.target.value)
              setPromptError(null)
            }}
            onBlur={() => void commitPrompt()}
            onKeyDown={(e) => e.key === 'Enter' && void commitPrompt()}
          />
          {promptError && (
            <p role="alert" className="text-xs text-red-400">
              {promptError}
            </p>
          )}
        </div>
      </Panel>
    </>
  )
}

export function CompactPage({ config }: { config: AppConfig }): React.JSX.Element {
  return (
    <>
      <PageHeader title="自動整理上下文" />
      <div className="max-w-2xl rounded-lg border p-4">
        <AutoCompactSection ac={config.auto_compact} />
      </div>
    </>
  )
}

export function IntegrationPage({ state }: { state: AppState }): React.JSX.Element {
  const { integration } = state
  return (
    <>
      <PageHeader title="Claude Code 整合" />
      <div className="max-w-2xl space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <Label>整合狀態</Label>
          <Badge variant={integration.installed ? 'default' : 'secondary'}>
            {integration.installed ? '已安裝' : integration.needsUpdate ? '需要更新' : '未安裝'}
          </Badge>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          安裝後會在 Claude Code 設定加入 statusline 與 hook，用來即時取得用量並在額度用完時自動切換。
        </p>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Node.js</span>
          <span className={integration.nodeFound ? 'text-emerald-400' : 'text-red-400'}>
            {integration.nodeFound ? '已找到' : '找不到，請先安裝 Node.js'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() =>
              void act(
                window.api.installIntegration(),
                integration.needsUpdate ? '已更新整合' : '已安裝整合'
              )
            }
          >
            {integration.needsUpdate ? '更新整合' : integration.installed ? '重新安裝' : '安裝整合'}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            disabled={!integration.installed && !integration.needsUpdate}
            onClick={() => void act(window.api.uninstallIntegration(), '已移除整合')}
          >
            移除整合
          </Button>
        </div>
      </div>
    </>
  )
}
