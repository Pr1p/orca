import { beforeEach, describe, expect, it, vi } from 'vitest'

const runProcessMock = vi.hoisted(() => vi.fn())

vi.mock('@orca/process-host', () => ({ runProcess: runProcessMock }))

import { EmulatorError } from './emulator-errors'
import { execServeSimCommand } from './serve-sim-execution'

const executable = { command: 'serve-sim', baseArgs: [], usesElectronAsNode: false }

describe('execServeSimCommand', () => {
  beforeEach(() => {
    runProcessMock.mockReset()
  })

  it('keeps the serve-sim no-server line in the emulator_no_active error', async () => {
    runProcessMock.mockResolvedValue({
      code: 1,
      stdout: 'No serve-sim server running. Run `serve-sim` first.',
      stderr: '',
      timedOut: false
    })

    const error = (await execServeSimCommand(executable, ['fold', '180', '-d', 'UDID']).catch(
      (thrown: unknown) => thrown
    )) as EmulatorError

    expect(error).toBeInstanceOf(EmulatorError)
    expect(error.code).toBe('emulator_no_active')
    expect(error.message).toContain('No active emulator for this worktree')
    expect(error.message).toContain('No serve-sim server running. Run `serve-sim` first.')
  })
})
