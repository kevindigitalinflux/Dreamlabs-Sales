import { expect, it } from 'vitest';
import { scaledDeepFindCaps, DEEP_FIND_MAX_LEADS } from './deepFindView';
import { MAX_DEEP_FIND_LEADS } from '../../supabase/functions/_shared/deepFindRules';
import { toggleRow, selectRows, runRowBatch } from './rowSelection';
it('allows 50 leads on both sides and scales only AI custom defaults', () => {
 expect(DEEP_FIND_MAX_LEADS).toBe(50); expect(MAX_DEEP_FIND_LEADS).toBe(50);
 expect(scaledDeepFindCaps(1)).toEqual({hunter:60, ai:25});
 expect(scaledDeepFindCaps(25)).toEqual({hunter:60, ai:25});
 expect(scaledDeepFindCaps(26)).toEqual({hunter:60, ai:26});
 expect(scaledDeepFindCaps(50)).toEqual({hunter:60, ai:50});
 expect(scaledDeepFindCaps(1000)).toEqual({hunter:60, ai:200});
});
it('toggles without mutation and selects only actionable rows', () => {
 const before = new Set(['stale']); expect([...toggleRow(before,'x')]).toEqual(['stale','x']);
 expect([...before]).toEqual(['stale']); expect([...selectRows(before,['a','b'])]).toEqual(['a','b']);
 expect([...selectRows(new Set(['a','b']),['a','b'])]).toEqual([]);
});
it('runs sequentially, catches each failure and continues', async () => {
 const seen:number[]=[];
 const result = await runRowBatch([1,2,3], async row => {seen.push(row); if(row===2) throw new Error('Failed row'); return row===3?'Rejected row':null;});
 expect(seen).toEqual([1,2,3]); expect(result).toEqual([{row:1,error:null},{row:2,error:'Failed row'},{row:3,error:'Rejected row'}]);
});

it('accepts 50 distinct UUIDs and refuses 51', async () => {
 const { parseCreateRequest } = await import('../../supabase/functions/_shared/deepFindRules');
 const ids = Array.from({length:51}, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
 expect(parseCreateRequest({lead_ids:ids.slice(0,50)})).toMatchObject({ok:true});
 expect(parseCreateRequest({lead_ids:ids})).toMatchObject({ok:false});
});
