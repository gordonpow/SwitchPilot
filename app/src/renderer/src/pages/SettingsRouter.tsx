import { useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RoutingPanel } from '@/components/RoutingPanel'
import { RoutingSetupCard } from '@/components/RoutingSetupCard'
import type { Page } from '@/lib/pages'
import { act } from '@/lib/use-app-state'
import { useT } from '@/lib/i18n'
import {
  CliSettingsPage,
  CompactPage,
  GeneralPage,
  IntegrationPage,
  SwitchSettingsPage
} from './settings/SettingsPages'
import { UpdatePage } from './settings/UpdatePage'

function RoutingSettings({
  state,
  onNavigate
}: {
  state: AppState
  onNavigate: (p: Page) => void
}): React.JSX.Element {
  const t = useT()
  const [askRemove, setAskRemove] = useState(false)
  const enabled = state.config.routing_enabled
  const onToggle = (v: boolean): void => {
    void act(window.api.setConfig({ routing_enabled: v }))
    // 從開到關且 skill 已安裝時，詢問是否一併移除
    if (!v && (state.routingSetup.skill === 'installed' || state.routingSetup.skill === 'outdated')) {
      setAskRemove(true)
    }
  }
  return (
    <>
      <div className="mb-4 flex max-w-2xl items-center gap-3 rounded-lg border p-4">
        <div className="min-w-0 flex-1">
          <Label htmlFor="routing-enabled">{t('routing.enabledTitle')}</Label>
          <p className="text-xs text-pretty text-muted-foreground">{t('routing.enabledDesc')}</p>
        </div>
        <Switch id="routing-enabled" checked={enabled} onCheckedChange={onToggle} />
      </div>
      {enabled && (
        <>
          <RoutingSetupCard state={state} onNavigate={onNavigate} />
          <RoutingPanel state={state} />
        </>
      )}
      <AlertDialog open={askRemove} onOpenChange={setAskRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.removeSkillTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">{t('dialog.removeSkillDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('dialog.keepSkill')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void act(window.api.uninstallSkill(), t('dialog.skillRemoved'))}>
              {t('dialog.removeSkillConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function SettingsRouter({
  page,
  state,
  onNavigate
}: {
  page: Page
  state: AppState
  onNavigate: (p: Page) => void
}): React.JSX.Element | null {
  switch (page) {
    case 'settings/general':
      return <GeneralPage config={state.config} />
    case 'settings/switch':
      return <SwitchSettingsPage config={state.config} pending={state.pending} />
    case 'settings/cli':
      return <CliSettingsPage config={state.config} />
    case 'settings/compact':
      return <CompactPage config={state.config} />
    case 'settings/routing':
      return <RoutingSettings state={state} onNavigate={onNavigate} />
    case 'settings/integration':
      return <IntegrationPage state={state} />
    case 'settings/update':
      return <UpdatePage state={state} />
    default:
      return null
  }
}
