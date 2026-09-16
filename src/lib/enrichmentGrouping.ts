import type { EnrichableField, EnrichmentResult } from '../types';

/**
 * Turns enrichment results + a per-lead set of checked fields into one
 * { [leadId]: patch } map, containing only the fields the user kept
 * checked. Leads with nothing checked (or nothing valid checked) are
 * omitted entirely.
 */
export function groupChangesByLead(
  results: EnrichmentResult[],
  checked: Record<string, Set<EnrichableField>>,
): Record<string, Partial<Record<EnrichableField, string>>> {
  const grouped: Record<string, Partial<Record<EnrichableField, string>>> = {};
  for (const result of results) {
    const checkedFields = checked[result.lead_id];
    if (!checkedFields || checkedFields.size === 0) continue;
    const patch: Partial<Record<EnrichableField, string>> = {};
    for (const field of checkedFields) {
      const value = result.proposed[field];
      if (value !== undefined) patch[field] = value;
    }
    if (Object.keys(patch).length > 0) grouped[result.lead_id] = patch;
  }
  return grouped;
}
