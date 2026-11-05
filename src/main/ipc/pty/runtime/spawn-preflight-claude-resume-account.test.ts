import { describe, expect, it } from 'vitest'
import type { ClaudeRuntimeAuthPreparation } from '../../../claude-accounts/runtime-auth/runtime-auth-types'
import { prepareRuntimePtySpawn } from './spawn-preflight'
import { createRuntimePtySpawnState } from './spawn-state'
import { makeRuntimePtySpawnTestDeps } from './spawn-preflight-test-deps-fixture'

const ACTIVE_HOME = '/home/u/.local/share/orca/claude-profiles/active-acct/home'
const SESSION_HOME = '/home/u/.local/share/orca/claude-profiles/7f7f1e7c/home'
const SESSION_ID = 'ea8dbad6'
const TRANSCRIPT = `${SESSION_HOME}/projects/-home-u-repo/${SESSION_ID}.jsonl`

/** The active account's patch, as the router would build it for a launch. */
function activeAccountAuth(): ClaudeRuntimeAuthPreparation {
  return {
    configDir: ACTIVE_HOME,
    runtime: 'host',
    wslDistro: null,
    wslLinuxConfigDir: null,
    envPatch: {
      CLAUDE_CONFIG_DIR: ACTIVE_HOME,
      ORCA_CLAUDE_INJECTED_CONFIG_DIR: ACTIVE_HOME
    },
    provenance: 'profile:active-acct'
  }
}

async function prepareEnv(
  argsOverrides: Record<string, unknown>
): Promise<Record<string, string> | undefined> {
  const deps = {
    ...makeRuntimePtySpawnTestDeps(),
    prepareClaudeAuth: async () => activeAccountAuth()
  }
  const ctx = createRuntimePtySpawnState(deps, {
    cols: 80,
    rows: 24,
    cwd: '/tmp/repo',
    worktreeId: 'wt-1',
    command: `claude --resume ${SESSION_ID}`,
    launchAgent: 'claude',
    env: { KEEP: '1' },
    ...argsOverrides
  })
  try {
    await prepareRuntimePtySpawn(ctx)
  } finally {
    ctx.finishTerminalInstall()
  }
  return ctx.env
}

describe('a saved Claude resume keeps the account its transcript lives under (#24752)', () => {
  it("overrides the active account's CLAUDE_CONFIG_DIR with the session's own", async () => {
    const env = await prepareEnv({
      resumeProviderSession: { key: 'session_id', id: SESSION_ID, transcriptPath: TRANSCRIPT }
    })
    expect(env).toMatchObject({
      KEEP: '1',
      CLAUDE_CONFIG_DIR: SESSION_HOME,
      ORCA_CLAUDE_INJECTED_CONFIG_DIR: ACTIVE_HOME
    })
  })

  it('leaves the active account routing on a fresh launch and non-managed transcripts', async () => {
    expect(await prepareEnv({})).toMatchObject({ CLAUDE_CONFIG_DIR: ACTIVE_HOME })
    expect(
      await prepareEnv({
        resumeProviderSession: {
          key: 'session_id',
          id: SESSION_ID,
          transcriptPath: `/home/u/.claude/projects/-home-u-repo/${SESSION_ID}.jsonl`
        }
      })
    ).toMatchObject({ CLAUDE_CONFIG_DIR: ACTIVE_HOME })
  })
})
