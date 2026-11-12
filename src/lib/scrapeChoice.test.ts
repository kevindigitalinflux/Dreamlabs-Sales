import {expect,it} from 'vitest';
import {chooseScrapeDomain} from '../../supabase/functions/_shared/scrapeChoice';
const base={isDirectory:(domain:string)=>domain==='yell.com',namedEmails:()=>0};
it('scrapes the lead site even when a phone or one address was already found',()=>expect(chooseScrapeDomain({...base,verified:['a.com'],siteDomain:'a.com',namedEmails:()=>1})).toBe('a.com'));
it('skips a site that already gave two named addresses',()=>expect(chooseScrapeDomain({...base,verified:['a.com'],siteDomain:'a.com',namedEmails:()=>2})).toBeNull());
it('never scrapes a directory or an unverified site',()=>{
 expect(chooseScrapeDomain({...base,verified:['yell.com'],siteDomain:'yell.com'})).toBeNull();
 expect(chooseScrapeDomain({...base,verified:[],siteDomain:'a.com'})).toBeNull();
});
it('prefers the lead site over another verified domain',()=>expect(chooseScrapeDomain({...base,verified:['b.com','a.com'],siteDomain:'a.com'})).toBe('a.com'));
it('falls back to the first eligible domain if the lead site already has two named emails',()=>expect(chooseScrapeDomain({...base,verified:['b.com','a.com'],siteDomain:'a.com',namedEmails:domain=>domain==='a.com'?2:0})).toBe('b.com'));
