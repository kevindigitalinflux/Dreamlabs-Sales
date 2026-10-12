// supabase/functions/_shared/knownPersonWideRun.ts
// Step order and trust rules for the wider known-person lookup. Providers are passed in, so this only imports the
// equally pure knownPerson.ts / knownPersonWide.ts and runs in both Deno and Vitest.
import { emailOnDomain, plainLookupError, type FoundFields, type LookupFailure } from './knownPerson.ts';
import {
  STEP_DETAILS, SUGGESTION_LABELS, buildPatternEmail, emailDomain, failureReason, inferPattern, matchHunterPerson, onAnyDomain, stepResult,
  webFailureDetail,
  type StepId, type StepResult, type Suggestion, type VerifierClass,
} from './knownPersonWide.ts';

type Lookup = { ok: true; found: FoundFields } | { ok: false; failure: LookupFailure };

/** The providers one run may call. Each must never throw and must respect the timeout it is given. */
export interface WideLookupDeps {
  now: () => number;
  /** Uses the one rate-limit slot for the whole run; false when the daily limit is reached. */
  takeSlot: () => Promise<boolean>;
  hunterFind: (domain: string, first: string, last: string, timeoutMs: number) => Promise<Lookup>;
  hunterDomain: (domain: string, timeoutMs: number) => Promise<{ ok: true; emails: unknown[]; pattern: string | null } | { ok: false; failure: LookupFailure }>;
  hunterVerify: (email: string, timeoutMs: number) => Promise<{ ok: true; verdict: VerifierClass } | { ok: false; failure: LookupFailure }>;
  /** Reads the lead's website; an email is acceptable on any of `domains`. */
  scanWebsite: (website: string, domains: string[], first: string, last: string, budgetMs: number) => Promise<{ ok: true; email: string | null; linkedin_url: string | null } | { ok: false }>;
  webSearch: (timeoutMs: number) => Promise<Lookup>;
  apolloMatch: (domain: string, first: string, last: string, timeoutMs: number) => Promise<Lookup>;
  /** Fills blank fields of the saved person with what a step found and returns what was actually filled. */
  absorb: (found: FoundFields, step: StepId) => FoundFields;
}

/** Another contact's address with its owner's name, used to learn a domain's email pattern. */
export interface KnownAddress { email: string; first: string | null; last: string | null }

/** What is known before the run starts. */
export interface WideLookupInput {
  first: string;
  last: string;
  have: { email: string | null; linkedin_url: string | null; phone: string | null };
  hasApolloId: boolean;
  /** The company domains to search, in order (see candidateDomains), at most 3. */
  domains: string[];
  /** The lead's own website when it is a usable company site, else null. */
  website: string | null;
  /** True when the lead's website is a social network or directory page. */
  websiteDirectory: boolean;
  /** Other contacts' addresses, for learning a domain's pattern when Hunter has none. */
  knownAddresses?: KnownAddress[];
  usePaid: boolean;
  keys: { hunter: boolean; apollo: boolean; gemini: boolean };
  /** Whole-run wall-time budget for every step except the web search. */
  budgetMs?: number;
  /** Extra time the web search (always the last step) may use beyond budgetMs. */
  webExtraMs?: number;
}

/** What the run did. */
export interface WideLookupOutcome {
  steps: StepResult[];
  suggestions: Suggestion[];
  hunterCalled: boolean;
  apolloCalled: boolean;
  limitReached: boolean;
}

export const WIDE_BUDGET_MS = 20_000;
/** The web search runs last and may use this much more than WIDE_BUDGET_MS, so it is not starved by earlier steps. */
export const WEB_EXTRA_MS = 10_000;
const WEB_MAX_MS = 15_000;
const MAX_DOMAINS = 3;
const MIN_START_MS: Record<StepId, number> = {
  hunter_finder: 1_500, hunter_domain: 1_500, pattern: 1_500, website: 3_000, web: 4_000, apollo: 2_000,
};

