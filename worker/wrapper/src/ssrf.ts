import { promises as dnsPromises } from 'node:dns'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

export type SsrfCode =
  | 'bad_url' | 'bad_scheme' | 'bad_credentials' | 'bad_port' | 'bad_host' | 'bad_resolved_address'
  | 'dns_failed' | 'too_many_redirects' | 'bad_content_type' | 'timeout' | 'fetch_failed'

export class SsrfError extends Error {
  constructor(public code: SsrfCode, message?: string) {
    super(message ?? code)
  }
}

// ---------- IP classification ----------
const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

const v4ToInt = (ip: string) => ip.split('.').reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0

function isPublicV4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false
  const n = v4ToInt(ip)
  return !V4_BLOCKS.some(([base, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (v4ToInt(base) & mask)
  })
}

/** Expand an IPv6 string to eight 16-bit groups, or null if it is not valid. */
function expandV6(ip: string): number[] | null {
  let s = (ip.toLowerCase().split('%')[0] ?? '')
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const v4 = dotted[1]!
    if (v4.split('.').some((p) => Number(p) > 255)) return null
    const n = v4ToInt(v4)
    s = s.slice(0, -v4.length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null
  const groups = [...head, ...(halves.length === 2 ? Array<string>(missing).fill('0') : []), ...tail]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => parseInt(g, 16))
}

function isPublicV6(ip: string): boolean {
  const g = expandV6(ip)
  if (!g) return false
  const [a, b, c, d, e, f, x, y] = g as [number, number, number, number, number, number, number, number]
  const embedded = (hi: number, lo: number) => isPublicV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  const firstFiveZero = a === 0 && b === 0 && c === 0 && d === 0 && e === 0
  if (g.every((v) => v === 0)) return false // ::
  if (g.slice(0, 7).every((v) => v === 0) && y === 1) return false // ::1
  if ((a & 0xfe00) === 0xfc00) return false // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return false // fe80::/10 link local
  if ((a & 0xff00) === 0xff00) return false // multicast
  if (a === 0x2001 && b === 0x0db8) return false // documentation
  if (firstFiveZero && f === 0xffff) return embedded(x, y) // ::ffff:a.b.c.d (IPv4-mapped)
  if (firstFiveZero && f === 0) return false // ::a.b.c.d (deprecated IPv4-compatible)
  if (a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return embedded(x, y) // NAT64
  if (a === 0x2002) return embedded(b, c) // 6to4 embeds an IPv4 address
  return true
}

export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return isPublicV4(ip)
  if (kind === 6) return isPublicV6(ip)
  return false
}

// ---------- URL validation ----------
const BAD_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.arpa']

export function parseTarget(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SsrfError('bad_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('bad_scheme')
  if (url.username || url.password) throw new SsrfError('bad_credentials')
  if (url.port && url.port !== '80' && url.port !== '443') throw new SsrfError('bad_port')

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new SsrfError('bad_host')
  } else {
    // Needs a dot (no bare "intranet") and must not use an internal-only suffix.
    if (!host.includes('.') || host === 'localhost' || BAD_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new SsrfError('bad_host')
    }
    if (/^[0-9.x]+$/i.test(host)) throw new SsrfError('bad_host') // numeric tricks the URL parser did not normalise
  }
  return url
}

// ---------- DNS pinning: the address that is checked is the address that is connected to ----------
type Resolved = Array<{ address: string; family: number }>
type Resolver = (host: string) => Promise<Resolved>

const defaultResolver: Resolver = async (host) => dnsPromises.lookup(host, { all: true, verbatim: true })

/** `lookup` option for undici's connector. Refuses unless EVERY answer is public. */
export function guardedLookup(
  host: string,
  options: { all?: boolean },
  cb: (err: Error | null, address?: unknown, family?: number) => void,
  resolver: Resolver = defaultResolver,
): void {
  resolver(host).then(
    (answers) => {
      if (answers.length === 0) return cb(new SsrfError('dns_failed'))
      if (answers.some((a) => !isPublicIp(a.address))) return cb(new SsrfError('bad_resolved_address'))
      if (options.all) return cb(null, answers)
      const first = answers[0]!
      return cb(null, first.address, first.family)
    },
    () => cb(new SsrfError('dns_failed')),
  )
}

// ---------- Fetch ----------
export type FetchImpl = (
  url: string,
  init?: { signal?: AbortSignal; redirect?: 'manual'; headers?: Record<string, string> },
) => Promise<Response>

export interface SafeFetchOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  fetchImpl?: FetchImpl
}

export interface SafeFetchResult {
  finalUrl: string
  status: number
  contentType: string
  body: string
  truncated: boolean
}

const pinnedAgent = new Agent({ connect: { lookup: guardedLookup as never }, headersTimeout: 10_000, bodyTimeout: 10_000 })
const defaultFetch: FetchImpl = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: pinnedAgent } as never) as unknown as Promise<Response>

const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json))/i

export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { maxBytes = 1_000_000, timeoutMs = 10_000, maxRedirects = 3, fetchImpl = defaultFetch } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let current = parseTarget(raw)
    for (let hop = 0; ; hop++) {
      let res: Response
      try {
        res = await fetchImpl(current.toString(), {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'user-agent': 'DreamlabsLookupBot/1.0 (+https://didreamlabs.com)',
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          },
        })
      } catch (e) {
        if (controller.signal.aborted) throw new SsrfError('timeout')
        if (e instanceof SsrfError) throw e
        const cause = (e as { cause?: unknown }).cause
        if (cause instanceof SsrfError) throw cause
        throw new SsrfError('fetch_failed')
      }

      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= maxRedirects) throw new SsrfError('too_many_redirects')
        current = parseTarget(new URL(location, current).toString())
        await res.body?.cancel()
        continue
      }

      const contentType = res.headers.get('content-type') ?? ''
      if (contentType && !TEXTUAL.test(contentType)) {
        await res.body?.cancel()
        throw new SsrfError('bad_content_type')
      }

      const reader = res.body?.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      let truncated = false
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        if (total + value.length > maxBytes) {
          chunks.push(value.slice(0, maxBytes - total))
          total = maxBytes
          truncated = true
          await reader.cancel()
          break
        }
        chunks.push(value)
        total += value.length
      }
      const body = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks))
      return { finalUrl: current.toString(), status: res.status, contentType, body, truncated }
    }
  } finally {
    clearTimeout(timer)
  }
}
