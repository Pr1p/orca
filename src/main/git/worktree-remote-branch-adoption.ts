import { isSafeGitRefName } from '../../shared/git-status-upstream-ref'
import { listRemoteNames } from './repo-base-ref-search'
import { gitExecFileAsync } from './runner'
import { gitExecOptions, type LocalGitExecOptions } from './repo-default-base-ref'

function remoteBranchRef(remote: string, branchName: string): string | null {
  const ref = `refs/remotes/${remote}/${branchName}`
  return isSafeGitRefName(ref) ? ref : null
}

async function hasRemoteBranchRef(
  repoPath: string,
  ref: string,
  options: LocalGitExecOptions
): Promise<boolean> {
  try {
    const { stdout } = await gitExecFileAsync(
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      {
        ...gitExecOptions(repoPath, options)
      }
    )
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Finds one safe remote-tracking ref for an explicitly requested local branch. */
export async function resolveTrackableRemoteBranchRef(
  repoPath: string,
  branchName: string,
  preferredRemote: string | undefined,
  options: LocalGitExecOptions = {}
): Promise<string | null> {
  if (branchName.startsWith('-') || !isSafeGitRefName(`refs/heads/${branchName}`)) {
    return null
  }
  const remoteNames = await listRemoteNames(repoPath, options)
  const candidates = [
    ...(preferredRemote ? [preferredRemote] : []),
    ...remoteNames.filter((remote) => remote !== preferredRemote)
  ]
    .map((remote) => remoteBranchRef(remote, branchName))
    .filter((ref): ref is string => ref !== null)
  const matches = (
    await Promise.all(
      candidates.map(async (ref) =>
        (await hasRemoteBranchRef(repoPath, ref, options)) ? ref : null
      )
    )
  ).filter((ref): ref is string => ref !== null)

  if (preferredRemote) {
    const preferredRef = remoteBranchRef(preferredRemote, branchName)
    if (preferredRef && matches.includes(preferredRef)) {
      return preferredRef
    }
  }
  return matches.length === 1 ? matches[0] : null
}
