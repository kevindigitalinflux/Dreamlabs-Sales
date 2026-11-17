import {expect,it} from 'vitest';
import {checkWindowEnd} from '../../supabase/functions/_shared/deepFindParallel';
it.each([[50,1,3],[300,3,4.333333333333333],[1000,1,8]])('sizes %i leads at %i parallel with the floor and ceiling', (count,parallel,hours)=>{
 expect(checkWindowEnd(0,count,parallel)).toBeCloseTo(hours*3600000,3);
});
