export interface SearchResult { title: string; url: string; snippet: string }
type SearchAnswer = { ok: true; results: SearchResult[] } | { ok: false; error: 'timeout' | 'upstream' | 'throttled' | 'bad_response' }

/** Read bounded search snippets only. Never fetch a result URL or log a query. */
export async function searchWeb(query: string, deps: { searxUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number; limit?: number }): Promise<SearchAnswer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 12_000)
  try {
    const url = new URL('/search', deps.searxUrl)
    url.search = new URLSearchParams({ q: query, format: 'json', language: 'en', safesearch: '0' }).toString()
    const res = await (deps.fetchImpl ?? fetch)(url, { signal: controller.signal, redirect: 'error' })
    if (res.status === 429) return { ok: false, error: 'throttled' }
    if (!res.ok) return { ok: false, error: 'upstream' }
    let json: unknown
    try { json = await res.json() } catch { return { ok: false, error: controller.signal.aborted ? 'timeout' : 'bad_response' } }
    if (!json || typeof json !== 'object' || !('results' in json) || !Array.isArray(json.results)) return { ok: false, error: 'bad_response' }
    const results: SearchResult[] = []
    const limit = Math.min(8, Math.max(0, deps.limit ?? 8))
    for (const item of json.results) {
      if (!item || typeof item !== 'object' || typeof item.title !== 'string' || typeof item.url !== 'string' || typeof item.content !== 'string') continue
      let target: URL
      try { target = new URL(item.url) } catch { continue }
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) continue
      if (results.length >= limit) break
      results.push({ title: item.title.trim().slice(0, 200), url: target.href, snippet: item.content.trim().slice(0, 400) })
    }
    if (!results.length && 'unresponsive_engines' in json && Array.isArray(json.unresponsive_engines)) {
      const unavailable = new Set(json.unresponsive_engines.filter(Array.isArray).map(item => item[0]))
      if (['google', 'bing', 'duckduckgo', 'brave', 'startpage', 'mojeek'].every(engine => unavailable.has(engine))) return { ok: false, error: 'throttled' }
    }
    return { ok: true, results }
  } catch (error) {
    return { ok: false, error: controller.signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'upstream' }
  } finally { clearTimeout(timer) }
}
