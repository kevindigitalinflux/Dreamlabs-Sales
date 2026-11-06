import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {ReplacementRows} from '../components/deepfind/ReplacementRows';
import {groupReplacements} from './deepFindReplacements';
import {runReviewBatch} from './reviewBatch';
import {suggestionKey} from '../../supabase/functions/_shared/deepFindSuggestions';
import type {ReviewSuggestion} from '../../supabase/functions/_shared/deepFindSuggestions';
const suggestions:ReviewSuggestion[]=['a','b'].map(name=>({name,value:`${name}@example.com`,replaces_saved_email:{contact_id:name,email:`old-${name}@example.com`}}));
it('shows select-all and disabled empty replacement actions alongside the old/new values',()=>{
 const html=renderToStaticMarkup(createElement(ReplacementRows,{suggestions,busy:false,onAction:async()=>null}));
 expect(html).toContain('Select all actionable rows');expect(html).toContain('Replace selected');expect(html).toContain('disabled=""');expect(html).toContain('old-a@example.com');
});
it('selects one primary replacement per person, never several conflicting alternatives',()=>{
 const groups=groupReplacements([...suggestions,{...suggestions[0],value:'alternative@example.com',guess_rank:'other'}]).groups;
 expect(groups.map(g=>g.primary.value)).toEqual(['a@example.com','b@example.com']);
});
it('uses the selected row action and retains partial failure',async()=>{
 const action=vi.fn(async(s:ReviewSuggestion)=>s.name==='a'?'Changed since':null);
 const out=await runReviewBatch(suggestions,new Set(suggestions.map(suggestionKey)),suggestionKey,action);
 expect(out.map(r=>r.error)).toEqual(['Changed since',null]);
});
it('caps replacement actions at fifty',async()=>{
 const rows=Array.from({length:51},(_,i)=>({...suggestions[0],name:String(i)}));expect(await runReviewBatch(rows,new Set(rows.map(suggestionKey)),suggestionKey,async()=>null)).toHaveLength(50);
});
it('does nothing for empty replacement selection',async()=>{
 const action=vi.fn(async()=>null);await runReviewBatch(suggestions,new Set(),suggestionKey,action);expect(action).not.toHaveBeenCalled();
});
