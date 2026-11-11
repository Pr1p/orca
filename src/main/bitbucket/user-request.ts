import { authHeaders, type BitbucketAuthConfig } from './bitbucket-auth-config'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'

const USER_REQUEST_TIMEOUT_MS = 4000

export type RawBitbucketUser = {
  username?: string | null
  display_name?: string | null
  account_id?: string | null
}

/** Network, server and decode failures do not prove the credentials are invalid. */
export type BitbucketUserResult =
  // A null user means the credential authenticated but the token lacks the scope to read /user;
  // repository and pull-request access can still work (#40476).
  { ok: true; user: RawBitbucketUser | null } | { ok: false; reason: 'rejected' | 'unreachable' }

export function accountNameFromUser(user: RawBitbucketUser | null): string | null {
  return user?.username ?? user?.display_name ?? user?.account_id ?? null
}

export async function fetchBitbucketUserResult(
  config: BitbucketAuthConfig,
  timeoutMs: number = USER_REQUEST_TIMEOUT_MS
): Promise<BitbucketUserResult> {
  let response: Response
  try {
    const base = config.baseUrl.replace(/\/+$/, '')
    response = await fetch(`${base}/user`, {
      headers: {
        Accept: 'application/json',
        ...authHeaders(config)
      },
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    // Bitbucket 401s invalid credentials; a 403 proves the pair authenticated and only the
    // scope is missing, so the credential is usable for repo endpoints (#40476).
    if (response.status === 401) {
      return { ok: false, reason: 'rejected' }
    }
    if (response.status === 403) {
      return { ok: true, user: null }
    }
    return { ok: false, reason: 'unreachable' }
  }
  try {
    return { ok: true, user: (await response.json()) as RawBitbucketUser }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}
