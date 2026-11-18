import { readDeepFindDetails } from './deepFindView';
import { registrySkipReason } from '../../supabase/functions/_shared/deepFindSuggestions';
import type { DeepFindRowWithLead } from '../hooks/useDeepFindRun';

/** How much a lead's Deep find result needs the user: `most` = decide something, `some` = review what was found, `none` = nothing to do. */
export type DeepFindPriority = 'most' | 'some' | 'none' | 'working';

export const PRIORITY_LABEL: Record<DeepFindPriority, string> = { most: 'Needs you', some: 'To review', none: 'Nothing to do', working: 'Still working' };
export const PRIORITY_ORDER: DeepFindPriority[] = ['most', 'some', 'working', 'none'];

interface PriorityInputs {
  status: DeepFindRowWithLead['status'];
  /** A company choice, a suspect website or a failure: something only the user can settle. */
  needsDecision: boolean;
  /** Suggested emails, people to check and dismissed people: findings the user may want to use. */
  toReview: number;
}

/** Pure ranking rule behind the Deep find filter. Queued and running leads are "working" until they finish. */
export function deepFindPriority({ status, needsDecision, toReview }: PriorityInputs): DeepFindPriority {
  if (status === 'queued' || status === 'running') return 'working';
  if (status === 'failed' || needsDecision) return 'most';
  return toReview > 0 ? 'some' : 'none';
}

/** Everything about one lead's result that both the card and the filter need, worked out once. */
export function deepFindRowFlags(row: DeepFindRowWithLead) {
  const details = readDeepFindDetails(row.domains);
  const registrySkipped = registrySkipReason(row.lead ?? {});
  const openChoice = details.companyCandidates.length > 0 && !row.lead?.company_number && !registrySkipped;
  const toCheck = [...details.unverified, ...details.namedByWeb, ...details.namedOnSite];
  const toReview = details.suggestions.length + toCheck.length + details.dismissedPeople.length;
  const priority = deepFindPriority({ status: row.status, needsDecision: openChoice || details.websiteSuspect, toReview });
  return { details, registrySkipped, openChoice, toCheck, toReview, priority };
}
