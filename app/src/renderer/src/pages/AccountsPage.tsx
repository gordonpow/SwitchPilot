import { Globe, Plus, RefreshCw, Save, Terminal } from 'lucide-react'
import type { AccountView, AppState } from '../../../shared/types'
import { AccountCard } from '@/components/AccountCard'
import { AgySection, type AgyDialog } from '@/components/AgySection'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { act } from '@/lib/use-app-state'
import { useT } from '@/lib/i18n'

interface Props {
  state: AppState
  now: number
  onSwitch: (a: AccountView) => void
  onRename: (a: AccountView) => void
  onDelete: (a: AccountView) => void
  onSaveCurrent: () => void
  agyDialog: AgyDialog
  onAgyDialog: (d: AgyDialog) => void
}

export function AccountsPage({
  state,
  now,
  onSwitch,
  onRename,
  onDelete,
  onSaveCurrent,
  agyDialog,
  onAgyDialog
}: Props): React.JSX.Element {
  const t = useT()
  const busy = state.switching
  const agyBusy = state.agyLogin.state === 'waiting' || state.agyLogin.state === 'signed_in'
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('accounts.title')}
        description={t('accounts.description')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus /> {t('accounts.addAccount')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>{t('accounts.anthropicGroup')}</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => void act(window.api.startLogin(state.config.login_browser))}
              >
                <Globe /> {t('accounts.browserLogin')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy || !state.current.unsaved} onSelect={onSaveCurrent}>
                <Save /> {t('accounts.saveCurrentLogin')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('accounts.googleGroup')}</DropdownMenuLabel>
              <DropdownMenuItem disabled={agyBusy} onSelect={() => onAgyDialog('add')}>
                <Terminal /> {t('accounts.loginNewAgy')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={agyBusy || !state.agyCurrent?.unsaved}
                onSelect={() => onAgyDialog('save')}
              >
                <Save /> {t('accounts.saveCurrentAgy')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <section aria-label="Anthropic" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-sm font-semibold">Anthropic</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{t('common.countItems', { count: state.accounts.length })}</span>
          <div className="ml-auto flex items-center gap-2">
            {state.current.unsaved && (
              <Button
                size="xs"
                variant="outline"
                className="border-amber-500/50 text-amber-300"
                disabled={busy}
                onClick={onSaveCurrent}
              >
                <Save /> {t('accounts.saveCurrentWithEmail', { email: state.current.email ?? t('common.unknownLabel') })}
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('topbar.refreshUsage')}
                  disabled={state.usagePolling}
                  onClick={() => void act(window.api.refreshUsage())}
                >
                  <RefreshCw className={state.usagePolling ? 'animate-spin' : undefined} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('topbar.refreshUsage')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {state.accounts.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-pretty text-muted-foreground">
            {t('accounts.emptyAnthropic')}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {state.accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                threshold={state.config.threshold}
                thresholdWeekly={state.config.threshold_weekly}
                now={now}
                busy={busy}
                onSwitch={() => onSwitch(a)}
                onRename={() => onRename(a)}
                onDelete={() => onDelete(a)}
                onRelogin={() => void act(window.api.startLogin(state.config.login_browser, a.id))}
              />
            ))}
          </div>
        )}
      </section>

      <AgySection state={state} now={now} dialog={agyDialog} onDialogChange={onAgyDialog} />
    </div>
  )
}
