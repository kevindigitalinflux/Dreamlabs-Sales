import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({refs:[],slot:0,effects:[],enabled:true,permission:'granted',navigate:vi.fn(),setEnabled:vi.fn(),notifications:[],store:new Map()}));
vi.mock('react',()=>({useRef:initial=>{const i=h.slot++;return h.refs[i]??(h.refs[i]={current:initial});},useEffect:fn=>{h.effects.push(fn);}}));
vi.mock('react-router',()=>({useNavigate:()=>h.navigate}));
vi.mock('../hooks/useDesktopNotifications',()=>({useDesktopPreference:()=>({enabled:h.enabled,permission:h.permission,userId:'user',setEnabled:h.setEnabled})}));
import {useKeyHealthDesktopNotifications} from '../hooks/useKeyHealthDesktopNotifications';
const row={org_id:'org',provider:'gemini',state:'needs_topup',status_code:402,key_source:'org',feature:'deep_find',first_failed_at:'2026-11-18T10:00:00Z',last_failed_at:'2026-11-18T10:00:00Z',failure_count:1};
function render(rows=[row],admin=true){h.slot=0;h.effects=[];useKeyHealthDesktopNotifications(rows,false,'org',admin);h.effects.forEach(effect=>effect());}
beforeEach(()=>{h.refs=[];h.notifications=[];h.store.clear();h.enabled=true;h.permission='granted';h.navigate.mockClear();
 vi.stubGlobal('window',{localStorage:{getItem:key=>h.store.get(key)??null,setItem:(key,value)=>h.store.set(key,value)},focus:vi.fn()});
 const Notification=class{constructor(title,options){this.title=title;this.options=options;this.close=vi.fn();h.notifications.push(this);}static requestPermission=vi.fn();};vi.stubGlobal('Notification',Notification);
});
afterEach(()=>vi.unstubAllGlobals());
it('shows once per problem across refresh and remount, and opens the matching section on click',()=>{
 render();render();expect(h.notifications).toHaveLength(1);h.refs=[];render();expect(h.notifications).toHaveLength(1);
 render([{...row,first_failed_at:'2026-11-18T11:00:00Z'}]);expect(h.notifications).toHaveLength(2);
 h.notifications[1].onclick();expect(h.navigate).toHaveBeenCalledWith('/settings/organization#gemini');expect(Notification.requestPermission).not.toHaveBeenCalled();
});
it('never prompts members or requests notification permission',()=>{render([row],false);h.permission='default';render();h.permission='granted';h.enabled=false;render();expect(h.notifications).toEqual([]);expect(Notification.requestPermission).not.toHaveBeenCalled();});
