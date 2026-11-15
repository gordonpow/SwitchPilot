import type { AppState } from '../../../shared/types'
import { CliPanel } from '@/components/CliPanel'
import { LaunchPanel } from '@/components/LaunchPanel'
import { PageHeader } from '@/components/PageHeader'
import { useT } from '@/lib/i18n'

export function CliPage({ state }: { state: AppState }): React.JSX.Element {
  const t = useT()
  return (
    <>
      <PageHeader title={t('cli.title')} description={t('cli.pageDescription')} />
      <div className="grid gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <div className="self-start">
          <LaunchPanel lastFolder={state.config.last_folder} runs={state.runs} />
        </div>
        <CliPanel clis={state.clis} mode={state.config.switch_mode} tall />
      </div>
    </>
  )
}
