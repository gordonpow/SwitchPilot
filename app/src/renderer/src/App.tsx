import { useState } from 'react'
import type { AccountView } from '../../shared/types'
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

function App(): React.JSX.Element {
  const state = useAppState()
  const now = useNow()
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

  if (!state) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground" role="status">
        載入中…
      </div>
    )
  }

  const doSwitch = async (a: AccountView, restart: boolean): Promise<void> => {
    await act(window.api.switchTo(a.id, restart), `已切換到「${a.name}」`)
  }
  const requestSwitch = (a: AccountView): void => {
    // 只有 restart 模式才需要問是否重啟託管視窗；live 模式一律不重啟
    if (state.runs.length > 0 && state.config.switch_mode === 'restart') setSwitchTarget(a)
    else void doSwitch(a, false)
  }

  return (
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
        title="重新命名"
        initialName={renaming?.name ?? ''}
        submitLabel="儲存"
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (renaming && (await act(window.api.renameSlot(renaming.id, name), '已重新命名'))) setRenaming(null)
        }}
      />
      <NameDialog
        open={savingCurrent}
        title="儲存目前登入的帳號"
        description={state.current.email ? `目前登入：${state.current.email}` : undefined}
        initialName={state.current.email ?? ''}
        submitLabel="儲存"
        onClose={() => setSavingCurrent(false)}
        onSubmit={async (name) => {
          if (await act(window.api.saveCurrent(name), '已儲存帳號')) setSavingCurrent(false)
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除帳號「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              會移除這個帳號儲存的登入資料，無法復原。需要時必須重新登入。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void act(window.api.deleteSlot(deleting.id), '已刪除帳號')}
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={switchTarget !== null} onOpenChange={(o) => !o && setSwitchTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切換到「{switchTarget?.name}」</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty">
              目前有 {state.runs.length} 個託管中的 claude 視窗。是否一併重啟，讓它們改用新帳號？
              不重啟的話，執行中的視窗會繼續使用舊帳號。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                if (switchTarget) void doSwitch(switchTarget, false)
                setSwitchTarget(null)
              }}
            >
              只切換，不重啟
            </Button>
            <AlertDialogAction
              onClick={() => {
                if (switchTarget) void doSwitch(switchTarget, true)
              }}
            >
              切換並重啟
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster theme="dark" />
    </TooltipProvider>
  )
}

export default App
