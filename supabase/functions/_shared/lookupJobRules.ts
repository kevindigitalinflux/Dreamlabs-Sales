// Pure lookup rules shared by the edge runner and unit tests. No runtime imports.
export type LookupKind = 'enrich' | 'decision_makers';
export type LookupReview = 'none' | 'pending' | 'applied' | 'dismissed';
export type LookupLeadStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';
export const LOOKUP_LIMITS = {
  maxLeads: 50, orgPerDay: 300, leadPerDay: 5,
  wallBudgetMs: 130_000, // Mirrors WALL_BUDGET_MS in deepFind.ts without its runtime imports.
  leadBudgetMs: 100_000, checkpointMarginMs: 10_000,
  leadReserveMs: 110_000, // Like Deep find's LEAD_RESERVE_MS: a whole lead plus final persistence time.
} as const;
export function canStartLookupLead(startedAt: number, now: number): boolean {
  return now - startedAt < LOOKUP_LIMITS.wallBudgetMs - LOOKUP_LIMITS.leadReserveMs;
}
/** Log classification only, never provider messages, details or response bodies. */
export function lookupErrorKind(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') return err.code;
  return err instanceof Error ? err.name : 'unknown';
}
export function parseLookupRequest(body: unknown): { kind: LookupKind; leadIds: string[] } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.kind !== 'enrich' && b.kind !== 'decision_makers') return null;
  if (!Array.isArray(b.lead_ids) || b.lead_ids.length < 1 || b.lead_ids.length > LOOKUP_LIMITS.maxLeads) return null;
  if (!b.lead_ids.every((id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return null;
  return { kind: b.kind, leadIds: [...new Set(b.lead_ids as string[])] };
}
export function lookupReview(kind: LookupKind, proposed: Record<string, unknown>): LookupReview {
  return kind === 'enrich' && Object.keys(proposed).length > 0 ? 'pending' : 'none';
}
export function lookupSkipReason(leadExists: boolean, member: boolean, canEdit: boolean): string | null {
  if (!leadExists) return 'This lead is no longer available.';
  if (!member) return 'The person who started this job is no longer in the organisation.';
  if (!canEdit) return 'The person who started this job can no longer edit this lead.';
  return null;
}
