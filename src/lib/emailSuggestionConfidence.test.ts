import { expect, it } from 'vitest';
import { guessConfidence, groupUnverifiedGuesses } from '../../supabase/functions/_shared/emailSuggestionConfidence';
const person={first:'Jane',last:'Smith'};
const a={email:'alex.brown@example.com',first:'Alex',last:'Brown',published:true};
const b={email:'mary.jones@example.com',first:'Mary',last:'Jones',published:true};
it.each([[],[a],[a,{...a}],[a,{...a,email:'alex_brown@example.com'}],[a,{...b,published:false}],[a,{...b,email:'mary@example.com'}]].map(samples=>({samples})))('keeps insufficient or conflicting evidence unverified: %j',({samples})=>{
 expect(guessConfidence('example.com',person,'jane.smith@example.com',samples,[])).toBe('Guess, unverified');
});
it('supports only the matching format from two distinct published people',()=>{
 expect(guessConfidence('example.com',person,'jane.smith@example.com',[a,b],[])).toBe('Pattern-supported. Likely: matches the format of 2 published addresses at this domain, not confirmed');
 expect(guessConfidence('example.com',person,'jane@example.com',[a,b],[])).toBe('Guess, unverified');
});
it('does not count another domain or a duplicate person twice',()=>{
 expect(guessConfidence('example.com',person,'jane.smith@example.com',[a,{...b,email:'mary.jones@other.com'}],[])).toBe('Guess, unverified');
 expect(guessConfidence('example.com',person,'jane.smith@example.com',[a,{...a,email:'ALEX.BROWN@example.com'}],[])).toBe('Guess, unverified');
});
it('requires unique known identity for anonymous site addresses',()=>{
 const samples=[{...a,first:null,last:null},{...b,first:null,last:null}];
 expect(guessConfidence('example.com',person,'jane.smith@example.com',samples,[])).toBe('Guess, unverified');
 expect(guessConfidence('example.com',person,'jane.smith@example.com',samples,[a,b])).toContain('Pattern-supported');
});
it('groups guesses across domains under one normal suggestion per person',()=>{
 const rows=[{name:'Jane Smith',field:'email',value:'jane@one.com',label:'Guess, unverified',guess_rank:'most_likely' as const},
 {name:'JANE SMITH',field:'email',value:'jane@two.com',label:'Guess, unverified',guess_rank:'most_likely' as const},
 {name:'Jane Smith',field:'email',value:'published@one.com',label:'Found on site'}];
 const out=groupUnverifiedGuesses(rows);
 expect(out.filter(s=>s.guess_rank==='most_likely')).toHaveLength(1);
 expect(out[1].guess_rank).toBe('other');expect(out[2].guess_rank).toBeUndefined();
});
