import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dismissDecisionMaker } from '../lib/dismissDecisionMaker';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import {
  SAVED_AS_OWN_MESSAGE, contactErrorMessage, editStrategy, isOwnSource, newContactRow, primarySwitchPlan, validateContactForm,
} from '../lib/leadContacts';
import type { ContactFormValues } from '../lib/leadContacts';
import type { DecisionMakerCandidate } from '../types';

const TABLE = 'decision_maker_candidates';

/** Result of a contact write: an error to show, or null (with an optional plain-English notice). */
export interface ContactResult { error: string | null; notice?: string }

/**
 * A lead's live (non-dismissed) contacts, people and general inboxes together, kept
 * fresh by a realtime subscription scoped to the lead, plus the write actions the
 * Contacts card needs. Every write is validated first and uses `.select().single()`
 * so a write that row-level security silently blocks is reported. State resets when
 * the lead or organisation changes and late responses for the old one are ignored.
 */
export function useLeadContacts(leadId: string) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const userId = session?.user.id ?? null;
  const [contacts, setContacts] = useState<DecisionMakerCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const epoch = useRef(0);
  const listRef = useRef<DecisionMakerCandidate[]>([]);
  listRef.current = contacts;

  useEffect(() => {
    const mine = ++epoch.current;
    setContacts([]); setLoading(true); setLoadError(null);
    void supabase.from(TABLE).select('*').eq('lead_id', leadId).is('dismissed_at', null).order('created_at').then(({ data, error }) => {
      if (mine !== epoch.current) return;
      if (error) setLoadError('Could not load contacts. Please refresh and try again.');
      else setContacts((data as DecisionMakerCandidate[]) ?? []);
      setLoading(false);
    });
    const channel = supabase
      .channel(`lead-contacts-${leadId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `lead_id=eq.${leadId}` }, (payload) => {
        if (mine !== epoch.current) return;
        if (payload.eventType === 'DELETE') {
          setContacts((prev) => prev.filter((c) => c.id !== (payload.old as { id: string }).id));
          return;
        }
        const row = payload.new as DecisionMakerCandidate;
        if (row.dismissed_at) { setContacts((prev) => prev.filter((c) => c.id !== row.id)); return; }
        setContacts((prev) => (prev.some((c) => c.id === row.id) ? prev.map((c) => (c.id === row.id ? row : c)) : [...prev, row]));
      })
      .subscribe();
    return () => { epoch.current++; void supabase.removeChannel(channel); };
  }, [leadId, currentOrg?.id]);

  const upsertLocal = useCallback((row: DecisionMakerCandidate) => {
    setContacts((prev) => (prev.some((c) => c.id === row.id) ? prev.map((c) => (c.id === row.id ? row : c)) : [...prev, row]));
  }, []);

  /** Updates columns on one row; returns the stored row or an error message. */
  const patchRow = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const mine = epoch.current;
    const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
    if (error) return { row: null, error: contactErrorMessage(error) };
    if (mine === epoch.current) upsertLocal(data as DecisionMakerCandidate);
    return { row: data as DecisionMakerCandidate, error: null };
  }, [upsertLocal]);

  const insertRow = useCallback(async (value: Parameters<typeof newContactRow>[2], include = true) => {
    if (!userId) return { row: null, error: 'You need to be signed in to add a contact.' };
    const mine = epoch.current;
    const { data, error } = await supabase.from(TABLE).insert(newContactRow(leadId, userId, value, include)).select().single();
    if (error) return { row: null, error: contactErrorMessage(error) };
    if (mine === epoch.current) upsertLocal(data as DecisionMakerCandidate);
    return { row: data as DecisionMakerCandidate, error: null };
  }, [leadId, userId, upsertLocal]);

  /** Adds a person or general inbox typed by the user (source 'manual'). */
  const addContact = useCallback(async (form: ContactFormValues): Promise<ContactResult> => {
    const v = validateContactForm(form);
    if (!v.ok) return { error: v.error };
    return { error: (await insertRow(v.value)).error };
  }, [insertRow]);

  /** Sets the main contact: clears the old one first, restores it if setting the new one fails. */
  const setPrimary = useCallback(async (id: string): Promise<ContactResult> => {
    const plan = primarySwitchPlan(listRef.current, id);
    if (!plan.set) return { error: null };
    for (const oldId of plan.clear) {
      const r = await patchRow(oldId, { is_primary: false });
      if (r.error) return { error: r.error };
    }
    const r = await patchRow(plan.set, { is_primary: true });
    if (!r.error) return { error: null };
    for (const oldId of plan.restore) await patchRow(oldId, { is_primary: true });
    return { error: `${r.error}. Your previous main contact was kept.` };
  }, [patchRow]);

  /** Saves an edit. Provider rows whose email (or obfuscated name) changes are dismissed and re-saved as a manual contact. */
  const updateContact = useCallback(async (contact: DecisionMakerCandidate, form: ContactFormValues): Promise<ContactResult> => {
    const v = validateContactForm(form);
    if (!v.ok) return { error: v.error };
    if (editStrategy(contact, v.value) === 'inline') return { error: (await patchRow(contact.id, { ...v.value })).error };
    const made = await insertRow(v.value, contact.include_in_sequences);
    if (made.error || !made.row) return { error: made.error };
    const dismissErr = await dismissDecisionMaker(contact.id);
    if (dismissErr) {
      await supabase.from(TABLE).delete().eq('id', made.row.id);
      setContacts((prev) => prev.filter((c) => c.id !== made.row?.id));
      return { error: dismissErr };
    }
    setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    if (contact.is_primary) {
      const p = await patchRow(made.row.id, { is_primary: true });
      if (p.error) return { error: null, notice: `${SAVED_AS_OWN_MESSAGE}. It could not be made the main contact: ${p.error}` };
    }
    return { error: null, notice: SAVED_AS_OWN_MESSAGE };
  }, [patchRow, insertRow]);

  /** Turns follow-up sequences on or off for one contact. */
  const setIncludeInSequences = useCallback(async (id: string, on: boolean): Promise<ContactResult> => (
    { error: (await patchRow(id, { include_in_sequences: on })).error }
  ), [patchRow]);

  /** Deletes a manual / Dream Agent contact, or dismisses a provider one (so a new search does not bring it back). */
  const removeContact = useCallback(async (contact: DecisionMakerCandidate): Promise<ContactResult> => {
    if (isOwnSource(contact.source)) {
      const { error } = await supabase.from(TABLE).delete().eq('id', contact.id).select().single();
      if (error) return { error: contactErrorMessage(error) };
    } else {
      const err = await dismissDecisionMaker(contact.id);
      if (err) return { error: err };
    }
    // Realtime does not deliver DELETE events on the filtered subscription, so drop it here.
    setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    return { error: null };
  }, []);

  return { contacts, loading, loadError, addContact, updateContact, removeContact, setPrimary, setIncludeInSequences };
}
