import {expect,it,vi} from 'vitest';
import {applyAgentBatch} from './dreamAgentApplyBatch';
const actions=[{type:'update',id:'a'},{type:'update',id:'b'},{type:'add_contact',id:'c'},{type:'update',id:'pending'}];
const resolutions={0:{status:'confirmed_update'},1:{status:'confirmed_update'},2:{status:'confirmed_contact',draft:{email:'edited@example.com'}},3:{status:'pending'}};
it('retains only failed and unconfirmed rows, their edited resolutions and per-row errors',async()=>{
 const write=vi.fn(async index=>index===1?'Denied':null);
 const result=await applyAgentBatch(actions,resolutions,write,async()=>[{index:2,error:'Contact changed'}]);
 expect(write.mock.calls.map(c=>c[0])).toEqual([0,1]);expect(result.actions.map(a=>a.id)).toEqual(['b','c','pending']);
 expect(result.resolutions).toEqual({0:resolutions[1],1:resolutions[2],2:resolutions[3]});expect(result.errors).toEqual({0:'Denied',1:'Contact changed'});
 expect(result.succeeded).toBe(1);
});
it('caps all action types together at fifty and never writes pending rows',async()=>{
 const many=Array.from({length:53},()=>({type:'update'}));const statuses=Object.fromEntries(many.map((_,i)=>[i,{status:i===0?'pending':'confirmed_update'}]));const save=vi.fn(async()=>null);
 const result=await applyAgentBatch(many,statuses,save,async()=>[]);expect(save).toHaveBeenCalledTimes(50);expect(result.actions).toHaveLength(3);
});
it('retains thrown failures and continues with the next confirmed row',async()=>{
 const result=await applyAgentBatch(actions.slice(0,2),resolutions,async index=>{if(index===0)throw Error('Try again');return null;},async()=>[]);
 expect(result.errors).toEqual({0:'Try again'});expect(result.succeeded).toBe(1);
});
it('does not silently drop a contact with no row outcome',async()=>{
 const result=await applyAgentBatch([actions[2]],{0:resolutions[2]},async()=>null,async()=>[]);
 expect(result.actions).toHaveLength(1);expect(result.errors[0]).toContain('Could not');
});
