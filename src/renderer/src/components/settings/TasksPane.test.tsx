// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/types'
import { TasksPane } from './TasksPane'
import type { TaskProviderConnectionMap } from './use-task-provider-connection-status'

const openSettingsTarget = vi.hoisted(() => vi.fn())
const connectionStatusMock = vi.hoisted(() => vi.fn())

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openSettingsTarget, settingsSearchQuery: '' })
}))

vi.mock('./use-task-provider-connection-status', () => ({
  useTaskProviderConnectionStatus: () => connectionStatusMock()
}))

function allConnected(): TaskProviderConnectionMap {
  return { github: 'connected', gitlab: 'connected', linear: 'connected', jira: 'connected' }
}

function makeProps(overrides: Partial<GlobalSettings> = {}): {
  settings: GlobalSettings
  updateSettings: ReturnType<typeof vi.fn>
} {
  return {
    settings: { ...getDefaultSettings(''), ...overrides },
    updateSettings: vi.fn()
  }
}

afterEach(() => {
  cleanup()
  openSettingsTarget.mockReset()
  connectionStatusMock.mockReset()
  connectionStatusMock.mockReturnValue(allConnected())
})

describe('TasksPane connection-status guidance', () => {
  it('always shows the visibility-vs-setup banner with an Open Integrations link', () => {
    connectionStatusMock.mockReturnValue(allConnected())
    const { settings, updateSettings } = makeProps()
    render(<TasksPane settings={settings} updateSettings={updateSettings} />)

    expect(screen.getByText(/Turning on a source only controls visibility/)).toBeTruthy()
    expect(screen.getByText('Open Integrations')).toBeTruthy()
  })

  it('shows Not configured and a Configure link for a visible unconnected provider', () => {
    connectionStatusMock.mockReturnValue({ ...allConnected(), linear: 'not-connected' })
    const { settings, updateSettings } = makeProps()
    render(<TasksPane settings={settings} updateSettings={updateSettings} />)

    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(screen.getAllByText('Configure in Integrations')).toHaveLength(1)
  })

  it('does not flag a provider that is hidden from Tasks', () => {
    connectionStatusMock.mockReturnValue({ ...allConnected(), linear: 'not-connected' })
    const { settings, updateSettings } = makeProps({ visibleTaskProviders: ['github'] })
    render(<TasksPane settings={settings} updateSettings={updateSettings} />)

    expect(screen.queryByText('Not configured')).toBeNull()
    expect(screen.queryByText('Configure in Integrations')).toBeNull()
  })

  it('suppresses the warning while connection status is still resolving', () => {
    connectionStatusMock.mockReturnValue({ ...allConnected(), linear: 'checking' })
    const { settings, updateSettings } = makeProps()
    render(<TasksPane settings={settings} updateSettings={updateSettings} />)

    expect(screen.queryByText('Not configured')).toBeNull()
    expect(screen.queryByText('Configure in Integrations')).toBeNull()
  })

  it('navigates to integrations when Configure is clicked', () => {
    connectionStatusMock.mockReturnValue({ ...allConnected(), linear: 'not-connected' })
    const { settings, updateSettings } = makeProps()
    render(<TasksPane settings={settings} updateSettings={updateSettings} />)

    fireEvent.click(screen.getByText('Configure in Integrations'))
    expect(openSettingsTarget).toHaveBeenCalledWith({ pane: 'integrations', repoId: null })
  })

  it('navigates to integrations when Open Integrations is clicked', () => {
    connectionStatusMock.mockReturnValue(allConnected())
    const { settings, updateSettings } = makeProps()
    render(<TasksPane settings={settings} updateSettings={updateSettings} />)

    fireEvent.click(screen.getByText('Open Integrations'))
    expect(openSettingsTarget).toHaveBeenCalledWith({ pane: 'integrations', repoId: null })
  })
})
