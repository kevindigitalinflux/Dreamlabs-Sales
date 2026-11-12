import { expect, it, vi } from 'vitest'
import { drainQueue, enqueueLeadChecks } from '../../supabase/functions/_shared/verifyQueue'

const row = (patch = {}) => ({ id: 'q1', org_id: 'org', run_id: 'run', lead_id: 'lead', contact_id: 'contact', address: 'jo@fixture.test', domain: 'fixture.test', kind: 'smtp', person_key: 'jo smith', person_name: 'Jo Smith', attempts: 1, ...patch })
function fixture(batches = [[row()]]) {
  const pending = [...batches]; let clock = 0
  const worker = { verifyEmail: vi.fn(async () => ({ ok: true, value: { status: 'valid', reason: 'deliverable' } })), msExists: vi.fn(async () => ({ ok: true, value: 'exists' })) }
  const deps = {
    rpc: vi.fn(async (name) => ({ data: name === 'deep_find_checks_claim' ? pending.shift() ?? [] : name === 'deep_find_checks_finish' ? true : 0, error: null })),
    workerFor: vi.fn(() => worker), recordOutcome: vi.fn(async () => {}), applyProven: vi.fn(async () => 'applied'), refreshReadiness: vi.fn(async () => {}),
    canStillEdit: vi.fn(async () => true), now: () => clock,
  }
  const calls = name => deps.rpc.mock.calls.filter(call => call[0] === name)
  return { deps, worker, calls, setClock: value => { clock = value } }
}
it('(a) records valid, applies proof, refreshes once, and expires again after the loop finishes', async () => {
  const f = fixture()
  expect(await drainQueue(f.deps, 0, 140_000)).toEqual({ processed: 1 })
  expect(f.deps.recordOutcome).toHaveBeenCalledWith({ orgId: 'org', leadId: 'lead', address: 'jo@fixture.test', outcome: 'checked_valid' })
  expect(f.deps.applyProven).toHaveBeenCalledWith({ orgId: 'org', leadId: 'lead', contactId: 'contact', address: 'jo@fixture.test' })
  expect(f.deps.refreshReadiness).toHaveBeenCalledTimes(1)
  expect(f.calls('deep_find_checks_expire')).toHaveLength(3)
  expect(f.calls('deep_find_checks_claim')[0][1]).toEqual({ p_max: 4 })
  expect(f.calls('deep_find_checks_finish')[0][1]).toMatchObject({ p_id: 'q1', p_status: 'done', p_verdict: 'valid' })
  expect(f.calls('deep_find_checks_finish')).toHaveLength(1)
})
it('(b) requeues timeout for ninety seconds without recording an outcome', async () => {
  const f = fixture(); f.worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'unverifiable', reason: 'timeout' } })
  await drainQueue(f.deps, 0, 140_000)
  expect(f.calls('deep_find_checks_finish')[0][1]).toMatchObject({ p_status: 'queued', p_reason: 'timeout', p_next_at: new Date(90_000).toISOString() })
  expect(f.deps.recordOutcome).not.toHaveBeenCalled(); expect(f.deps.applyProven).not.toHaveBeenCalled()
})
it.each(['lost membership', 'cancelled run', 'deleted lead'])('(c/i) skips %s without downstream effects', async () => {
  const f = fixture(); f.deps.canStillEdit.mockResolvedValue(false)
  await drainQueue(f.deps, 0, 140_000)
  expect(f.calls('deep_find_checks_finish')[0][1]).toMatchObject({ p_status: 'skipped', p_reason: 'no_access' })
  for (const callback of [f.deps.workerFor, f.deps.recordOutcome, f.deps.applyProven, f.deps.refreshReadiness]) expect(callback).not.toHaveBeenCalled()
})
it('(d) skips limit_reached and makes no more claim calls this tick', async () => {
  const f = fixture([[row()], [row({ id: 'q2' })]]); f.worker.verifyEmail.mockResolvedValue({ ok: false, failure: 'limit_reached' })
  await drainQueue(f.deps, 0, 140_000)
  expect(f.calls('deep_find_checks_finish')[0][1]).toMatchObject({ p_status: 'skipped', p_reason: 'limit_reached' })
  expect(f.calls('deep_find_checks_claim')).toHaveLength(1)
})
it('(e) never claims inside the final forty-second reserve', async () => {
  const f = fixture(); f.setClock(100_000)
  expect(await drainQueue(f.deps, 0, 140_000)).toEqual({ processed: 0 }); expect(f.deps.rpc).not.toHaveBeenCalled()
})
it('(f) finishes Microsoft not_found without writing an SMTP outcome', async () => {
  const f = fixture([[row({ kind: 'ms_exists' })]]); f.worker.msExists.mockResolvedValue({ ok: true, value: 'not_found' })
  await drainQueue(f.deps, 0, 140_000)
  expect(f.calls('deep_find_checks_finish')[0][1]).toMatchObject({ p_status: 'done', p_verdict: 'not_found' })
  expect(f.deps.recordOutcome).not.toHaveBeenCalled(); expect(f.deps.applyProven).not.toHaveBeenCalled(); expect(f.deps.refreshReadiness).toHaveBeenCalledTimes(1)
})
it('(g) preserves the enqueue RPC unique-address result across two leads', async () => {
  const unique = new Set(); const rpc = vi.fn(async (_name, { p_rows }) => ({ data: p_rows.filter(item => { const key = `${item.run_id}:${item.address}:${item.kind}`; if (unique.has(key)) return false; unique.add(key); return true }).length, error: null }))
  const candidate = { address: 'jo@fixture.test', domain: 'fixture.test', kind: 'smtp', personKey: 'jo smith', personName: 'Jo Smith', contactId: null, rank: 0 }
  const counts = await Promise.all(['lead1', 'lead2'].map(leadId => enqueueLeadChecks({ rpc }, { orgId: 'org', runId: 'run', leadId, plan: [candidate] })))
  expect(counts.reduce((a, b) => a + b)).toBe(1); expect(rpc).toHaveBeenCalledTimes(2)
  expect(rpc.mock.calls[0][1].p_rows[0]).toMatchObject({ person_key: 'jo smith', person_name: 'Jo Smith', contact_id: null })
})
it('(h) offers a valid replacement without deleting the invalid saved address', async () => {
  const saved = 'wrong@fixture.test'; const f = fixture([[row({ address: saved })], [row({ id: 'guess', address: 'jo.smith@fixture.test' })]])
  f.worker.verifyEmail.mockImplementation(async address => ({ ok: true, value: { status: address === saved ? 'invalid' : 'valid', reason: address === saved ? 'mailbox_not_found' : 'deliverable' } }))
  f.deps.applyProven.mockImplementation(async () => 'suggested')
  await drainQueue(f.deps, 0, 140_000)
  expect(saved).toBe('wrong@fixture.test')
  expect(f.deps.applyProven).toHaveBeenCalledTimes(1); expect(f.deps.applyProven.mock.calls[0][0].address).toBe('jo.smith@fixture.test')
  expect(f.deps.refreshReadiness).toHaveBeenCalledTimes(2)
  expect(f.deps.rpc.mock.calls.every(([name]) => !/delete/.test(name))).toBe(true)
})
it('(j) isolates a throwing row and runs the other claimed rows concurrently', async () => {
  const f = fixture([[row(), row({ id: 'q2', address: 'pat@second.test', domain: 'second.test' })]])
  let release; const started = new Promise(resolve => { release = resolve })
  f.worker.verifyEmail.mockImplementation(async address => { if (address === 'jo@fixture.test') { await started; throw Error('fixture failure') } release(); return { ok: true, value: { status: 'valid', reason: 'deliverable' } } })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await drainQueue(f.deps, 0, 140_000)).toEqual({ processed: 1 })
  expect(f.calls('deep_find_checks_finish')[0][1].p_id).toBe('q2'); expect(log).toHaveBeenCalled(); log.mockRestore()
})
it('R10 does not expire again for a valid saved shared inbox with no person key', async () => {
  const f = fixture([[row({ person_key: null, contact_id: null, address: 'info@fixture.test' })]])
  await drainQueue(f.deps, 0, 140_000)
  expect(f.calls('deep_find_checks_expire')).toHaveLength(2); expect(f.deps.applyProven).not.toHaveBeenCalled()
})
it('R10 expires only once extra after multiple named-person proofs in one loop', async () => {
  const f = fixture([[row(), row({ id: 'q2', address: 'pat@second.test', domain: 'second.test', kind: 'ms_exists' })]])
  await drainQueue(f.deps, 0, 140_000)
  expect(f.calls('deep_find_checks_expire')).toHaveLength(3); expect(f.deps.workerFor).toHaveBeenCalledTimes(2)
})
it('R8 records role_account as checked_valid without applying it to a person', async () => {
  const f = fixture(); f.worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'risky', reason: 'role_account' } })
  await drainQueue(f.deps, 0, 140_000)
  expect(f.deps.recordOutcome.mock.calls[0][0].outcome).toBe('checked_valid'); expect(f.deps.applyProven).not.toHaveBeenCalled()
})
it('does not write effects if authorization is revoked during the worker call', async () => {
  const f = fixture(); f.deps.canStillEdit.mockResolvedValueOnce(true).mockResolvedValue(false)
  await drainQueue(f.deps, 0, 140_000)
  expect(f.calls('deep_find_checks_finish')[0][1]).toMatchObject({ p_status: 'skipped', p_reason: 'no_access' })
  for (const callback of [f.deps.recordOutcome, f.deps.applyProven, f.deps.refreshReadiness]) expect(callback).not.toHaveBeenCalled()
})
it('does not record or apply a result when running-only finish loses its row', async () => {
  const f = fixture(); const rpc = f.deps.rpc
  f.deps.rpc = vi.fn(async (...args) => args[0] === 'deep_find_checks_finish' ? { data: false, error: null } : rpc(...args))
  expect(await drainQueue(f.deps, 0, 140_000)).toEqual({ processed: 0 }); expect(f.deps.recordOutcome).not.toHaveBeenCalled(); expect(f.deps.applyProven).not.toHaveBeenCalled()
})