/** The single pattern other contacts' addresses on `domain` agree on, or null. */
export function patternFromAddresses(addresses: KnownAddress[], domain: string): string | null {
  const found = new Set<string>();
  for (const a of addresses) {
    if (emailDomain(a.email) !== domain) continue;
    const p = inferPattern(a.email, a.first, a.last);
    if (p) found.add(p);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * Runs the steps cheapest first: for each company domain in turn (stopping once the person's email is found)
 * Hunter finder, Hunter company list and the email pattern (Hunter's, or one learned from another contact's address
 * on that domain) with Hunter's verifier; then the lead's website, web search and Apollo. Each step only works on
 * blank fields; later steps are skipped once email AND LinkedIn are filled; one rate-limit slot covers the whole
 * run; every call gets its own timeout inside the overall budget. A failing step becomes a step status and never
 * stops the next one. Web-search finds and unverified pattern guesses are never saved: they become suggestions.
 */
export async function runWideLookup(input: WideLookupInput, deps: WideLookupDeps): Promise<WideLookupOutcome> {
  const budget = input.budgetMs ?? WIDE_BUDGET_MS;
  const start = deps.now();
  const remaining = () => budget - (deps.now() - start);
  const webRemaining = () => budget + (input.webExtraMs ?? WEB_EXTRA_MS) - (deps.now() - start);
  const state = { ...input.have };
  const { first, last } = input;
  const domains = input.domains.slice(0, MAX_DOMAINS);
  const hasName = first.trim() !== '' && last.trim() !== '';
  const bothDone = () => !!state.email && !!state.linkedin_url;
  const steps: StepResult[] = [];
  const suggestions: Suggestion[] = [];
  let hunterCalled = false;
  let apolloCalled = false;
  const absorb = (found: FoundFields, step: StepId): FoundFields => {
    const applied = deps.absorb(found, step);
    if (applied.email) state.email = applied.email;
    if (applied.linkedin_url) state.linkedin_url = applied.linkedin_url;
    if (applied.phone) state.phone = applied.phone;
    return applied;
  };
  const filledAny = (a: FoundFields) => !!(a.email || a.linkedin_url || a.phone);
  const t = (cap: number) => Math.max(1, Math.min(cap, remaining()));
  const noDomain = () => stepResult('hunter_finder', 'skipped', input.websiteDirectory ? STEP_DETAILS.directory : STEP_DETAILS.noDomain);

  /** Why a step cannot run at all (before any call is made), or null. */
  const blockedBy = (id: StepId): StepResult | null => {
    if (id !== 'website' && !input.usePaid) return stepResult(id, 'skipped', STEP_DETAILS.paidOff);
    if ((id === 'hunter_finder' || id === 'hunter_domain' || id === 'pattern') && !input.keys.hunter) return stepResult(id, 'unavailable', STEP_DETAILS.noKeyHunter, undefined, 'no_key');
    if (id === 'web' && !input.keys.gemini) return stepResult(id, 'unavailable', STEP_DETAILS.noKeyGemini, undefined, 'no_key');
    if (id === 'apollo' && !input.keys.apollo) return stepResult(id, 'unavailable', STEP_DETAILS.noKeyApollo, undefined, 'no_key');
    if (id === 'website') {
      if (!input.website) return stepResult(id, 'skipped', input.websiteDirectory ? STEP_DETAILS.directory : STEP_DETAILS.noWebsite);
    } else if (domains.length === 0) {
      return { ...noDomain(), id, label: stepResult(id, 'skipped', '').label };
    }
    if (id === 'apollo' ? first.trim() === '' : !hasName) return stepResult(id, 'skipped', STEP_DETAILS.needName);
    if (id === 'apollo' && input.hasApolloId) return stepResult(id, 'skipped', STEP_DETAILS.alreadyFilled);
    return null;
  };
  const notNeeded = (id: StepId): boolean => (id === 'hunter_finder' || id === 'pattern' ? !!state.email : bothDone());

  const hunterIds: StepId[] = ['hunter_finder', 'hunter_domain', 'pattern'];
  // The web search is last: it is the slowest step and has its own extra time (webExtraMs).
  const laterIds: StepId[] = ['website', 'apollo', 'web'];
  const wouldRun = [...hunterIds, ...laterIds].some((id) => !blockedBy(id) && !notNeeded(id));
  let limitReached = false;
  if (wouldRun) {
    let allowed = false;
    try { allowed = await deps.takeSlot(); } catch { allowed = false; }
    limitReached = !allowed;
  }

  /** Runs one step with the shared skip rules; `run` does the work. */
  const attempt = async (id: StepId, domain: string | undefined, run: () => Promise<StepResult>) => {
    if (notNeeded(id)) { steps.push(stepResult(id, 'skipped', STEP_DETAILS.alreadyFilled, domain)); return; }
    if (limitReached) { steps.push(stepResult(id, 'skipped', STEP_DETAILS.limit, domain, 'rate_limited')); return; }
    if (id === 'web' ? webRemaining() < MIN_START_MS.web : remaining() < MIN_START_MS[id]) {
      steps.push(stepResult(id, 'skipped', id === 'web' ? STEP_DETAILS.webSkippedTime : STEP_DETAILS.timeUp, domain));
      return;
    }
    try { steps.push(await run()); } catch { steps.push(stepResult(id, 'error', STEP_DETAILS.failed, domain, 'network')); }
  };

  // (1-3) Hunter, once per company domain
  const hunterBlocked = blockedBy('hunter_finder');
  if (hunterBlocked) {
    for (const id of hunterIds) steps.push({ ...hunterBlocked, id, label: stepResult(id, 'skipped', '').label });
  } else {
    for (const [i, d] of domains.entries()) {
      if (i > 0 && state.email) break; // the person's email is found: stop searching more domains
      let listPattern: string | null = null;
      let listRan = false;
      await attempt('hunter_finder', d, async () => {
        hunterCalled = true;
        const res = await deps.hunterFind(d, first, last, t(5_000));
        if (!res.ok) return stepResult('hunter_finder', 'error', plainLookupError('hunter', res.failure), d, failureReason(res.failure));
        const email = res.found.email && emailOnDomain(res.found.email, d) ? res.found.email : undefined;
        return filledAny(absorb(email ? { email } : {}, 'hunter_finder'))
          ? stepResult('hunter_finder', 'found', STEP_DETAILS.hunterFinderFound(d), d)
          : stepResult('hunter_finder', 'no_match', STEP_DETAILS.hunterFinderNone(d), d);
      });
      await attempt('hunter_domain', d, async () => {
        hunterCalled = true;
        const res = await deps.hunterDomain(d, t(5_000));
        if (!res.ok) return stepResult('hunter_domain', 'error', plainLookupError('hunter', res.failure), d, failureReason(res.failure));
        listRan = true;
        listPattern = res.pattern;
        const match = matchHunterPerson(res.emails, first, last);
        if (match.status === 'ambiguous') return stepResult('hunter_domain', 'no_match', STEP_DETAILS.domainAmbiguous(last, d), d);
        if (match.status === 'none' || !emailOnDomain(match.email, d)) return stepResult('hunter_domain', 'no_match', STEP_DETAILS.domainNone(last, d), d);
        const found: FoundFields = { email: match.email };
        if (match.linkedin_url) found.linkedin_url = match.linkedin_url;
        return filledAny(absorb(found, 'hunter_domain'))
          ? stepResult('hunter_domain', 'found', STEP_DETAILS.domainFound(last, d), d)
          : stepResult('hunter_domain', 'no_match', STEP_DETAILS.domainNothingNew(last, d), d);
      });
      const learned = listPattern ? null : patternFromAddresses(input.knownAddresses ?? [], d);
      const pattern = listPattern ?? learned;
      if (!pattern && !listRan && !state.email) { steps.push(stepResult('pattern', 'skipped', STEP_DETAILS.noPattern(d), d)); continue; }
      await attempt('pattern', d, async () => {
        const guess = pattern ? buildPatternEmail(pattern, first, last, d) : null;
        if (!guess) return stepResult('pattern', 'no_match', STEP_DETAILS.patternNone(d), d);
        const other = !listPattern;
        hunterCalled = true;
        const v = await deps.hunterVerify(guess, t(5_000));
        if (v.ok && v.verdict === 'invalid') {
          return stepResult('pattern', 'no_match', other ? STEP_DETAILS.otherPatternInvalid(d) : STEP_DETAILS.patternInvalid(d), d);
        }
        if (v.ok && v.verdict === 'verified') {
          return absorb({ email: guess }, 'pattern').email
            ? stepResult('pattern', 'found', other ? STEP_DETAILS.otherPatternVerified(d) : STEP_DETAILS.patternVerified(d), d)
            : stepResult('pattern', 'no_match', STEP_DETAILS.patternNothingNew(d), d);
        }
        suggestions.push({ field: 'email', value: guess, label: SUGGESTION_LABELS.guess });
        return stepResult('pattern', 'found', other ? STEP_DETAILS.otherPatternGuess(d) : STEP_DETAILS.patternGuess(d), d);
      });
    }
  }

  // (4-6) the lead's website, web search, Apollo
  for (const id of laterIds) {
    const blocked = blockedBy(id);
    if (blocked) { steps.push(blocked); continue; }
    await attempt(id, undefined, () => runLater(id));
  }

  async function runLater(id: StepId): Promise<StepResult> {
    if (id === 'website') {
      const res = await deps.scanWebsite(input.website as string, domains, first, last, t(8_000));
      if (!res.ok) return stepResult(id, 'error', STEP_DETAILS.websiteUnreadable, undefined, 'network');
      const found: FoundFields = {};
      if (res.email && onAnyDomain(res.email, domains)) found.email = res.email;
      if (res.linkedin_url) found.linkedin_url = res.linkedin_url;
      return filledAny(absorb(found, id)) ? stepResult(id, 'found', STEP_DETAILS.websiteFound) : stepResult(id, 'no_match', STEP_DETAILS.websiteNone);
    }
    if (id === 'web') {
      const res = await deps.webSearch(Math.max(1, Math.min(WEB_MAX_MS, webRemaining())));
      if (!res.ok) {
        const reason = failureReason(res.failure);
        return stepResult(id, 'error', webFailureDetail(reason), undefined, reason);
      }
      let any = false;
      if (res.found.email && !state.email && onAnyDomain(res.found.email, domains)) {
        suggestions.push({ field: 'email', value: res.found.email, label: SUGGESTION_LABELS.web });
        any = true;
      }
      if (res.found.linkedin_url && !state.linkedin_url) {
        suggestions.push({ field: 'linkedin_url', value: res.found.linkedin_url, label: SUGGESTION_LABELS.web });
        any = true;
      }
      return any ? stepResult(id, 'found', STEP_DETAILS.webFound) : stepResult(id, 'no_match', STEP_DETAILS.webNone);
    }
    apolloCalled = true;
    const res = await deps.apolloMatch(domains[0]!, first, last, t(8_000));
    if (!res.ok) {
      if (res.failure === 401) return stepResult(id, 'unavailable', STEP_DETAILS.apolloKeyRejected, undefined, failureReason(401));
      if (res.failure === 402 || res.failure === 403) return stepResult(id, 'unavailable', STEP_DETAILS.apolloUnavailable, undefined, failureReason(res.failure));
      return stepResult(id, 'error', plainLookupError('apollo', res.failure), undefined, failureReason(res.failure));
    }
    return filledAny(absorb(res.found, id)) ? stepResult(id, 'found', STEP_DETAILS.apolloFound) : stepResult(id, 'no_match', STEP_DETAILS.apolloNone);
  }

  // Suggestions only for fields that are still blank, one per value.
  const seen = new Set<string>();
  const kept = suggestions.filter((s) => {
    const key = `${s.field}:${s.value.toLowerCase()}`;
    if (state[s.field] || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { steps, suggestions: kept, hunterCalled, apolloCalled, limitReached };
}
