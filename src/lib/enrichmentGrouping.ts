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

/** A found value the user chose to keep alongside what the lead already has, instead of replacing it. */
export interface AdditionalDetail {
  field: EnrichableField;
  value: string;
  source: string;
}

const isBlank = (v: string | null | undefined): boolean => !v || v.trim() === '' || v.trim() === '—';

/**
 * Splits the checked enrichment fields into what to WRITE to the lead and what
 * to only NOTE. Enrichment fills gaps and enriches; it must not clobber details
 * a rep got straight from the owner:
 *  - existing value blank      -> patch (fill it in)
 *  - existing value present:
 *      - `replaceExisting` on  -> patch (overwrite, the old behaviour)
 *      - otherwise             -> addition (kept as a note; the field is untouched)
 * A found value identical to the existing one (ignoring case) is dropped.
 */
export function splitEnrichmentChanges(
  results: EnrichmentResult[],
  checked: Record<string, Set<EnrichableField>>,
  existing: Record<string, Partial<Record<EnrichableField, string | null>>>,
  replaceExisting: boolean,
): {
  patches: Record<string, Partial<Record<EnrichableField, string>>>;
  additions: Record<string, AdditionalDetail[]>;
} {
  const patches: Record<string, Partial<Record<EnrichableField, string>>> = {};
  const additions: Record<string, AdditionalDetail[]> = {};
  for (const result of results) {
    const fields = checked[result.lead_id];
    if (!fields) continue;
    for (const field of fields) {
      const value = result.proposed[field];
      if (value === undefined) continue;
      const current = existing[result.lead_id]?.[field];
      if (!isBlank(current) && current!.trim().toLowerCase() === value.trim().toLowerCase()) continue;
      if (isBlank(current) || replaceExisting) {
        (patches[result.lead_id] ??= {})[field] = value;
      } else {
        (additions[result.lead_id] ??= []).push({ field, value, source: result.source[field] ?? '' });
      }
    }
  }
  return { patches, additions };
}
