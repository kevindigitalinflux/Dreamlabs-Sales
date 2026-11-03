import { expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/ai', () => ({ geminiGroundedSearch: vi.fn() }));
import { geminiGroundedSearch } from '../../supabase/functions/_shared/ai';
import { registryWebNumbers } from '../../supabase/functions/_shared/registryWebProof';
it('uses the Fold7 brand in the existing single grounded query', async () => {
 vi.mocked(geminiGroundedSearch).mockResolvedValue({text:'',sources:[],sourceEvidence:[]});
 await registryWebNumbers('Fold7 - Global Creative Advertising Agency London HQ','fake',5000);
 expect(vi.mocked(geminiGroundedSearch).mock.calls.at(-1)?.[0]).toContain('"Fold7" Companies House');
});
