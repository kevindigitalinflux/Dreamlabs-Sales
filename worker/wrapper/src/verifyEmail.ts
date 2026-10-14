import { RateLimiter } from './rateLimit.js'

export type VerifyStatus = 'valid' | 'invalid' | 'risky' | 'unverifiable'

export interface VerifyResult {
  email: string
  status: VerifyStatus
  /** Short, fixed reason code. Never raw provider text. */
  reason:
    | 'deliverable' | 'bad_syntax' | 'no_mail_server' | 'mailbox_missing' | 'mailbox_disabled'
    | 'catch_all' | 'disposable' | 'full_inbox' | 'role_account' | 'provider_blocks_checks' | 'unknown' | 'checker_error'
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([a-z0-9-]{1,63}\.)+[a-z]{2,24}$/

/** Lowercases and validates. Returns null for anything that is not a plain mailbox@domain address. */
export function normaliseEmail(raw: unknown): { email: string; domain: string } | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) return null
  return { email, domain: email.slice(email.lastIndexOf('@') + 1) }
}

interface ReacherReply {
  is_reachable?: string
  syntax?: { is_valid_syntax?: boolean }
  mx?: { accepts_mail?: boolean }
  smtp?: { can_connect_smtp?: boolean; has_full_inbox?: boolean; is_catch_all?: boolean; is_deliverable?: boolean; is_disabled?: boolean }
  misc?: { is_disposable?: boolean; is_role_account?: boolean }
}

/** Turns Reacher's answer into our small, honest label set. Anything unsure is "unverifiable", never "valid". */
export function mapReacher(email: string, reply: unknown): VerifyResult {
  const r = (reply && typeof reply === 'object' ? reply : {}) as ReacherReply
  const done = (status: VerifyStatus, reason: VerifyResult['reason']): VerifyResult => ({ email, status, reason })

  if (r.syntax?.is_valid_syntax === false) return done('invalid', 'bad_syntax')
  if (r.mx?.accepts_mail === false) return done('invalid', 'no_mail_server')
  if (r.misc?.is_disposable) return done('risky', 'disposable')
  if (r.smtp?.is_disabled) return done('invalid', 'mailbox_disabled')
  if (r.is_reachable === 'invalid') return done('invalid', 'mailbox_missing')
  if (r.smtp?.is_catch_all) return done('unverifiable', 'catch_all')
  if (r.smtp?.has_full_inbox) return done('risky', 'full_inbox')
  if (r.is_reachable === 'safe' && r.smtp?.is_deliverable) {
    return r.misc?.is_role_account ? done('risky', 'role_account') : done('valid', 'deliverable')
  }
  if (r.smtp && r.smtp.can_connect_smtp === false) return done('unverifiable', 'provider_blocks_checks')
  return done('unverifiable', 'unknown')
}

export interface VerifyDeps {
  reacherUrl: string
  reacherSecret?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function verifyEmail(email: string, deps: VerifyDeps): Promise<VerifyResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 30_000)
  try {
    const res = await fetchImpl(`${deps.reacherUrl}/v0/check_email`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(deps.reacherSecret ? { 'x-reacher-secret': deps.reacherSecret } : {}) },
      body: JSON.stringify({ to_email: email }),
    })
    if (!res.ok) return { email, status: 'unverifiable', reason: 'checker_error' }
    return mapReacher(email, await res.json())
  } catch {
    return { email, status: 'unverifiable', reason: 'checker_error' }
  } finally {
    clearTimeout(timer)
  }
}

/** Per-domain politeness: a handful of checks a minute per domain keeps the VPS IP off blocklists. */
export const makeDomainThrottle = (perMinute = 5, now?: () => number) => new RateLimiter(perMinute, 60_000, now)
