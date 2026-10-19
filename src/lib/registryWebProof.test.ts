import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/ai', () => ({ geminiGroundedSearch: vi.fn() }));
import { geminiGroundedSearch } from '../../supabase/functions/_shared/ai';
import { registryWebNumbers } from '../../supabase/functions/_shared/registryWebProof';
it('does not count unsupported model numbers as grounded proof', async () => {
  vi.mocked(geminiGroundedSearch).mockResolvedValue({ text: '13550006', sources: [], sourceEvidence: [] });
  expect(await registryWebNumbers('BK', 'fake', 5000)).toEqual([]);
});
it('accepts candidate numbers in grounded evidence, never arbitrary unrelated model output', async () => {
  vi.mocked(geminiGroundedSearch).mockResolvedValue({ text: '13550006 13550007', sources: ['https://example.com'], sourceEvidence: ['https://example.com BK company number 13550006'] });
  expect(await registryWebNumbers('BK', 'fake', 5000)).toEqual(['13550006']);
});
