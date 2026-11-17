import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({sets:[],rows:[],reload:vi.fn(),remove:vi.fn(),filters:[]}));
vi.mock('react',async original=>({...await original(),useEffect:()=>{},useState:initial=>[initial,next=>h.sets.push(next)]}));
vi.mock('../hooks/useUsage',()=>({useUsage:()=>({rows:h.rows,loading:false,error:null,reload:h.reload})}));
vi.mock('./supabase',()=>({supabase:{from:table=>({delete:()=>{h.remove(table);return {eq:(key,value)=>{h.filters.push([key,value]);return {eq:async(key,value)=>{h.filters.push([key,value]);return {error:null}}}}}}})}}));
import {UsageLimitsCard} from '../components/settings/UsageLimitsCard';
const find=(node,predicate)=>{
 if(!node||typeof node!=='object')return null;
 if(predicate(node))return node;
 for(const child of [node.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}
 return null;
};
beforeEach(()=>{h.sets=[];h.filters=[];h.reload.mockClear();h.remove.mockClear();h.rows=[{resource:'worker_scrape',used:0,limit:50,globalUsed:0,globalLimit:1600,resetsAt:'2026-11-18T00:00:00Z'}]});
it('shows Reset to 400 and removes the org override to restore the database default',async()=>{
 const tree=UsageLimitsCard({orgId:'fixture-org',isOrgAdmin:true});
 const button=find(tree,node=>[node.props?.children].flat().join('')==='Reset to 400');
 expect(button).not.toBeNull();button.props.onClick();
 for(let i=0;i<6;i++)await Promise.resolve();
 expect(h.remove).toHaveBeenCalledWith('usage_limits');expect(h.filters).toEqual([['org_id','fixture-org'],['resource','worker_scrape']]);
 expect(h.sets).toContainEqual({ok:true,text:'Site scrapes limit reset to the default of 400 a day.'});expect(h.reload).toHaveBeenCalledOnce();
});
