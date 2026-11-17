import type { SearchHit } from './workerRules.ts';
import type { WorkerClient } from './workerClient.ts';
import { judgeRolePerson, rolePeoplePrompt, type RoleCandidate, type RolePeopleInput } from './roleSearchRules.ts';

export interface SearchProvider {
  search(query: string, input?: RolePeopleInput): Promise<{ ok: true; hits: SearchHit[]; via: 'searxng' } | { ok: true; people: RoleCandidate[]; via: 'gemini' } | { ok: false; why: 'none' | 'limit' | 'cap' | 'failed' | 'busy' }>;
}

export interface RoleSearchFallbackShape {
  lines_parsed: number; profile_urls: number; sources: number; redirect_sources: number; linkedin_titled_sources: number;
  people_lines: number; people_kept: number;
}
type GroundedReply = { text: string; sources: string[]; sourceEvidence?: string[] };
const linkedinHost = (host: string) => /^(?:(?:www|[a-z]{2}(?:-[a-z]{2})?)\.)?linkedin\.com$/i.test(host);
const sourceUrl = (value: string): URL | null => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null; }
  catch { return null; }
};
// Same profile-host/path check as judgeRoleHit; this does not replace the later company/role judge.
const profileUrl = (value: string) => {
  const url = sourceUrl(value);
  return !!url && linkedinHost(url.hostname) && /^\/in\/[^/]+/.test(url.pathname);
};
const nameWords = (value: string): string[] => value.toLowerCase().match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? [];

/** Bind a chunk title and its supported segments by their exact source URI, never by page text alone. */
function groundingSources(reply: GroundedReply) {
  return reply.sources.map(uri => {
    const url = sourceUrl(uri);
    const evidence = (reply.sourceEvidence ?? []).filter(line => line.startsWith(uri + ' ')).map(line => line.slice(uri.length + 1).trim());
    const redirect = url?.hostname === 'vertexaisearch.cloud.google.com' && /^\/grounding-api-redirect\/.+/.test(url.pathname);
    const titled = linkedinHost(evidence[0] ?? '');
    return { uri, evidence, redirect, titled };
  });
}

/** Classify locally; never log an exception message, provider body, prompt or credential. */
function roleSearchFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return 'network';
  if (['AbortError', 'TimeoutError'].includes(error.name) || error.message === 'Gemini request timed out') return 'timeout';
  const status = /^Gemini ([1-5]\d{2})(?::|$)/.exec(error.message);
  if (status) return `http_${status[1]}`;
  if (error instanceof SyntaxError || error.message === 'Gemini reply could not be read') return 'bad_json';
  return 'network';
}

/** Prefer worker snippets; spend one run AI unit only for the approved fallback cases. */
export function makeSearchProvider(deps: { worker: WorkerClient; gemini?: (prompt: string) => Promise<GroundedReply>; reserveAi: () => Promise<boolean>; onSearch?: (via: 'searxng' | 'gemini') => void; onFallbackShape?: (shape: RoleSearchFallbackShape) => void }): SearchProvider {
  // The engine creates one provider per lead; only empty-result fallback is limited across its rungs.
  let emptyFallbackUsed = false;
  let workerNotConfigured = false;
  return { async search(query, input) {
    try {
      const result = workerNotConfigured ? { ok: false as const, failure: 'not_configured' as const }
        : await deps.worker.search(query).catch(error => { deps.onSearch?.('searxng'); throw error; });
      if (!result.ok && result.failure === 'not_configured') workerNotConfigured = true;
      else deps.onSearch?.('searxng');
      if (result.ok && result.value.length) return { ok: true, hits: result.value.slice(0, 8), via: 'searxng' };
      if (!result.ok && result.failure === 'limit_reached') return { ok: false, why: 'limit' };
      if (!result.ok && !['busy', 'not_configured', 'unreachable'].includes(result.failure)) return { ok: false, why: 'failed' };
      if (!deps.gemini) return { ok: false, why: 'none' };
      if (!input) return { ok: false, why: 'failed' };
      if (result.ok) {
        if (emptyFallbackUsed) return { ok: false, why: 'none' };
        emptyFallbackUsed = true;
      }
      if (!await deps.reserveAi()) return { ok: false, why: 'cap' };
      deps.onSearch?.('gemini');
      const grounded = await deps.gemini(rolePeoplePrompt(input));
      const sources = new Set(grounded.sources);
      const chunks = groundingSources(grounded);
      let linesParsed = 0, profileUrls = 0, peopleLines = 0;
      const people: RoleCandidate[] = [];
      for (const line of grounded.text.split(/\r?\n/).slice(0, 100)) {
        let hit: unknown;
        try { hit = JSON.parse(line); } catch { continue; }
        linesParsed++;
        if (!hit || typeof hit !== 'object' || Array.isArray(hit)) continue;
        const row = hit as Record<string, unknown>;
        if (typeof row.name !== 'string' || typeof row.title !== 'string' || typeof row.company !== 'string'
          || (row.linkedin_url !== null && typeof row.linkedin_url !== 'string')) continue;
        const candidate = { name: row.name.trim().slice(0, 200), title: row.title.trim().slice(0, 200), company: row.company.trim().slice(0, 300), linkedinUrl: row.linkedin_url };
        peopleLines++;
        const profile = typeof candidate.linkedinUrl === 'string' && profileUrl(candidate.linkedinUrl) ? sourceUrl(candidate.linkedinUrl) : null;
        if (profile) profileUrls++;
        const name = candidate.name.split(',')[0].trim().split(/\s+/).filter(word => !/^\p{L}\.?$/u.test(word));
        const first = (name[0] ?? '').toLowerCase(), last = (name.at(-1) ?? '').toLowerCase();
        const supportsName = (text: string) => {
          const tokens = nameWords(text);
          return tokens.includes(first) && tokens.includes(last);
        };
        const supported = name.length >= 2 ? chunks.filter(chunk => sourceUrl(chunk.uri) && chunk.evidence.some(supportsName)) : [];
        if (!grounded.sources.length || !supported.length) continue;
        const judged = judgeRolePerson({ ...candidate, evidence: supported.flatMap(chunk => chunk.evidence.filter(supportsName)).join('\n') }, input, { rung: input.rung, roles: input.roles });
        if (!judged.ok) continue;
        const linked = profile && (sources.has(profile.href) || supported.some(chunk => chunk.titled && chunk.evidence.some(supportsName)));
        if (profile && linked) { profile.protocol = 'https:'; profile.search = ''; profile.hash = ''; profile.pathname = profile.pathname.replace(/\/+$/, ''); }
        people.push({ ...judged.person, linkedinUrl: linked && profile ? profile.href : null });
        if (people.length === 8) break;
      }
      if (!people.length) deps.onFallbackShape?.({ lines_parsed: linesParsed, profile_urls: profileUrls,
        sources: grounded.sources.length, redirect_sources: chunks.filter(chunk => chunk.redirect).length,
        linkedin_titled_sources: chunks.filter(chunk => chunk.titled).length, people_lines: peopleLines, people_kept: people.length });
      return { ok: true, people, via: 'gemini' };
    } catch (error) { const code = roleSearchFailureCode(error); console.error('Role search unavailable', code); return { ok: false, why: code === 'http_429' ? 'busy' : 'failed' }; }
  } };
}
