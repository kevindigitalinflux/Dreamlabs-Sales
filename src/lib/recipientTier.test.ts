import {describe,expect,it} from 'vitest';
import {recipientTier,type RecipientEvidence} from '../../supabase/functions/_shared/recipientTier';
const address='jane.smith@example.com';
const base:RecipientEvidence={forAddress:address,syntaxValid:true,hasMailServer:true,generated:true,roleNeedsReview:false};
const support=[{address:'alex.brown@example.com',personKey:'alex brown'},{address:'mary.jones@example.com',personKey:'mary jones'}];
const pattern={domain:'example.com',candidateMatches:true,t1Support:support};
describe('recipient tiers',()=>{
 it.each(['bouncedHard','optedOut','blocklisted'] as const)('%s defeats every positive signal',key=>{
  expect(recipientTier(address,{...base,[key]:true,checker:'valid',replied:true,sentOk:true,publishedByCompany:true,pattern}).tier).toBe('never');
 });
 it.each([{checker:'invalid' as const},{syntaxValid:false},{hasMailServer:false}])('hard negative %j defeats publication/history',negative=>{
  expect(recipientTier(address,{...base,...negative,replied:true,publishedByCompany:true}).tier).toBe('never');
 });
 it.each(['checker_valid','replied','sent_ok','company_site','places','saved_non_guessed'] as const)('accepts strong evidence %s',basis=>{
  const facts={checker_valid:{checker:'valid' as const},replied:{replied:true},sent_ok:{sentOk:true},company_site:{publishedByCompany:true},places:{placesEmail:true},saved_non_guessed:{generated:false,savedNonGuessed:true}}[basis];
  expect(recipientTier(address,{...base,...facts})).toMatchObject({tier:'T1',basis,reason:expect.any(String)});
 });
 it('requires two distinct T1 people on the exact domain, MX and a matching generated format',()=>{
  expect(recipientTier(address,{...base,pattern})).toMatchObject({tier:'T2',basis:'supported_pattern'});
 });
 it.each([
  {generated:false}, {hasMailServer:null}, {pattern:{...pattern,candidateMatches:false}},
  {pattern:{...pattern,domain:'other.example.com'}}, {pattern:{...pattern,t1Support:support.slice(0,1)}},
  {pattern:{...pattern,t1Support:[support[0],{...support[1],personKey:'alex brown'}]}},
  {pattern:{...pattern,t1Support:[support[0],{...support[1],address:'alex.brown@other.example.com'}]}},
  {pattern:{...pattern,t1Support:[support[0],{...support[0],address:'ALEX.BROWN@EXAMPLE.COM',personKey:'another person'}]}},
  {pattern:{...pattern,t1Support:[support[0],{address,personKey:'jane smith'}]}},
  {pattern:{...pattern,t1Support:[support[0],{...support[1],personKey:''}]}}, {supportedGuessAllowed:false},
 ])('does not promote incomplete/conflicting pattern evidence %j',patch=>{
  expect(recipientTier(address,{...base,pattern,...patch}).tier).toBe('T3');
 });
 it.each([{checker:'valid' as const},{publishedByCompany:true},{placesEmail:true},{generated:false,savedNonGuessed:true},{pattern}])('keeps hosted/catch-all role addresses at T3 despite %j',facts=>{
  const role='info@example.com';expect(recipientTier(role,{...base,forAddress:role,roleNeedsReview:true,...facts}).tier).toBe('T3');
 });
 it.each(['replied','sentOk'] as const)('real %s history can establish a hosted role mailbox',key=>{
  const role='info@example.com';expect(recipientTier(role,{...base,forAddress:role,roleNeedsReview:true,[key]:true}).tier).toBe('T1');
 });
 it('never treats a saved generated address or absent provenance as strong',()=>{
  expect(recipientTier(address,{...base,savedNonGuessed:true}).tier).toBe('T3');expect(recipientTier(address,base).tier).toBe('T3');
 });
 it('does not reuse evidence for another address and rejects header injection',()=>{
  expect(recipientTier(address,{...base,forAddress:'other@example.com',checker:'valid'}).tier).toBe('T3');
  expect(recipientTier(address+'\r\nBcc: other@example.com',{...base,checker:'valid'}).tier).toBe('never');
 });
 it('normalises address case and whitespace for exact evidence matching',()=>{
  expect(recipientTier(' JANE.SMITH@EXAMPLE.COM ',{...base,replied:true}).tier).toBe('T1');
 });
});
