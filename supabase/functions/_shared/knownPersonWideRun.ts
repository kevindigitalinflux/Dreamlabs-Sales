// supabase/functions/_shared/knownPersonWideRun.ts
// Step order and trust rules for the wider known-person lookup. Providers are passed in, so this only imports the
// equally pure knownPerson.ts / knownPersonWide.ts and runs in both Deno and Vitest.
import { emailOnDomain, plainLookupError, type FoundFields, type LookupFailure } from './knownPerson.ts';
import {
  STEP_DETAILS, SUGGESTION_LABELS, buildPatternEmail, matchHunterPerson, stepResult,
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
  scanWebsite: (website: string, domain: string, first: string, last: string, budgetMs: number) => Promise<{ ok: true; email: string | null; linkedin_url: string | null } | { ok: false }>;
  webSearch: (timeoutMs: number) => Promise<Lookup>;
  apolloMatch: (domain: string, first: string, last: string, timeoutMs: number) => Promise<Lookup>;
  /** Fills blank fields of the saved person with what a step found and returns what was actually filled. */
  absorb: (found: FoundFields, step: StepId) => FoundFields;
}

/** What is known before the run starts. */
export interface WideLookupInput {
  first: string;
  last: string;
  have: { email: string | null; linkedin_url: string | null; phone: string | null };
  hasApolloId: boolean;
  /** The lead's public domain, or null when it has none. */
  domain: string | null;
  /** True when the domain is a social network or directory page. */
  directory: boolean;
  website: string | null;
  usePaid: boolean;
  keys: { hunter: boolean; apollo: boolean; gemini: boolean };
  /** Whole-run wall-time budget. */
  budgetMs?: number;
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
const MIN_START_MS = { hunter: 1_500, website: 3_000, web: 4_000, apollo: 2_000 };

/**
 * Runs the six steps in order (Hunter finder, Hunter company list, email pattern, the company website, web search,
 * Apollo), cheapest first. Each step only works on blank fields; later steps are skipped once email AND LinkedIn
 * are filled; one rate-limit slot covers the whole run; every step gets its own timeout inside the overall budget.
 * A failing step becomes a step status and never stops the next step. Web-search finds and unverified pattern
 * guesses are never saved: they come back as suggestions.
 */
export async function runWideLookup(input: WideLookupInput, deps: WideLookupDeps): Promise<WideLookupOutcome> {
  const budget = input.budgetMs ?? WIDE_BUDGET_MS;
  const start = deps.now();
  const remaining = () => budget - (deps.now() - start);
  const state = { ...input.have };
  const { first, last, domain } = input;
  const hasName = first.trim() !== '' && last.trim() !== '';
  const domainOk = domain !== null && !input.directory;
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

  /** Why a step cannot run at all (before any call is made), or null. */
  const blockedBy = (id: StepId): StepResult | null => {
    const paid = id !== 'website';
    if (paid && !input.usePaid) return stepResult(id, 'skipped', STEP_DETAILS.paidOff);
    if ((id === 'hunter_finder' || id === 'hunter_domain' || id === 'pattern') && !input.keys.hunter) return stepResult(id, 'unavailable', STEP_DETAILS.noKeyHunter);
    if (id === 'web' && !input.keys.gemini) return stepResult(id, 'unavailable', STEP_DETAILS.noKeyGemini);
    if (id === 'apollo' && !input.keys.apollo) return stepResult(id, 'unavailable', STEP_DETAILS.noKeyApollo);
    if (input.directory) return stepResult(id, 'skipped', STEP_DETAILS.directory);
    if (!domainOk || (id === 'website' && !input.website)) return stepResult(id, 'skipped', STEP_DETAILS.noWebsite);
    if (id === 'apollo' ? first.trim() === '' : !hasName) return stepResult(id, 'skipped', STEP_DETAILS.needName);
    if (id === 'apollo' && input.hasApolloId) return stepResult(id, 'skipped', STEP_DETAILS.alreadyFilled);
    return null;
  };
  const notNeeded = (id: StepId): boolean => {
    if (id === 'hunter_finder' || id === 'pattern') return !!state.email;
    return bothDone();
  };

  const order: StepId[] = ['hunter_finder', 'hunter_domain', 'pattern', 'website', 'web', 'apollo'];
  const wouldRun = order.some((id) => !blockedBy(id) && !notNeeded(id));
  let limitReached = false;
  if (wouldRun) {
    let allowed = false;
    try { allowed = await deps.takeSlot(); } catch { allowed = false; }
    limitReached = !allowed;
  }

  let pattern: string | null = null;
  let domainListRan = false;
  for (const id of order) {
    const blocked = blockedBy(id);
    if (blocked) { steps.push(blocked); continue; }
    if (notNeeded(id)) { steps.push(stepResult(id, 'skipped', STEP_DETAILS.alreadyFilled)); continue; }
    if (limitReached) { steps.push(stepResult(id, 'skipped', STEP_DETAILS.limit)); continue; }
    if (id === 'pattern' && !domainListRan) { steps.push(stepResult(id, 'skipped', STEP_DETAILS.noPattern)); continue; }
    const minStart = id === 'website' ? MIN_START_MS.website : id === 'web' ? MIN_START_MS.web : id === 'apollo' ? MIN_START_MS.apollo : MIN_START_MS.hunter;
    if (remaining() < minStart) { steps.push(stepResult(id, 'skipped', STEP_DETAILS.timeUp)); continue; }
    try {
      steps.push(await runStep(id));
    } catch {
      steps.push(stepResult(id, 'error', STEP_DETAILS.failed));
    }
  }

  async function runStep(id: StepId): Promise<StepResult> {
    const d = domain as string;
    const t = (cap: number) => Math.max(1, Math.min(cap, remaining()));
    switch (id) {
      case 'hunter_finder': {
        hunterCalled = true;
        const res = await deps.hunterFind(d, first, last, t(5_000));
        if (!res.ok) return stepResult(id, 'error', plainLookupError('hunter', res.failure));
        const email = res.found.email && emailOnDomain(res.found.email, d) ? res.found.email : undefined;
        return filledAny(absorb(email ? { email } : {}, id))
          ? stepResult(id, 'found', STEP_DETAILS.hunterFinderFound)
          : stepResult(id, 'no_match', STEP_DETAILS.hunterFinderNone);
      }
      case 'hunter_domain': {
        hunterCalled = true;
        const res = await deps.hunterDomain(d, t(5_000));
        if (!res.ok) return stepResult(id, 'error', plainLookupError('hunter', res.failure));
        domainListRan = true;
        pattern = res.pattern;
        const match = matchHunterPerson(res.emails, first, last);
        if (match.status === 'ambiguous') return stepResult(id, 'no_match', STEP_DETAILS.domainAmbiguous(last));
        if (match.status === 'none' || !emailOnDomain(match.email, d)) return stepResult(id, 'no_match', STEP_DETAILS.domainNone(last));
        const found: FoundFields = { email: match.email };
        if (match.linkedin_url) found.linkedin_url = match.linkedin_url;
        return filledAny(absorb(found, id))
          ? stepResult(id, 'found', STEP_DETAILS.domainFound(last))
          : stepResult(id, 'no_match', STEP_DETAILS.domainNothingNew(last));
      }
      case 'pattern': {
        const guess = pattern ? buildPatternEmail(pattern, first, last, d) : null;
        if (!guess) return stepResult(id, 'no_match', STEP_DETAILS.patternNone);
        hunterCalled = true;
        const v = await deps.hunterVerify(guess, t(5_000));
        if (v.ok && v.verdict === 'invalid') return stepResult(id, 'no_match', STEP_DETAILS.patternInvalid);
        if (v.ok && v.verdict === 'verified') {
          return absorb({ email: guess }, id).email
            ? stepResult(id, 'found', STEP_DETAILS.patternVerified)
            : stepResult(id, 'no_match', STEP_DETAILS.patternNothingNew);
        }
        suggestions.push({ field: 'email', value: guess, label: SUGGESTION_LABELS.guess });
        return stepResult(id, 'found', STEP_DETAILS.patternGuess);
      }
      case 'website': {
        const res = await deps.scanWebsite(input.website as string, d, first, last, t(8_000));
        if (!res.ok) return stepResult(id, 'error', STEP_DETAILS.websiteUnreadable);
        const found: FoundFields = {};
        if (res.email && emailOnDomain(res.email, d)) found.email = res.email;
        if (res.linkedin_url) found.linkedin_url = res.linkedin_url;
        return filledAny(absorb(found, id))
          ? stepResult(id, 'found', STEP_DETAILS.websiteFound)
          : stepResult(id, 'no_match', STEP_DETAILS.websiteNone);
      }
      case 'web': {
        const res = await deps.webSearch(t(10_000));
        if (!res.ok) return stepResult(id, 'error', STEP_DETAILS.webFailed);
        let any = false;
        if (res.found.email && !state.email && emailOnDomain(res.found.email, d)) {
          suggestions.push({ field: 'email', value: res.found.email, label: SUGGESTION_LABELS.web });
          any = true;
        }
        if (res.found.linkedin_url && !state.linkedin_url) {
          suggestions.push({ field: 'linkedin_url', value: res.found.linkedin_url, label: SUGGESTION_LABELS.web });
          any = true;
        }
        return any ? stepResult(id, 'found', STEP_DETAILS.webFound) : stepResult(id, 'no_match', STEP_DETAILS.webNone);
      }
      case 'apollo': {
        apolloCalled = true;
        const res = await deps.apolloMatch(d, first, last, t(8_000));
        if (!res.ok) {
          if (res.failure === 401) return stepResult(id, 'unavailable', STEP_DETAILS.apolloKeyRejected);
          if (res.failure === 402 || res.failure === 403) return stepResult(id, 'unavailable', STEP_DETAILS.apolloUnavailable);
          return stepResult(id, 'error', plainLookupError('apollo', res.failure));
        }
        return filledAny(absorb(res.found, id))
          ? stepResult(id, 'found', STEP_DETAILS.apolloFound)
          : stepResult(id, 'no_match', STEP_DETAILS.apolloNone);
      }
    }
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
