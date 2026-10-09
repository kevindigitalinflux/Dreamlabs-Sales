import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dismissDecisionMaker } from '../lib/dismissDecisionMaker';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import { contactErrorMessage, isOwnSource } from '../lib/leadContacts';
import type { ContactFormValues } from '../lib/leadContacts';
import { addContactRow, setPrimaryContact, updateContactRow } from '../lib/contactWrites';
import type { ContactResult, ContactWriteCtx } from '../lib/contactWrites';
import type { DecisionMakerCandidate } from '../types';

const TABLE = 'decision_maker_candidates';

export type { ContactResult };

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

  /**
   * Reloads the list (for rows the server wrote); ignored if the lead changed meanwhile.
   * Resolves to the fresh rows, or null when the reload failed or is no longer relevant.
   */
  const refresh = useCallback(async (): Promise<DecisionMakerCandidate[] | null> => {
    const mine = epoch.current;
    const { data, error } = await supabase.from(TABLE).select('*').eq('lead_id', leadId).is('dismissed_at', null).order('created_at');
    if (mine !== epoch.current || error || !data) return null;
    setContacts(data as DecisionMakerCandidate[]);
    return data as DecisionMakerCandidate[];
  }, [leadId]);

  const upsertLocal = useCallback((row: DecisionMakerCandidate) => {
    setContacts((prev) => (prev.some((c) => c.id === row.id) ? prev.map((c) => (c.id === row.id ? row : c)) : [...prev, row]));
  }, []);

  /** Write context for one action: local state is only touched while this lead/org is still the current one. */
  const ctxFor = useCallback((): ContactWriteCtx => {
    const mine = epoch.current;
    return {
      client: supabase, userId, dismiss: dismissDecisionMaker,
      onRow: (row) => { if (mine === epoch.current) upsertLocal(row); },
      onRemoved: (id) => setContacts((prev) => prev.filter((c) => c.id !== id)),
    };
  }, [userId, upsertLocal]);

  /** Updates columns on one row; returns the stored row or an error message. */
  const patchRow = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const mine = epoch.current;
    const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
    if (error) return { row: null, error: contactErrorMessage(error) };
    if (mine === epoch.current) upsertLocal(data as DecisionMakerCandidate);
    return { row: data as DecisionMakerCandidate, error: null };
  }, [upsertLocal]);

  /** Adds a person or general inbox typed by the user (source 'manual'). */
  const addContact = useCallback(async (form: ContactFormValues): Promise<ContactResult> => {
    const r = await addContactRow(ctxFor(), leadId, form);
    return { error: r.error };
  }, [ctxFor, leadId]);

  /** Sets the main contact: clears the old one first, restores it if setting the new one fails. */
  const setPrimary = useCallback(async (id: string): Promise<ContactResult> => (
    setPrimaryContact(ctxFor(), listRef.current, id)
  ), [ctxFor]);

  /** Saves an edit. Provider rows whose email (or obfuscated name) changes are dismissed and re-saved as a manual contact. */
  const updateContact = useCallback(async (contact: DecisionMakerCandidate, form: ContactFormValues): Promise<ContactResult> => {
    const r = await updateContactRow(ctxFor(), contact, form);
    return r.notice ? { error: r.error, notice: r.notice } : { error: r.error };
  }, [ctxFor]);

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

  return { contacts, loading, loadError, refresh, addContact, updateContact, removeContact, setPrimary, setIncludeInSequences };
}
