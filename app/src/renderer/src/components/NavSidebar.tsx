import { useState } from 'react'
import {
  ChevronDown,
  LayoutDashboard,
  ScrollText,
  Settings,
  Terminal,
  Users,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Page } from '@/lib/pages'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { MessageKey } from '../../../shared/i18n'

interface Props {
  page: Page
  onNavigate: (p: Page) => void
  accountCount: number
  cliCount: number
  dispatchCount?: number
  routingEnabled?: boolean
  /** 有新版本：「設定」與「更新」右上角顯示紅點 */
  updateAvailable?: boolean
}

const settingsItems: { page: Page; labelKey: MessageKey }[] = [
  { page: 'settings/general', labelKey: 'nav.settings.general' },
  { page: 'settings/switch', labelKey: 'nav.settings.switch' },
  { page: 'settings/cli', labelKey: 'nav.settings.cli' },
  { page: 'settings/compact', labelKey: 'nav.settings.compact' },
  { page: 'settings/routing', labelKey: 'nav.settings.routing' },
  { page: 'settings/integration', labelKey: 'nav.settings.integration' },
  { page: 'settings/update', labelKey: 'nav.settings.update' }
]

const itemBase =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** 右上角紅點（窄版導覽也顯示）。 */
function Dot({ label }: { label: string }): React.JSX.Element {
  return (
    <span
      role="img"
      aria-label={label}
      className="absolute top-1 right-1.5 size-2 rounded-full bg-red-500"
    />
  )
}

function Item({
  icon: Icon,
  label,
  active,
  count,
  onClick,
  trailing,
  expanded,
  badge
}: {
  icon?: LucideIcon
  label: string
  active: boolean
  count?: number
  onClick: () => void
  trailing?: React.ReactNode
  expanded?: boolean
  badge?: string
}): React.JSX.Element {
  const btn = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
      aria-label={label}
      onClick={onClick}
      className={cn(
        itemBase,
        'relative max-[1099px]:justify-center max-[1099px]:px-0',
        active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground'
      )}
    >
      {badge && <Dot label={badge} />}
      {Icon && <Icon className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate text-left max-[1099px]:hidden">{label}</span>
      {count !== undefined && (
        <span className="text-xs tabular-nums text-muted-foreground max-[1099px]:hidden">{count}</span>
      )}
      {trailing}
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="right" className="min-[1100px]:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function NavSidebar({ page, onNavigate, accountCount, cliCount, dispatchCount, routingEnabled = true, updateAvailable = false }: Props): React.JSX.Element {
  const t = useT()
  const inSettings = page.startsWith('settings/')
  const [open, setOpen] = useState(inSettings)
  const showSub = open || inSettings
  return (
    <nav
      aria-label={t('nav.mainMenu')}
      className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r p-2 max-[1099px]:w-14"
    >
      <Item icon={LayoutDashboard} label={t('nav.overview')} active={page === 'overview'} onClick={() => onNavigate('overview')} />
      <Item
        icon={Users}
        label={t('nav.accounts')}
        count={accountCount}
        active={page === 'accounts'}
        onClick={() => onNavigate('accounts')}
      />
      <Item
        icon={Terminal}
        label={t('nav.cli')}
        count={cliCount}
        active={page === 'cli'}
        onClick={() => onNavigate('cli')}
      />
      {routingEnabled && (
      <Item
        icon={Workflow}
        label={t('nav.dispatch')}
        count={dispatchCount}
        active={page === 'dispatch'}
        onClick={() => onNavigate('dispatch')}
      />
      )}
      <Item icon={ScrollText} label={t('nav.events')} active={page === 'events'} onClick={() => onNavigate('events')} />
      <div role="separator" className="my-1 border-t" />
      <Item
        icon={Settings}
        label={t('nav.settings')}
        active={false}
        expanded={showSub}
        badge={updateAvailable ? t('nav.updateBadge') : undefined}
        onClick={() => {
          if (inSettings) setOpen((v) => !v)
          else {
            setOpen(true)
            onNavigate('settings/general')
          }
        }}
        trailing={
          <ChevronDown
            className={cn('size-3.5 shrink-0 transition-transform max-[1099px]:hidden', showSub && 'rotate-180')}
          />
        }
      />
      {showSub && (
        <div className="flex flex-col gap-0.5 pl-3 max-[1099px]:pl-0">
          {settingsItems.map((s, i) => (
            <SubItem key={s.page} short={String(i + 1)} label={t(s.labelKey)} active={page === s.page} onClick={() => onNavigate(s.page)} badge={s.page === 'settings/update' && updateAvailable ? t('nav.updateBadge') : undefined} />
          ))}
        </div>
      )}
    </nav>
  )
}

function SubItem({
  short,
  label,
  active,
  onClick,
  badge
}: {
  short: string
  label: string
  active: boolean
  onClick: () => void
  badge?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          onClick={onClick}
          className={cn(
            itemBase,
            'relative py-1.5 text-[13px] max-[1099px]:justify-center max-[1099px]:px-0',
            active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground'
          )}
        >
          {badge && <Dot label={badge} />}
          <span className="truncate max-[1099px]:hidden">{label}</span>
          <span className="hidden text-[11px] font-medium max-[1099px]:inline">{short}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="min-[1100px]:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
