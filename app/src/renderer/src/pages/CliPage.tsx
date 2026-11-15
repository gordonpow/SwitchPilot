import type { AppState } from '../../../shared/types'
import { CliPanel } from '@/components/CliPanel'
import { LaunchPanel } from '@/components/LaunchPanel'
import { PageHeader } from '@/components/PageHeader'

export function CliPage({ state }: { state: AppState }): React.JSX.Element {
  return (
    <>
      <PageHeader title="Claude CLI" description="從這裡啟動 claude，並查看偵測到的 CLI 與切換時的接續方式。" />
      <div className="grid gap-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <div className="self-start">
          <LaunchPanel lastFolder={state.config.last_folder} runs={state.runs} />
        </div>
        <CliPanel clis={state.clis} mode={state.config.switch_mode} tall />
      </div>
    </>
  )
}
