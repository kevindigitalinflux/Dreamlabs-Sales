import {expect,it,vi} from 'vitest'
const h=vi.hoisted(()=>({refs:[],index:0,effects:[],sets:[],rpc:vi.fn()}));
vi.mock('react',()=>({useRef:initial=>{const i=h.index++;return h.refs[i]??(h.refs[i]={current:initial})},useState:initial=>[initial,next=>h.sets.push(next)],useEffect:effect=>h.effects.push(effect)}));
vi.mock('./supabase',()=>({supabase:{rpc:(...args)=>h.rpc(...args)}}));
import {useGeminiSearchUsage} from '../hooks/useGeminiSearchUsage';
async function render(org,open){h.index=0;h.effects=[];useGeminiSearchUsage(org,open);for(const effect of h.effects)effect();await Promise.resolve();await Promise.resolve()}
it('loads once on first open and reloads only when the org changes',async()=>{
 h.refs=[];h.sets=[];h.rpc.mockResolvedValue({data:{org_searches:5,shared_key:false,shared_searches:null},error:null});
 await render('one',false);expect(h.rpc).not.toHaveBeenCalled();await render('one',true);await render('one',true);await render('one',false);await render('one',true);expect(h.rpc).toHaveBeenCalledExactlyOnceWith('gemini_search_snapshot',{p_org:'one'});await render('two',true);expect(h.rpc).toHaveBeenCalledTimes(2);
});
it('does not show another org stale snapshot after a switch',async()=>{
 h.refs=[];h.sets=[];h.rpc.mockClear();let resolve;h.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue({data:{org_searches:2,shared_key:false,shared_searches:null},error:null});
 await render('one',true);await render('two',true);resolve({data:{org_searches:999,shared_key:false,shared_searches:null},error:null});await Promise.resolve();await Promise.resolve();expect(h.sets.filter(s=>s?.value?.orgSearches===999)).toEqual([]);
});
