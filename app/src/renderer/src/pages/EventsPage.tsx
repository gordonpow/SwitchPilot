import type { AppState } from '../../../shared/types'
import { EventLog } from '@/components/EventLog'
import { PageHeader } from '@/components/PageHeader'
import { useT } from '@/lib/i18n'

export function EventsPage({ state }: { state: AppState }): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex h-full min-h-72 flex-col">
      <PageHeader title={t('events.title')} />
      <div className="min-h-0 flex-1">
        <EventLog events={state.events} full />
      </div>
    </div>
  )
}
