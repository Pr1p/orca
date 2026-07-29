// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/types'
import type { PreflightStatus } from '../../../../preload/api-types'
import { useTaskProviderConnectionStatus } from './use-task-provider-connection-status'

const mocks = vi.hoisted(() => ({
  store: {
    current: null as null | Record<string, unknown>
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.store.current ?? {})
}))

vi.mock('./use-integration-provider-status-refresh', () => ({
  useIntegrationProviderStatusRefresh: () => undefined
}))

function installStore(overrides: Record<string, unknown> = {}): GlobalSettings {
  const settings = getDefaultSettings('')
  const runtimeKey = 'local#0'
  const preflightKey = 'host'
  mocks.store.current = {
    settings,
    linearStatus: { connected: false, viewer: null },
    linearStatusChecked: true,
    linearStatusContextKey: runtimeKey,
    jiraStatus: { connected: false, viewer: null },
    jiraStatusChecked: true,
    jiraStatusContextKey: runtimeKey,
    preflightStatus: null,
    preflightStatusChecked: true,
    preflightStatusContextKey: preflightKey,
    preflightStatusLoading: false,
    preflightStatusError: null,
    ...overrides
  }
  return settings
}

afterEach(() => {
  mocks.store.current = null
})

describe('useTaskProviderConnectionStatus', () => {
  it('reports connected when Linear and Jira are authenticated', () => {
    const settings = installStore({
      linearStatus: { connected: true, viewer: null },
      jiraStatus: { connected: true, viewer: null }
    })
    const { result } = renderHook(() => useTaskProviderConnectionStatus(settings))
    expect(result.current.linear).toBe('connected')
    expect(result.current.jira).toBe('connected')
  })

  it('reports not-connected when a provider is checked but disconnected', () => {
    const settings = installStore()
    const { result } = renderHook(() => useTaskProviderConnectionStatus(settings))
    expect(result.current.linear).toBe('not-connected')
    expect(result.current.jira).toBe('not-connected')
  })

  it('reports checking while the status probe is stale', () => {
    const settings = installStore({ linearStatusChecked: false, jiraStatusChecked: false })
    const { result } = renderHook(() => useTaskProviderConnectionStatus(settings))
    expect(result.current.linear).toBe('checking')
    expect(result.current.jira).toBe('checking')
  })

  it('maps GitHub and GitLab preflight into connected or not-connected', () => {
    const preflight = {
      gh: { installed: true, authenticated: true },
      glab: { installed: true, authenticated: false }
    } as unknown as PreflightStatus
    const settings = installStore({ preflightStatus: preflight })
    const { result } = renderHook(() => useTaskProviderConnectionStatus(settings))
    expect(result.current.github).toBe('connected')
    expect(result.current.gitlab).toBe('not-connected')
  })
})
