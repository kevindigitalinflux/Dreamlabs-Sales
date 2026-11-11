import { expect, it, vi } from 'vitest';
import { registryProofEligible, reserveRegistryProof } from '../../supabase/functions/_shared/registryProofGate';
it.each(['ambiguous','not_found'])('enables proof at every effort for %s',how=>{
 for(const effort of ['low','custom','medium','high','extra_high'] as const) expect(registryProofEligible(effort,how)).toBe(true);
});
it('skips resolved and disabled states',()=>{
 for(const how of ['auto','saved','raw_lead','no_key','not_uk','rejected','error']) expect(registryProofEligible('medium',how)).toBe(false);
});
it('preserves time/key guard and reports refused reservation without calling proof',async()=>{
 const reserve=vi.fn(async()=>false); const lines:string[]=[];
 expect(await reserveRegistryProof('medium','ambiguous',true,18000,reserve,line=>lines.push(line))).toBe(false);
 expect(reserve).not.toHaveBeenCalled();
 expect(await reserveRegistryProof('medium','not_found',true,19000,reserve,line=>lines.push(line))).toBe(false);
 expect(reserve).toHaveBeenCalledTimes(1); expect(lines).toEqual(['Companies House web proof skipped: not enough time remains.','Companies House web proof skipped: the AI call allowance was reached.']);
});
it('reserves once when admitted',async()=>{
 const reserve=vi.fn(async()=>true);
 expect(await reserveRegistryProof('medium','ambiguous',true,19000,reserve,()=>{})).toBe(true);
 expect(reserve).toHaveBeenCalledTimes(1);
});

it('does not reserve proof for an unnamed lead', async () => {
 const reserve = vi.fn(async () => true);
 expect(await reserveRegistryProof('medium', 'not_found', true, 19000, reserve, () => {}, false)).toBe(false);
 expect(reserve).not.toHaveBeenCalled();
});
