import { useState } from 'react'
import { Check, Circle, TriangleAlert } from 'lucide-react'
import type { AppState } from '../../../shared/types'
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
import { act } from '@/lib/use-app-state'
import { useT } from '@/lib/i18n'
import type { Page } from '@/lib/pages'

type StepState = 'done' | 'todo' | 'optional'

function StepIcon({ state }: { state: StepState }): React.JSX.Element {
  if (state === 'done') return <Check className="size-4 text-emerald-400" aria-hidden />
  if (state === 'todo') return <TriangleAlert className="size-4 text-amber-400" aria-hidden />
  return <Circle className="size-4 text-muted-foreground" aria-hidden />
}

function Step({
  state,
  title,
  desc,
  action
}: {
  state: StepState
  title: string
  desc?: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 shrink-0">
        <StepIcon state={state} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-pretty text-muted-foreground">{desc}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

function CopyExample({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪貼簿不可用時忽略
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
      <code className="min-w-0 flex-1 break-all text-xs">{text}</code>
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  )
}

export function RoutingSetupCard({
  state,
  onNavigate
}: {
  state: AppState
  onNavigate: (p: Page) => void
}): React.JSX.Element {
  const t = useT()
  const s = state.routingSetup
  const [checking, setChecking] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      await act(window.api.checkRoutingSetup())
    } finally {
      setChecking(false)
    }
  }

  const install = async (): Promise<void> => {
    try {
      const r = await window.api.installSkill(false)
      if (!r.ok && r.code === 'EXISTS') {
        setConfirmOverwrite(true)
        return
      }
      await act(Promise.resolve(r), t('dialog.skillInstalled'))
    } catch {
      await act(Promise.resolve({ ok: false as const, error: t('common.unknownErrorLong'), code: 'UNKNOWN' as const }))
    }
  }

  const skillDesc =
    s.skill === 'installed'
      ? `${t('routing.step.skillInstalled')}　${t('routing.step.skillPath', { path: s.skillPath })}`
      : s.skill === 'outdated'
        ? t('routing.step.skillOutdated')
        : s.skill === 'missing'
          ? t('routing.step.skillMissing')
          : t('routing.step.skillUnavailable')

  return (
    <div className="mb-4 max-w-2xl rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t('routing.setupTitle')}</h3>
          <p className="text-xs text-pretty text-muted-foreground">{t('routing.setupDesc')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={checking} onClick={() => void recheck()}>
          {checking ? t('routing.rechecking') : t('routing.recheck')}
        </Button>
      </div>
      <div className="divide-y">
        <Step
          state={s.nodeFound ? 'done' : 'todo'}
          title={t('routing.step.nodeTitle')}
          desc={s.nodeFound ? t('routing.step.nodeInstalled') : t('routing.step.nodeMissing')}
        />
        <Step
          state={s.dispatcherInstalled ? 'done' : 'todo'}
          title={t('routing.step.dispatcherTitle')}
          desc={s.dispatcherInstalled ? t('routing.step.dispatcherInstalled') : t('routing.step.dispatcherMissing')}
        />
        <Step
          state={s.agyInstalled ? 'done' : 'optional'}
          title={t('routing.step.agyTitle')}
          desc={s.agyInstalled ? t('routing.step.agyInstalled') : t('routing.step.agyMissing')}
        />
        <Step
          state={s.agyAccounts > 0 ? 'done' : 'optional'}
          title={t('routing.step.agyAccountsTitle')}
          desc={
            s.agyAccounts > 0
              ? t('routing.step.agyAccountsCount', { count: s.agyAccounts })
              : t('routing.step.agyAccountsNone')
          }
          action={
            <Button size="sm" variant="outline" onClick={() => onNavigate('accounts')}>
              {t('routing.step.goToAccounts')}
            </Button>
          }
        />
        <Step
          state={s.skill === 'installed' ? 'done' : 'todo'}
          title={t('routing.step.skillTitle')}
          desc={skillDesc}
          action={
            <>
              {(s.skill === 'missing' || s.skill === 'outdated') && (
                <Button size="sm" onClick={() => void install()}>
                  {s.skill === 'missing' ? t('routing.step.installSkill') : t('routing.step.updateSkill')}
                </Button>
              )}
              {(s.skill === 'installed' || s.skill === 'outdated') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void act(window.api.uninstallSkill(), t('dialog.skillRemoved'))}
                >
                  {t('routing.step.uninstallSkill')}
                </Button>
              )}
            </>
          }
        />
        <Step
          state="done"
          title={t('routing.step.startTitle')}
          desc={
            <div className="mt-1 space-y-1.5">
              <CopyExample text={t('routing.step.exampleEn')} />
              <CopyExample text={t('routing.step.exampleZh')} />
              <p>{t('routing.step.startNotice')}</p>
            </div>
          }
        />
      </div>

      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.overwriteSkillTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">{t('dialog.overwriteSkillDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void act(window.api.installSkill(true), t('dialog.skillInstalled'))}
            >
              {t('dialog.overwriteSkillConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
