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
  const busy = state.switching
  const agyBusy = state.agyLogin.state === 'waiting' || state.agyLogin.state === 'signed_in'
  return (
    <div className="space-y-6">
      <PageHeader
        title="帳號"
        description="依公司分組；新增帳號不影響目前登入的帳號。"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus /> 新增帳號
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>Anthropic（Claude）</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => void act(window.api.startLogin(state.config.login_browser))}
              >
                <Globe /> 瀏覽器登入
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy || !state.current.unsaved} onSelect={onSaveCurrent}>
                <Save /> 儲存目前登入的帳號
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Google（agy）</DropdownMenuLabel>
              <DropdownMenuItem disabled={agyBusy} onSelect={() => onAgyDialog('add')}>
                <Terminal /> 登入新帳號
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={agyBusy || !state.agyCurrent?.unsaved}
                onSelect={() => onAgyDialog('save')}
              >
                <Save /> 儲存目前 agy 登入
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <section aria-label="Anthropic" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-sm font-semibold">Anthropic</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{state.accounts.length} 個</span>
          <div className="ml-auto flex items-center gap-2">
            {state.current.unsaved && (
              <Button
                size="xs"
                variant="outline"
                className="border-amber-500/50 text-amber-300"
                disabled={busy}
                onClick={onSaveCurrent}
              >
                <Save /> 儲存目前登入（{state.current.email ?? '未知'}）
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="重新整理用量"
                  disabled={state.usagePolling}
                  onClick={() => void act(window.api.refreshUsage())}
                >
                  <RefreshCw className={state.usagePolling ? 'animate-spin' : undefined} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>重新整理用量</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {state.accounts.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-pretty text-muted-foreground">
            還沒有 Anthropic 帳號。從頁首「新增帳號」選 Anthropic，再登入或儲存目前的登入。
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {state.accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                threshold={state.config.threshold}
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
