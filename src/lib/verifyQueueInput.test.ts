import { expect, it } from 'vitest'
import { buildQueuePlan } from '../../supabase/functions/_shared/verifyQueueInput'

const base = { people: [{ personKey: 'jo smith', name: 'Jo Smith', first: 'Jo', last: 'Smith', contactId: 'contact', priority: 0 }], domains: [{ domain: 'fixture.test', provider: 'microsoft' as const }], savedAddresses: [], candidatesFor: () => ['jo.smith@fixture.test', 'jsmith@fixture.test'], checked: new Map() }
it('maps durable hosted catch-all suppression to Microsoft background checks', () => {
  const plan = buildQueuePlan({ ...base, checked: new Map([['old@fixture.test', { ok: true, value: { status: 'unverifiable', reason: 'hosted_unverifiable' } }]]) })
  expect(plan.map(row => row.kind)).toEqual(['ms_exists', 'ms_exists'])
})
it('never requeues confirmed role or invalid addresses from the in-run map', () => {
  const plan = buildQueuePlan({ ...base, savedAddresses: [{ address: 'info@fixture.test', contactId: null, personKey: null, personName: null }], checked: new Map([
    ['info@fixture.test', { ok: true, value: { status: 'risky', reason: 'role_account' } }],
    ['jo.smith@fixture.test', { ok: true, value: { status: 'invalid', reason: 'mailbox_missing' } }],
  ]) })
  expect(plan.map(row => row.address)).toEqual(['jsmith@fixture.test'])
})
it('keeps timeouts retryable and routes Microsoft no-answer domains through ms_exists', () => {
  const plan = buildQueuePlan({ ...base, checked: new Map([['jo.smith@fixture.test', { ok: false, failure: 'timeout', line: 'fixture' }]]) })
  expect(plan.map(row => row.kind)).toEqual(['ms_exists', 'ms_exists'])
})
