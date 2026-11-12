import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgWorkerConfig: vi.fn(async () => ({ url: 'https://worker.fixture.test', secret: 'fixture-only' })) }))
vi.mock('../../supabase/functions/_shared/workerClient', () => ({ makeWorkerClient: vi.fn(() => ({ verifyEmail: vi.fn(), msExists: vi.fn(), scrapeSite: vi.fn(), lines: () => [] })) }))
vi.mock('../../supabase/functions/_shared/dnsLookup', () => ({ lookupMx: vi.fn(async () => 'mx'), cachedMailProvider: () => 'unknown' }))
vi.mock('../../supabase/functions/_shared/recipientContext', () => ({ loadRecipientContext: vi.fn() }))
import { createQueueDeps } from '../../supabase/functions/_shared/verifyQueueService'
import { makeWorkerClient } from '../../supabase/functions/_shared/workerClient'
import { loadRecipientContext } from '../../supabase/functions/_shared/recipientContext'
import { replyDatabase } from './replyTestDatabase'

const address = 'jo.smith@fixture.test'
const queueRow = { id: 'queue', org_id: 'org', run_id: 'run', lead_id: 'lead', contact_id: 'contact', address, domain: 'fixture.test', kind: 'smtp', person_key: 'jo smith', person_name: 'Jo Smith', attempts: 1 }
beforeEach(() => vi.clearAllMocks())
function fixture(contact = {}) {
  const db = replyDatabase({ leads: [{ id: 'lead', org_id: 'org', business_name: 'Fixture Ltd', updated_at: 'lead-v1' }], org_members: [{ org_id: 'org', user_id: 'creator' }],
    deep_find_runs: [{ id: 'run', org_id: 'org', created_by: 'creator', status: 'completed', started_at: new Date().toISOString() }],
    deep_find_leads: [{ id: 'result', run_id: 'run', lead_id: 'lead', org_id: 'org', status: 'done', updated_at: 'result-v1', domains: { domains: [], suggestions: [], auto_applied: [], website_suspect: false } }],
    decision_maker_candidates: [{ id: 'contact', lead_id: 'lead', first_name: 'Jo', last_name: 'Smith', title: 'Director', email: null, include_in_sequences: true, updated_at: 'contact-v1', ...contact }],
  })
  db.service.rpc = vi.fn(async () => ({ data: true, error: null }))
  loadRecipientContext.mockImplementation(async () => ({ lead: db.tables.leads[0], contacts: db.tables.decision_maker_candidates.filter(c => !c.dismissed_at), assess: async email => ({
    evidence: { forAddress: email, syntaxValid: true, hasMailServer: true, generated: true, roleNeedsReview: false, checker: email === address ? 'valid' : 'invalid' },
    result: { tier: email === address ? 'T1' : 'never', basis: email === address ? 'checker_valid' : 'checker_invalid', reason: email === address ? 'The checker confirmed this address.' : 'The checker says this address does not exist.' },
  }) }))
  const root = createQueueDeps(db.service)
  return { db, root, deps: root.forRow(queueRow), input: { orgId: 'org', leadId: 'lead', contactId: 'contact', address } }
}
it('creates fresh per-row worker clients without gate, retry or time-left options', async () => {
  const f = fixture(); const second = f.root.forRow({ ...queueRow, id: 'queue2' })
  await f.deps.canStillEdit('run', 'lead'); await second.canStillEdit('run', 'lead')
  expect(f.deps.workerFor('org')).not.toBe(second.workerFor('org'))
  expect(makeWorkerClient).toHaveBeenCalledTimes(2)
  expect(Object.keys(makeWorkerClient.mock.calls[0][0]).sort()).toEqual(['config', 'orgId', 'usage'])
})
it.each(['cancelled', 'deleted', 'member-left', 'cannot-edit', 'wrong-org'])('refuses %s before mutations', async reason => {
  const f = fixture()
  if (reason === 'cancelled') f.db.tables.deep_find_runs[0].status = 'cancelled'
  if (reason === 'deleted') f.db.tables.leads.length = 0
  if (reason === 'member-left') f.db.tables.org_members.length = 0
  if (reason === 'cannot-edit') f.db.service.rpc.mockResolvedValue({ data: false, error: null })
  if (reason === 'wrong-org') f.db.tables.leads[0].org_id = 'other'
  expect(await f.deps.canStillEdit('run', 'lead')).toBe(false)
  expect(f.db.writes).toHaveLength(0)
})
it('fills a blank contact, records Undo and the existing note, and preserves enrollment flags', async () => {
  const f = fixture(); await f.deps.canStillEdit('run', 'lead')
  expect(await f.deps.applyProven(f.input)).toBe('applied')
  expect(f.db.tables.decision_maker_candidates[0]).toMatchObject({ email: address, include_in_sequences: true })
  expect(f.db.tables.lead_notes[0]).toMatchObject({ created_by: 'creator', content: `Added ${address}: The checker confirmed this address.` })
  expect(f.db.tables.deep_find_leads[0].domains.auto_applied).toContainEqual({ table: 'decision_maker_candidates', id: 'contact', field: 'email', before: null, after: address })
  expect(f.db.writes.every(write => !Object.hasOwn(write.patch, 'include_in_sequences') && write.table !== 'sequence_enrollments')).toBe(true)
})
it('offers a proven replacement without touching the saved invalid address', async () => {
  const f = fixture({ email: 'wrong@fixture.test' }); await f.deps.canStillEdit('run', 'lead')
  expect(await f.deps.applyProven(f.input)).toBe('suggested')
  expect(f.db.tables.decision_maker_candidates[0].email).toBe('wrong@fixture.test')
  expect(f.db.tables.deep_find_leads[0].domains.suggestions[0]).toMatchObject({ name: 'Jo Smith', value: address, replaces_saved_email: { contact_id: 'contact', email: 'wrong@fixture.test' } })
})
it('never fills a dismissed contact or an address without current T1/T2 evidence', async () => {
  const f = fixture({ dismissed_at: '2026-11-12' }); await f.deps.canStillEdit('run', 'lead')
  expect(await f.deps.applyProven(f.input)).toBe('skipped')
  const g = fixture(); await g.deps.canStillEdit('run', 'lead')
  const bad = g.root.forRow({ ...queueRow, address: 'bad@fixture.test' }); await bad.canStillEdit('run', 'lead')
  expect(await bad.applyProven({ ...g.input, address: 'bad@fixture.test' })).toBe('skipped')
})
it('records an exact queue outcome with a stable source and no sequence pause', async () => {
  const f = fixture(); await f.deps.canStillEdit('run', 'lead')
  await f.deps.recordOutcome({ ...f.input, outcome: 'checked_invalid' })
  expect(f.db.service.rpc).toHaveBeenCalledWith('record_email_outcome', expect.objectContaining({ p_org_id: 'org', p_lead_id: 'lead', p_address: address, p_source_message_id: 'queue:queue', p_pause_sequences: false }))
})
it('recomputes readiness from saved facts and the current shared tier evidence', async () => {
  const f = fixture({ email: address }); await f.deps.canStillEdit('run', 'lead'); await f.deps.refreshReadiness('lead')
  expect(f.db.tables.leads[0].readiness).toBe('ready')
  f.db.tables.decision_maker_candidates[0].email = 'wrong@fixture.test'
  await f.deps.refreshReadiness('lead')
  expect(f.db.tables.leads[0].readiness).toBe('almost')
})
it('preserves a concurrent first-pass checker checkpoint instead of overwriting its JSON', async () => {
  const f = fixture({ email: address }); await f.deps.canStillEdit('run', 'lead')
  const from = f.db.service.from; let injected = false
  f.db.service.from = table => {
    const query = from(table); const update = query.update
    query.update = patch => {
      if (table === 'deep_find_leads' && !injected) { injected = true; f.db.tables.deep_find_leads[0].domains._verify_gate = { concurrent: true } }
      return update(patch)
    }
    return query
  }
  await expect(f.deps.refreshReadiness('lead')).rejects.toThrow('changed concurrently')
  expect(f.db.tables.deep_find_leads[0].domains._verify_gate).toEqual({ concurrent: true })
})
it('keeps a concurrently typed email and leaves its enrollment flag unchanged', async () => {
  const f = fixture(); await f.deps.canStillEdit('run', 'lead')
  const from = f.db.service.from
  f.db.service.from = table => {
    const query = from(table); const update = query.update
    query.update = patch => {
      if (table === 'decision_maker_candidates') f.db.tables.decision_maker_candidates[0].email = 'typed@fixture.test'
      return update(patch)
    }
    return query
  }
  expect(await f.deps.applyProven(f.input)).toBe('skipped')
  expect(f.db.tables.decision_maker_candidates[0]).toMatchObject({ email: 'typed@fixture.test', include_in_sequences: true })
  expect(f.db.tables.lead_notes).toHaveLength(0)
})
it('keeps the existing 100-entry automatic-change guard and offers proof for review instead', async () => {
  const f = fixture(); f.db.tables.deep_find_leads[0].domains.auto_applied = Array.from({ length: 100 }, () => ({ field: 'email' }))
  await f.deps.canStillEdit('run', 'lead')
  expect(await f.deps.applyProven(f.input)).toBe('suggested')
  expect(f.db.tables.decision_maker_candidates[0].email).toBeNull()
})
