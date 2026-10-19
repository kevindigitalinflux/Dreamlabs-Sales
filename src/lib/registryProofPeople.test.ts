import { afterEach, expect, it, vi } from 'vitest';
import { fetchActivePscNames } from '../../supabase/functions/_shared/registryProofPeople';
afterEach(() => vi.unstubAllGlobals());
it('keeps active individual PSCs only; uses one bounded Companies House request', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json({ items: [
    { name: 'Jane Smith', kind: 'individual-person-with-significant-control' },
    { name: 'Old Person', kind: 'individual-person-with-significant-control', ceased_on: '2020-01-01' },
    { name: 'Other Company', kind: 'corporate-entity-person-with-significant-control' },
    { name: 'Unknown Person', kind: 'unknown' },
  ] }));
  vi.stubGlobal('fetch', request);
  expect(await fetchActivePscNames('13550006', 'fake')).toEqual(['Jane Smith']);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe('https://api.company-information.service.gov.uk/company/13550006/persons-with-significant-control?items_per_page=25');
});
it('rejects invalid company numbers and fails closed on malformed data', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json({ items: 'bad' }));
  vi.stubGlobal('fetch', request);
  expect(await fetchActivePscNames('../other', 'fake')).toEqual([]);
  expect(request).not.toHaveBeenCalled();
  expect(await fetchActivePscNames('13550006', 'fake')).toEqual([]);
});
