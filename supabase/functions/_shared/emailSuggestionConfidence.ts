import { inferDomainPattern, patternGuess, type PatternSample, type NamedPerson } from './domainPattern.ts';
import { displayPersonKey } from './personIdentity.ts';
/** Only addresses actually observed in published sources can support confidence. */
export interface PublishedPatternSample extends PatternSample { published: boolean }
/** Counts distinct known people, never addresses or guesses alone. */
export function guessConfidence(domain: string, person: NamedPerson, email: string, samples: PublishedPatternSample[], people: NamedPerson[]): string {
  const real = [...new Map(samples.filter(s=>s.published).map(s=>[s.email.toLowerCase(),s])).values()];
  const pattern = inferDomainPattern(domain, real, people);
  if (!pattern || patternGuess(pattern, person, domain)?.toLowerCase() !== email.toLowerCase()) return 'Guess, unverified';
  const identities = new Set<string>();
  for (const sample of real) {
    const names = sample.first && sample.last ? [{first:sample.first,last:sample.last}] : people;
    const matches = new Set(names.filter(p=>patternGuess(pattern,p,domain)?.toLowerCase()===sample.email.toLowerCase()).map(p=>displayPersonKey(p.first+' '+p.last)));
    if(matches.size===1)identities.add([...matches][0]!);
  }
  return identities.size>=2 ? `Pattern-supported. Likely: matches the format of ${identities.size} published addresses at this domain, not confirmed` : 'Guess, unverified';
}
/** Keeps published/verified findings intact and places extra format guesses in the existing collapsed group. */
export function groupUnverifiedGuesses<T extends {name:string;label:string;guess_rank?:'most_likely'|'other'}>(rows:T[]):T[] {
  const seen=new Set<string>();
  return rows.map(row=>{
    if(!row.guess_rank)return row;
    const key=displayPersonKey(row.name);const rank=seen.has(key)?'other':'most_likely';seen.add(key);
    return {...row,guess_rank:rank};
  });
}
