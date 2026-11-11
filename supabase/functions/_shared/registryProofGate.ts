import type { Effort } from './deepFindEffort.ts';
/** Registry proof has its own allowance at every effort level. */
export function registryProofEligible(effort: Effort, how: string): boolean {
 return ['low','custom','medium', 'high', 'extra_high'].includes(effort) && ['ambiguous', 'not_found'].includes(how);
}
/** One guarded reservation; refusal is a normal, visible skip. */
export async function reserveRegistryProof(effort: Effort, how: string, key: boolean, left: number, reserve: () => Promise<boolean>, note: (line:string)=>void, hasName = true): Promise<boolean> {
 if (!hasName || !registryProofEligible(effort, how)) return false;
 if(!key){note('Companies House web proof skipped: no Gemini key is available.');return false;}
 if(left<=18_000){note('Companies House web proof skipped: not enough time remains.');return false;}
 try{if (await reserve()) return true;}catch{console.error('Registry proof allowance unavailable');}
 note('Companies House web proof skipped: the AI call allowance was reached.');
 return false;
}
