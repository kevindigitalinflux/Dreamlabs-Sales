// supabase/functions/_shared/deepFindProblems.ts
// Turns the search steps that gave no answer into one plain-English line each ("Hunter company search (loveliving):
// Hunter refused the request (error 429, too many requests, try again later)"). Imports only import-free modules:
// tested from src/lib. Only fixed sentences, safe failure codes and cleaned names or domains ever reach a line.
import { HUNTER_RATE_LIMITED_LINE, HUNTER_USAGE_EXHAUSTED_LINE } from './hunterLimits.ts';

/** One step that gave no answer. `failure` is a safe code: an HTTP status, timeout, network, bad_reply, no_mx, dns_error. */
export interface ProblemInput { step: string; target: string; failure: string }

/** At most this many "why" lines per lead. */
export const MAX_PROBLEM_LINES = 15;

const STEP_LABELS: Record<string, { label: (t: string) => string; provider: string }> = {
  hunter_company: { label: (t) => `Hunter company search (${t})`, provider: 'Hunter' },
  hunter_finder: { label: (t) => `Hunter email finder by company (${t})`, provider: 'Hunter' },
  hunter_list: { label: (t) => `Hunter list for ${t}`, provider: 'Hunter' },
  hunter_verify: { label: (t) => `Hunter email check on ${t}`, provider: 'Hunter' },
  domain_check: { label: (t) => `Domain check ${t}`, provider: 'DNS' },
  site_check: { label: (t) => `Website check ${t}`, provider: 'The website' },
  web: { label: () => 'Web search', provider: 'Gemini' },
  apollo: { label: (t) => `Apollo company search (${t})`, provider: 'Apollo' },
  person: { label: (t) => `Looking up ${t}`, provider: '' },
  officers: { label: () => 'Companies House officers', provider: 'Companies House' },
  save: { label: (t) => `Saving ${t}`, provider: 'The database' },
};

/** A name or domain safe for a fixed sentence: letters, digits, spaces, "&", dots and hyphens, at most 60 characters. */
function cleanTarget(t: unknown): string {
  return typeof t === 'string' ? t.replace(/[^\p{L}0-9 &.,()'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
}

/** The plain reason for one safe failure code, naming the provider for HTTP errors. */
export function problemReason(provider: string, failure: string): string {
  if (failure === 'no_mx') return 'no email set up';
  if (failure === 'dns_error') return 'the DNS check did not answer';
  if (failure === 'unreadable') return 'the website could not be read';
  if (failure === 'timeout') return 'ran out of time';
  if (failure === 'no_key') return `no ${provider} key is set`;
  if (failure === 'network') return `${provider} could not be reached`;
  if (failure === 'bad_reply') return `${provider} sent an answer that could not be read`;
  const code = /^\d{3}$/.test(failure) ? Number(failure) : NaN;
  if (code === 401) return `${provider} did not accept the saved API key (error 401)`;
  if (code === 402) return `${provider} says the plan is out of credits (error 402)`;
  if (code === 403) return `${provider} refused the request (error 403, the plan may not include it)`;
  if (code === 429) return `${provider} refused the request (error 429, too many requests, try again later)`;
  if (code >= 500) return `${provider} had a problem on its side (error ${code}), try again later`;
  if (code >= 400) return `${provider} refused the request (error ${code})`;
  return 'did not work';
}

/** The provider named in a person lookup step label ("Max Whatley, Hunter email finder"). */
function personProvider(target: string): string {
  if (/Hunter/.test(target)) return 'Hunter';
  if (/Web search/.test(target)) return 'Gemini';
  if (/Apollo/.test(target)) return 'Apollo';
  return 'The website';
}

/**
 * One line per problem, de-duplicated, at most MAX_PROBLEM_LINES (the most useful steps first, in order seen). Hunter's
 * used-up searches and "slow down" answers are each ONE fixed line, however many steps they hit.
 */
export function problemLines(problems: ProblemInput[]): string[] {
  const out: string[] = [];
  for (const p of problems.slice(0, 100)) {
    const meta = STEP_LABELS[p.step];
    if (!meta || typeof p.failure !== 'string') continue;
    const target = cleanTarget(p.target) || 'company';
    const provider = meta.provider || personProvider(target);
    const fixed = provider !== 'Hunter' ? null
      : p.failure === 'usage_exhausted' ? HUNTER_USAGE_EXHAUSTED_LINE : p.failure === 'rate_limited' ? HUNTER_RATE_LIMITED_LINE : null;
    if (fixed) { if (!out.includes(fixed)) out.push(fixed); if (out.length >= MAX_PROBLEM_LINES) break; continue; }
    const failure = p.failure === 'rate_limited' ? '429' : p.failure;
    const line = `${meta.label(target)}: ${problemReason(provider, failure)}.`;
    if (!out.includes(line)) out.push(line);
    if (out.length >= MAX_PROBLEM_LINES) break;
  }
  return out;
}

/** Credits reserved per step ({ hunter: { 'company domains': 5 }, ai: { 'web search': 1 } }). */
export interface CreditUse { hunter: Record<string, number>; ai: Record<string, number> }

/**
 * One plain line with the credits this lead used, per step: "Credits used: Hunter 9 (company domains 5, company lists
 * 4), AI 1 (web search 1)." Step names are fixed by the engine; counts are validated numbers.
 */
export function creditLine(used: CreditUse): string {
  const part = (name: string, rec: Record<string, number>) => {
    const entries = Object.entries(rec).filter(([, n]) => Number.isInteger(n) && n > 0).slice(0, 8);
    const total = entries.reduce((a, [, n]) => a + n, 0);
    if (total === 0) return `${name} 0`;
    return `${name} ${total} (${entries.map(([k, n]) => `${k.replace(/[^a-z ]/gi, '').slice(0, 30)} ${n}`).join(', ')})`;
  };
  return `Credits used: ${part('Hunter', used.hunter)}, ${part('AI', used.ai)}.`;
}
