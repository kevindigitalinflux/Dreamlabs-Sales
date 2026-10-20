import type { SupabaseClient } from '@supabase/supabase-js';
import { contactDisplayName } from '../../supabase/functions/_shared/contacts';
import { candidateSourceLabel } from './candidateSource';
import { contactErrorMessage } from './leadContacts';
import type { DecisionMakerCandidate } from '../types';

/** A dismissed contact described for the "Dismissed people" list. */
export interface DismissedContact { id: string; name: string; role: string | null; source: string }

/** The dismissed rows of a lead's contacts, with name, role and source label. */
export function dismissedContactsOf(rows: DecisionMakerCandidate[]): DismissedContact[] {
  return rows.filter((r) => r.dismissed_at).map((r) => ({
    id: r.id, name: contactDisplayName(r), role: r.title?.trim() || null, source: candidateSourceLabel(r.source),
  }));
}

export type RestorePlan = { ok: true; id: string; name: string } | { ok: false; error: string };

/** Pure planner: only a still-dismissed contact can be restored. */
export function planRestore(row: DecisionMakerCandidate): RestorePlan {
  const name = contactDisplayName(row);
  return row.dismissed_at ? { ok: true, id: row.id, name } : { ok: false, error: `${name} is already restored.` };
}

export const restoredMessage = (name: string) => `Restored ${name}`;

/** Extra request fields for the run-creation call; empty unless the user ticked "Start fresh". */
export const startFreshBody = (startFresh: boolean): { start_fresh?: true } => (startFresh ? { start_fresh: true } : {});

/**
 * Sets dismissed_at to null through the user's session (RLS applies). Compare-and-set: the write only matches while the
 * row is still dismissed, so a restore that raced with another one is reported instead of silently doing nothing.
 */
export async function restoreDismissedContact(client: Pick<SupabaseClient, 'from'>, id: string, name: string): Promise<{ error: string | null; message: string | null }> {
  const { data, error } = await client.from('decision_maker_candidates')
    .update({ dismissed_at: null }).eq('id', id).not('dismissed_at', 'is', null).select('id').maybeSingle();
  if (error) return { error: `${contactErrorMessage(error)} (${error.code ?? 'error'})`, message: null };
  if (!data) return { error: `${name} was already restored or changed. Refresh to see the current list.`, message: null };
  return { error: null, message: restoredMessage(name) };
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
