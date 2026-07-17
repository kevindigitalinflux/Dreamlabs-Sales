import { formatCurrency, packageLabel } from './utils';
import type { Lead } from '../types';

/** The {{variables}} templates may use (SPEC.md §7). */
export const TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'business_name', label: 'Business name' },
  { key: 'owner_name', label: 'Owner name' },
  { key: 'audit_date', label: 'Audit date' },
  { key: 'package_name', label: 'Package' },
  { key: 'deal_value', label: 'Deal value' },
  { key: 'contractor_name', label: 'Your name' },
  { key: 'pain_point', label: 'Pain point' },
  { key: 'cal_link', label: 'Booking link' },
];

/** Replaces {{key}} with values; empty/unknown keys blank out and are reported in `missing`. */
export function substituteVariables(
  text: string,
  vars: Record<string, string | null | undefined>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === null || value === undefined || value === '') {
      missing.add(key);
      return '';
    }
    return value;
  });
  return { text: out, missing: [...missing] };
}

/** Builds the variable map for a lead. `notes` = latest note contents, newest first. */
export function buildTemplateVars(
  lead: Lead,
  contractorName: string,
  notes: string[] = [],
): Record<string, string | null> {
  const painPoint = notes
    .map((n) => /Main pain point:\n([^\n]+)/.exec(n)?.[1]?.trim() ?? null)
    .find((p) => p) ?? null;
  return {
    first_name: lead.owner_name?.split(' ')[0] ?? null,
    business_name: lead.business_name,
    owner_name: lead.owner_name,
    audit_date: null,
    package_name: lead.package_tier ? packageLabel(lead.package_tier) : null,
    deal_value: lead.deal_value !== null ? formatCurrency(lead.deal_value) : null,
    contractor_name: contractorName,
    pain_point: painPoint,
    cal_link: null,
  };
}
