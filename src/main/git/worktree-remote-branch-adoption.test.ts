import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveTrackableRemoteBranchRef } from './worktree-remote-branch-adoption'

describe('resolveTrackableRemoteBranchRef real Git contract', () => {
  const tempPaths: string[] = []

  afterEach(() => {
    for (const path of tempPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  function createRepo(remotes: string[]): { repoPath: string; git: (...args: string[]) => string } {
    const repoPath = mkdtempSync(join(tmpdir(), 'orca-pr31645-adoption-'))
    tempPaths.push(repoPath)
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repoPath, encoding: 'utf8' })
    git('init', '--quiet')
    git('config', 'user.name', 'Orca Test')
    git('config', 'user.email', 'orca@example.test')
    git('config', 'commit.gpgSign', 'false')
    git('config', 'core.hooksPath', '.git/no-hooks')
    writeFileSync(join(repoPath, 'fixture.txt'), 'base\n')
    git('add', 'fixture.txt')
    git('commit', '--quiet', '-m', 'base')
    for (const remote of remotes) {
      git('remote', 'add', remote, 'https://example.test/repo.git')
    }
    return { repoPath, git }
  }

  it('uses a unique cached fallback, prefers a cached match, and refuses ambiguity', async () => {
    const { repoPath, git } = createRepo(['fork', 'origin'])
    const resolve = (preferred?: string): Promise<string | null> =>
      resolveTrackableRemoteBranchRef(repoPath, 'feature/test', preferred)
    await expect(resolve('origin')).resolves.toBeNull()
    git('update-ref', 'refs/remotes/fork/feature/test', 'HEAD')
    await expect(resolve('origin')).resolves.toBe('refs/remotes/fork/feature/test')
    git('update-ref', 'refs/remotes/origin/feature/test', 'HEAD')
    await expect(resolve('origin')).resolves.toBe('refs/remotes/origin/feature/test')
    await expect(resolve('fork')).resolves.toBe('refs/remotes/fork/feature/test')
    await expect(resolve()).resolves.toBeNull()
  })

  it('excludes an overlapping remote prefix and checks out the canonical cached branch', async () => {
    const { repoPath, git } = createRepo(['foo', 'foo/bar', 'other'])
    git('update-ref', 'refs/remotes/foo/bar/baz', 'HEAD')
    git('update-ref', 'refs/remotes/other/bar/baz', 'HEAD')

    const ref = await resolveTrackableRemoteBranchRef(repoPath, 'bar/baz', 'foo')
    expect(ref).toBe('refs/remotes/other/bar/baz')
    if (!ref) {
      throw new Error('Expected a canonical cached branch')
    }
    const checkoutPath = join(repoPath, 'checkout')
    git('worktree', 'add', '--quiet', '--track', '-b', 'bar/baz', checkoutPath, ref)
    expect(git('-C', checkoutPath, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe(
      'other/bar/baz'
    )
    expect(git('-C', checkoutPath, 'rev-parse', 'HEAD')).toBe(git('rev-parse', ref))
  })
})
