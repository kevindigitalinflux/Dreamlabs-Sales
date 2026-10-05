import type { DecisionMakerCandidate, Lead } from '../types';

/** One email to be written in a bulk draft: a person at a lead's company. */
export interface BulkTarget {
  leadId: string;
  businessName: string;
  email: string;
  /** Who it's addressed to; null means the lead's own default contact. */
  name: string | null;
  /** Their job title (decision-makers only), so the AI can write to their role. */
  title: string | null;
  candidateId: string | null;
  kind: 'lead' | 'additional' | 'decision_maker';
}

/**
 * Who a bulk draft writes to. For each selected lead: its own email, and, when
 * `includeOthers` is on, its additional addresses and every decision-maker found for it,
 * each as a separate email (so a company with three decision-makers gets three, each
 * written for that person). An address is only used once per lead, ignoring case, so a
 * decision-maker whose email is already the lead's isn't written to twice. Leads with no
 * address at all simply produce no targets.
 */
export function buildBulkTargets(leads: Lead[], decisionMakers: DecisionMakerCandidate[], includeOthers: boolean): BulkTarget[] {
  const targets: BulkTarget[] = [];
  for (const lead of leads) {
    const seen = new Set<string>();
    const add = (t: Omit<BulkTarget, 'leadId' | 'businessName'>) => {
      const norm = t.email.trim().toLowerCase();
      if (!norm || seen.has(norm)) return;
      seen.add(norm);
      targets.push({ leadId: lead.id, businessName: lead.business_name, ...t });
    };
    if (lead.email) add({ email: lead.email, name: null, title: null, candidateId: null, kind: 'lead' });
    if (!includeOthers) continue;
    for (const extra of lead.additional_emails ?? []) add({ email: extra, name: null, title: null, candidateId: null, kind: 'additional' });
    for (const dm of decisionMakers) {
      if (dm.lead_id !== lead.id || !dm.email || dm.dismissed_at) continue;
      const name = `${dm.first_name ?? ''} ${dm.last_name ?? ''}`.trim() || null;
      add({ email: dm.email, name, title: dm.title, candidateId: dm.id, kind: 'decision_maker' });
    }
  }
  return targets;
}

/** How many of the targets are not just a lead's own address, i.e. what ticking "include others" adds. */
export function countOtherContacts(leads: Lead[], decisionMakers: DecisionMakerCandidate[]): number {
  return buildBulkTargets(leads, decisionMakers, true).length - buildBulkTargets(leads, decisionMakers, false).length;
}
