import {splitEnrichmentChanges} from './enrichmentGrouping';
import type {AdditionalDetail} from './enrichmentGrouping';
import type {EnrichableField,EnrichmentResult} from '../types';
export type EnrichmentApply=(patches:Record<string,Partial<Record<EnrichableField,string>>>,additions:Record<string,AdditionalDetail[]>)=>Promise<{applied:number;failed:{leadId:string;error:string}[]}>;
/** One lead at a time preserves the existing applyLeadUpdate and additional-value ordering. */
export async function applyEnrichmentRow(row:EnrichmentResult,checked:Record<string,Set<EnrichableField>>,snapshot:Record<string,Partial<Record<EnrichableField,string>>>,replace:boolean,apply:EnrichmentApply) {
 const {patches,additions}=splitEnrichmentChanges([row],checked,snapshot,replace);
 if(!Object.keys(patches).length&&!Object.keys(additions).length)return 'No changed fields selected for this lead.';
 const result=await apply(patches,additions);
 return result.failed[0]?.error??(result.applied?null:'No details were saved. Try again.');
}
