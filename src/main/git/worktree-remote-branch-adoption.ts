import { isSafeGitRefName } from '../../shared/git-status-upstream-ref'
import { listRemoteNames } from './repo-base-ref-search'
import { buildRemoteBranchRefs } from './repo-branch-conflict'
import { probeExactRefs } from './exact-ref-probe'
import { gitExecFileAsync } from './runner'
import { gitExecOptions, type LocalGitExecOptions } from './repo-default-base-ref'

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
  const candidates = buildRemoteBranchRefs(remoteNames, branchName)
  const { presentRefs: matches } = await probeExactRefs(
    (argv) => gitExecFileAsync(argv, gitExecOptions(repoPath, options)),
    candidates
  )

  if (preferredRemote) {
    const preferredRef = `refs/remotes/${preferredRemote}/${branchName}`
    if (matches.includes(preferredRef)) {
      return preferredRef
    }
  }
  return matches.length === 1 ? matches[0] : null
}
