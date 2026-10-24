import { describe, expect, it } from 'vitest'
import type { DetectedWorktree } from '../../../../shared/worktree/types'
import { reconcileFetchedHostWorktreeState } from './repo-catalog-merge'
import { createTestStore, makeWorktree, seedStore, TEST_REPO } from '../slices/store-test-helpers'

function detected(id: string): DetectedWorktree {
  return {
    ...makeWorktree({ id, repoId: TEST_REPO.id }),
    ownership: 'orca-managed',
    selectedCheckout: false,
    visible: true
  }
}

describe('reconcileFetchedHostWorktreeState', () => {
  it('keeps legacy unstamped rows when a local refresh has only remote previous owners', () => {
    const store = createTestStore()
    const unstamped = makeWorktree({
      id: 'repo1::/legacy',
      repoId: TEST_REPO.id
    })
    const local = makeWorktree({
      id: 'repo1::/local',
      repoId: TEST_REPO.id,
      hostId: 'local'
    })
    const remote = makeWorktree({
      id: 'repo1::/remote',
      repoId: TEST_REPO.id,
      hostId: 'ssh:box'
    })
    const unstampedDetected = detected('repo1::/legacy')
    const localDetected = {
      ...detected('repo1::/local'),
      hostId: 'local' as const
    }
    const remoteDetected = {
      ...detected('repo1::/remote'),
      hostId: 'ssh:box' as const
    }

    seedStore(store, {
      repos: [{ ...TEST_REPO, connectionId: 'box', executionHostId: 'ssh:box' }],
      worktreesByRepo: { [TEST_REPO.id]: [unstamped, local, remote] },
      detectedWorktreesByRepo: {
        [TEST_REPO.id]: {
          repoId: TEST_REPO.id,
          authoritative: true,
          source: 'git',
          worktrees: [unstampedDetected, localDetected, remoteDetected]
        }
      }
    })

    const reconciled = reconcileFetchedHostWorktreeState(store.getState(), [], [], 'local')

    expect(reconciled.worktreesByRepo[TEST_REPO.id]?.map((worktree) => worktree.id)).toEqual([
      unstamped.id,
      remote.id
    ])
    expect(
      reconciled.detectedWorktreesByRepo[TEST_REPO.id]?.worktrees.map((worktree) => worktree.id)
    ).toEqual([unstampedDetected.id, remoteDetected.id])
  })
})
