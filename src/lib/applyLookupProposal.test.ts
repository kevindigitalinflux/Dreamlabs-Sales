import { expect, it, vi } from 'vitest';
import { saveLookupProposal } from './applyLookupProposal';
it('marks applied only after a successful lead write', async () => {
  const order: string[] = [];
  const error = await saveLookupProposal(async () => { order.push('write'); return null; }, async () => { order.push('review'); return true; });
  expect(error).toBeNull(); expect(order).toEqual(['write', 'review']);
});
it('leaves review pending when RLS rejects the lead update', async () => {
  const mark = vi.fn();
  expect(await saveLookupProposal(async () => 'Cannot edit this lead.', mark)).toBe('Cannot edit this lead.');
  expect(mark).not.toHaveBeenCalled();
});
it('explains a saved lead when the review write fails', async () => {
  expect(await saveLookupProposal(async () => null, async () => false)).toBe('The lead was saved, but the review could not be marked applied. Refresh and try again.');
});
