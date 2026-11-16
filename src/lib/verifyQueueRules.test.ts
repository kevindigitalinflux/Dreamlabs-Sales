import { describe, expect, it } from 'vitest'
import { planQueue, nextStep, siblingsToSkip, QUEUE_MAX_PER_LEAD, QUEUE_RETRY_DELAYS_MS, QUEUE_RUN_WINDOW_MS, type QueueInput, type QueuePerson } from '../../supabase/functions/_shared/verifyQueueRules'

const people: QueuePerson[] = Array.from({ length: 5 }, (_, i) => ({ personKey: `person ${i}`, name: `Person ${i}`, contactId: `contact-${i}`, first: `person${i}`, last: 'smith', priority: i }))
const saved = [0, 1].map(i => ({ address: `saved${i}@fixture.test`, personKey: null, personName: null, contactId: null }))
const input = (count = 3): QueueInput => ({ people: people.slice(0, count), domains: [{ domain: 'fixture.test', provider: 'unknown', state: 'provable' }], alreadyChecked: {}, savedAddresses: saved, candidatesFor: (person, domain) => Array.from({ length: 8 }, (_, i) => `${person.first}.${i}@${domain}`) })

describe('planQueue', () => {
  it.each([[3, 26], [5, 30]])('keeps saved rows first and round-robins %i people into %i rows', (count, total) => {
    const rows = planQueue(input(count))
    expect(rows).toHaveLength(total)
    expect(rows.slice(0, 2).map(row => row.address)).toEqual(saved.map(row => row.address))
    expect(rows.slice(2, 2 + count).map(row => [row.personKey, row.rank])).toEqual(people.slice(0, count).map(person => [person.personKey, 0]))
    expect(rows[2 + count].rank).toBe(1)
  })
  it('exports the exact limits', () => {
    expect(QUEUE_MAX_PER_LEAD).toBe(30)
    expect(QUEUE_RETRY_DELAYS_MS).toEqual([90_000, 300_000, 900_000])
    expect(QUEUE_RUN_WINDOW_MS).toBe(3_600_000)
  })
  it('orders people by priority before each format rank', () => {
    const data = input(); data.people.reverse()
    expect(planQueue(data).slice(2, 5).map(row => row.personKey)).toEqual(people.slice(0, 3).map(person => person.personKey))
  })
  it('omits proven, invalid, placeholder and guessed role addresses', () => {
    const data = input(1); data.savedAddresses = [{ ...saved[0], address: 'valid@fixture.test' }]
    data.alreadyChecked = { 'valid@fixture.test': 'valid', 'bad@fixture.test': 'invalid', 'retry@fixture.test': 'unverifiable' }
    data.candidatesFor = () => ['bad@fixture.test', 'test@example.com', 'info@fixture.test', 'retry@fixture.test']
    expect(planQueue(data).map(row => row.address)).toEqual(['retry@fixture.test'])
  })
  it('deduplicates saved and generated rows by normalized address and kind', () => {
    const data = input(1); data.savedAddresses = [{ ...saved[0], address: ' PERSON0.0@fixture.test ' }]
    expect(planQueue(data).filter(row => row.address === 'person0.0@fixture.test')).toHaveLength(1)
  })
  it('does not guess for a person with a valid candidate', () => {
    const data = input(1); data.alreadyChecked = { 'person0.7@fixture.test': 'valid' }
    expect(planQueue(data)).toHaveLength(2)
  })
  it.each(['catch_all', 'no_answer'] as const)('uses Microsoft checks for saved and the first four formats on %s', state => {
    const data = input(); data.domains = [{ domain: 'fixture.test', provider: 'microsoft', state }]
    const rows = planQueue(data)
    expect(rows).toHaveLength(14)
    expect(rows.slice(0, 2).every(row => row.kind === 'smtp')).toBe(true)
    expect(rows.slice(2).every(row => row.kind === 'ms_exists')).toBe(true)
    expect(rows.filter(row => row.personKey === people[0].personKey).map(row => row.rank)).toEqual([0, 1, 2, 3])
  })
  it('never guesses on another provider catch-all', () => {
    const data = input(); data.savedAddresses = []; data.domains[0].state = 'catch_all'
    expect(planQueue(data)).toEqual([])
  })
  it('keeps saved Microsoft roles SMTP on no-answer and catch-all', () => {
    const data = input(0); data.savedAddresses = [{ ...saved[0], address: 'info@fixture.test' }]
    data.domains = [{ domain: 'fixture.test', provider: 'microsoft', state: 'no_answer' }]
    expect(planQueue(data)).toMatchObject([{ kind: 'smtp' }])
    data.domains[0].state = 'catch_all'
    expect(planQueue(data)).toMatchObject([{ kind: 'smtp' }])
  })
  it('omits checked saved rows and plans unchecked-domain formats', () => {
    const data = input(1); data.domains[0].state = 'unchecked'; data.alreadyChecked = { [saved[0].address]: 'invalid', [saved[1].address]: 'valid' }
    expect(planQueue(data)).toHaveLength(8)
    expect(planQueue(data).every(row => row.kind === 'smtp')).toBe(true)
  })
})

