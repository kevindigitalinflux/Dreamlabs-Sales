import {useRef,useState} from 'react';
import {useRowSelection} from './useRowSelection';
import {runReviewBatch} from '../lib/reviewBatch';
/** Successful rows leave; failed and unprocessed rows retain their selection and errors. */
export function useReviewBatch(ids:string[]) {
 const [done,setDone]=useState<Set<string>>(new Set());
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [summary,setSummary]=useState('');
 const [busy,setBusy]=useState(false);
 const locked=useRef(false);
 const selection=useRowSelection(ids.filter(id=>!done.has(id)));
 const reset=()=>{selection.clear();setDone(new Set());setErrors({});setSummary('');};
 async function run<T>(rows:T[],key:(row:T)=>string,action:(row:T)=>Promise<string|null>,label:string) {
  if(locked.current||!selection.selected.size)return;
  locked.current=true;setBusy(true);
  try {
   const results=await runReviewBatch(rows,selection.selected,key,action);
   const successes=results.filter(r=>!r.error).map(r=>key(r.row));
   setDone(previous=>new Set([...previous,...successes]));
   for(const id of successes)selection.remove(id);
   setErrors(previous=>{const next={...previous};for(const r of results){const id=key(r.row);if(r.error)next[id]=r.error;else delete next[id];}return next;});
   setSummary(`${label}: ${successes.length} succeeded, ${results.length-successes.length} failed.${selection.selected.size>results.length?' Remaining rows stay selected.':''}`);
  } finally {locked.current=false;setBusy(false);}
 }
 return {...selection,done,errors,summary,busy,run,reset};
}
