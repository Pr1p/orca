import '../../pty-subprocess/testing/mock-descendant-sweep'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DaemonClient } from '../../transport/client/daemon-client'
import { startDaemon, type DaemonHandle } from '../daemon-main'
import {
  DaemonDetachedSessionReaper,
  DEFAULT_DETACHED_SESSION_REAP_MS,
  resolveDetachedSessionReapMs
} from '../daemon-detached-session-reaper'
import { getDaemonSocketPath } from '../../launch/daemon-spawner'
import { createNoopDaemonFileLog } from '../../observability/daemon-file-log'
import { SessionOutputPlane } from '../../sessions/session-output-plane'
import type { TerminalHost } from '../../terminal-host/terminal-host'
import type { SubprocessHandle } from '../../sessions/session-subprocess-handle'

// Real timers with a tiny reap bound; the reaper wakes on the reap deadline itself, so the whole
// chain settles within a few hundred milliseconds.
const REAP_BOUND_MS = 150

function createMockSubprocess(): SubprocessHandle & {
  exit(code: number): void
  kill: Mock
  onData: Mock
} {
  let onExit: ((code: number) => void) | null = null
  return {
    pid: 9345,
    getForegroundProcess: () => null,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    terminateOwnedTree: () => 'unavailable' as const,
    forceKill: vi.fn(),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit(callback) {
      onExit = callback
    },
    dispose: vi.fn(),
    exit(code) {
      onExit?.(code)
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('detached idle session reaping (#40261)', () => {
  let directory: string
  let daemon: DaemonHandle | null
  let client: DaemonClient | null

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-detached-reap-'))
    daemon = null
    client = null
  })

  afterEach(async () => {
    client?.disconnect()
    await daemon?.shutdown().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  })

  function socketPaths(): { socketPath: string; tokenPath: string } {
    return {
      socketPath: getDaemonSocketPath(directory),
      tokenPath: join(directory, 'daemon.token')
    }
  }

  it('kills a session left detached and silent, letting the daemon retire', async () => {
    const subprocess = createMockSubprocess()
    const onIdleShutdown = vi.fn()
    const daemonLog = createNoopDaemonFileLog()
    const log = vi.spyOn(daemonLog, 'log')
    daemon = await startDaemon({
      ...socketPaths(),
      spawnSubprocess: () => subprocess,
      detachedSessionReapMs: REAP_BOUND_MS,
      onIdleShutdown,
      log: daemonLog
    })
    client = new DaemonClient(socketPaths())
    await client.ensureConnected()
    await client.request('createOrAttach', { sessionId: 'abandoned', cols: 80, rows: 24 })

    client.disconnect()
    await vi.waitFor(() => expect(subprocess.kill).toHaveBeenCalled(), { timeout: 5_000 })
    // The kill landed while the session still lives, and retirement still waited for its exit.
    expect(onIdleShutdown).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'session-detached-reap',
      expect.objectContaining({ sessionId: 'abandoned' })
    )
    subprocess.exit(0)
    await vi.waitFor(() => expect(onIdleShutdown).toHaveBeenCalledTimes(1), { timeout: 5_000 })
  })

  it('does not reap a detached session that keeps producing output', async () => {
    const subprocess = createMockSubprocess()
    const onIdleShutdown = vi.fn()
    daemon = await startDaemon({
      ...socketPaths(),
      spawnSubprocess: () => subprocess,
      detachedSessionReapMs: REAP_BOUND_MS,
      onIdleShutdown
    })
    client = new DaemonClient(socketPaths())
    await client.ensureConnected()
    await client.request('createOrAttach', { sessionId: 'still-working', cols: 80, rows: 24 })
    client.disconnect()

    const emitData = subprocess.onData.mock.calls[0]?.[0] as (data: string) => void
    expect(emitData).toBeTypeOf('function')
    // A working agent streams output; every byte restarts the idle clock.
    // ast-grep-ignore: test-no-polling-loop -- spaced ticks deliberately span many wake deadlines, not a poll-until-true
    for (let i = 0; i < 15; i++) {
      emitData('tick')
      // ast-grep-ignore: test-no-real-time-wait -- spaced ticks must each push the reap deadline past a later wake
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    expect(subprocess.kill).not.toHaveBeenCalled()

    emitData('done')
    await vi.waitFor(() => expect(subprocess.kill).toHaveBeenCalled(), { timeout: 5_000 })
    subprocess.exit(0)
  })

  it('does not reap a session while a client is still attached', async () => {
    const subprocess = createMockSubprocess()
    const onIdleShutdown = vi.fn()
    daemon = await startDaemon({
      ...socketPaths(),
      spawnSubprocess: () => subprocess,
      detachedSessionReapMs: REAP_BOUND_MS,
      onIdleShutdown
    })
    client = new DaemonClient(socketPaths())
    await client.ensureConnected()
    await client.request('createOrAttach', { sessionId: 'watched', cols: 80, rows: 24 })

    // ast-grep-ignore: test-no-real-time-wait -- negative window: the reap deadline must pass while the client stays attached
    await new Promise((resolve) => setTimeout(resolve, REAP_BOUND_MS * 3))
    expect(subprocess.kill).not.toHaveBeenCalled()
    expect(onIdleShutdown).not.toHaveBeenCalled()
  })
})

describe('SessionOutputPlane detached idle clock', () => {
  it('counts from the last full detachment and resets on output', () => {
    const plane = new SessionOutputPlane({ cols: 80, rows: 24 })
    // A session nobody ever attached is reap-eligible from birth.
    expect(plane.detachedIdleMs()).not.toBeNull()

    const token = plane.attachClient({ onData: () => {}, onExit: () => {} })
    expect(plane.detachedIdleMs()).toBeNull()

    plane.detachClient(token)
    const afterDetach = performance.now()
    expect(plane.detachedIdleMs(afterDetach + 100)).toBeGreaterThanOrEqual(100)

    // A detached session still producing output is working, not idle: at one fixed probe time,
    // moving the anchor to the emit strictly lowers the idle read.
    const probe = performance.now() + 60_000
    const idleBeforeOutput = plane.detachedIdleMs(probe) ?? -1
    plane.emit({ data: 'tick', rawStartSeq: 0, rawEndSeq: 4, transformed: false })
    const idleAfterOutput = plane.detachedIdleMs(probe) ?? -1
    expect(idleBeforeOutput).toBeGreaterThan(0)
    expect(idleAfterOutput).toBeLessThan(idleBeforeOutput)
  })
})

describe('DaemonDetachedSessionReaper', () => {
  it('kills and logs only candidates past the reap bound', () => {
    const host = {
      detachedIdleSessions: () => [
        { sessionId: 's1', idleMs: 3_700_000 },
        { sessionId: 'fresh', idleMs: 10 }
      ],
      kill: vi.fn(() => Promise.resolve())
    } as unknown as TerminalHost
    const daemonLog = createNoopDaemonFileLog()
    const log = vi.spyOn(daemonLog, 'log')
    const reaper = new DaemonDetachedSessionReaper({ host, log: daemonLog, reapMs: 1_000 })

    reaper.sweep()

    expect(host.kill).toHaveBeenCalledTimes(1)
    expect(host.kill).toHaveBeenCalledWith('s1')
    expect(log).toHaveBeenCalledWith('session-detached-reap', {
      sessionId: 's1',
      idleMs: 3_700_000
    })
  })

  it('never sweeps when reaping is disabled', () => {
    const host = {
      detachedIdleSessions: vi.fn(),
      kill: vi.fn()
    } as unknown as TerminalHost
    const reaper = new DaemonDetachedSessionReaper({ host, reapMs: 0 })

    reaper.start()
    reaper.sweep()

    expect(host.detachedIdleSessions).not.toHaveBeenCalled()
    expect(host.kill).not.toHaveBeenCalled()
  })

  it('wakes exactly on the earliest reap deadline', () => {
    vi.useFakeTimers()
    const start = Date.now()
    const host = {
      detachedIdleSessions: () => [{ sessionId: 's1', idleMs: Date.now() - start }],
      kill: vi.fn(() => Promise.resolve())
    } as unknown as TerminalHost
    const reaper = new DaemonDetachedSessionReaper({ host, reapMs: 1_000 })

    reaper.start()
    vi.advanceTimersByTime(999)
    expect(host.kill).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(host.kill).toHaveBeenCalledTimes(1)

    reaper.dispose()
    vi.advanceTimersByTime(120_000)
    expect(host.kill).toHaveBeenCalledTimes(1)
  })

  it('does not retry a kill the host refused', async () => {
    const host = {
      detachedIdleSessions: () => [{ sessionId: 's1', idleMs: 5_000 }],
      kill: vi.fn(() => Promise.reject(new Error('EPERM')))
    } as unknown as TerminalHost
    const reaper = new DaemonDetachedSessionReaper({ host, reapMs: 1_000 })

    reaper.sweep()
    await new Promise((resolve) => setTimeout(resolve, 0))
    reaper.sweep()

    expect(host.kill).toHaveBeenCalledTimes(1)
  })

  it('resolves the grace from ORCA_DAEMON_DETACHED_SESSION_REAP_MS', () => {
    expect(resolveDetachedSessionReapMs({})).toBe(DEFAULT_DETACHED_SESSION_REAP_MS)
    expect(resolveDetachedSessionReapMs({ ORCA_DAEMON_DETACHED_SESSION_REAP_MS: '0' })).toBe(0)
    expect(resolveDetachedSessionReapMs({ ORCA_DAEMON_DETACHED_SESSION_REAP_MS: ' 2500 ' })).toBe(
      2_500
    )
    expect(
      resolveDetachedSessionReapMs({ ORCA_DAEMON_DETACHED_SESSION_REAP_MS: 'not-a-number' })
    ).toBe(DEFAULT_DETACHED_SESSION_REAP_MS)
  })
})
