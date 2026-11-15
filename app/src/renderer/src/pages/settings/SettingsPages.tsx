import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { AppConfig, AppState, AutoCompactConfig, LoginBrowser } from '../../../../shared/types'
import type { LangSetting, MessageKey } from '../../../../shared/i18n'
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
import { useT } from '@/lib/i18n'

const browsers: { value: LoginBrowser; labelKey: MessageKey }[] = [
  { value: 'chrome', labelKey: 'settings.browser.chrome' },
  { value: 'edge', labelKey: 'settings.browser.edge' },
  { value: 'default', labelKey: 'settings.browser.default' }
]
const intervals: { value: number; labelKey: MessageKey }[] = [
  { value: 60, labelKey: 'settings.interval.1m' },
  { value: 120, labelKey: 'settings.interval.2m' },
  { value: 300, labelKey: 'settings.interval.5m' },
  { value: 600, labelKey: 'settings.interval.10m' },
  { value: 1800, labelKey: 'settings.interval.30m' }
]

/** 自動整理上下文設定：數值與資料夾在失焦或按 Enter 時才送出。 */
function AutoCompactSection({ ac }: { ac: AutoCompactConfig }): React.JSX.Element {
  const t = useT()
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
      setError(e instanceof Error ? e.message : t('common.unknownErrorLong'))
    }
  }
  const commitNum = (key: 'threshold' | 'wait_seconds', text: string, cur: number): void => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) {
      setError(t('settings.errorEnterNumber'))
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
        <Label htmlFor="auto-compact">{t('settings.compact.title')}</Label>
        <Switch
          id="auto-compact"
          checked={ac.enabled}
          onCheckedChange={(v) => void patch({ enabled: v })}
        />
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {t('settings.compact.desc')}
      </p>
      {ac.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('settings.compact.thresholdType')}</Label>
              <Select
                value={ac.threshold_type}
                onValueChange={(v) =>
                  void patch({
                    threshold_type: v as 'percent' | 'tokens',
                    threshold: v === 'percent' ? 60 : 120000
                  })
                }
              >
                <SelectTrigger className="w-full" aria-label={t('settings.compact.thresholdType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">{t('settings.compact.typePercent')}</SelectItem>
                  <SelectItem value="tokens">{t('settings.compact.typeTokens')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="compact-threshold">
                {isPct ? t('settings.compact.thresholdPercent') : t('settings.compact.thresholdTokens')}
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
              <Label>{t('settings.compact.action')}</Label>
              <Select
                value={ac.action}
                onValueChange={(v) => void patch({ action: v as 'compact' | 'clear' })}
              >
                <SelectTrigger className="w-full" aria-label={t('settings.compact.action')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">{t('settings.compact.actionCompact')}</SelectItem>
                  <SelectItem value="clear">{t('settings.compact.actionClear')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="compact-wait">{t('settings.compact.waitSeconds')}</Label>
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
              <span className="text-pretty">{t('settings.compact.clearWarning')}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="space-y-0.5">
              <Label
                htmlFor="compact-clear-screen"
                className={ac.action === 'clear' ? 'text-muted-foreground' : ''}
              >
                {t('settings.compact.clearScreen')}
              </Label>
              <p className="text-xs text-pretty text-muted-foreground">
                {t('settings.compact.clearScreenDesc')}
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
            <Label htmlFor="compact-folders">{t('settings.compact.folders')}</Label>
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
  const t = useT()
  const intervalOptions = intervals.some((i) => i.value === config.usage_poll_seconds)
    ? intervals.map((i) => ({ value: i.value, label: t(i.labelKey) }))
    : [
        ...intervals.map((i) => ({ value: i.value, label: t(i.labelKey) })),
        {
          value: config.usage_poll_seconds,
          label: t('settings.interval.customSeconds', { seconds: config.usage_poll_seconds })
        }
      ]
  return (
    <>
      <PageHeader title={t('settings.general.title')} description={t('settings.general.desc')} />
      <Panel>
        <Row
          label={t('settings.general.launchAtLogin')}
          htmlFor="launch-at-login"
          hint={t('settings.general.launchAtLoginHint')}
        >
          <Switch
            id="launch-at-login"
            checked={config.launch_at_login}
            onCheckedChange={(v) => void act(window.api.setConfig({ launch_at_login: v }))}
          />
        </Row>
        <Row
          label={t('settings.general.closeToTray')}
          htmlFor="close-to-tray"
          hint={t('settings.general.closeToTrayHint')}
        >
          <Switch
            id="close-to-tray"
            checked={config.close_to_tray}
            onCheckedChange={(v) => void act(window.api.setConfig({ close_to_tray: v }))}
          />
        </Row>
        <Row label={t('settings.language.label')} hint={t('settings.language.hint')}>
          <Select
            value={config.language}
            onValueChange={(v) => void act(window.api.setConfig({ language: v as LangSetting }))}
          >
            <SelectTrigger className="w-52" aria-label={t('settings.language.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('settings.language.auto')}</SelectItem>
              <SelectItem value="zh-TW">{t('settings.language.zhTW')}</SelectItem>
              <SelectItem value="en">{t('settings.language.en')}</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label={t('settings.general.loginBrowser')}>
          <Select
            value={config.login_browser}
            onValueChange={(v) => void act(window.api.setConfig({ login_browser: v as LoginBrowser }))}
          >
            <SelectTrigger className="w-52" aria-label={t('settings.general.loginBrowser')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {browsers.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {t(b.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t('settings.general.pollInterval')}>
          <Select
            value={String(config.usage_poll_seconds)}
            onValueChange={(v) => void act(window.api.setConfig({ usage_poll_seconds: Number(v) }))}
          >
            <SelectTrigger className="w-52" aria-label={t('settings.general.pollInterval')}>
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
  const t = useT()
  return (
    <>
      <PageHeader title={t('settings.switch.title')} description={t('settings.switch.desc')} />
      <div className="max-w-2xl space-y-4">
        <AutoSwitchPanel config={config} pending={pending} />
        <Panel>
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="space-y-1">
              <Label htmlFor="switch-to-earliest">{t('settings.switch.earliest')}</Label>
              <p className="text-xs text-pretty text-muted-foreground">
                {t('settings.switch.earliestDesc')}
              </p>
            </div>
            <Switch
              id="switch-to-earliest"
              checked={config.switch_to_earliest}
              onCheckedChange={(v) => void act(window.api.setConfig({ switch_to_earliest: v }))}
            />
          </div>
        </Panel>
        <Panel>
          <div className="space-y-2 py-3">
            <Label>{t('settings.switch.mode')}</Label>
            <Select
              value={config.switch_mode}
              onValueChange={(v) =>
                void act(window.api.setConfig({ switch_mode: v as 'live' | 'restart' }))
              }
            >
              <SelectTrigger className="w-full" aria-label={t('settings.switch.mode')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">{t('settings.switch.modeLive')}</SelectItem>
                <SelectItem value="restart">{t('settings.switch.modeRestart')}</SelectItem>
              </SelectContent>
            </Select>
            {config.switch_mode === 'live' && (
              <p className="text-xs text-pretty text-muted-foreground">
                {t('settings.switch.modeLiveDesc')}
              </p>
            )}
          </div>
        </Panel>
      </div>
    </>
  )
}

export function CliSettingsPage({ config }: { config: AppConfig }): React.JSX.Element {
  const t = useT()
  const [prompt, setPrompt] = useState(config.continue_prompt)
  const [promptError, setPromptError] = useState<string | null>(null)
  useEffect(() => setPrompt(config.continue_prompt), [config.continue_prompt])
  const commitPrompt = async (): Promise<void> => {
    if (prompt === config.continue_prompt) return
    try {
      const r = await window.api.setConfig({ continue_prompt: prompt })
      setPromptError(r.ok ? null : r.error)
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : t('common.unknownErrorLong'))
    }
  }
  return (
    <>
      <PageHeader title={t('settings.cli.title')} description={t('settings.cli.desc')} />
      <Panel>
        <Row label={t('settings.cli.manageExternal')} htmlFor="manage-external">
          <Switch
            id="manage-external"
            checked={config.manage_external}
            onCheckedChange={(v) => void act(window.api.setConfig({ manage_external: v }))}
          />
        </Row>
        <div className="space-y-2 py-3">
          <Label htmlFor="continue-prompt">{t('settings.cli.continuePrompt')}</Label>
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
  const t = useT()
  return (
    <>
      <PageHeader title={t('settings.compact.title')} />
      <div className="max-w-2xl rounded-lg border p-4">
        <AutoCompactSection ac={config.auto_compact} />
      </div>
    </>
  )
}

export function IntegrationPage({ state }: { state: AppState }): React.JSX.Element {
  const t = useT()
  const { integration } = state
  return (
    <>
      <PageHeader title={t('settings.integration.title')} />
      <div className="max-w-2xl space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <Label>{t('settings.integration.status')}</Label>
          <Badge variant={integration.installed ? 'default' : 'secondary'}>
            {integration.installed ? t('settings.integration.installed') : integration.needsUpdate ? t('settings.integration.needsUpdate') : t('settings.integration.notInstalled')}
          </Badge>
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          {t('settings.integration.desc')}
        </p>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Node.js</span>
          <span className={integration.nodeFound ? 'text-emerald-400' : 'text-red-400'}>
            {integration.nodeFound ? t('settings.integration.nodeFound') : t('settings.integration.nodeMissing')}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() =>
              void act(
                window.api.installIntegration(),
                integration.needsUpdate ? t('settings.integration.updatedToast') : t('settings.integration.installedToast')
              )
            }
          >
            {integration.needsUpdate ? t('settings.integration.updateBtn') : integration.installed ? t('settings.integration.reinstallBtn') : t('settings.integration.installBtn')}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            disabled={!integration.installed && !integration.needsUpdate}
            onClick={() => void act(window.api.uninstallIntegration(), t('settings.integration.uninstalledToast'))}
          >
            {t('settings.integration.uninstallBtn')}
          </Button>
        </div>
      </div>
    </>
  )
}
