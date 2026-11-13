import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgWorkerConfig: vi.fn(async () => null) }))
vi.mock('../../supabase/functions/_shared/dnsLookup', () => ({ lookupMx: vi.fn(async () => 'mx'), cachedMailProvider: () => 'microsoft' }))
import { createQueueDeps } from '../../supabase/functions/_shared/verifyQueueService'
import { loadRecipientContext } from '../../supabase/functions/_shared/recipientContext'
import { replyDatabase } from './replyTestDatabase'
import { makeRunVerifyGate, saveRunResult } from '../../supabase/functions/_shared/runVerifyGateStore'
import { reserveRunRegistryProof } from '../../supabase/functions/_shared/registryProofAllowance'

const address = 'jo.smith@fixture.test'
const q = { id: '00000000-0000-4000-8000-000000000001', org_id: 'org', run_id: 'run', lead_id: 'lead', contact_id: 'contact', address, domain: 'fixture.test', kind: 'ms_exists', person_key: 'jo smith', person_name: 'Jo Smith', attempts: 1, status: 'done', verdict: 'exists', reason: 'exists', finished_at: new Date().toISOString() }
const input = { orgId: 'org', leadId: 'lead', contactId: 'contact', address }
function fixture() {
  const db = replyDatabase({ leads: [{ id: 'lead', org_id: 'org', business_name: 'Fixture', updated_at: 'lead-v1' }], decision_maker_candidates: [{ id: 'contact', lead_id: 'lead', kind: 'person', first_name: 'Jo', last_name: 'Smith', title: 'Director', email: null, dismissed_at: null, include_in_sequences: true }],
    org_members: [{ org_id: 'org', user_id: 'creator' }], deep_find_runs: [{ id: 'run', org_id: 'org', status: 'completed', created_by: 'creator', started_at: new Date().toISOString() }],
    deep_find_leads: [{ id: 'result', run_id: 'run', lead_id: 'lead', org_id: 'org', status: 'done', updated_at: 'result-v1', domains: { domains: [], recipient_evidence: {}, auto_applied: [], suggestions: [] } }],
    deep_find_check_queue: [{ ...q }], email_outcomes: [], outreach_blocklist: [],
  })
  db.service.rpc = vi.fn(async () => ({ data: true, error: null }))
  // Model independent HTTP snapshots and inject real zero-row optimistic conflicts, not thrown fake worker answers.
  const from = db.service.from; const hooks = { leadConflicts: 0, contactConflicts: 0, contactApplied: 0, detailConflicts: 0, detailWrites: 0, beforeUpdate: null }
  db.service.from = table => {
    const query = from(table); const update = query.update; const then = query.then; let isWrite = false
    query.update = patch => {
      isWrite = true
      hooks.beforeUpdate?.(table, patch)
      if (table === 'deep_find_leads') { hooks.detailWrites++; if (hooks.detailConflicts > 0) { hooks.detailConflicts--; const current = db.tables.deep_find_leads[0]; current.updated_at = `conflict-${hooks.detailWrites}`; current.domains = { ...current.domains, _queue_version: (current.domains._queue_version ?? 0) + 1 } } }
      if (table === 'leads' && hooks.leadConflicts > 0) { hooks.leadConflicts--; db.tables.leads[0].updated_at = `lead-conflict-${hooks.leadConflicts}` }
      if (table === 'decision_maker_candidates' && hooks.contactConflicts > 0) { hooks.contactConflicts--; return { ...query, select: async () => ({ data: [], error: null }) } }
      return update(patch)
    }
    query.then = resolve => then(result => { if (table === 'decision_maker_candidates' && isWrite && result.data?.length) hooks.contactApplied++; return resolve(structuredClone(result)) })
    return query
  }
  const wait = vi.fn(async () => {})
  const root = createQueueDeps(db.service, undefined, { wait, random: () => 0 })
  return { db, hooks, wait, root, deps: root.forRow(q), next: () => createQueueDeps(db.service, undefined, { wait, random: () => 0 }) }
}
beforeEach(() => vi.restoreAllMocks())
it('real queuedProof reads the exact done Microsoft proof absent from stored JSON', async () => {
  const f = fixture(); const assessed = await (await loadRecipientContext(f.db.service, 'org', 'lead')).assess(address)
  expect(assessed.evidence.msExists).toBe('exists'); expect(assessed.result.tier).toBe('T1')
})
it('retries three metadata conflicts with fresh reads and succeeds on the fourth write', async () => {
  const f = fixture(); f.hooks.detailConflicts = 3
  expect(await f.deps.applyProven(input)).toBe('applied')
  expect(f.wait).toHaveBeenCalledTimes(3)
  expect(f.db.tables.decision_maker_candidates[0].email).toBe(address)
  expect(f.db.tables.lead_notes).toHaveLength(1)
  expect(f.db.tables.deep_find_leads[0].domains.recipient_evidence[address].msExists).toBe('exists')
})
it('recovers a permanently conflicted done proof on a later tick without checking the worker again', async () => {
  const f = fixture(); f.hooks.detailConflicts = Infinity
  await expect(f.deps.applyProven(input)).rejects.toThrow()
  expect(f.db.tables.decision_maker_candidates[0].email).toBeNull()
  f.hooks.detailConflicts = 0
  await f.next().recoverProven(Date.now() + 100_000)
  expect(f.db.tables.decision_maker_candidates[0].email).toBe(address); expect(f.db.tables.lead_notes).toHaveLength(1)
  await f.next().recoverProven(Date.now() + 100_000)
  expect(f.db.tables.lead_notes).toHaveLength(1)
  expect(f.db.tables.deep_find_leads[0].domains.recipient_evidence[address].msExists).toBe('exists')
  expect(f.db.tables.leads[0].readiness).toBe('ready')
})
it('two independent invocations interleave readiness and a fill without losing proof or duplicating its note', async () => {
  const f = fixture(); let release; let reached
  const paused = new Promise(resolve => { reached = resolve }); const resume = new Promise(resolve => { release = resolve })
  const original = f.db.service.from; let intercept = true
  f.db.service.from = table => {
    const query = original(table); const then = query.then
    query.then = resolve => then(async result => {
      if (table === 'deep_find_leads' && intercept) { intercept = false; reached(); await resume }
      resolve(result)
    }); return query
  }
  const first = f.root.forRow(q).refreshReadiness('lead'); await paused
  expect(await f.next().forRow(q).applyProven(input)).toBe('applied'); release(); await first
  expect(f.db.tables.decision_maker_candidates[0]).toMatchObject({ email: address, include_in_sequences: true })
  expect(f.db.tables.lead_notes).toHaveLength(1)
  expect(f.db.tables.deep_find_leads[0].domains.recipient_evidence[address].msExists).toBe('exists')
  expect(f.db.tables.leads[0].readiness).toBe('ready')
})
it('retries a stale lead readiness update instead of abandoning the done row', async () => {
  const f = fixture(); f.hooks.leadConflicts = 3
  await f.deps.refreshReadiness('lead')
  expect(f.wait).toHaveBeenCalledTimes(3)
})
it('does not permanently skip a proven Microsoft row when queuedProof temporarily cannot be read', async () => {
  const f = fixture(); f.db.failures.add('deep_find_check_queue:select')
  await expect(f.deps.applyProven(input)).rejects.toThrow()
  expect(f.db.tables.decision_maker_candidates[0].email).toBeNull()
  f.db.failures.delete('deep_find_check_queue:select')
  await f.next().recoverProven(Date.now() + 100_000)
  expect(f.db.tables.decision_maker_candidates[0].email).toBe(address)
})
it('two simultaneous invocations applying the same proof produce exactly one fill and one note', async () => {
  const f = fixture()
  await Promise.all([f.deps.applyProven(input), f.next().forRow(q).applyProven(input)])
  expect(f.db.tables.decision_maker_candidates[0].email).toBe(address)
  expect(f.db.tables.lead_notes).toHaveLength(1)
  expect(f.hooks.contactApplied).toBe(1)
})
it('recovers after a successful contact fill followed by a failed note without adding a duplicate', async () => {
  const f = fixture(); f.db.failures.add('lead_notes:upsert')
  await expect(f.deps.applyProven(input)).rejects.toThrow()
  expect(f.db.tables.decision_maker_candidates[0].email).toBe(address)
  f.db.failures.delete('lead_notes:upsert')
  await f.next().recoverProven(Date.now() + 100_000)
  await f.next().recoverProven(Date.now() + 100_000)
  expect(f.db.tables.lead_notes).toHaveLength(1)
})
it('defers proof effects while the first-pass result is still being saved, then recovers after it is done', async () => {
  const f = fixture(); f.db.tables.deep_find_leads[0].status = 'running'
  await expect(f.deps.applyProven(input)).rejects.toThrow()
  expect(f.db.tables.decision_maker_candidates[0].email).toBeNull()
  f.db.tables.deep_find_leads[0].status = 'done'
  await f.next().recoverProven(Date.now() + 100_000)
  expect(f.db.tables.decision_maker_candidates[0].email).toBe(address)
})
it('the first-pass result saver advances the shared queue metadata version', async () => {
  const f = fixture(); f.db.tables.deep_find_leads[0].status = 'running'; f.db.tables.deep_find_leads[0].domains._queue_version = 4
  await saveRunResult(f.db.service, 'result', { status: 'done', domains: { steps: [] }, updated_at: 'next' })
  expect(f.db.tables.deep_find_leads[0].domains._queue_version).toBe(5)
})
it('checker and registry checkpoint writers advance the version without changing their policies', async () => {
  const f = fixture(); f.db.tables.deep_find_leads[0].domains._queue_version = 4
  await makeRunVerifyGate(f.db.service, 'org', 'run').run(address, 100_000, async () => ({ ok: true, value: { status: 'valid', reason: 'deliverable' } }))
  expect(f.db.tables.deep_find_leads[0].domains._queue_version).toBeGreaterThan(4)
  const before = f.db.tables.deep_find_leads[0].domains._queue_version
  expect(await reserveRunRegistryProof(f.db.service, 'org', 'run', 'lead')).toBe(true)
  expect(f.db.tables.deep_find_leads[0].domains._queue_version).toBe(before + 1)
})
it.each(['cancelled', 'expired', 'dismissed', 'opted_out', 'role', 'wrong_contact'])('recovery preserves the %s guard', async rule => {
  const f = fixture()
  if (rule === 'cancelled') f.db.tables.deep_find_runs[0].status = 'cancelled'
  if (rule === 'expired') f.db.tables.deep_find_runs[0].started_at = new Date(Date.now() - 61 * 60_000).toISOString()
  if (rule === 'dismissed') f.db.tables.decision_maker_candidates[0].dismissed_at = new Date().toISOString()
  if (rule === 'opted_out') f.db.tables.leads[0].opted_out = true
  if (rule === 'role') f.db.tables.deep_find_check_queue[0].address = 'info@fixture.test'
  if (rule === 'wrong_contact') f.db.tables.deep_find_check_queue[0].contact_id = 'another-contact'
  const request = vi.spyOn(globalThis, 'fetch')
  await f.root.recoverProven(Date.now() + 100_000)
  expect(f.db.tables.decision_maker_candidates[0].email).toBeNull(); expect(f.db.tables.lead_notes).toHaveLength(0)
  expect(request).not.toHaveBeenCalled()
})
it('attempts at most four recoveries per tick and progresses past settled rows next tick', async () => {
  const f = fixture()
  f.db.tables.deep_find_check_queue = Array.from({ length: 6 }, (_, index) => ({ ...q, id: `00000000-0000-4000-8000-00000000000${index + 1}`, address: `jo.smith${index}@fixture.test` }))
  await f.root.recoverProven(Date.now() + 100_000)
  expect(Object.keys(f.db.tables.deep_find_leads[0].domains._queue_effects)).toHaveLength(4)
  await f.next().recoverProven(Date.now() + 100_000)
  expect(Object.keys(f.db.tables.deep_find_leads[0].domains._queue_effects)).toHaveLength(6)
  expect(f.db.tables.lead_notes).toHaveLength(1)
})
it('refreshes the old-value guard when a concurrent edit changes one blank representation into another', async () => {
  const f = fixture(); let changed = false
  f.hooks.beforeUpdate = table => { if (table === 'decision_maker_candidates' && !changed) { changed = true; f.db.tables.decision_maker_candidates[0].email = ' ' } }
  expect(await f.deps.applyProven(input)).toBe('applied')
  expect(f.db.tables.decision_maker_candidates[0]).toMatchObject({ email: address, include_in_sequences: true })
  expect(f.db.tables.deep_find_leads[0].domains.auto_applied[0].before).toBe(' ')
  expect(f.db.tables.lead_notes).toHaveLength(1)
})
