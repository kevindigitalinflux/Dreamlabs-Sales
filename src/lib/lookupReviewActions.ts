import type {LookupRowInput} from './jobs/lookup';
import {saveLookupProposal} from './applyLookupProposal';
import {mergeAdditions,type AdditionalDetail} from './enrichmentGrouping';
import type {EnrichableField,EnrichmentResult,Lead} from '../types';
import type {LeadPatch} from './leadUpdates';
export interface LookupReviewRow extends LookupRowInput {
 id:string;lead_id:string;reason:string|null;lead:Lead|null;reviewReason?:string|null;
 result:{proposed?:EnrichmentResult['proposed'];source?:EnrichmentResult['source'];steps?:string[];stored?:number};
}
/** Preserve unsupported and permission-limited rows with a written reason instead of a selectable action. */
export function lookupReviewReason(row:LookupReviewRow,kind:string,canEdit:boolean):string|null {
 if(kind!=='enrich')return 'Review people on the lead; these job rows are not individual people proposals.';
 if(row.review!=='pending')return 'This result has already been reviewed or has no proposals.';
 if(row.status!=='done')return 'Wait until this lookup finishes.';
 if(!row.lead)return 'This lead is no longer available.';
 if(!canEdit)return "You don't have permission to edit this lead, or permission could not be checked.";
 if(!Object.keys(row.result.proposed??{}).length)return 'No details were proposed for this lead.';
 return null;
}
/** The existing read/check/write/mark order, shared by one-row and selected lookup review. */
export async function saveLookupReview(row:LookupReviewRow,fields:Partial<Record<EnrichableField,string>>,additions:AdditionalDetail[],io:{
 read:()=>Promise<Lead|null>;write:(patch:LeadPatch,before:Lead)=>Promise<string|null>;mark:()=>Promise<boolean>;current:()=>boolean;
}):Promise<string|null> {
 return saveLookupProposal(async()=>{
  if(!io.current()||!row.lead)return 'This lead is no longer available.';
  const latest=await io.read();if(!latest||!io.current())return 'This lead is no longer available.';
  for(const field of Object.keys(fields) as EnrichableField[]) {
   if((latest[field]??'')!==(row.lead[field]??'')&&latest[field]!==fields[field])return 'These details changed while you were reviewing. Close this review and open it again.';
  }
  return io.write({...fields,...mergeAdditions(latest,additions)},latest);
 },()=>io.current()?io.mark():Promise.resolve(false));
}
