import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import {
  normalizeAgentProviderSession,
  type AgentProviderSessionMetadata
} from '../../shared/agent-session/lifecycle/agent-session-resume'

const MANAGED_ACCOUNT_ID = /^[a-zA-Z0-9_-]+$/

/** The managed account home a saved Claude transcript lives under (…/claude-profiles/<id>/home,
 *  legacy …/claude-accounts/<id>/auth), so a resume re-enters that account instead of whichever
 *  one is active now (#24752); transcripts outside managed homes return null. */
export function claudeResumeAccountConfigDir(
  agent: TuiAgent | null | undefined,
  providerSession: AgentProviderSessionMetadata | unknown
): string | null {
  if (agent !== 'claude') {
    return null
  }
  const transcriptPath = normalizeAgentProviderSession(providerSession)?.transcriptPath
  if (!transcriptPath) {
    return null
  }
  const segments = transcriptPath.replace(/\\/g, '/').split('/')
  const projects = segments.lastIndexOf('projects')
  if (projects < 3) {
    return null
  }
  const managedRoot = segments[projects - 3]
  const accountId = segments[projects - 2]
  const configFolder = segments[projects - 1]
  const isManaged =
    (managedRoot === 'claude-profiles' && configFolder === 'home') ||
    (managedRoot === 'claude-accounts' && configFolder === 'auth')
  return isManaged && MANAGED_ACCOUNT_ID.test(accountId)
    ? segments.slice(0, projects).join('/')
    : null
}

/** Apply the session-bound account after any active-account patch. The injected marker keeps
 *  naming the active account, so the `claude` shell function treats the resume value as the
 *  pane's own and runs the resume under it. */
export function withClaudeResumeAccountConfigDir(
  env: Record<string, string> | undefined,
  agent: TuiAgent | null | undefined,
  providerSession: AgentProviderSessionMetadata | unknown
): Record<string, string> | undefined {
  if (env === undefined) {
    return env
  }
  const configDir = claudeResumeAccountConfigDir(agent, providerSession)
  return configDir ? { ...env, CLAUDE_CONFIG_DIR: configDir } : env
}
