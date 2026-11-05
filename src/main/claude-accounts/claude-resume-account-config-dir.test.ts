import { describe, expect, it } from 'vitest'
import {
  claudeResumeAccountConfigDir,
  withClaudeResumeAccountConfigDir
} from './claude-resume-account-config-dir'

const WSL_PROFILE_TRANSCRIPT =
  '/home/u/.local/share/orca/claude-profiles/7f7f1e7c/home/projects/-home-u-repo/ea8dbad6.jsonl'
const WSL_LEGACY_TRANSCRIPT =
  '/home/u/.local/share/orca/claude-accounts/7f7f1e7c/auth/projects/-home-u-repo/ea8dbad6.jsonl'

describe('claudeResumeAccountConfigDir', () => {
  it('reads the managed account home out of a saved transcript path', () => {
    expect(
      claudeResumeAccountConfigDir('claude', {
        key: 'session_id',
        id: 'ea8dbad6',
        transcriptPath: WSL_PROFILE_TRANSCRIPT
      })
    ).toBe('/home/u/.local/share/orca/claude-profiles/7f7f1e7c/home')
    expect(
      claudeResumeAccountConfigDir('claude', {
        key: 'session_id',
        id: 'ea8dbad6',
        transcriptPath: WSL_LEGACY_TRANSCRIPT
      })
    ).toBe('/home/u/.local/share/orca/claude-accounts/7f7f1e7c/auth')
  })

  it('accepts a host-runtime Windows transcript path', () => {
    expect(
      claudeResumeAccountConfigDir('claude', {
        key: 'session_id',
        id: 'ea8dbad6',
        transcriptPath:
          'C:\\Users\\u\\AppData\\Roaming\\orca\\claude-profiles\\acct9\\home\\projects\\C--Users-u-repo\\ea8dbad6.jsonl'
      })
    ).toBe('C:/Users/u/AppData/Roaming/orca/claude-profiles/acct9/home')
  })

  it('returns null outside managed homes, for other agents, and without a transcript', () => {
    const systemDefault = {
      key: 'session_id' as const,
      id: 'ea8dbad6',
      transcriptPath: '/home/u/.claude/projects/-home-u-repo/ea8dbad6.jsonl'
    }
    expect(claudeResumeAccountConfigDir('claude', systemDefault)).toBeNull()
    expect(claudeResumeAccountConfigDir('codex', { key: 'session_id', id: 'x' })).toBeNull()
    expect(claudeResumeAccountConfigDir('claude', { key: 'session_id', id: 'ea8dbad6' })).toBeNull()
    expect(
      claudeResumeAccountConfigDir('claude', {
        key: 'session_id',
        id: 'ea8dbad6',
        transcriptPath:
          '/home/u/.local/share/orca/claude-profiles/not an id/home/projects/x/y.jsonl'
      })
    ).toBeNull()
  })
})

describe('withClaudeResumeAccountConfigDir', () => {
  it('overrides an active-account patch with the session-bound account', () => {
    expect(
      withClaudeResumeAccountConfigDir(
        {
          CLAUDE_CONFIG_DIR: '/active-account/home',
          ORCA_CLAUDE_INJECTED_CONFIG_DIR: '/active-account/home'
        },
        'claude',
        { key: 'session_id', id: 'ea8dbad6', transcriptPath: WSL_PROFILE_TRANSCRIPT }
      )
    ).toEqual({
      CLAUDE_CONFIG_DIR: '/home/u/.local/share/orca/claude-profiles/7f7f1e7c/home',
      ORCA_CLAUDE_INJECTED_CONFIG_DIR: '/active-account/home'
    })
  })

  it('keeps unrelated env and undefined env untouched', () => {
    expect(
      withClaudeResumeAccountConfigDir({ KEEP: '1' }, 'claude', {
        key: 'session_id',
        id: 'ea8dbad6',
        transcriptPath: '/home/u/.claude/projects/a/b.jsonl'
      })
    ).toEqual({ KEEP: '1' })
    expect(withClaudeResumeAccountConfigDir(undefined, 'claude', undefined)).toBeUndefined()
  })
})
