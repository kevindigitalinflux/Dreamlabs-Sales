import {expect,it} from 'vitest';
import {parallelInvocations} from '../../supabase/functions/_shared/deepFindParallel';
it('defaults to three invocations and bounds persisted parallelism to one through five',()=>{
 expect(parallelInvocations(undefined)).toBe(3);expect(parallelInvocations(0)).toBe(1);expect(parallelInvocations(9)).toBe(5);expect(parallelInvocations(2)).toBe(2);
});
