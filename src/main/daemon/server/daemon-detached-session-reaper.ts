import type { DaemonFileLog } from '../observability/daemon-file-log'
import type { TerminalHost } from '../terminal-host/terminal-host'
import type { DetachedIdleTerminalHostSession } from '../terminal-host/terminal-host-session-listing'

export const DETACHED_SESSION_REAP_MS_ENV_VAR = 'ORCA_DAEMON_DETACHED_SESSION_REAP_MS'
/** An hour detached with no viewer and no output means no one is coming back (#40261). */
export const DEFAULT_DETACHED_SESSION_REAP_MS = 60 * 60 * 1000
const MIN_WAKE_MS = 50
const IDLE_BACKOFF_MS = 60_000

/** `0` disables; anything non-numeric falls back to the default hour. */
export function resolveDetachedSessionReapMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DETACHED_SESSION_REAP_MS_ENV_VAR]?.trim()
  return raw && /^\d+$/.test(raw) ? Number(raw) : DEFAULT_DETACHED_SESSION_REAP_MS
}

type DaemonDetachedSessionReaperOptions = {
  host: Pick<TerminalHost, 'detachedIdleSessions' | 'kill'>
  log?: DaemonFileLog
  reapMs?: number
}

/**
 * Kills sessions whose client detached and never came back, so idle agent PTY trees cannot pin
 * host memory for the daemon's lifetime (#40261). A session still emitting output is working and
 * is never a candidate; the ordinary exit chain (kill → teardown → onSessionReaped) reaps the
 * session and re-evaluates idle shutdown.
 */
export class DaemonDetachedSessionReaper {
  private readonly reapMs: number
  private readonly log: DaemonFileLog | undefined
  private timer: ReturnType<typeof setTimeout> | null = null
  // A session handed to kill() stays out of scheduling until its kill settles, so a slow teardown
  // or a refused kill cannot spin the wake at MIN_WAKE_MS.
  private readonly killsInFlight = new Set<string>()

  constructor(private readonly options: DaemonDetachedSessionReaperOptions) {
    this.reapMs = options.reapMs ?? resolveDetachedSessionReapMs()
    this.log = options.log
  }

  start(): void {
    if (this.reapMs <= 0 || this.timer !== null) {
      return
    }
    this.schedule()
  }

  /**
   * Deadline-driven, never fixed-cadence: each wake lands on the earliest moment a detached
   * session could become reapable — output can only push a deadline later, and a later
   * detachment's deadline is never earlier than a pending one — so one wake per deadline is
   * never late. Nothing detached means a slow backoff instead of a poll.
   */
  private schedule(): void {
    const backoffMs = Math.min(IDLE_BACKOFF_MS, this.reapMs)
    let maxIdleMs: number | null = null
    for (const session of this.options.host.detachedIdleSessions()) {
      if (!this.killsInFlight.has(session.sessionId)) {
        maxIdleMs = Math.max(maxIdleMs ?? 0, session.idleMs)
      }
    }
    const delay =
      maxIdleMs === null
        ? backoffMs
        : Math.max(Math.min(MIN_WAKE_MS, backoffMs), this.reapMs - maxIdleMs)
    this.timer = setTimeout(() => {
      this.timer = null
      this.sweep()
      if (this.timer === null) {
        this.schedule()
      }
    }, delay)
    this.timer.unref?.()
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  sweep(): void {
    if (this.reapMs <= 0) {
      return
    }
    const detached = this.options.host.detachedIdleSessions()
    const stillDetached = new Set(detached.map((session) => session.sessionId))
    for (const sessionId of this.killsInFlight) {
      // A kill whose session has left the listing settled; a session still listed after a refused
      // kill is never retried here — shutdown-time disposal owns it from there.
      if (!stillDetached.has(sessionId)) {
        this.killsInFlight.delete(sessionId)
      }
    }
    for (const candidate of detached) {
      if (candidate.idleMs < this.reapMs || this.killsInFlight.has(candidate.sessionId)) {
        continue
      }
      this.killCandidate(candidate)
    }
  }

  private killCandidate(candidate: DetachedIdleTerminalHostSession): void {
    this.killsInFlight.add(candidate.sessionId)
    this.log?.log('session-detached-reap', {
      sessionId: candidate.sessionId,
      idleMs: candidate.idleMs
    })
    void Promise.resolve(this.options.host.kill(candidate.sessionId)).catch((error: unknown) => {
      this.log?.log('session-detached-reap-failed', {
        sessionId: candidate.sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }
}
