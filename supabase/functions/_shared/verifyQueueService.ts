import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { makeWorkerClient } from './workerClient.ts';
import type { WorkerConfig } from './workerRules.ts';
import { resolveOrgWorkerConfig } from './orgApiKeys.ts';
import { lookupMx } from './dnsLookup.ts';
import { recordEmailOutcome } from './emailOutcomeLearning.ts';
import { loadRecipientContext } from './recipientContext.ts';
import { evaluateReadiness } from './leadReadiness.ts';
import { isSuggestionDismissed, type ReviewSuggestion } from './deepFindSuggestions.ts';
import { autoApplyRecipients } from './recipientAutoApply.ts';
import { isRoleAddress } from './emailPrecheckRules.ts';
import { QUEUE_RUN_WINDOW_MS } from './verifyQueueRules.ts';
import type { QueueDeps, QueueRow } from './verifyQueue.ts';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const personKey = (contact: { first_name?: unknown; last_name?: unknown }) => `${text(contact.first_name)} ${text(contact.last_name)}`.trim().toLowerCase();

/** Service callbacks are bound to one claimed row; no creator/run state is shared between concurrent rows. */
export function createQueueDeps(service: SupabaseClient, sharedOrgIds?: string): QueueDeps {
  const locks = new Map<string, Promise<unknown>>();
  const rpc: QueueDeps['rpc'] = async (name, args) => service.rpc(name, args);
  async function serial<T>(leadId: string, action: () => Promise<T>): Promise<T> {
    const task = (locks.get(leadId) ?? Promise.resolve()).then(action, action);
    locks.set(leadId, task);
    try { return await task; } finally { if (locks.get(leadId) === task) locks.delete(leadId); }
  }
  function scoped(row?: QueueRow): QueueDeps {
    let config: WorkerConfig | null = null;
    let configured = false;
    let creator: string | null = null;
    const current = () => { if (!row) throw Error('A claimed queue row is required'); return row; };
    const canStillEdit: QueueDeps['canStillEdit'] = async (runId, leadId) => {
      const q = current();
      if (q.run_id !== runId || q.lead_id !== leadId) return false;
      const [run, lead] = await Promise.all([
        service.from('deep_find_runs').select('id,org_id,created_by,status,started_at').eq('id', runId).eq('org_id', q.org_id).maybeSingle(),
        service.from('leads').select('id').eq('id', leadId).eq('org_id', q.org_id).maybeSingle(),
      ]);
      if (run.error || lead.error || !run.data || !lead.data || !['active', 'completed'].includes(run.data.status)
        || !Number.isFinite(Date.parse(run.data.started_at)) || Date.now() >= Date.parse(run.data.started_at) + QUEUE_RUN_WINDOW_MS) return false;
      const [member, access] = await Promise.all([
        service.from('org_members').select('user_id').eq('org_id', q.org_id).eq('user_id', run.data.created_by).maybeSingle(),
        service.rpc('deep_find_creator_can_edit', { target_user: run.data.created_by, target_lead: leadId }),
      ]);
      if (member.error || access.error || !member.data || access.data !== true) return false;
      creator = run.data.created_by;
      if (!configured) {
        config = await resolveOrgWorkerConfig(service, q.org_id, sharedOrgIds);
        await lookupMx(q.domain, 3000, true);
        configured = true;
      }
      return true;
    };
    const checkpoint = async () => { const q = current(); if (!await canStillEdit(q.run_id, q.lead_id)) throw Error('Queue creator can no longer edit this lead'); };
    const readDetails = async () => {
      const q = current();
      const result = await service.from('deep_find_leads').select('id,domains,updated_at')
        .eq('org_id', q.org_id).eq('run_id', q.run_id).eq('lead_id', q.lead_id).maybeSingle();
      if (result.error || !result.data) throw Error('Could not read background check result');
      return result.data;
    };
    const saveDetails = async (change: (old: Record<string, any>) => Record<string, unknown>) => {
      const q = current(); const old = await readDetails(); await checkpoint();
      const version = JSON.stringify(old.domains);
      const result = await service.from('deep_find_leads').update({ domains: change(old.domains ?? {}), updated_at: new Date().toISOString() })
        .eq('id', old.id).eq('org_id', q.org_id).eq('run_id', q.run_id).eq('lead_id', q.lead_id).eq('updated_at', old.updated_at).eq('domains', version).select('id');
      if (result.error || !result.data?.length) throw Error('Background check result changed concurrently');
    };
    return {
      rpc, now: Date.now, forRow: next => scoped(next), canStillEdit,
      workerFor(orgId) {
        const q = current();
        if (orgId !== q.org_id || !configured || !creator) throw Error('Queue worker scope was not authorized');
        return makeWorkerClient({ usage: service, orgId, config });
      },
      async recordOutcome(input) {
        const q = current();
        if (input.orgId !== q.org_id || input.leadId !== q.lead_id || input.address !== q.address
          || !['checked_valid', 'checked_invalid', 'checked_unverifiable'].includes(input.outcome)) throw Error('Invalid queue outcome scope');
        await checkpoint();
        await recordEmailOutcome(service, { ...input, outcome: input.outcome as 'checked_valid' | 'checked_invalid' | 'checked_unverifiable', source: `queue:${q.id}`, seenAt: new Date(), pauseSequences: false });
      },
      async applyProven(input) {
        const q = current();
        if (input.orgId !== q.org_id || input.leadId !== q.lead_id || input.address !== q.address || input.contactId !== q.contact_id) throw Error('Invalid queue fill scope');
        return serial(q.lead_id, async () => {
          await checkpoint();
          if (q.person_key === null || isRoleAddress(input.address)) return 'skipped';
          const context = await loadRecipientContext(service, q.org_id, q.lead_id);
          const assessed = await context.assess(input.address);
          if (!['T1', 'T2'].includes(assessed.result.tier)) return 'skipped';
          const contacts = context.contacts.filter(contact => personKey(contact) === q.person_key);
          const contact = contacts.length === 1 && (!q.contact_id || contacts[0].id === q.contact_id) ? contacts[0] : null;
          // A dismissed or replaced contact id cannot be silently converted into a different person's suggestion.
          if (q.contact_id && !contact) return 'skipped';
          const name = q.person_name ?? q.person_key;
          if (isSuggestionDismissed({ name, field: 'email', value: input.address }, context.lead)) return 'skipped';
          const savedEmail = contact ? text(contact.email) : '';
          if (savedEmail.toLowerCase() === input.address) return 'skipped';
          const suggest = async () => {
            const suggestion: ReviewSuggestion = { name, field: 'email', value: input.address, label: assessed.result.reason,
              ...(contact && savedEmail ? { replaces_saved_email: { contact_id: contact.id, email: savedEmail } } : {}) };
            await saveDetails(old => ({ ...old, recipient_evidence: { ...old.recipient_evidence, [input.address]: assessed.evidence },
              suggestions: [...(Array.isArray(old.suggestions) ? old.suggestions : []).filter((item: ReviewSuggestion) => item.value !== input.address), suggestion] }));
            return 'suggested' as const;
          };
          if (!contact || savedEmail) return suggest();
          const detail = await readDetails();
          if (Array.isArray(detail.domains?.auto_applied) && detail.domains.auto_applied.length >= 100) return suggest();
          let applied = false;
          const before = contact.email ?? null;
          await autoApplyRecipients([{ address: input.address, name, tier: assessed.result, savedEmail: null }], async () => {
            await checkpoint();
            // Preserve the existing blank-value comparison and dismissal guard, without changing enrollment flags.
            let update = service.from('decision_maker_candidates').update({ email: input.address, updated_at: new Date().toISOString() })
              .eq('id', contact.id).eq('lead_id', q.lead_id).is('dismissed_at', null);
            update = before === null ? update.is('email', null) : update.eq('email', before);
            const result = await update.select('id');
            if (result.error) throw Error('Could not fill confirmed contact address');
            if (!result.data?.length) return false;
            applied = true;
            await saveDetails(old => ({ ...old, recipient_evidence: { ...old.recipient_evidence, [input.address]: assessed.evidence },
              auto_applied: [...(Array.isArray(old.auto_applied) ? old.auto_applied : []), { table: 'decision_maker_candidates', id: contact.id, field: 'email', before, after: input.address }] }));
            return true;
          }, async content => {
            await checkpoint();
            const note = await service.from('lead_notes').insert({ lead_id: q.lead_id, created_by: creator, note_type: 'general', content });
            if (note.error) throw Error('Could not save confirmed recipient note');
          });
          return applied ? 'applied' : 'skipped';
        });
      },
      async refreshReadiness(leadId) {
        const q = current(); if (leadId !== q.lead_id) throw Error('Invalid queue readiness scope');
        await serial(leadId, async () => {
          await checkpoint();
          const context = await loadRecipientContext(service, q.org_id, leadId);
          const detail = await readDetails();
          const addresses = [context.lead.email, ...(Array.isArray(context.lead.additional_emails) ? context.lead.additional_emails : []), ...context.contacts.map(contact => contact.email)]
            .filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim().toLowerCase());
          const recipientEvidence = Object.fromEntries(await Promise.all([...new Set(addresses)].map(async address => [address, (await context.assess(address)).evidence])));
          const domains = (Array.isArray(detail.domains?.domains) ? detail.domains.domains : []).filter((domain: any) => typeof domain?.domain === 'string');
          const readiness = evaluateReadiness({ lead: context.lead, contacts: context.contacts, domains, recipientEvidence, validEmails: [], websiteSuspect: detail.domains?.website_suspect === true });
          await checkpoint();
          const result = await service.from('leads').update(readiness).eq('id', leadId).eq('org_id', q.org_id).eq('updated_at', context.lead.updated_at).select('id');
          if (result.error || !result.data?.length) throw Error('Could not refresh background readiness');
          await saveDetails(old => ({ ...old, ...readiness, recipient_evidence: { ...old.recipient_evidence, ...recipientEvidence } }));
        });
      },
    };
  }
  return scoped();
}
