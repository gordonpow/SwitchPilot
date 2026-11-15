import type { AppState } from '../../../shared/types'
import { EventLog } from '@/components/EventLog'
import { PageHeader } from '@/components/PageHeader'

export function EventsPage({ state }: { state: AppState }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-72 flex-col">
      <PageHeader title="事件紀錄" />
      <div className="min-h-0 flex-1">
        <EventLog events={state.events} full />
      </div>
    </div>
  )
}
