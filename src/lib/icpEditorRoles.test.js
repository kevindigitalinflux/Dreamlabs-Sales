import {expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({slots:[],index:0}));
vi.mock('react',async original=>({...await original(),useState:initial=>{const index=state.index++;if(!(index in state.slots))state.slots[index]=initial;return [state.slots[index],next=>{state.slots[index]=typeof next==='function'?next(state.slots[index]):next}]}}));
import {IcpEditor} from '../components/settings/IcpEditor';
import {candidateSourceLabel,isProviderSource} from './candidateSource';
function nodes(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(nodes)]}
it('saves typed role lines as arrays, dropping blank lines and duplicates',async()=>{
 state.slots=[];const save=vi.fn(async()=>null);const props={profile:null,canEdit:true,onSave:save,onDelete:async()=>null,onClose:vi.fn()};const render=()=>{state.index=0;return nodes(IcpEditor(props))};
 let tree=render();tree.find(n=>n.props?.label==='Name').props.onChange({target:{value:'Offices'}});
 tree.find(n=>n.props?.label==='Target roles').props.onChange({target:{value:'Facilities Manager\n\nOffice Manager\nDirector\nDirector'}});
 tree.find(n=>n.props?.label==='Fallback roles').props.onChange({target:{value:'Operations Manager\n\nHR Manager'}});
 tree=render();tree.find(n=>n.props?.children==='Save profile').props.onClick();await Promise.resolve();
 expect(save).toHaveBeenCalledWith(expect.objectContaining({target_roles:['Facilities Manager','Office Manager','Director'],fallback_roles:['Operations Manager','HR Manager']}),undefined);
});
it('labels role search as a provider source',()=>{expect(candidateSourceLabel('role_search')).toBe('Found by role search');expect(isProviderSource('role_search')).toBe(true)});
