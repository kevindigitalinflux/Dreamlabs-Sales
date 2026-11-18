import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({instances:new Map(),name:'a',slot:0,effects:[],requests:vi.fn(),names:[],channels:[],removed:vi.fn()}));
vi.mock('react',()=>({useId:()=>h.name,useState:initial=>{const cells=h.instances.get(h.name);const i=h.slot++;if(!(i in cells))cells[i]={value:typeof initial==='function'?initial():initial};const cell=cells[i];return [cell.value,value=>{cell.value=typeof value==='function'?value(cell.value):value;}];},useRef:initial=>{const cells=h.instances.get(h.name),i=h.slot++;return cells[i]??(cells[i]={current:initial});},useEffect:(effect,deps)=>{const cells=h.instances.get(h.name),i=h.slot++,old=cells[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();cells[i]={deps};h.effects.push(()=>{cells[i].cleanup=effect();});}}}));
vi.mock('./supabase',()=>({supabase:{from:()=>({select:()=>({eq:(_key,org)=>h.requests(org)})}),channel:name=>{h.names.push(name);const channel={on:(_type,_filter,fn)=>{channel.refresh=fn;return channel;},subscribe:()=>channel};h.channels.push(channel);return channel;},removeChannel:(...args)=>h.removed(...args)}}));
import {useApiKeyHealth} from '../hooks/useApiKeyHealth';
const row={org_id:'org',provider:'gemini',state:'refused',status_code:401,key_source:'org',feature:'drafting',first_failed_at:'2026-11-18T10:00:00Z',last_failed_at:'2026-11-18T10:00:00Z',failure_count:1};
async function render(org='org',name='a'){h.name=name;h.slot=0;if(!h.instances.has(name))h.instances.set(name,[]);const result=useApiKeyHealth(org);const effects=h.effects.splice(0);effects.forEach(effect=>effect());await Promise.resolve();await Promise.resolve();return result;}
beforeEach(()=>{h.instances.clear();h.effects=[];h.names=[];h.channels=[];h.requests.mockReset().mockResolvedValue({data:[row],error:null});h.removed.mockClear();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-18T10:05:00Z'));});
afterEach(()=>{for(const cells of h.instances.values())for(const cell of cells)cell?.cleanup?.();vi.useRealTimers();});
it('gives two mounted consumers different channels and scopes every read to the org',async()=>{
 expect((await render()).loading).toBe(true);expect((await render()).rows).toEqual([row]);await render('org','b');expect(h.names).toHaveLength(2);expect(new Set(h.names).size).toBe(2);expect(h.requests).toHaveBeenCalledWith('org');
});
it('discards a slow old-org response after switching and removes its channel',async()=>{
 let resolve;h.requests.mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue({data:[{...row,org_id:'next'}],error:null});
 await render();expect((await render('next')).rows).toEqual([]);resolve({data:[row],error:null});await Promise.resolve();await Promise.resolve();expect((await render('next')).rows).toEqual([{...row,org_id:'next'}]);expect(h.removed).toHaveBeenCalled();
});
it('expires soft rate limits without requiring a realtime event',async()=>{
 h.requests.mockResolvedValue({data:[{...row,state:'rate_limited'}],error:null});await render();expect((await render()).rows).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(10*60_000+1);expect((await render()).rows).toEqual([]);
});
it('handles empty and error reads without exposing raw error data',async()=>{
 h.requests.mockResolvedValue({data:[],error:null});await render();expect((await render()).rows).toEqual([]);
 h.requests.mockResolvedValue({data:null,error:{message:'private'}});h.channels[0].refresh();await Promise.resolve();await Promise.resolve();expect((await render()).error).toBe('Could not load API key status.');
});
