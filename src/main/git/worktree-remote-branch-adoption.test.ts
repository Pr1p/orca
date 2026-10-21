import { describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({ gitExecFileAsyncMock: vi.fn() }))

vi.mock('./runner', () => ({ gitExecFileAsync: gitExecFileAsyncMock }))

import { resolveTrackableRemoteBranchRef } from './worktree-remote-branch-adoption'

describe('resolveTrackableRemoteBranchRef', () => {
  it('prefers the selected base remote when the explicit branch exists there', async () => {
    gitExecFileAsyncMock.mockImplementation(async (argv: string[]) => {
      if (argv[0] === 'remote') {
        return { stdout: 'fork\norigin\n' }
      }
      if (argv.at(-1) === 'refs/remotes/origin/feature/test^{commit}') {
        return { stdout: 'a'.repeat(40) }
      }
      throw Object.assign(new Error('missing'), { code: 1 })
    })

    await expect(resolveTrackableRemoteBranchRef('/repo', 'feature/test', 'origin')).resolves.toBe(
      'refs/remotes/origin/feature/test'
    )
  })

  it('refuses an ambiguous remote-only branch without a preferred remote match', async () => {
    gitExecFileAsyncMock.mockImplementation(async (argv: string[]) => {
      if (argv[0] === 'remote') {
        return { stdout: 'fork\norigin\n' }
      }
      return { stdout: 'a'.repeat(40) }
    })

    await expect(
      resolveTrackableRemoteBranchRef('/repo', 'feature/test', undefined)
    ).resolves.toBeNull()
  })
})
