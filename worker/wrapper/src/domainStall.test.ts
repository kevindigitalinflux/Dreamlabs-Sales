import {expect,it} from 'vitest'
import {DomainStallBreaker} from './domainStall.js'
it('trips after two consecutive errors for ten minutes and isolates domains',()=>{
 let now=0;const b=new DomainStallBreaker(()=>now);
 b.record('a.test',{status:'unverifiable',reason:'timeout'});expect(b.blocked('a.test')).toBe(false);
 b.record('a.test',{status:'unverifiable',reason:'checker_error'});expect(b.blocked('a.test')).toBe(true);expect(b.blocked('b.test')).toBe(false);
 now=599999;expect(b.blocked('a.test')).toBe(true);now=600000;expect(b.blocked('a.test')).toBe(false);
 b.record('a.test',{status:'unverifiable',reason:'timeout'});expect(b.blocked('a.test')).toBe(false);
});
it.each(['valid','invalid','risky'] as const)('resets the consecutive count on %s',status=>{
 const b=new DomainStallBreaker(()=>0);b.record('a.test',{status:'unverifiable',reason:'timeout'});b.record('a.test',{status,reason:'deliverable'});b.record('a.test',{status:'unverifiable',reason:'timeout'});expect(b.blocked('a.test')).toBe(false);
});
