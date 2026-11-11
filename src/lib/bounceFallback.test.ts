import {expect,it,vi} from 'vitest';
import {nextFallback,queueFallback} from '../../supabase/functions/_shared/bounceFallback';
const input={guessed:true,attempts:0,ranked:['a@company.com','b@company.com','c@company.com'],bounced:['a@company.com'],current:'a@company.com'};
it('chooses the next unbounced format and enforces a lifetime maximum of two',()=>{
 expect(nextFallback(input)).toBe('b@company.com');
 expect(nextFallback({...input,attempts:2})).toBeNull();
 expect(nextFallback({...input,guessed:false})).toBeNull();
 expect(nextFallback({...input,bounced:input.ranked})).toBeNull();
});
it('never queues while reputation is paused or durable storage is unavailable',async()=>{
 const save=vi.fn(async()=>false);
 expect(await queueFallback(input,false,save)).toBe(false);expect(save).not.toHaveBeenCalled();
 expect(await queueFallback(input,true,save)).toBe(false);expect(save).toHaveBeenCalledWith('b@company.com');
});