describe('nextStep', () => {
  it.each([['valid', 'deliverable', 'valid'], ['invalid', 'mailbox_not_found', 'invalid'], ['risky', 'role_account', 'valid'], ['unverifiable', 'catch_all', 'unverifiable']])('finishes SMTP %s / %s', (status, reason, verdict) => {
    expect(nextStep({ kind: 'smtp', attempts: 1 }, { ok: true, status, reason }, 1000)).toEqual({ status: 'done', verdict, reason })
  })
  it.each(['timeout', 'unknown', 'checker_error'])('retries %s at each scheduled delay then exhausts', reason => {
    for (const [index, delay] of QUEUE_RETRY_DELAYS_MS.entries()) {
      expect(nextStep({ kind: 'smtp', attempts: index + 1 }, { ok: true, status: 'unverifiable', reason }, 1000)).toEqual({ status: 'queued', nextAt: 1000 + delay, reason })
    }
    expect(nextStep({ kind: 'smtp', attempts: 4 }, { ok: true, status: 'unverifiable', reason }, 1000)).toEqual({ status: 'done', verdict: 'unverifiable', reason })
  })
  it.each(['timeout', 'busy', 'unreachable'])('retries worker failure %s', failure => {
    expect(nextStep({ kind: 'smtp', attempts: 1 }, { ok: false, failure }, 1000)).toEqual({ status: 'queued', nextAt: 91_000, reason: failure })
  })
  it.each(['limit_reached', 'not_configured'])('skips %s', failure => {
    expect(nextStep({ kind: 'smtp', attempts: 1 }, { ok: false, failure }, 1000)).toEqual({ status: 'skipped', reason: failure })
  })
  it.each(['exists', 'not_found'])('finishes Microsoft %s', verdict => {
    expect(nextStep({ kind: 'ms_exists', attempts: 1 }, { ok: true, status: verdict, reason: verdict }, 1000)).toEqual({ status: 'done', verdict, reason: verdict })
  })
  it('retries Microsoft unknown', () => {
    expect(nextStep({ kind: 'ms_exists', attempts: 1 }, { ok: true, status: 'unknown', reason: 'unknown' }, 1000)).toEqual({ status: 'queued', nextAt: 91_000, reason: 'unknown' })
  })
})

it('skips only a proven person’s siblings and never anonymous or unproven rows', () => {
  const rows = [{ id: 'same', personKey: 'jo smith', kind: 'smtp' }, { id: 'other', personKey: 'pat smith', kind: 'ms_exists' }, { id: 'anonymous', personKey: null, kind: 'smtp' }]
  for (const verdict of ['valid', 'exists']) expect(siblingsToSkip({ personKey: 'jo smith', verdict }, rows)).toEqual(['same'])
  expect(siblingsToSkip({ personKey: 'jo smith', verdict: 'invalid' }, rows)).toEqual([])
  expect(siblingsToSkip({ personKey: null, verdict: 'valid' }, rows)).toEqual([])
})

it.each(['provable','unchecked','catch_all','no_answer'] as const)('Microsoft %s sends four person formats to exists and company/role addresses to SMTP', state => {
 const data=input(1); data.domains=[{domain:'fixture.test',provider:'microsoft',state}];
 data.savedAddresses=[{...saved[0],address:'jo@fixture.test',personKey:'jo smith'}, {...saved[1],address:'info@fixture.test'}, {...saved[1],address:'office-mail@fixture.test'}];
 const rows=planQueue(data);
 expect(rows.slice(0,3).map(r=>r.kind)).toEqual(['ms_exists','smtp','smtp']);
 expect(rows.filter(r=>r.personKey===people[0].personKey).map(r=>[r.kind,r.rank])).toEqual([['ms_exists',0],['ms_exists',1],['ms_exists',2],['ms_exists',3]]);
});
it('requeues a stalled domain for ten minutes even at the attempt ceiling',()=>{
 expect(nextStep({kind:'smtp',attempts:4},{ok:false,failure:'domain_stalled'},1000)).toEqual({status:'queued',nextAt:601000,reason:'domain_stalled'});
});
