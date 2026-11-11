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

  it('reports fold rejections as emulator_error even when the stack dump embeds the no-server string', async () => {
    // Shape captured from a real serve-sim 0.1.47 fold failure: the unhandled rejection
    // prints the whole minified bundle line, which contains "No serve-sim server running."
    // many times — substring matching classified this as emulator_no_active (#40509).
    runProcessMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: [
        'file:///serve-sim/dist/serve-sim.js:161',
        '...console.error("No serve-sim server running. Run `serve-sim` first."),process.exit(1)...',
        '',
        'Error: Simulator rejected the fold. An iPhone Duo with guest HID support is required.',
        '    at J.onmessage (file:///serve-sim/dist/serve-sim.js:161:6107)'
      ].join('\n'),
      timedOut: false
    })

    const error = (await execServeSimCommand(executable, ['fold', '180', '-d', 'UDID']).catch(
      (thrown: unknown) => thrown
    )) as EmulatorError

    expect(error).toBeInstanceOf(EmulatorError)
    expect(error.code).toBe('emulator_error')
    expect(error.message).toContain('Simulator rejected the fold')
  })
})
