import {runRowBatch} from './rowSelection';
import {REVIEW_BATCH_LIMIT} from './reviewBatch';
/** Keep grouped contact ordering, while removing only rows whose own save succeeded. */
export async function applyAgentBatch<T extends {type:string},R extends {status:string}>(actions:T[],resolutions:Record<number,R>,
 save:(index:number)=>Promise<string|null>,contacts:(indices:number[])=>Promise<{index:number;error:string|null}[]>) {
 const chosen=actions.map((action,index)=>({action,index})).filter(r=>resolutions[r.index]?.status.startsWith('confirmed_')).slice(0,REVIEW_BATCH_LIMIT);
 const contact=chosen.filter(r=>['add_contact','update_contact'].includes(r.action.type)).map(r=>r.index);
 const results=await runRowBatch(chosen.filter(r=>!contact.includes(r.index)),r=>save(r.index));
 const outcomes=results.map(r=>({index:r.row.index,error:r.error}));
 if(contact.length){try{outcomes.push(...await contacts(contact));}catch(error){console.error('Dream Agent contact batch failed',error);outcomes.push(...contact.map(index=>({index,error:'Could not save this contact. Try again.'})));}}
 for(const row of chosen)if(!outcomes.some(result=>result.index===row.index))outcomes.push({index:row.index,error:'Could not confirm this row was saved. Review it before trying again.'});
 const saved=new Set(outcomes.filter(r=>!r.error).map(r=>r.index));
 const errors:Record<number,string>={};const nextResolutions:Record<number,R>={};
 const remaining=actions.flatMap((action,index)=>{
  if(saved.has(index)||resolutions[index]?.status==='dismissed')return [];
  const next=Object.keys(nextResolutions).length;nextResolutions[next]=resolutions[index];
  const error=outcomes.find(r=>r.index===index)?.error;if(error)errors[next]=error;
  return [action];
 });
 return {actions:remaining,resolutions:nextResolutions,errors,succeeded:saved.size};
}
