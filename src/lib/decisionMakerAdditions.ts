import { ADDITIONAL_COLUMN, mergeAdditions } from './enrichmentGrouping';
import type { AdditionalDetail } from './enrichmentGrouping';
import type { LeadPatch } from './leadUpdates';
import type { DecisionMakerCandidate, Lead } from '../types';

/** Display name for a candidate, or 'Unknown name' when neither part is known. */
export function candidateName(c: DecisionMakerCandidate): string {
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  return name || 'Unknown name';
}

/** What a decision-maker would add to a lead's additional fields: their name (with title), email and phone, whichever are actually known. */
export function additionsFor(c: DecisionMakerCandidate): AdditionalDetail[] {
  const out: AdditionalDetail[] = [];
  const name = candidateName(c);
  // An unrevealed Apollo contact only has an obfuscated last name: nothing real to store yet.
  if (!c.name_obfuscated && name !== 'Unknown name') out.push({ field: 'owner_name', value: c.title ? `${name} (${c.title})` : name, source: c.source });
  if (c.email) out.push({ field: 'email', value: c.email, source: c.source });
  if (c.phone) out.push({ field: 'phone', value: c.phone, source: c.source });
  return out;
}

/** True when every value is already on the lead (as its primary field or in its additional list), ignoring case. */
export function alreadyOnLead(lead: Lead, additions: AdditionalDetail[]): boolean {
  const primary: Record<AdditionalDetail['field'], string | null> = { email: lead.email, phone: lead.phone, website: lead.website, owner_name: lead.owner_name };
  return additions.every(({ field, value }) => {
    const v = value.trim().toLowerCase();
    return (primary[field] ?? '').trim().toLowerCase() === v || (lead[ADDITIONAL_COLUMN[field]] ?? []).some((x) => x.trim().toLowerCase() === v);
  });
}

/**
 * One lead patch that adds every given decision-maker's known details to the
 * lead's additional fields, or null when there is nothing new to add (so a bulk
 * "add all" never issues a pointless write).
 */
export function additionsPatchFor(lead: Lead, candidates: DecisionMakerCandidate[]): LeadPatch | null {
  const additions = candidates.flatMap(additionsFor).filter((a) => !alreadyOnLead(lead, [a]));
  return additions.length > 0 ? mergeAdditions(lead, additions) : null;
}
