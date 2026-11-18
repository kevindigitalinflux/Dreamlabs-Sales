import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({instances:new Map(),name:'a',slot:0,effects:[],requests:vi.fn(),names:[],channels:[],filters:[],removed:vi.fn()}));
vi.mock('react',()=>({useId:()=>h.name,useState:initial=>{const cells=h.instances.get(h.name);const i=h.slot++;if(!(i in cells))cells[i]={value:typeof initial==='function'?initial():initial};const cell=cells[i];return [cell.value,value=>{cell.value=typeof value==='function'?value(cell.value):value;}];},useRef:initial=>{const cells=h.instances.get(h.name),i=h.slot++;return cells[i]??(cells[i]={current:initial});},useEffect:(effect,deps)=>{const cells=h.instances.get(h.name),i=h.slot++,old=cells[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();cells[i]={deps};h.effects.push(()=>{cells[i].cleanup=effect();});}}}));
vi.mock('./supabase',()=>({supabase:{from:()=>({select:()=>({eq:(_key,org)=>h.requests(org)})}),channel:name=>{h.names.push(name);const channel={on:(_type,_filter,fn)=>{h.filters.push(_filter);channel.refresh=fn;return channel;},subscribe:()=>channel};h.channels.push(channel);return channel;},removeChannel:(...args)=>h.removed(...args)}}));
import {useApiKeyHealth} from '../hooks/useApiKeyHealth';
const row={org_id:'org',provider:'gemini',state:'refused',status_code:401,key_source:'org',feature:'drafting',first_failed_at:'2026-11-18T10:00:00Z',last_failed_at:'2026-11-18T10:00:00Z',failure_count:1};
async function render(org='org',name='a'){h.name=name;h.slot=0;if(!h.instances.has(name))h.instances.set(name,[]);const result=useApiKeyHealth(org);const effects=h.effects.splice(0);effects.forEach(effect=>effect());await Promise.resolve();await Promise.resolve();return result;}
beforeEach(()=>{vi.stubGlobal('window',new EventTarget());const doc=new EventTarget();doc.visibilityState='visible';vi.stubGlobal('document',doc);h.filters=[];h.instances.clear();h.effects=[];h.names=[];h.channels=[];h.requests.mockReset().mockResolvedValue({data:[row],error:null});h.removed.mockClear();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-18T10:05:00Z'));});
afterEach(()=>{for(const cells of h.instances.values())for(const cell of cells)cell?.cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();});
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

function unmount(name='a'){for(const cell of h.instances.get(name)??[])cell?.cleanup?.();h.instances.delete(name);}
it('subscribes only to filtered INSERT/UPDATE events, never unfiltered deletes',async()=>{
 await render();expect(h.filters.map(filter=>filter.event).sort()).toEqual(['INSERT','UPDATE']);
 expect(h.filters.every(filter=>filter.filter==='org_id=eq.org')).toBe(true);
});
it('clears a deleted health row on the sixty-second visible refresh',async()=>{
 await render();expect((await render()).rows).toEqual([row]);h.requests.mockResolvedValue({data:[],error:null});
 await vi.advanceTimersByTimeAsync(59_999);expect(h.requests).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect((await render()).rows).toEqual([]);expect(h.requests).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(120_000);expect(h.requests).toHaveBeenCalledTimes(2);
});
it('does not poll without visible rows, including expired rate limits',async()=>{
 for(const data of [[],[{...row,state:'rate_limited',last_failed_at:'2026-11-18T09:00:00Z'}]]){
  h.requests.mockResolvedValue({data,error:null});await render();await render();const calls=h.requests.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);expect(h.requests).toHaveBeenCalledTimes(calls);expect(vi.getTimerCount()).toBe(0);unmount();
 }
});
it('pauses polling while hidden and refreshes immediately on becoming visible',async()=>{
 await render();await render();document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));
 expect(vi.getTimerCount()).toBe(0);window.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(120_000);expect(h.requests).toHaveBeenCalledTimes(1);
 h.requests.mockResolvedValue({data:[],error:null});document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));
 await Promise.resolve();await Promise.resolve();expect((await render()).rows).toEqual([]);expect(h.requests).toHaveBeenCalledTimes(2);
});
it('does not start polling in an initially hidden tab',async()=>{
 document.visibilityState='hidden';await render();await render();const calls=h.requests.mock.calls.length;
 await vi.advanceTimersByTimeAsync(120_000);expect(h.requests).toHaveBeenCalledTimes(calls);expect(vi.getTimerCount()).toBe(0);
});
it('refreshes on focus even after an empty load',async()=>{
 h.requests.mockResolvedValue({data:[],error:null});await render();await render();h.requests.mockResolvedValue({data:[row],error:null});
 window.dispatchEvent(new Event('focus'));await Promise.resolve();await Promise.resolve();expect((await render()).rows).toEqual([row]);expect(h.requests).toHaveBeenCalledTimes(2);
});
it('removes polling and listeners on unmount',async()=>{
 const removeWindow=vi.spyOn(window,'removeEventListener'),removeDocument=vi.spyOn(document,'removeEventListener');
 await render();await render();expect(vi.getTimerCount()).toBe(1);unmount();expect(vi.getTimerCount()).toBe(0);
 expect(removeWindow).toHaveBeenCalledWith('focus',expect.any(Function));expect(removeDocument).toHaveBeenCalledWith('visibilitychange',expect.any(Function));
 const calls=h.requests.mock.calls.length;window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(120_000);expect(h.requests).toHaveBeenCalledTimes(calls);
});
it('polls only the new organisation after switching and ignores a pending old refresh',async()=>{
 await render();await render();let resolve;h.requests.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
 await vi.advanceTimersByTimeAsync(60_000);h.requests.mockResolvedValue({data:[{...row,org_id:'next'}],error:null});await render('next');await render('next');
 resolve({data:[row],error:null});await Promise.resolve();await Promise.resolve();expect((await render('next')).rows).toEqual([{...row,org_id:'next'}]);
 expect(vi.getTimerCount()).toBe(1);h.requests.mockClear();await vi.advanceTimersByTimeAsync(60_000);expect(h.requests).toHaveBeenCalledExactlyOnceWith('next');
});
