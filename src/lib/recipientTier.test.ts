import {describe,expect,it} from 'vitest';
import {recipientTier,type RecipientEvidence} from '../../supabase/functions/_shared/recipientTier';
const address='jane.smith@example.com';
const base:RecipientEvidence={forAddress:address,syntaxValid:true,hasMailServer:true,generated:true,roleNeedsReview:false};
const support=[{address:'alex.brown@example.com',personKey:'alex brown'},{address:'mary.jones@example.com',personKey:'mary jones'}];
const pattern={domain:'example.com',candidateMatches:true,t1Support:support};
describe('verifier v2 evidence',()=>{
 const saved={...base,generated:false,savedNonGuessed:true};
 it('trusts Microsoft exists before checker acceptance',()=>expect(recipientTier(address,{...saved,checker:'unverifiable',msExists:'exists'})).toMatchObject({tier:'T1',basis:'ms_exists',reason:'Microsoft confirms this mailbox exists.'}));
 it('keeps Microsoft not-found saved addresses under review',()=>expect(recipientTier(address,{...saved,msExists:'not_found'})).toMatchObject({tier:'T3',basis:'ms_not_found'}));
 it.each([{publishedByCompany:true,basis:'company_site'},{placesEmail:true,basis:'places'}])('preserves publication precedence $basis',({basis,...facts})=>expect(recipientTier(address,{...saved,...facts,msExists:'not_found'})).toMatchObject({tier:'T1',basis}));
 it('requires proof for unchecked saved addresses',()=>expect(recipientTier(address,{...saved,checker:'unverifiable'})).toMatchObject({tier:'T3',basis:'saved_unproven',reason:'Saved address that no check has confirmed. Review it.'}));
 it('still accepts a checker-confirmed saved address',()=>expect(recipientTier(address,{...saved,checker:'valid'}).tier).toBe('T1'));
 const role={...saved,forAddress:'info@example.com',roleNeedsReview:true};
 it.each(['exists','not_found'] as const)('does not use Microsoft %s to classify roles',msExists=>expect(recipientTier(role.forAddress,{...role,msExists})).toMatchObject({tier:'T3',basis:'role_review'}));
 it('accepts exact role confirmation',()=>expect(recipientTier(role.forAddress,{...role,roleConfirmed:true})).toEqual({tier:'T1',basis:'role_confirmed',reason:'The mail server confirms this shared inbox.'}));
 it('keeps an unconfirmed published role under review',()=>expect(recipientTier(role.forAddress,{...role,publishedByCompany:true})).toMatchObject({tier:'T3',basis:'role_review'}));
 it('hard bounce beats Microsoft and role confirmation',()=>{
  expect(recipientTier(address,{...saved,bouncedHard:true,msExists:'exists'}).tier).toBe('never');
  expect(recipientTier(role.forAddress,{...role,bouncedHard:true,roleConfirmed:true}).tier).toBe('never');
 });
});
describe('recipient tiers',()=>{
 it.each(['bouncedHard','optedOut','blocklisted'] as const)('%s defeats every positive signal',key=>{
  expect(recipientTier(address,{...base,[key]:true,checker:'valid',replied:true,sentOk:true,publishedByCompany:true,pattern}).tier).toBe('never');
 });
 it.each([{checker:'invalid' as const},{syntaxValid:false},{hasMailServer:false}])('hard negative %j defeats publication/history',negative=>{
  expect(recipientTier(address,{...base,...negative,replied:true,publishedByCompany:true}).tier).toBe('never');
 });
 it.each(['checker_valid','replied','sent_ok','company_site','places'] as const)('accepts strong evidence %s',basis=>{
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
