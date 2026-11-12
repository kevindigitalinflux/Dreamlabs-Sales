import { expect, it, vi } from 'vitest'
vi.mock('../../supabase/functions/_shared/dnsLookup', () => ({ lookupMx: vi.fn(async () => 'mx'), cachedMailProvider: () => 'hosted' }))
import { loadRecipientContext } from '../../supabase/functions/_shared/recipientContext'
// @ts-expect-error Existing JavaScript database fixture has no declaration file.
import { replyDatabase } from './replyTestDatabase'

const address = 'jo@fixture.test'
const row = { org_id: 'org', lead_id: 'lead', address, kind: 'ms_exists', status: 'done', verdict: 'exists', finished_at: '2026-11-12T10:00:00Z' }
const fixture = (rows: object[], proof = {}) => replyDatabase({ leads: [{ id: 'lead', org_id: 'org', email: address }], decision_maker_candidates: [], email_outcomes: [], deep_find_leads: [{ lead_id: 'lead', org_id: 'org', domains: { recipient_evidence: { [address]: proof } } }], deep_find_check_queue: rows })
it('reads the newest exact scoped Microsoft verdict', async () => {
  const db = fixture([{ ...row, verdict: 'not_found', finished_at: '2026-11-12T11:00:00Z' }, row, { ...row, org_id: 'other', verdict: 'exists' }, { ...row, address: 'other@fixture.test' }])
  expect((await (await loadRecipientContext(db.service as never, 'org', 'lead')).assess(address)).result).toMatchObject({ tier: 'T3', basis: 'ms_not_found' })
})
it('accepts Microsoft exists evidence for that address', async () => {
  const db = fixture([row])
  expect((await (await loadRecipientContext(db.service as never, 'org', 'lead')).assess(address)).result).toMatchObject({ tier: 'T1', basis: 'ms_exists' })
})
it.each([{ status: 'running' }, { kind: 'smtp' }, { verdict: 'unverifiable' }, { lead_id: 'other' }])('ignores non-proving rows %j', async patch => {
  const db = fixture([{ ...row, ...patch }], { msExists: 'exists', roleConfirmed: true })
  const result = await (await loadRecipientContext(db.service as never, 'org', 'lead')).assess(address)
  expect(result.evidence.msExists).toBeUndefined()
  expect(result.evidence.roleConfirmed).not.toBe(true)
  expect(result.result.tier).toBe('T3')
})
it.each([{ error: true }, { throws: true }])('keeps queue read failures nonfatal %j', async mode => {
  const db = fixture([row]); const from = db.service.from
  db.service.from = ((table: string) => { if (table === 'deep_find_check_queue' && mode.throws) throw Error('fixture failure'); return from(table) }) as typeof db.service.from
  if (mode.error) db.failures.add('deep_find_check_queue:select')
  expect((await (await loadRecipientContext(db.service as never, 'org', 'lead')).assess(address)).evidence.msExists).toBeUndefined()
})
it.each([
  { kind: 'smtp', status: 'done', reason: 'role_account', expected: 'T1' },
  { kind: 'smtp', status: 'running', reason: 'role_account', expected: 'T3' },
  { kind: 'smtp', status: 'done', reason: 'catch_all', expected: 'T3' },
  { kind: 'ms_exists', status: 'done', reason: 'role_account', expected: 'T3' },
  { kind: 'smtp', status: 'done', reason: 'role_account', address: 'other@fixture.test', expected: 'T3' },
])('requires exact done SMTP role_account evidence %j', async ({ expected, ...patch }) => {
  const db = fixture([{ ...row, address: 'info@fixture.test', ...patch }])
  expect((await (await loadRecipientContext(db.service as never, 'org', 'lead')).assess('info@fixture.test')).result.tier).toBe(expected)
})
