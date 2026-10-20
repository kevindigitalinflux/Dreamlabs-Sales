import { supabase } from './supabase';
import { readableInvokeError } from './invokeError';
import { planUnblock } from './domainBlock';
import type { Effort } from '../../supabase/functions/_shared/deepFindEffort';

/** Result of starting a Deep find: the run id, or a readable error. */
export type StartDeepFindResult = { runId: string; queued: number; alreadyRunning: number } | { error: string };

/**
 * Starts a Deep find for up to 25 leads with the given credit caps. The server checks every lead belongs to the
 * caller's organisation and that the caller can edit it, then works through them in the background.
 */
export async function startDeepFind(leadIds: string[], caps: { hunter: number; ai: number }, effort: Effort = 'custom', startFresh = false): Promise<StartDeepFindResult> {
  const { data, error } = await supabase.functions.invoke('run-deep-find', { body: { action: 'create', lead_ids: leadIds, caps, effort, ...(startFresh ? { start_fresh: true } : {}) } });
  if (error) return { error: await readableInvokeError(error) };
  const d = (data ?? {}) as { run_id?: unknown; queued?: unknown; already_running?: unknown; error?: unknown };
  if (typeof d.error === 'string') return { error: d.error };
  if (typeof d.run_id !== 'string') return { error: 'Deep find did not start. Please try again.' };
  return { runId: d.run_id, queued: Number(d.queued) || 0, alreadyRunning: Number(d.already_running) || 0 };
}

/** Stops a Deep find (its creator or an org admin). Leads not yet searched are skipped. Returns an error or null. */
export async function cancelDeepFind(runId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('run-deep-find', { body: { action: 'cancel', run_id: runId } });
  if (error) return readableInvokeError(error);
  const d = (data ?? {}) as { error?: unknown };
  return typeof d.error === 'string' ? d.error : null;
}

/** Result of a lead action on Deep find results: an error, or an optional notice to show. */
export type LeadActionResult = { error: string } | { notice: string | null };

/**
 * "Use this company": saves the Companies House number on the lead (checked server side) and starts a small Deep
 * find for the lead so its officers are added and looked up.
 */
export async function chooseDeepFindCompany(leadId: string, companyNumber: string): Promise<LeadActionResult> {
  const { data, error } = await supabase.functions.invoke('run-deep-find', {
    body: { action: 'choose_company', lead_id: leadId, company_number: companyNumber },
  });
  if (error) return { error: await readableInvokeError(error) };
  const d = (data ?? {}) as { error?: unknown; notice?: unknown; company_name?: unknown };
  if (typeof d.error === 'string') return { error: d.error };
  if (typeof d.notice === 'string') return { notice: d.notice };
  return { notice: typeof d.company_name === 'string' ? `Saved ${d.company_name}. Deep find is adding its officers.` : null };
}

/** "Not their domain": removes the domain from the lead and stops Deep find and lookups from using it again. */
export async function blockDeepFindDomain(leadId: string, domain: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('run-deep-find', { body: { action: 'block_domain', lead_id: leadId, domain } });
  if (error) return readableInvokeError(error);
  const d = (data ?? {}) as { error?: unknown };
  return typeof d.error === 'string' ? d.error : null;
}

/** Whether the domain is in email_domains right now (a block removes it from there, so Undo can put it back). Null if unreadable. */
export async function wasInEmailDomains(leadId: string, domain: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('leads').select('email_domains').eq('id', leadId).maybeSingle();
  if (error || !data) return null;
  return Array.isArray(data.email_domains) && data.email_domains.includes(domain);
}

/**
 * Undo "Not their domain" / "Restore" with the user's session (RLS). Compare-and-set on the blocked_domains value just
 * read, so a concurrent change is never overwritten. Returns a readable coded error or null.
 */
export async function unblockDeepFindDomain(leadId: string, domain: string, restoreToEmail = false): Promise<string | null> {
  const { data, error } = await supabase.from('leads').select('blocked_domains, email_domains').eq('id', leadId).maybeSingle();
  if (error) { console.error('unblock read failed', error); return 'Could not restore this domain (UB1). Please try again.'; }
  if (!data) return 'You do not have permission to edit this lead (UB2).';
  const blocked: string[] = Array.isArray(data.blocked_domains) ? data.blocked_domains : [];
  if (!blocked.includes(domain)) return null;
  const next = planUnblock({ blocked, email: Array.isArray(data.email_domains) ? data.email_domains : [] }, domain, restoreToEmail);
  const patch: Record<string, string[]> = { blocked_domains: next.blocked };
  if (restoreToEmail) patch.email_domains = next.email;
  const { data: rows, error: wErr } = await supabase.from('leads').update(patch).eq('id', leadId)
    .eq('blocked_domains', `{${blocked.map((d) => `"${d}"`).join(',')}}`).select('id');
  if (wErr) { console.error('unblock write failed', wErr); return 'Could not restore this domain (UB3). Please try again.'; }
  if (!rows || rows.length === 0) return 'This lead changed while you were restoring. Please try again (UB4).';
  return null;
}

/** Hunter's allowance this month, as the server read it from Hunter's free account endpoint (numbers only). */
export interface HunterAllowance {
  configured: boolean;
  available: boolean;
  usedUp: boolean;
  searchesLeft: number | null;
  creditsLeft: number | null;
  /** When Hunter says the monthly allowance renews (YYYY-MM-DD), if it reported a plain date. */
  resetDate: string | null;
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Asks the server how many Hunter searches this organisation has left this month. Null when it could not be checked. */
export async function fetchHunterAllowance(orgId: string): Promise<HunterAllowance | null> {
  const { data, error } = await supabase.functions.invoke('run-deep-find', { body: { action: 'hunter_account', org_id: orgId } });
  if (error) return null;
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.configured !== 'boolean') return null;
  return {
    configured: d.configured, available: d.available === true, usedUp: d.used_up === true,
    searchesLeft: numOrNull(d.searches_left), creditsLeft: numOrNull(d.credits_left),
    resetDate: typeof d.reset_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.reset_date) ? d.reset_date : null,
  };
}

/** The plain sentence for the allowance, e.g. "Hunter: 5 searches left this month." */
export function hunterAllowanceText(a: HunterAllowance | null): string | null {
  if (!a) return null;
  if (!a.configured) return 'No Hunter key is set, so Hunter steps will be skipped. Other configured services can still run within your effort level.';
  if (a.usedUp) return 'Hunter says this account\'s searches for the month are used up. Free steps continue; other configured services follow your effort level.';
  if (a.searchesLeft !== null) return `Hunter: ${a.searchesLeft} ${a.searchesLeft === 1 ? 'search' : 'searches'} left this month.`;
  if (a.creditsLeft !== null) return `Hunter: ${a.creditsLeft} ${a.creditsLeft === 1 ? 'credit' : 'credits'} left this month.`;
  return null;
}
