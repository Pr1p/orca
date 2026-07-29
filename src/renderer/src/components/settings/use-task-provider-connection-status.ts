import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { useAppStore } from '@/store'
import type { GlobalSettings, TaskProvider } from '../../../../shared/types'
import { getPreflightIntegrationStatuses } from './integrations-pane-status'
import { useIntegrationProviderStatusRefresh } from './use-integration-provider-status-refresh'

export type TaskProviderConnectionState = 'checking' | 'connected' | 'not-connected'

export type TaskProviderConnectionMap = Record<TaskProvider, TaskProviderConnectionState>

function cliPreflightState(
  status: 'checking' | 'connected' | 'not-installed' | 'not-authenticated'
): TaskProviderConnectionState {
  if (status === 'checking') {
    return 'checking'
  }
  return status === 'connected' ? 'connected' : 'not-connected'
}

// Visibility (Task Sources) and connection (Integrations) are separate concerns.
// This reads the same status sources the Integrations cards use so the Task
// Sources page can flag providers that are visible but never configured.
export function useTaskProviderConnectionStatus(
  settings: GlobalSettings
): TaskProviderConnectionMap {
  // Triggers linear/jira/preflight probes when stale - keeps status honest.
  useIntegrationProviderStatusRefresh()

  const providerRuntimeContextKey = getProviderRuntimeContextKey(settings)

  const linearStatus = useAppStore((s) => s.linearStatus)
  const linearStatusChecked = useAppStore((s) => s.linearStatusChecked)
  const linearStatusContextKey = useAppStore((s) => s.linearStatusContextKey)
  const linearCurrent = linearStatusContextKey === providerRuntimeContextKey
  const linear: TaskProviderConnectionState =
    !linearCurrent || !linearStatusChecked
      ? 'checking'
      : linearStatus.connected
        ? 'connected'
        : 'not-connected'

  const jiraStatus = useAppStore((s) => s.jiraStatus)
  const jiraStatusChecked = useAppStore((s) => s.jiraStatusChecked)
  const jiraStatusContextKey = useAppStore((s) => s.jiraStatusContextKey)
  const jiraCurrent = jiraStatusContextKey === providerRuntimeContextKey
  const jira: TaskProviderConnectionState =
    !jiraCurrent || !jiraStatusChecked
      ? 'checking'
      : jiraStatus.connected
        ? 'connected'
        : 'not-connected'

  const preflightStatus = useAppStore((s) => s.preflightStatus)
  const preflightStatusChecked = useAppStore((s) => s.preflightStatusChecked)
  const preflightStatusContextKey = useAppStore((s) => s.preflightStatusContextKey)
  const preflightStatusLoading = useAppStore((s) => s.preflightStatusLoading)
  const preflightStatusError = useAppStore((s) => s.preflightStatusError)
  const expectedPreflightContextKey = useAppStore((s) =>
    localPreflightContextKey(getLocalPreflightContext(s))
  )
  const preflightCurrent = preflightStatusContextKey === expectedPreflightContextKey
  const preflightAvailable =
    !preflightStatusLoading &&
    preflightStatusChecked &&
    preflightCurrent &&
    preflightStatusError === null
  const cliStatuses = getPreflightIntegrationStatuses(
    preflightAvailable ? preflightStatus : null,
    new Set()
  )

  return {
    github: cliPreflightState(cliStatuses.ghStatus),
    gitlab: cliPreflightState(cliStatuses.glabStatus),
    linear,
    jira
  }
}
