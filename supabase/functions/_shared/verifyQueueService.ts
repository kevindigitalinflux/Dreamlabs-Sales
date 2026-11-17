import { checkWindowEnd } from './deepFindParallel.ts';
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
import { queueRetry, QueueStepError, type QueueRetryOptions } from './verifyQueueRetry.ts';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const personKey = (contact: { first_name?: unknown; last_name?: unknown }) => `${text(contact.first_name)} ${text(contact.last_name)}`.trim().toLowerCase();

/** Service callbacks are bound to one claimed row; no creator/run state is shared between concurrent rows. */
export function createQueueDeps(service: SupabaseClient, sharedOrgIds?: string, retry: QueueRetryOptions = {}): QueueDeps {
  const locks = new Map<string, Promise<unknown>>();
  const rpc: QueueDeps['rpc'] = async (name, args) => service.rpc(name, args);
  async function serial<T>(leadId: string, action: () => Promise<T>): Promise<T> {
    const task = (locks.get(leadId) ?? Promise.resolve()).then(action, action);
    locks.set(leadId, task);
    try { return await task; } finally { if (locks.get(leadId) === task) locks.delete(leadId); }
  }
  function scoped(row?: QueueRow, recoveryFinishedAt?: string): QueueDeps {
    let config: WorkerConfig | null = null;
    let configured = false;
    let creator: string | null = null;
    const current = () => { if (!row) throw Error('A claimed queue row is required'); return row; };
    const canStillEdit: QueueDeps['canStillEdit'] = async (runId, leadId) => {
      const q = current();
      if (q.run_id !== runId || q.lead_id !== leadId) return false;
      const [run, lead] = await Promise.all([
        service.from('deep_find_runs').select('id,org_id,created_by,status,started_at,lead_count,deep_find_parallel').eq('id', runId).eq('org_id', q.org_id).maybeSingle(),
        service.from('leads').select('id').eq('id', leadId).eq('org_id', q.org_id).maybeSingle(),
      ]);
      if (run.error || lead.error || !run.data || !lead.data || !['active', 'completed'].includes(run.data.status)
        || !Number.isFinite(Date.parse(run.data.started_at)) || !Number.isFinite(Date.parse(recoveryFinishedAt ?? q.created_at))
        || Date.now() >= checkWindowEnd(Date.parse(run.data.started_at), run.data.lead_count, run.data.deep_find_parallel)
        || Date.now() >= Date.parse(recoveryFinishedAt ?? q.created_at) + QUEUE_RUN_WINDOW_MS) return false;
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
    const checkpoint = async () => { const q = current(); if (!await canStillEdit(q.run_id, q.lead_id)) throw new QueueStepError('access_read', false); };
    const readDetails = async () => {
      const q = current();
      const result = await service.from('deep_find_leads').select('id,domains,updated_at,status')
        .eq('org_id', q.org_id).eq('run_id', q.run_id).eq('lead_id', q.lead_id).maybeSingle();
      if (result.error || !result.data || ['running', 'queued'].includes(result.data.status)) throw new QueueStepError('details_read');
      return result.data;
    };
    const saveDetails = async (change: (old: Record<string, any>) => Record<string, unknown>, expected?: { version: unknown; timestamp: unknown }) => {
      const write = async () => {
      const q = current(); const old = await readDetails(); await checkpoint();
      const version = old.domains?._queue_version;
      if (expected && (version !== expected.version || old.updated_at !== expected.timestamp)) throw new QueueStepError('readiness_write');
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) throw new QueueStepError('details_read', false);
      let update = service.from('deep_find_leads').update({ domains: { ...change(old.domains ?? {}), _queue_version: (version ?? 0) + 1 }, updated_at: new Date().toISOString() })
        .eq('id', old.id).eq('org_id', q.org_id).eq('run_id', q.run_id).eq('lead_id', q.lead_id).eq('updated_at', old.updated_at);
      update = version === undefined ? update.is('domains->>_queue_version', null) : update.eq('domains->>_queue_version', String(version));
      const result = await update.select('id');
      if (result.error || !result.data?.length) throw new QueueStepError(expected ? 'readiness_write' : 'details_write');
      };
      // Readiness conflicts restart its whole assessment rather than replaying an old computed result.
      return expected ? write() : queueRetry('details_write', write, retry);
    };
    const effect = (old: Record<string, any>, state: Record<string, unknown>) => ({ ...old, _queue_effects: { ...old._queue_effects, [current().id]: { address: current().address, ...state } } });
    const skip = async (rule: string) => {
      console.info('Background check result skipped', rule);
      await saveDetails(old => effect(old, { state: 'skipped', rule }));
      return 'skipped' as const;
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
        return serial(q.lead_id, () => queueRetry('apply_proven', async () => {
          await checkpoint();
          if (q.person_key === null || isRoleAddress(input.address)) return skip(q.person_key === null ? 'no_person' : 'role_address');
          const context = await queueRetry('context_read', () => loadRecipientContext(service, q.org_id, q.lead_id), retry);
          const assessed = await queueRetry('context_assess', () => context.assess(input.address), retry);
          if (!['T1', 'T2'].includes(assessed.result.tier)) {
            if (q.kind === 'ms_exists' && assessed.evidence.msExists === undefined && assessed.result.tier !== 'never') throw new QueueStepError('context_assess');
            return skip('not_sendable');
          }
          const contacts = context.contacts.filter(contact => personKey(contact) === q.person_key);
          const contact = contacts.length === 1 && (!q.contact_id || contacts[0].id === q.contact_id) ? contacts[0] : null;
          // A dismissed or replaced contact id cannot be silently converted into a different person's suggestion.
          if (q.contact_id && !contact) return skip('contact_scope');
          const name = q.person_name ?? q.person_key;
          if (isSuggestionDismissed({ name, field: 'email', value: input.address }, context.lead)) return skip('dismissed');
          const detail = await readDetails();
          const pending = detail.domains?._queue_effects?.[q.id];
          const savedEmail = contact ? text(contact.email) : '';
          if (savedEmail.toLowerCase() === input.address && pending?.state === 'applied') return 'applied';
          if (savedEmail.toLowerCase() === input.address && pending?.state !== 'pending') return skip('already_applied');
          const suggest = async () => {
            const suggestion: ReviewSuggestion = { name, field: 'email', value: input.address, label: assessed.result.reason,
              ...(contact && savedEmail ? { replaces_saved_email: { contact_id: contact.id, email: savedEmail } } : {}) };
            await saveDetails(old => ({ ...effect(old, { state: 'suggested', ready: false }), recipient_evidence: { ...old.recipient_evidence, [input.address]: assessed.evidence },
              suggestions: [...(Array.isArray(old.suggestions) ? old.suggestions : []).filter((item: ReviewSuggestion) => item.value !== input.address), suggestion] }));
            return 'suggested' as const;
          };
          if (!contact || (savedEmail && savedEmail.toLowerCase() !== input.address)) return suggest();
          if (pending?.state !== 'pending' && Array.isArray(detail.domains?.auto_applied) && detail.domains.auto_applied.length >= 100) return suggest();
          const before = pending?.state === 'pending' && savedEmail.toLowerCase() === input.address ? pending.before : contact.email ?? null;
          if (pending?.state !== 'pending') {
            let ceiling = false;
            await saveDetails(old => {
              const reservations = Object.values(old._queue_effects ?? {}).filter((item: any) => item?.state === 'pending'
                && !(old.auto_applied ?? []).some((change: any) => change.field === 'email' && change.after === item.address)).length;
              if ((old.auto_applied?.length ?? 0) + reservations >= 100) { ceiling = true; return old; }
              return effect(old, { state: 'pending', before, contact_id: contact.id });
            });
            if (ceiling) return suggest();
          } else if (savedEmail.toLowerCase() !== input.address && pending.before !== before) {
            await saveDetails(old => effect(old, { ...pending, before }));
          }
          await autoApplyRecipients([{ address: input.address, name, tier: assessed.result, savedEmail: null }], async () => {
            await checkpoint();
            // Preserve the existing blank-value comparison and dismissal guard, without changing enrollment flags.
            if (savedEmail.toLowerCase() !== input.address) {
              let update = service.from('decision_maker_candidates').update({ email: input.address, updated_at: new Date().toISOString() })
              .eq('id', contact.id).eq('lead_id', q.lead_id).is('dismissed_at', null);
              update = before === null ? update.is('email', null) : update.eq('email', before);
              const result = await update.select('id');
              if (result.error || !result.data?.length) throw new QueueStepError('contact_write');
            }
            await saveDetails(old => ({ ...old, recipient_evidence: { ...old.recipient_evidence, [input.address]: assessed.evidence },
              auto_applied: (old.auto_applied ?? []).some((item: any) => item.table === 'decision_maker_candidates' && item.id === contact.id && item.field === 'email' && item.after === input.address)
                ? old.auto_applied : [...(old.auto_applied ?? []), { table: 'decision_maker_candidates', id: contact.id, field: 'email', before, after: input.address }] }));
            return true;
          }, async content => {
            await checkpoint();
            const note = await service.from('lead_notes').upsert({ id: q.id, lead_id: q.lead_id, created_by: creator, note_type: 'general', content }, { onConflict: 'id', ignoreDuplicates: true });
            if (note.error) throw new QueueStepError('note_write');
          });
          await saveDetails(old => effect(old, { state: 'applied', ready: false }));
          return 'applied';
        }, retry));
      },
      async refreshReadiness(leadId) {
        const q = current(); if (leadId !== q.lead_id) throw Error('Invalid queue readiness scope');
        await serial(leadId, () => queueRetry('refresh_readiness', async () => {
          await checkpoint();
          const detail = await readDetails();
          const context = await queueRetry('context_read', () => loadRecipientContext(service, q.org_id, leadId), retry);
          const addresses = [context.lead.email, ...(Array.isArray(context.lead.additional_emails) ? context.lead.additional_emails : []), ...context.contacts.map(contact => contact.email)]
            .filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim().toLowerCase());
          const recipientEvidence = Object.fromEntries(await Promise.all([...new Set(addresses)].map(async address => [address, (await context.assess(address)).evidence])));
          const domains = (Array.isArray(detail.domains?.domains) ? detail.domains.domains : []).filter((domain: any) => typeof domain?.domain === 'string');
          const readiness = evaluateReadiness({ lead: context.lead, contacts: context.contacts, domains, recipientEvidence, validEmails: [], websiteSuspect: detail.domains?.website_suspect === true });
          await checkpoint();
          const latest = await readDetails();
          if (latest.domains?._queue_version !== detail.domains?._queue_version || latest.updated_at !== detail.updated_at) throw new QueueStepError('readiness_write');
          const result = await service.from('leads').update(readiness).eq('id', leadId).eq('org_id', q.org_id).eq('updated_at', context.lead.updated_at).select('id');
          if (result.error || !result.data?.length) throw new QueueStepError('readiness_write');
          await saveDetails(old => ({ ...old, ...readiness, recipient_evidence: { ...old.recipient_evidence, ...recipientEvidence },
            ...(old._queue_effects?.[q.id] ? { _queue_effects: { ...old._queue_effects, [q.id]: { ...old._queue_effects[q.id], ready: true } } } : {}) }),
            { version: detail.domains?._queue_version, timestamp: detail.updated_at });
        }, retry));
      },
    };
  }
  const root = scoped();
  root.recoverProven = async deadline => {
    let attempted = 0;
    const snapshots = new Map<string, { old: Record<string, any>; lead: any; contacts: any[] }>();
    for (let offset = 0; Date.now() < deadline && attempted < 4; offset += 100) {
      const page = await service.from('deep_find_check_queue').select('*').eq('status', 'done').in('verdict', ['valid', 'exists'])
        .not('person_key', 'is', null).gte('finished_at', new Date(Date.now() - QUEUE_RUN_WINDOW_MS).toISOString())
        .order('finished_at').order('id').range(offset, offset + 99);
      if (page.error || !Array.isArray(page.data)) { console.error('Background check step failed', 'recovery_read'); return; }
      for (const row of page.data as (QueueRow & { finished_at: string })[]) {
        if (Date.now() >= deadline || attempted >= 4) return;
        if (isRoleAddress(row.address)) continue;
        const scope = scoped(row, row.finished_at);
        try {
          const key = `${row.org_id}:${row.run_id}:${row.lead_id}`;
          if (!snapshots.has(key)) {
            const [detail, lead, contacts] = await Promise.all([
              service.from('deep_find_leads').select('domains').eq('org_id', row.org_id).eq('run_id', row.run_id).eq('lead_id', row.lead_id).maybeSingle(),
              service.from('leads').select('dismissed_suggestions').eq('org_id', row.org_id).eq('id', row.lead_id).maybeSingle(),
              service.from('decision_maker_candidates').select('id,email,first_name,last_name,dismissed_at').eq('lead_id', row.lead_id),
            ]);
            if (detail.error || lead.error || contacts.error || !detail.data || !lead.data) throw new QueueStepError('recovery_read', false);
            snapshots.set(key, { old: detail.data.domains ?? {}, lead: lead.data, contacts: contacts.data ?? [] });
          }
          const { old, lead, contacts } = snapshots.get(key)!; const state = old._queue_effects?.[row.id];
          if (state?.state === 'skipped' || state?.ready === true) continue;
          if (isSuggestionDismissed({ name: row.person_name ?? row.person_key ?? '', field: 'email', value: row.address }, lead)) continue;
          const contact = contacts.find(item => !item.dismissed_at && personKey(item) === row.person_key && (!row.contact_id || item.id === row.contact_id));
          if (row.contact_id && !contact) { console.info('Background check result skipped', 'contact_scope'); continue; }
          const represented = text(contact?.email).toLowerCase() === row.address
            || (old.suggestions ?? []).some((item: any) => text(item.value).toLowerCase() === row.address)
            || (old.auto_applied ?? []).some((item: any) => item.field === 'email' && text(item.after).toLowerCase() === row.address);
          if (represented && !state) continue;
          if (!await scope.canStillEdit(row.run_id, row.lead_id)) { console.info('Background check result skipped', 'no_access'); continue; }
          attempted++;
          if (!represented || state?.state === 'pending') {
            if (row.kind === 'smtp') await scope.recordOutcome({ orgId: row.org_id, leadId: row.lead_id, address: row.address, outcome: 'checked_valid' });
            await scope.applyProven({ orgId: row.org_id, leadId: row.lead_id, contactId: row.contact_id, address: row.address });
          }
          await scope.refreshReadiness(row.lead_id);
        } catch (error) { console.error('Background check recovery failed', error instanceof QueueStepError ? error.step : 'recovery_read'); }
      }
      if (page.data.length < 100) return;
    }
  };
  return root;
}
