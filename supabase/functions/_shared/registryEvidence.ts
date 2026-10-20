import { companyNameTokens, hasLocation, strongLocationAgrees, pickCompany, type CompanyCandidate, type LeadLocation } from './registrySearch.ts';
import { sameCompanyName } from './nameVariants.ts';

export interface RegistryEvidence { E1: boolean; E2: boolean; E3: boolean; E4: boolean; E5: boolean; E6: boolean; reasons: string[] }
export interface RegistryProof {
  pages: string[]; people: string[]; officers: Record<string, string[]>; website?: string | null; webNumbers?: string[]; peopleNumbers?: string[];
}
const EXCLUDED_CONTEXT = /\b(?:powered by|partners?|acquired|subsidiary of|part of|owned by|built by|designed by|developed by|formerly|in association with|member of|sister company)\b/;
const LEGAL_WORDING = /\b(registered in (?:england|wales|scotland|northern ireland)|company (?:no\.?|number|registration number|reg\b)|registered (?:office|number)|reg\.? ?(?:no\.?|number))/;
const LABEL_WORDS = new Set(['of', 'at', 'is', 'by', 'as', 'name', 'copyright', 'ltd']);
const NEXT_WORDS = new Set(['registered', 'company', 'reg', 'registration', 'trading', 'vat', 'is', 'are', 'was', 'a', 'an', 'the', 'whose', 'and', 'no', 'number', 'at', 'of', 'in', 'all', 'copyright']);
/** The match must start where a name can start: text start, punctuation, a year, or a small connector/label word. */
function startsAtBoundary(prefix: string) {
  const t = prefix.trimEnd();
  if (!t || !/[a-z0-9]$/.test(t)) return true;
  const word = t.match(/[a-z0-9]+$/)![0];
  return LABEL_WORDS.has(word) || /^(?:19|20)\d\d$/.test(word);
}
/** The name must not continue into more name words. */
function endsAtBoundary(suffix: string) {
  const t = suffix.trimStart();
  if (!t || !/^[a-z0-9]/.test(t)) return true;
  return NEXT_WORDS.has(t.match(/^[a-z0-9]+/)![0]);
}
const personKey = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().replace(/^(?:(?:mr|mrs|ms|miss|dr|prof|sir|dame|lord|lady) )+/, '');
/** Evidence is scored independently of provider ordering. Weak domain evidence can never authorize a pick. */
export function matchRegistryEvidence(scored: CompanyCandidate[], name: string, loc: LeadLocation, proof: RegistryProof) {
  const words = companyNameTokens(name);
  const allWords = (c: CompanyCandidate) => words.length > 0 && (words.every(w => companyNameTokens(c.name).includes(w)) || sameCompanyName(c.name, name));
  const evidence: Record<string, RegistryEvidence> = {};
  const text = proof.pages.join(' ').replace(/<[^>]*>/g, ' | ').replace(/\s+/g, ' ').toLowerCase();
  const known = proof.people.map(personKey).filter(p => p.split(' ').length >= 2 && p.split(' ').every(part => part.length >= 2));
  let host = '';
  try { host = new URL(proof.website?.includes('://') ? proof.website : `https://${proof.website ?? ''}`).hostname.replace(/^www\./, '').split('.')[0]; } catch { /* An invalid website contributes no evidence. */ }
  for (const c of scored) {
    const tokens = companyNameTokens(c.name);
    const E1 = sameCompanyName(c.name, name) || (tokens.length === words.length && allWords(c));
    const E2 = strongLocationAgrees(c, loc);
    const escapedNumber = c.company_number.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const legalName = c.name.toLowerCase().replace(/\s+/g, ' ').trim();
    const legalPattern = legalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const legalWording = [...text.matchAll(new RegExp(`(?<![a-z0-9])${legalPattern}(?![a-z0-9])`, 'g'))].some(match => {
      const index = match.index!;
      if (EXCLUDED_CONTEXT.test(text.slice(Math.max(0, index - 60), index))) return false;
      if (!startsAtBoundary(text.slice(0, index)) || !endsAtBoundary(text.slice(index + legalName.length))) return false;
      const nearby = text.slice(Math.max(0, index - 100), index) + ' '
        + text.slice(index + legalName.length, index + legalName.length + 100);
      return LEGAL_WORDING.test(nearby);
    });
    const websiteNumber = [...text.matchAll(new RegExp(`\\b${escapedNumber}\\b`, 'g'))].some(m => !EXCLUDED_CONTEXT.test(text.slice(Math.max(0, m.index! - 30), m.index!)));
    const E3 = websiteNumber || legalWording;
    const E4 = (proof.peopleNumbers ?? []).includes(c.company_number) || (proof.officers[c.company_number] ?? []).some(p => known.includes(personKey(p)));
    const E5 = (proof.webNumbers ?? []).includes(c.company_number);
    const slug = tokens.join('');
    const E6 = slug.length >= 5 && host.includes(slug);
    const reasons = [E1 ? 'exact name' : allWords(c) ? 'all name words match' : 'partial name match', c.status ?? 'status unknown',
      E2 && 'registered location matches', E3 && (websiteNumber ? `your website shows number ${c.company_number}` : 'your website shows the exact registered name with legal wording'),
      E4 && 'a known person is an active officer or PSC', E5 && 'web search confirms the company number', E6 && 'website name matches'].filter(Boolean) as string[];
    evidence[c.company_number] = { E1, E2, E3, E4, E5, E6, reasons };
  }
  const strength = (c: CompanyCandidate) => { const e = evidence[c.company_number]; return [e.E2, e.E3, e.E4, e.E5].filter(Boolean).length; };
  const active = scored.filter(c => c.status === 'active');
  const exact = active.filter(c => evidence[c.company_number].E1);
  const eligible = active.filter(c => {
    const e = evidence[c.company_number];
    if (!allWords(c)) return false;
    if (hasLocation(loc) && !e.E2 && !e.E3 && !e.E4) return false;
    return strength(c) >= 2 || (exact.length === 1 && e.E1 && (e.E2 || e.E3 || e.E4));
  });
  let chosen = eligible.length === 1 ? eligible[0] : null;
  if (chosen) {
    const selected = chosen;
    const selectedProof = evidence[selected.company_number];
    const competing = active.some(c => c !== selected && (strength(c) >= strength(selected)
      || ((!selectedProof.E3 && !selectedProof.E4) && (evidence[c.company_number].E3 || evidence[c.company_number].E4))));
    if (competing) chosen = null;
  }
  // Preserve the pre-evidence rules when no independent proof is available, including unique names without location.
  if (!chosen && !scored.some(c => { const e = evidence[c.company_number]; return e.E3 || e.E4 || e.E5; })) {
    const legacy = pickCompany(scored, name, loc).chosen;
    if (legacy && (!hasLocation(loc) || evidence[legacy.company_number].E2) && !active.some(c => c !== legacy && strength(c) >= strength(legacy))) chosen = legacy;
  }
  const candidates = [...scored].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || strength(b) - strength(a) || b.score - a.score || a.company_number.localeCompare(b.company_number))
    .slice(0, 5).map(c => ({ ...c, why: evidence[c.company_number].reasons.join(', ') }));
  return { chosen, candidates, evidence };
}
