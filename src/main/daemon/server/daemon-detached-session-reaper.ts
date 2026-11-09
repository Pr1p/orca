import type { DaemonFileLog } from '../observability/daemon-file-log'
import type { TerminalHost } from '../terminal-host/terminal-host'

export const DETACHED_SESSION_REAP_MS_ENV_VAR = 'ORCA_DAEMON_DETACHED_SESSION_REAP_MS'
/** An hour detached with no viewer and no output means no one is coming back (#40261). */
export const DEFAULT_DETACHED_SESSION_REAP_MS = 60 * 60 * 1000
const MIN_POLL_INTERVAL_MS = 50
const MAX_POLL_INTERVAL_MS = 60_000

/** `0` disables; anything non-numeric falls back to the default hour. */
export function resolveDetachedSessionReapMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DETACHED_SESSION_REAP_MS_ENV_VAR]?.trim()
  return raw && /^\d+$/.test(raw) ? Number(raw) : DEFAULT_DETACHED_SESSION_REAP_MS
}

function resolvePollIntervalMs(reapMs: number): number {
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.floor(reapMs / 10)))
}

type DaemonDetachedSessionReaperOptions = {
  host: TerminalHost
  log?: DaemonFileLog
  reapMs?: number
  pollIntervalMs?: number
}

/**
 * Kills sessions whose client detached and never came back, so idle agent PTY trees cannot pin
 * host memory for the daemon's lifetime (#40261). A session still emitting output is working and
 * is never a candidate; the ordinary exit chain (kill → teardown → onSessionReaped) reaps the
 * session and re-evaluates idle shutdown.
 */
export class DaemonDetachedSessionReaper {
  private readonly reapMs: number
  private readonly pollIntervalMs: number
  private readonly log: DaemonFileLog | undefined
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: DaemonDetachedSessionReaperOptions) {
    this.reapMs = options.reapMs ?? resolveDetachedSessionReapMs()
    this.pollIntervalMs = options.pollIntervalMs ?? resolvePollIntervalMs(this.reapMs)
    this.log = options.log
  }

  start(): void {
    if (this.reapMs <= 0 || this.timer !== null) {
      return
    }
    this.timer = setInterval(() => this.sweep(), this.pollIntervalMs)
    this.timer.unref?.()
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  sweep(): void {
    if (this.reapMs <= 0) {
      return
    }
    for (const candidate of this.options.host.detachedIdleSessions(this.reapMs)) {
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
}
