export interface RegistryOfficer { first_name: string | null; last_name: string | null; title: string | null }

const CORPORATE = /\b(ltd|limited|llp|plc|secretaries|nominees|nominee|services|holdings|trustees)\b/i;

/** Capitalises the first letter and the letter after a hyphen or apostrophe: MARY-JANE to Mary-Jane, O'BRIEN to O'Brien. (McDonald becomes Mcdonald, accepted.) */
function titleCase(word: string): string {
  return word ? word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase()) : word;
}

/** Splits "SURNAME, Forename Middle" (registry style) or "Forename Surname" into first and last name. */
export function splitOfficerName(raw: string): { first_name: string | null; last_name: string | null } {
  const name = raw.trim();
  if (!name) return { first_name: null, last_name: null };
  const comma = name.indexOf(',');
  if (comma !== -1) {
    const surname = name.slice(0, comma).trim();
    const forenames = name.slice(comma + 1).trim().split(/\s+/).filter(Boolean);
    return { first_name: forenames[0] ? titleCase(forenames[0]) : null, last_name: surname ? titleCase(surname) : null };
  }
  const parts = name.split(/\s+/);
  return { first_name: titleCase(parts[0]!), last_name: parts.length > 1 ? parts.slice(1).map(titleCase).join(' ') : null };
}

/** "director" -> "Director", "secretary" -> "Company Secretary", "llp-member" -> "Llp Member". */
export function officerTitle(role: string | undefined): string | null {
  if (!role) return null;
  if (role === 'secretary') return 'Company Secretary';
  return role.split('-').map(titleCase).join(' ');
}

/** Active, non-corporate officers as decision-maker candidates: directors first, at most `max`. */
export function mapCompaniesHouseOfficers(
  items: { name?: string; officer_role?: string; resigned_on?: string }[],
  max = 5,
): RegistryOfficer[] {
  const people = items.filter((i) => i.name && !i.resigned_on && !CORPORATE.test(i.name) && !(i.officer_role ?? '').startsWith('corporate'));
  people.sort((a, b) => Number(b.officer_role === 'director') - Number(a.officer_role === 'director'));
  return people.slice(0, max).map((i) => ({ ...splitOfficerName(i.name!), title: officerTitle(i.officer_role) }));
}
