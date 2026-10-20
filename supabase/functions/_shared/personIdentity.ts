/** Display/creation identity only. Automatic owner/title writes must keep exact full-name matching. */
export function displayPersonKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const parts = value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z' -]/g, ' ').trim().replace(/^(?:(?:mr|mrs|ms|miss|dr|prof|sir|dame|lord|lady)\s+)+/, '').split(/\s+/);
  if (parts.length < 2 || parts[0].length < 2 || parts.at(-1)!.length < 2) return '';
  return `${parts[0]} ${parts.at(-1)}`;
}

/** Keep the fullest spelling without combining fields from different sources. */
export function fullestPeople<T>(people: T[], name: (person: T) => string): T[] {
  const out: T[] = [];
  for (const person of people) {
    const key = displayPersonKey(name(person));
    const index = key ? out.findIndex(p => displayPersonKey(name(p)) === key) : -1;
    if (index < 0) out.push(person);
    else if (name(person).split(/\s+/).length > name(out[index]).split(/\s+/).length) out[index] = person;
  }
  return out;
}
