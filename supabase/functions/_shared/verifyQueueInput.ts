import { planQueue, type QueueInput, type QueueCandidate } from './verifyQueueRules.ts';
import type { WorkerResult } from './workerClient.ts';
import type { VerifyReply } from './workerRules.ts';

/** Adapt already-held first-pass answers; this does no DNS, provider or database work. */
export function buildQueuePlan(input: {
  people: QueueInput['people']; domains: Omit<QueueInput['domains'][number], 'state'>[];
  savedAddresses: QueueInput['savedAddresses']; checked: ReadonlyMap<string, WorkerResult<VerifyReply>>;
  candidatesFor: QueueInput['candidatesFor'];
}): QueueCandidate[] {
  const alreadyChecked: QueueInput['alreadyChecked'] = {};
  for (const [address, result] of input.checked) {
    alreadyChecked[address] = result.ok ? result.value.status === 'invalid' ? 'invalid'
      : result.value.status === 'valid' || (result.value.status === 'risky' && result.value.reason === 'role_account') ? 'valid' : 'unverifiable' : 'unverifiable';
  }
  const domains: QueueInput['domains'] = input.domains.map(domain => {
    const answers = [...input.checked].filter(([address]) => address.split('@')[1]?.toLowerCase() === domain.domain).map(([, result]) => result);
    const catchAll = answers.some(answer => answer.ok && ['catch_all', 'hosted_unverifiable'].includes(answer.value.reason));
    const provable = answers.some(answer => answer.ok && (['valid', 'invalid'].includes(answer.value.status) || answer.value.reason === 'role_account'));
    return { ...domain, state: catchAll ? 'catch_all' : provable ? 'provable' : answers.length ? 'no_answer' : 'unchecked' };
  });
  return planQueue({ people: input.people, domains, alreadyChecked, savedAddresses: input.savedAddresses, candidatesFor: input.candidatesFor });
}
