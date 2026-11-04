import type { Effort } from './deepFindEffort.ts';
/** Low stays free-only; custom keeps its existing lack of a dedicated registry proof call. */
export function registryProofEligible(effort: Effort, how: string): boolean {
 return ['medium', 'high', 'extra_high'].includes(effort) && ['ambiguous', 'not_found'].includes(how);
}
/** One guarded reservation; refusal is a normal, visible skip. */
export async function reserveRegistryProof(effort: Effort, how: string, key: boolean, left: number, reserve: () => Promise<boolean>, note: (line:string)=>void, hasName = true): Promise<boolean> {
 if (!hasName || !registryProofEligible(effort, how) || !key || left <= 18_000) return false;
 if (await reserve()) return true;
 note('Companies House web proof skipped: the AI call allowance was reached.');
 return false;
}
