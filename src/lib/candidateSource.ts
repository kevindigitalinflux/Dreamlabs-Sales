import type { DecisionMakerCandidate } from '../types';

const LABELS: Record<DecisionMakerCandidate['source'], string> = {
  hunter: 'Hunter',
  apollo: 'Apollo',
  companies_house: 'Companies House',
  cro: 'CRO',
  manual: 'Added manually',
  dream_agent: 'Dream Agent',
};

/** Readable source name for a decision-maker candidate (falls back to the raw value for unknown sources). */
export function candidateSourceLabel(source: string): string {
  return (LABELS as Record<string, string>)[source] ?? source;
}

/** True when a candidate has neither an email nor a phone number (e.g. a registry officer). */
export function hasNoContactDetails(c: Pick<DecisionMakerCandidate, 'email' | 'phone'>): boolean {
  return !c.email && !c.phone;
}

/** True for sources that come from a company registry (Companies House, CRO). */
export function isRegistrySource(source: string): boolean {
  return source === 'companies_house' || source === 'cro';
}

/** True for contacts found automatically by a provider search or registry (never typed by the user). */
export function isProviderSource(source: string): boolean {
  return source === 'hunter' || source === 'apollo' || isRegistrySource(source);
}
