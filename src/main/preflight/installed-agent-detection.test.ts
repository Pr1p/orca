import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/command-path/agent-detection-shell-path', () => ({
  hydrateShellPathForAgentDetection: vi.fn()
}))

// The persisted-registry PATH merge would re-add the machine PATH, defeating the stubbed fixture PATH.
vi.mock('../ipc/preflight-local-env', () => ({
  buildLocalPreflightEnv: () => ({ PATH: process.env.PATH })
}))

import { backgroundAgentDetectionOptions, detectInstalledAgents } from './installed-agent-detection'
import { detectAgentCommandsOnHost } from './agent-command-detection'
import type * as AgentCommandDetection from './agent-command-detection'

vi.mock('./agent-command-detection', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentCommandDetection>()
  return { detectAgentCommandsOnHost: vi.fn(actual.detectAgentCommandsOnHost) }
})

describe('detectInstalledAgents command overrides', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'orca agent override '))
    // Scope PATH to the fixture: probing the developer's real PATH is slow under the Windows bulk-fs cap.
    vi.stubEnv('PATH', dir)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  })

  it('lists an agent outside PATH only when its override executable exists', async () => {
    // The executable lives outside the scanned PATH; otherwise plain PATH detection would find it.
    const overrideDir = await mkdtemp(path.join(tmpdir(), 'orca agent override binary '))
    const executable = path.join(overrideDir, process.platform === 'win32' ? 'ante.exe' : 'ante')
    await writeFile(executable, '#!/bin/sh\n')
    await chmod(executable, 0o755)

    try {
      await expect(
        detectInstalledAgents(undefined, { agentCmdOverrides: { ante: `"${executable}"` } })
      ).resolves.toContain('ante')
      await expect(
        detectInstalledAgents(undefined, {
          agentCmdOverrides: { ante: `"${path.join(overrideDir, 'missing', 'ante')}"` }
        })
      ).resolves.not.toContain('ante')
    } finally {
      await rm(overrideDir, { recursive: true, force: true })
    }
  })
})

describe('detectInstalledAgents disabled agents', () => {
  it('does not probe PATH for a disabled agent', async () => {
    const probed: string[] = []
    vi.mocked(detectAgentCommandsOnHost).mockImplementation(async (commands) => {
      probed.push(...commands)
      return new Set(['amp', 'hermes'])
    })

    const detected = await detectInstalledAgents(undefined, {
      disabledTuiAgents: ['amp', 'hermes']
    })

    expect(detected).toEqual([])
    expect(probed).not.toContain('amp')
    expect(probed).not.toContain('amp.exe')
    expect(probed).not.toContain('hermes')
    expect(probed.length).toBeGreaterThan(0)
  })

  it('backgroundAgentDetectionOptions carries disabled agents and overrides from settings', () => {
    expect(
      backgroundAgentDetectionOptions({
        disabledTuiAgents: ['amp'],
        agentCmdOverrides: { ante: 'C:\\tools\\ante.exe' }
      })
    ).toEqual({ disabledTuiAgents: ['amp'], agentCmdOverrides: { ante: 'C:\\tools\\ante.exe' } })
    expect(backgroundAgentDetectionOptions(undefined)).toBeUndefined()
  })
})
