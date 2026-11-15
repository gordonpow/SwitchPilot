import { useState } from 'react'
import type { AppState } from '../../../../shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/lib/format'
import { act } from '@/lib/use-app-state'
import { useT } from '@/lib/i18n'

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right tabular-nums">{value}</span>
    </div>
  )
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-xs text-pretty text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

/** 設定 → 更新：版本資訊、下載與套用、自動檢查開關。 */
export function UpdatePage({ state }: { state: AppState }): React.JSX.Element {
  const t = useT()
  const { update, config } = state
  const { latest, download } = update
  const [confirm, setConfirm] = useState(false)
  const pct =
    download.total > 0 ? Math.min(100, Math.round((download.received / download.total) * 100)) : 0
  const published = latest?.publishedAt ? Date.parse(latest.publishedAt) : NaN

  return (
    <>
      <PageHeader title={t('settings.update.title')} description={t('settings.update.desc')} />
      <div className="max-w-2xl space-y-4">
        <div className="divide-y rounded-lg border px-4">
          <InfoRow label={t('settings.update.current')} value={update.current} />
          <InfoRow label={t('settings.update.latest')} value={latest ? latest.version : '-'} />
          {latest && Number.isFinite(published) && (
            <InfoRow
              label={t('settings.update.publishedAt')}
              value={formatDateTime(Math.floor(published / 1000))}
            />
          )}
          <InfoRow
            label={t('settings.update.checkedAt')}
            value={update.checkedAt ? formatDateTime(update.checkedAt) : t('settings.update.never')}
          />
          <div className="flex items-center justify-between gap-4 py-3">
            <p className="min-w-0 flex-1 text-sm">
              {update.available && latest
                ? t('settings.update.available', { version: latest.version })
                : update.error
                  ? t('settings.update.checkFailed')
                  : update.checkedAt
                    ? t('settings.update.upToDate')
                    : t('settings.update.never')}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={update.checking}
              onClick={() => void act(window.api.checkUpdate())}
            >
              {update.checking ? t('settings.update.checking') : t('settings.update.checkNow')}
            </Button>
          </div>
        </div>

        {update.error && (
          <p role="alert" className="text-sm text-pretty text-red-500">
            {update.error}
          </p>
        )}

        {update.available && latest && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>{t('settings.update.notes')}</Label>
              <pre className="max-h-48 overflow-y-auto rounded-md bg-muted/40 p-3 text-xs break-words whitespace-pre-wrap">
                {latest.notes.trim() || t('settings.update.noNotes')}
              </pre>
            </div>

            <div className="space-y-2">
              <Label>{t('settings.update.step1')}</Label>
              {download.state === 'downloading' && (
                <div className="space-y-1">
                  <Progress value={pct} />
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {t('settings.update.downloading', {
                      received: formatBytes(download.received),
                      total: formatBytes(download.total)
                    })}
                  </p>
                </div>
              )}
              {download.state === 'ready' && (
                <p className="text-sm text-emerald-500">{t('settings.update.downloaded')}</p>
              )}
              {download.state === 'error' && download.error && (
                <p role="alert" className="text-sm text-pretty text-red-500">
                  {download.error}
                </p>
              )}
              {!latest.hasHash && download.state !== 'idle' && (
                <p className="text-xs text-muted-foreground">{t('settings.update.noHash')}</p>
              )}
              {(download.state === 'idle' || download.state === 'error') && (
                <Button onClick={() => void window.api.downloadUpdate()}>
                  {download.state === 'error'
                    ? t('settings.update.retry')
                    : t('settings.update.download')}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('settings.update.step2')}</Label>
              {update.canApply ? (
                <>
                  <p className="text-xs text-pretty text-muted-foreground">
                    {t('settings.update.applyHint')}
                  </p>
                  <Button disabled={download.state !== 'ready'} onClick={() => setConfirm(true)}>
                    {t('settings.update.apply')}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-pretty text-muted-foreground">
                    {t('settings.update.manualHint')}
                  </p>
                  <Button variant="outline" onClick={() => void act(window.api.openReleasePage())}>
                    {t('settings.update.openRelease')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="divide-y rounded-lg border px-4">
          <SwitchRow
            id="update-check"
            label={t('settings.update.autoCheck')}
            hint={t('settings.update.autoCheckHint')}
            checked={config.update_check}
            onChange={(v) => void act(window.api.setConfig({ update_check: v }))}
          />
          <SwitchRow
            id="update-prerelease"
            label={t('settings.update.prerelease')}
            hint={t('settings.update.prereleaseHint')}
            checked={config.update_include_prerelease}
            onChange={(v) => void act(window.api.setConfig({ update_include_prerelease: v }))}
          />
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.update.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {t('settings.update.confirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void act(window.api.applyUpdate())}>
              {t('settings.update.confirmOk')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
