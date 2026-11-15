import { useEffect, useState } from 'react'
import type { AccountView } from '../../shared/types'
import { setLanguage } from '../../shared/i18n'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type AgyDialog } from '@/components/AgySection'
import { LoginDialog } from '@/components/LoginDialog'
import { NameDialog } from '@/components/NameDialog'
import { NavSidebar } from '@/components/NavSidebar'
import { TopBar } from '@/components/TopBar'
import { AccountsPage } from '@/pages/AccountsPage'
import { CliPage } from '@/pages/CliPage'
import { DispatchPage } from '@/pages/DispatchPage'
import { EventsPage } from '@/pages/EventsPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { SettingsRouter } from '@/pages/SettingsRouter'
import { initialPage, savePage, type Page } from '@/lib/pages'
import { act, useAppState, useNow } from '@/lib/use-app-state'
import { LangContext, useT } from '@/lib/i18n'

function App(): React.JSX.Element {
  const state = useAppState()
  const now = useNow()
  const t = useT()
  const [page, setPageState] = useState<Page>(initialPage)
  const setPage = (p: Page): void => {
    setPageState(p)
    savePage(p)
  }
  const [renaming, setRenaming] = useState<AccountView | null>(null)
  const [deleting, setDeleting] = useState<AccountView | null>(null)
  const [agyDialog, setAgyDialog] = useState<AgyDialog>(null)
  const [switchTarget, setSwitchTarget] = useState<AccountView | null>(null)
  const [savingCurrent, setSavingCurrent] = useState(false)

  const lang = state?.language
  // 先於子元件渲染就設好語言，讓同一輪的 t() 取得新語言
  if (lang) setLanguage(lang)
  useEffect(() => {
    if (lang) document.documentElement.lang = lang === 'zh-TW' ? 'zh-Hant-TW' : 'en'
  }, [lang])

  if (!state) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground" role="status">
        {t('app.loading')}
      </div>
    )
  }

  const doSwitch = async (a: AccountView, restart: boolean): Promise<void> => {
    await act(window.api.switchTo(a.id, restart), t('app.switchedTo', { name: a.name }))
  }
  const requestSwitch = (a: AccountView): void => {
    // 只有 restart 模式才需要問是否重啟託管視窗；live 模式一律不重啟
    if (state.runs.length > 0 && state.config.switch_mode === 'restart') setSwitchTarget(a)
    else void doSwitch(a, false)
  }

  return (
    <LangContext.Provider value={state.language}>
    <TooltipProvider delayDuration={200}>
      <div className="flex h-dvh flex-col">
        <TopBar state={state} now={now} onRefresh={() => void act(window.api.refreshUsage())} />

        <div className="flex min-h-0 flex-1">
          <NavSidebar
            page={page}
            onNavigate={setPage}
            accountCount={state.accounts.length + state.agyAccounts.length}
            cliCount={state.clis.length}
            dispatchCount={state.dispatch.running.length}
          />
          <main className="min-w-0 flex-1 overflow-y-auto p-5">
            {page === 'overview' && <OverviewPage state={state} onNavigate={setPage} />}
            {page === 'accounts' && (
              <AccountsPage
                state={state}
                now={now}
                onSwitch={requestSwitch}
                onRename={setRenaming}
                onDelete={setDeleting}
                onSaveCurrent={() => setSavingCurrent(true)}
                agyDialog={agyDialog}
                onAgyDialog={setAgyDialog}
              />
            )}
            {page === 'cli' && <CliPage state={state} />}
            {page === 'dispatch' && <DispatchPage state={state} />}
            {page === 'events' && <EventsPage state={state} />}
            {page.startsWith('settings/') && <SettingsRouter page={page} state={state} />}
          </main>
        </div>
      </div>

      <LoginDialog login={state.login} />

      <NameDialog
        open={renaming !== null}
        title={t('dialog.renameTitle')}
        initialName={renaming?.name ?? ''}
        submitLabel={t('common.save')}
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (renaming && (await act(window.api.renameSlot(renaming.id, name), t('dialog.renamed')))) setRenaming(null)
        }}
      />
      <NameDialog
        open={savingCurrent}
        title={t('dialog.saveCurrentTitle')}
        description={state.current.email ? t('dialog.currentLogin', { email: state.current.email }) : undefined}
        initialName={state.current.email ?? ''}
        submitLabel={t('common.save')}
        onClose={() => setSavingCurrent(false)}
        onSubmit={async (name) => {
          if (await act(window.api.saveCurrent(name), t('dialog.accountSaved'))) setSavingCurrent(false)
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.deleteConfirmTitle', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dialog.deleteConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void act(window.api.deleteSlot(deleting.id), t('dialog.accountDeleted'))}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={switchTarget !== null} onOpenChange={(o) => !o && setSwitchTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.switchConfirmTitle', { name: switchTarget?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              {t('dialog.switchConfirmDesc', { count: state.runs.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                if (switchTarget) void doSwitch(switchTarget, false)
                setSwitchTarget(null)
              }}
            >
              {t('dialog.switchOnly')}
            </Button>
            <AlertDialogAction
              onClick={() => {
                if (switchTarget) void doSwitch(switchTarget, true)
              }}
            >
              {t('dialog.switchAndRestart')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster theme="dark" />
    </TooltipProvider>
    </LangContext.Provider>
  )
}

export default App
