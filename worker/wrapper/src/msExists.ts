import { normaliseEmail } from './verifyEmail.js'

export type MsExists = 'exists' | 'not_found' | 'unknown'

/** Unknown or throttled replies never establish mailbox existence. */
export function mapMsReply(raw: unknown): MsExists {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unknown'
  const reply = raw as Record<string, unknown>
  if (reply.ThrottleStatus !== 0) return 'unknown'
  if ([0, 5, 6].includes(reply.IfExistsResult as number)) return 'exists'
  return reply.IfExistsResult === 1 ? 'not_found' : 'unknown'
}

export async function msExists(email: string, deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<{ email: string; result: MsExists }> {
  const parsed = normaliseEmail(email)
  const address = parsed?.email ?? email.trim().toLowerCase()
  if (!parsed) return { email: address, result: 'unknown' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000)
  try {
    const response = await (deps.fetchImpl ?? fetch)('https://login.microsoftonline.com/common/GetCredentialType', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: address, isOtherIdpSupported: true }),
    })
    return { email: address, result: response.status === 200 ? mapMsReply(await response.json()) : 'unknown' }
  } catch {
    // Do not log the address or provider response, including exception payloads.
    console.error('Microsoft mailbox check unavailable')
    return { email: address, result: 'unknown' }
  } finally {
    clearTimeout(timer)
  }
}
