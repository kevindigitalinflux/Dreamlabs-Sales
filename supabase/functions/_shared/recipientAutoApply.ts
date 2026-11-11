import type {TierResult} from './recipientTier.ts';
export interface AutoRecipient {address:string;name:string;tier:TierResult;savedEmail:string|null;dismissed?:boolean;contactId?:string}
/** First-email selection is independent of include_in_sequences; this helper never enrolls anyone. */
export async function autoApplyRecipients(rows:AutoRecipient[],fill:(row:AutoRecipient)=>Promise<boolean>,note:(message:string)=>Promise<void>) {
 for(const row of rows){
  if(row.dismissed||row.savedEmail?.trim()||!['T1','T2'].includes(row.tier.tier))continue;
  if(await fill(row))await note(`Added ${row.address}: ${row.tier.reason}`);
 }
}
