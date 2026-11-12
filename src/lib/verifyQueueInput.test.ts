import { expect, it } from 'vitest'
import { buildQueuePlan, savedLeadAddressPerson } from '../../supabase/functions/_shared/verifyQueueInput'

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
const owner = { first: 'John', last: 'Smith' }
it('F1 never attributes another person’s saved lead address to the owner', () => {
  expect(savedLeadAddressPerson('jane@firm.com', owner, null)).toEqual({ personKey: null, personName: null })
})
it('F1 attributes a matching ranked address to the owner', () => {
  expect(savedLeadAddressPerson('john.smith@firm.com', owner, null)).toEqual({ personKey: 'john smith', personName: 'John Smith' })
})
it('F1 matches ranked addresses case-insensitively on the address domain', () => {
  expect(savedLeadAddressPerson(' JOHN.SMITH@FIRM.COM ', owner, null)).toEqual({ personKey: 'john smith', personName: 'John Smith' })
})
it('F1 never attributes a role address to an owner', () => {
  expect(savedLeadAddressPerson('info@firm.com', owner, null)).toEqual({ personKey: null, personName: null })
})
it('F1 leaves owner attribution blank when there is no owner', () => {
  expect(savedLeadAddressPerson('john.smith@firm.com', null, null)).toEqual({ personKey: null, personName: null })
})
