import type { AppState } from '../../../shared/types'
import { RoutingPanel } from '@/components/RoutingPanel'
import type { Page } from '@/lib/pages'
import {
  CliSettingsPage,
  CompactPage,
  GeneralPage,
  IntegrationPage,
  SwitchSettingsPage
} from './settings/SettingsPages'

export function SettingsRouter({ page, state }: { page: Page; state: AppState }): React.JSX.Element | null {
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
      return <RoutingPanel state={state} />
    case 'settings/integration':
      return <IntegrationPage state={state} />
    default:
      return null
  }
}
