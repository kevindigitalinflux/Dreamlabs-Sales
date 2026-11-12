import { isRoleAddress, isPlaceholderAddress } from './emailPrecheckRules.ts';

export const QUEUE_MAX_PER_LEAD = 30;
export const QUEUE_RETRY_DELAYS_MS = [90_000, 300_000, 900_000] as const;
export const QUEUE_RUN_WINDOW_MS = 60 * 60_000;
export interface QueuePerson { personKey: string; name: string; contactId: string | null; first: string; last: string; priority: number }
export interface QueueCandidate { address: string; domain: string; kind: 'smtp' | 'ms_exists'; personKey: string | null; personName: string | null; contactId: string | null; rank: number }
export interface QueueInput {
  people: QueuePerson[];
  domains: { domain: string; provider: 'google' | 'microsoft' | 'hosted' | 'unknown'; state: 'provable' | 'catch_all' | 'no_answer' | 'unchecked' }[];
  alreadyChecked: Record<string, 'valid' | 'invalid' | 'unverifiable'>;
  savedAddresses: { address: string; contactId: string | null; personKey: string | null; personName: string | null }[];
  candidatesFor(person: QueuePerson, domain: string): string[];
}
export type QueueOutcome = { status: 'done'; verdict: 'valid' | 'invalid' | 'unverifiable' | 'exists' | 'not_found'; reason: string } | { status: 'queued'; nextAt: number; reason: string } | { status: 'skipped'; reason: string };

export function planQueue(input: QueueInput): QueueCandidate[] {
  const checked = new Map(Object.entries(input.alreadyChecked).map(([address, verdict]) => [address.trim().toLowerCase(), verdict]));
  const rows: QueueCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: QueueCandidate) => {
    const address = candidate.address.trim().toLowerCase();
    if (checked.get(address) === 'valid' || checked.get(address) === 'invalid' || isPlaceholderAddress(address)) return;
    const key = `${address}:${candidate.kind}`;
    if (!seen.has(key)) { seen.add(key); rows.push({ ...candidate, address }); }
  };
  for (const saved of input.savedAddresses) {
    const address = saved.address.trim().toLowerCase();
    const domain = address.split('@')[1] ?? '';
    const server = input.domains.find(item => item.domain.toLowerCase() === domain);
    const role = isRoleAddress(address);
    if (role && server?.state === 'catch_all') continue;
    const microsoft = server?.provider === 'microsoft' && ['catch_all', 'no_answer'].includes(server.state);
    add({ ...saved, address, domain, kind: microsoft && !role ? 'ms_exists' : 'smtp', rank: 0 });
  }
  const guesses: QueueCandidate[] = [];
  for (const person of [...input.people].sort((a, b) => a.priority - b.priority)) {
    const formats = input.domains.map(server => ({ server, addresses: input.candidatesFor(person, server.domain) }));
    const proven = input.savedAddresses.some(saved => saved.personKey === person.personKey && checked.get(saved.address.trim().toLowerCase()) === 'valid')
      || formats.some(group => group.addresses.some(address => checked.get(address.trim().toLowerCase()) === 'valid'));
    if (proven) continue;
    for (const { server, addresses } of formats) {
      const microsoft = server.provider === 'microsoft' && ['catch_all', 'no_answer'].includes(server.state);
      if (!microsoft && !['provable', 'unchecked'].includes(server.state)) continue;
      const kind = microsoft ? 'ms_exists' : 'smtp';
      (microsoft ? addresses.slice(0, 4) : addresses).forEach((address, rank) => {
        if (!isRoleAddress(address)) guesses.push({ address, domain: server.domain, kind, personKey: person.personKey, personName: person.name, contactId: person.contactId, rank });
      });
    }
  }
  for (const guess of guesses.sort((a, b) => a.rank - b.rank)) add(guess);
  return rows.slice(0, QUEUE_MAX_PER_LEAD);
}

export function nextStep(row: { kind: 'smtp' | 'ms_exists'; attempts: number }, answer: { ok: true; status: string; reason: string } | { ok: false; failure: string }, now: number): QueueOutcome {
  const reason = answer.ok ? answer.reason : answer.failure;
  if (!answer.ok && ['limit_reached', 'not_configured'].includes(reason)) return { status: 'skipped', reason };
  if (answer.ok) {
    if (row.kind === 'ms_exists' && (answer.status === 'exists' || answer.status === 'not_found')) return { status: 'done', verdict: answer.status, reason };
    if (row.kind === 'smtp') {
      if (answer.status === 'valid' || answer.status === 'invalid') return { status: 'done', verdict: answer.status, reason };
      if (answer.status === 'risky' && reason === 'role_account') return { status: 'done', verdict: 'valid', reason };
      if (reason === 'catch_all') return { status: 'done', verdict: 'unverifiable', reason };
    }
  }
  const delay = QUEUE_RETRY_DELAYS_MS[row.attempts - 1];
  return delay === undefined ? { status: 'done', verdict: 'unverifiable', reason } : { status: 'queued', nextAt: now + delay, reason };
}

export function siblingsToSkip(done: { personKey: string | null; verdict: string }, queued: { id: string; personKey: string | null; kind: string }[]): string[] {
  if (done.personKey === null || !['valid', 'exists'].includes(done.verdict)) return [];
  return queued.filter(row => row.personKey === done.personKey).map(row => row.id);
}
