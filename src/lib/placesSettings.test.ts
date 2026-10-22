import { expect, it, vi } from 'vitest';
import { parsePlacesSnapshot, savePlacesLimit } from './placesSettings';

it('rejects missing snapshots and validates the editable limit before writing', async () => {
  expect(parsePlacesSnapshot(null)).toBeNull();
  expect(parsePlacesSnapshot({ used: 2, limit: 900, resets_at: '2026-11-01T07:00:00Z' })).toMatchObject({ used: 2, limit: 900 });
  const client = { from: vi.fn() };
  for (const value of [-1, 100001, 1.5, NaN]) expect(await savePlacesLimit(client as never, 'org', value)).toBe(false);
  expect(client.from).not.toHaveBeenCalled();
});
it('updates only the limit and inserts only when no row exists', async () => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const select = vi.fn().mockResolvedValue({ data: [], error: null });
  const update = vi.fn(() => ({ eq: () => ({ select }) }));
  const client = { from: vi.fn(() => ({ update, insert })) };
  expect(await savePlacesLimit(client, 'org', 0)).toBe(true);
  expect(update).toHaveBeenCalledWith({ monthly_limit: 0 });
  expect(insert).toHaveBeenCalledWith({ org_id: 'org', monthly_limit: 0 });
  select.mockResolvedValue({ data: [{}], error: null });
  expect(await savePlacesLimit(client, 'org', 100000)).toBe(true);
  expect(insert).toHaveBeenCalledTimes(1);
});
it('does not insert after an update error', async () => {
  const insert = vi.fn();
  const client = { from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'denied' } }) }) }), insert }) };
  expect(await savePlacesLimit(client, 'org', 900)).toBe(false);
  expect(insert).not.toHaveBeenCalled();
});
