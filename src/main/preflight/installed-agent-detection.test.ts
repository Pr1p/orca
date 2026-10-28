import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTuiAgentDetectionProbeCommands,
  KNOWN_TUI_AGENT_DETECTION_COMMANDS
} from '../../shared/tui-agent-detection-commands'

const { detectCommandsMock } = vi.hoisted(() => ({
  detectCommandsMock: vi.fn(async (_commands: readonly string[]) => new Set<string>())
}))

vi.mock('./agent-command-detection', () => ({
  detectAgentCommandsOnHost: detectCommandsMock
}))
vi.mock('../ipc/agent-detection-shell-path', () => ({
  hydrateShellPathForAgentDetection: vi.fn(async () => undefined)
}))
vi.mock('../ipc/preflight-runtime-target', () => ({
  getPreflightWslTarget: vi.fn(() => null)
}))

import { detectInstalledAgents } from './installed-agent-detection'

function expectedProbeCommands(disabledAgentIds: ReadonlySet<string>): string[] {
  return getTuiAgentDetectionProbeCommands(
    KNOWN_TUI_AGENT_DETECTION_COMMANDS.filter((command) => !disabledAgentIds.has(command.id)),
    process.platform
  )
}

describe('detectInstalledAgents disabled-agent filtering', () => {
  beforeEach(() => {
    detectCommandsMock.mockReset()
    detectCommandsMock.mockResolvedValue(new Set<string>())
  })

  it('skips probing the commands of agents disabled in Settings → Agents', async () => {
    const disabled = new Set([KNOWN_TUI_AGENT_DETECTION_COMMANDS[0].id])
    await detectInstalledAgents(undefined, { disabledTuiAgents: [...disabled] })
    const probed = detectCommandsMock.mock.calls[0]?.[0] as string[]
    expect(probed).toEqual(expectedProbeCommands(disabled))
  })

  it('never reports a disabled agent, even when another agent probes the same command', async () => {
    const disabledAgent = KNOWN_TUI_AGENT_DETECTION_COMMANDS[0]
    const everyKnownCommand = new Set(
      KNOWN_TUI_AGENT_DETECTION_COMMANDS.flatMap((command) => [
        command.cmd,
        ...(command.requiredCommands ?? [])
      ])
    )
    detectCommandsMock.mockResolvedValueOnce(everyKnownCommand)
    const detected = await detectInstalledAgents(undefined, {
      disabledTuiAgents: [disabledAgent.id]
    })
    expect(detected).not.toContain(disabledAgent.id)
    const enabledIds = new Set(
      KNOWN_TUI_AGENT_DETECTION_COMMANDS.map(({ id }) => id).filter((id) => id !== disabledAgent.id)
    )
    expect(detected.some((id) => enabledIds.has(id as never))).toBe(true)
  })

  it('probes every known agent when no disabled list is given', async () => {
    await detectInstalledAgents()
    const probed = detectCommandsMock.mock.calls.at(-1)?.[0] as string[]
    expect(probed).toEqual(expectedProbeCommands(new Set()))
  })
})
