import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({dismissed:undefined,effects:[],store:new Map(),rows:[],role:'admin'}));
vi.mock('react',async original=>({...await original(),useState:initial=>{h.dismissed??=typeof initial==='function'?initial():initial;return [h.dismissed,value=>{h.dismissed=typeof value==='function'?value(h.dismissed):value;}];},useEffect:effect=>h.effects.push(effect)}));
vi.mock('../hooks/useOrg',()=>({useOrg:()=>({currentOrg:{id:'org',role:h.role}})}));
vi.mock('../hooks/useApiKeyHealth',()=>({useApiKeyHealth:()=>({rows:h.rows,loading:false,error:null})}));
vi.mock('../hooks/useKeyHealthDesktopNotifications',()=>({useKeyHealthDesktopNotifications:()=>{}}));
import {ApiKeyHealthBanner} from '../components/settings/ApiKeyHealthBanner';
const row={org_id:'org',provider:'gemini',state:'needs_topup',status_code:402,key_source:'org',feature:'deep_find',first_failed_at:'2026-11-18T10:00:00Z',last_failed_at:'2026-11-18T10:00:00Z',failure_count:1};
const render=()=>ApiKeyHealthBanner().props.children[1].props;
beforeEach(()=>{h.rows=[row];h.dismissed=undefined;h.effects=[];h.store.clear();vi.stubGlobal('window',{sessionStorage:{getItem:key=>h.store.get(key)??null,setItem:(key,value)=>h.store.set(key,value)}});});
it('session dismissal hides the current problem and a new episode comes back',()=>{
 let props=render();expect(props.rows).toHaveLength(1);props.onDismiss(row);expect(render().rows).toEqual([]);
 h.dismissed=undefined;expect(render().rows).toEqual([]);
 h.rows=[{...row,first_failed_at:'2026-11-18T11:00:00Z'}];expect(render().rows).toHaveLength(1);
});

afterEach(()=>vi.unstubAllGlobals());
