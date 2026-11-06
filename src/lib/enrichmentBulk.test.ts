import {expect,it,vi} from 'vitest';
import {applyEnrichmentRow} from './enrichmentBulk';
import {runReviewBatch} from './reviewBatch';
import {selectRows} from './rowSelection';
const rows=[{lead_id:'a',proposed:{email:'new@example.com'},source:{}},{lead_id:'b',proposed:{phone:'123'},source:{}}];
it('selects all enrichment lead rows',()=>expect(selectRows(new Set(),rows.map(r=>r.lead_id)).size).toBe(2));
it('applies only selected fields and retains blank-only/additional rules',async()=>{
 const save=vi.fn(async()=>({applied:1,failed:[]}));
 await applyEnrichmentRow(rows[0],{a:new Set(['email'])},{a:{email:'old@example.com'}},false,save);
 expect(save).toHaveBeenCalledWith({}, {a:[{field:'email',value:'new@example.com',source:''}]});
});
it('returns a lead failure instead of losing the row',async()=>{
 expect(await applyEnrichmentRow(rows[0],{a:new Set(['email'])},{},false,async()=>({applied:0,failed:[{leadId:'a',error:'Denied'}]}))).toBe('Denied');
});
it('uses the fifty-row cap for enrichment',async()=>{
 const many=Array.from({length:51},(_,i)=>({...rows[0],lead_id:String(i)}));
 expect(await runReviewBatch(many,new Set(many.map(r=>r.lead_id)),r=>r.lead_id,async()=>null)).toHaveLength(50);
});
it('does not apply an unselected enrichment row',async()=>{
 const save=vi.fn(async()=>null);expect(await runReviewBatch(rows,new Set(),r=>r.lead_id,save)).toEqual([]);expect(save).not.toHaveBeenCalled();
});
