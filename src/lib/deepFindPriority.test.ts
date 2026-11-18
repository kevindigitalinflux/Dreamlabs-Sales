import { describe, expect, it } from 'vitest';
import { deepFindPriority } from './deepFindPriority';

const base = { needsDecision: false, toReview: 0 };

describe('deepFindPriority', () => {
  it('calls queued and running leads still working, whatever they have found so far', () => {
    expect(deepFindPriority({ ...base, status: 'queued' })).toBe('working');
    expect(deepFindPriority({ status: 'running', needsDecision: true, toReview: 4 })).toBe('working');
  });
  it('puts failures and open decisions first', () => {
    expect(deepFindPriority({ ...base, status: 'failed' })).toBe('most');
    expect(deepFindPriority({ status: 'done', needsDecision: true, toReview: 0 })).toBe('most');
  });
  it('asks for a review when something was found but nothing needs deciding', () => {
    expect(deepFindPriority({ status: 'done', needsDecision: false, toReview: 2 })).toBe('some');
  });
  it('has nothing to do for a finished lead with no findings, and for skipped leads', () => {
    expect(deepFindPriority({ ...base, status: 'done' })).toBe('none');
    expect(deepFindPriority({ ...base, status: 'skipped' })).toBe('none');
  });
  it('a decision outranks findings to review', () => {
    expect(deepFindPriority({ status: 'done', needsDecision: true, toReview: 9 })).toBe('most');
  });
});
