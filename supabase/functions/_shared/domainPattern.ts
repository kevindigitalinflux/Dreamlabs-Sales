// supabase/functions/_shared/domainPattern.ts
// Works out a company's email format (first@, first.last@, flast@ ...) from addresses we already know on one of its
// confirmed domains, and builds candidate addresses for people we are looking for. Imports only import-free modules
// (tested from src/lib). A built address is a GUESS until Hunter's verifier says it is valid.
import { buildPatternEmail, inferPattern } from './knownPersonWide.ts';

/** A known address and, when known, whose it is. */
export interface PatternSample { email: string; first: string | null; last: string | null }

/** A person's name only (for trying site addresses against). */
export interface NamedPerson { first: string; last: string }

/** The format and how many addresses agree with it. */
export interface DomainPattern { pattern: string; evidence: number }

const onDomain = (email: string, domain: string) => email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);

/**
 * Infers the format from (a) addresses whose owner is known and (b) addresses with no owner, tried against the people
 * we know (an address only counts for a person when exactly one known format turns their name into it). Unambiguous
 * only: when the addresses point at two different formats, null. At most 40 samples and 20 people are read.
 */
export function inferDomainPattern(domain: string, samples: PatternSample[], people: NamedPerson[]): DomainPattern | null {
  const counts = new Map<string, number>();
  const add = (p: string | null) => { if (p) counts.set(p, (counts.get(p) ?? 0) + 1); };
  for (const s of samples.slice(0, 40)) {
    if (typeof s.email !== 'string' || !onDomain(s.email, domain)) continue;
    if (s.first) { add(inferPattern(s.email, s.first, s.last)); continue; }
    const matches = new Set(people.slice(0, 20).map((p) => inferPattern(s.email, p.first, p.last)).filter((x): x is string => !!x));
    if (matches.size === 1) add([...matches][0]!);
  }
  if (counts.size !== 1) return null;
  const [pattern, evidence] = [...counts.entries()][0]!;
  return { pattern, evidence };
}

/** "{first}.{last}" as people read it: "first.last". */
export function patternLabel(pattern: string): string {
  return pattern.replace(/\{f\}/g, 'f').replace(/\{l\}/g, 'l').replace(/\{first\}/g, 'first').replace(/\{last\}/g, 'last');
}

/** The fixed results line, e.g. "Email format on loveliving.uk looks like first@loveliving.uk (from 2 addresses)." */
export function patternLine(domain: string, p: DomainPattern): string {
  const d = domain.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 80);
  return `Email format on ${d} looks like ${patternLabel(p.pattern)}@${d} (from ${p.evidence} ${p.evidence === 1 ? 'address' : 'addresses'}).`;
}

/** The candidate address for one person, or null when their name cannot be written in the format. */
export function patternGuess(p: DomainPattern, person: NamedPerson, domain: string): string | null {
  return buildPatternEmail(p.pattern, person.first, person.last, domain);
}

/** The fixed suggestion label for an unverified guess, naming the format. */
export function guessLabel(p: DomainPattern, domain: string): string {
  const d = domain.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 80);
  return `Guess, unverified: looks like ${patternLabel(p.pattern)}@${d}`;
}
