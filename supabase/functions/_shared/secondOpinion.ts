import {recipientTier,type RecipientEvidence} from './recipientTier.ts';
export const SECOND_OPINION_ENABLED=false;
export interface VerificationResult {status:'valid'|'invalid'|'risky'|'unknown';catchAll:boolean;worked:boolean}
export interface VerificationProvider {verify(address:string,key:string):Promise<VerificationResult>}
interface Lease {orgId:string;id:string;day:string}
interface Dependencies {
 provider:VerificationProvider;
 loadOwnKey(orgId:string):Promise<{orgId:string;source:'org'|'global';value:string}|null>;
 /** Durable org-only quota, reserved atomically before dispatch; never borrow worker usage slots. */
 reserveUsage(orgId:string,dailyCap:number):Promise<Lease|null>;
 refundUsage(lease:Lease):Promise<void>;
}
interface Input {enabled?:boolean;orgId:string;address:string;evidence:RecipientEvidence;ownChecker:'valid'|'invalid'|'unverifiable';providerKind:string;dailyCap:number;ownCatchAll?:boolean}
/** Dormant seam: no vendor, endpoint, credentials or quota adapter is connected. */
export async function secondOpinion(input:Input,deps:Dependencies) {
 const original=recipientTier(input.address,input.evidence);
 const skipped={called:false,status:'unknown' as VerificationResult['status'],tier:original};
 if(!(input.enabled??SECOND_OPINION_ENABLED)||original.tier!=='T2'||input.ownChecker!=='unverifiable'
  ||!['google','microsoft','hosted','unknown'].includes(input.providerKind)||!Number.isSafeInteger(input.dailyCap)||input.dailyCap<1||input.dailyCap>1000)return skipped;
 try{
  const key=await deps.loadOwnKey(input.orgId);if(!key?.value||key.source!=='org'||key.orgId!==input.orgId)return skipped;
  const lease=await deps.reserveUsage(input.orgId,input.dailyCap);if(!lease||lease.orgId!==input.orgId)return skipped;
  let result:VerificationResult;
  try{result=await deps.provider.verify(input.address,key.value);}catch{console.error('Second verifier: uncertain provider failure');return {...skipped,called:true};}
  if(result.worked===false){try{await deps.refundUsage(lease);}catch{console.error('Second verifier: refund failed');}return {...skipped,called:true};}
  const status=result.status==='invalid'?'invalid':result.status==='valid'&&result.worked===true&&result.catchAll===false&&!input.ownCatchAll?'valid':result.status==='risky'||result.catchAll?'risky':'unknown';
  const evidence:RecipientEvidence={...input.evidence,...(status==='valid'||status==='invalid'?{checker:status}:{})};
  return {called:true,status,tier:recipientTier(input.address,evidence)};
 }catch{console.error('Second verifier: org configuration or quota unavailable');return skipped;}
}
