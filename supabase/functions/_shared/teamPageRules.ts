export interface TeamPerson { first: string; last: string; title: string; linkedinUrl: string | null; sourceUrl: string }
type Rung = 'target' | 'fallback' | 'final';
type Picked = TeamPerson & { rung: Rung };
export type DiscoveredRolePerson = Omit<Picked, 'sourceUrl'> & { source: 'role_search' | 'team_page' };
interface HtmlNode { tag: string; attrs: Record<string, string>; children: (HtmlNode | string)[] }
const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const key = (name: string) => words(name).join(' ');
const decode = (text: string) => text.replace(/&#(x[0-9a-f]+|\d+);|&(amp|quot|apos|nbsp|lt|gt);/gi, (_match, number: string | undefined, named: string) => {
  if (number) { const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number); return code <= 0x10ffff ? String.fromCodePoint(code) : ''; }
  return ({ amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>' } as Record<string, string>)[named.toLowerCase()];
});
const text = (node: HtmlNode | string): string => typeof node === 'string' ? decode(node) : node.children.map(text).join('|');
const flat = (node: HtmlNode | string) => text(node).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
const titleText = (node: HtmlNode | string): string => typeof node === 'string' ? decode(node)
  : ['a', 'script', 'style'].includes(node.tag) ? '' : node.children.map(titleText).join('|');
const blocked = (node: HtmlNode) => /testimonial|review|client|nav|footer/i.test(`${node.tag} ${node.attrs.id ?? ''} ${node.attrs.class ?? ''}`);
const heading = (node: HtmlNode) => /^(h[1-6]|strong)$/.test(node.tag);
const validName = (name: string) => /^[\p{L}]+(?:[-'’][\p{L}]+)*(?:\s+[\p{L}]+(?:[-'’][\p{L}]+)*){1,3}$/u.test(name);
const validTitle = (title: string) => title.length >= 2 && title.length <= 80 && title.split(/\s+/).length <= 8 && !title.endsWith('.');

function profileUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !/^(?:(?:www|[a-z]{2}(?:-[a-z]{2})?)\.)?linkedin\.com$/i.test(url.hostname) || !/^\/in\/[^/]+/.test(url.pathname)) return null;
    url.protocol = 'https:'; url.search = ''; url.hash = ''; url.pathname = url.pathname.replace(/\/+$/, ''); return url.href;
  } catch { return null; }
}

function htmlTree(html: string): HtmlNode {
  const root: HtmlNode = { tag: 'root', attrs: {}, children: [] }, stack = [root];
  const tokens = html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/gi) ?? [];
  for (const token of tokens.slice(0, 30_000)) {
    if (token.startsWith('<!--')) continue;
    if (/^<\//.test(token)) {
      const tag = /^<\/\s*([\w-]+)/.exec(token)?.[1]?.toLowerCase();
      const index = stack.map(node => node.tag).lastIndexOf(tag ?? '');
      if (index > 0) stack.length = index;
    } else if (token.startsWith('<')) {
      const tag = /^<\s*([\w-]+)/.exec(token)?.[1]?.toLowerCase(); if (!tag) continue;
      const attrs: Record<string, string> = {};
      const opening = token.slice(0, token.indexOf('>') + 1);
      for (const match of opening.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
      const node: HtmlNode = { tag, attrs, children: [] }; stack[stack.length - 1].children.push(node);
      if (tag === 'script') node.children.push(token.slice(opening.length).replace(/<\/script\s*>$/i, ''));
      else if (!/\/>$/.test(token) && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && stack.length < 100) stack.push(node);
    } else stack[stack.length - 1].children.push(token);
  }
  return root;
}

/** Extract only structured people and adjacent name/title cards from eligible company pages. */
export function teamPeopleFromPage(page: { html: string; url: string }): TeamPerson[] {
  let url: URL; try { url = new URL(page.url); } catch { return []; }
  if (!['https:', 'http:'].includes(url.protocol) || !/team|about|people|staff|leadership|management|who-we-are|our-story/i.test(url.pathname)) return [];
  const root = htmlTree(page.html), entries: { node: HtmlNode; parent: HtmlNode; excluded: boolean }[] = [];
  const visit = (node: HtmlNode, parent: HtmlNode, excluded: boolean) => {
    const hidden = excluded || blocked(node); entries.push({ node, parent, excluded: hidden });
    for (const child of node.children) if (typeof child !== 'string') visit(child, node, hidden);
  };
  visit(root, root, false);
  const companies = new Set(entries.filter(entry => entry.node.tag === 'title').flatMap(entry => flat(entry.node).split(/\s[|–-]\s/).map(key)));
  const people: TeamPerson[] = [], seen = new Set<string>();
  const add = (rawName: unknown, rawTitle: unknown, links: unknown[]) => {
    if (typeof rawName !== 'string' || typeof rawTitle !== 'string') return;
    const name = decode(rawName).trim(), title = decode(rawTitle).trim(), personKey = key(name);
    if (!validName(name) || !validTitle(title) || companies.has(personKey) || seen.has(personKey) || people.length >= 12) return;
    seen.add(personKey); const parts = name.split(/\s+/);
    people.push({ first: parts[0], last: parts.slice(1).join(' '), title, linkedinUrl: links.map(profileUrl).find(Boolean) ?? null, sourceUrl: page.url });
  };
  const jsonPeople = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 25) return;
    if (Array.isArray(value)) { for (const child of value.slice(0, 1000)) jsonPeople(child, depth + 1); return; }
    const object = value as Record<string, unknown>;
    if ([object['@type']].flat().includes('Person')) add(object.name, object.jobTitle, [object.sameAs, object.url].flat());
    for (const child of Object.values(object)) jsonPeople(child, depth + 1);
  };
  for (const { node, excluded } of entries) if (!excluded && node.tag === 'script' && node.attrs.type === 'application/ld+json') {
    try { jsonPeople(JSON.parse(node.children.join(''))); } catch { /* Malformed page data is ignored. */ }
  }
  for (const { node, parent, excluded } of entries) {
    if (excluded || !heading(node) || !validName(flat(node))) continue;
    const siblings = parent.children.slice(parent.children.indexOf(node) + 1).filter((item): item is HtmlNode => typeof item !== 'string');
    const segment: HtmlNode[] = [];
    for (const sibling of siblings) { if (heading(sibling)) break; segment.push(sibling); }
    const title = segment.map(item => titleText(item).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim()).find(Boolean);
    if (!title || !validTitle(title)) continue;
    const links: string[] = [];
    const collect = (item: HtmlNode) => { if (blocked(item)) return; if (item.attrs.href) links.push(item.attrs.href); for (const child of item.children) if (typeof child !== 'string') collect(child); };
    const namesInCard = parent.children.filter((item): item is HtmlNode => typeof item !== 'string' && heading(item) && validName(flat(item)));
    if (namesInCard.length === 1) collect(parent);
    else for (const sibling of segment) collect(sibling);
    add(flat(node), title, links);
  }
  return people;
}

/** Best rung first, with whole-word role matches and one row per person. */
export function pickTeamPeople(people: TeamPerson[], ladder: { rung: Rung; roles: string[] }[]): Picked[] {
  const picked: Picked[] = [], seen = new Set<string>();
  for (const rung of ladder) for (const person of people) {
    const name = key(`${person.first} ${person.last}`);
    if (seen.has(name) || !rung.roles.some(role => words(role).every(word => words(person.title).includes(word)))) continue;
    seen.add(name); picked.push({ ...person, rung: rung.rung }); if (picked.length === 2) return picked;
  }
  return picked;
}

/** Trust is supplied by the existing domain assessment; this performs no fetching. */
export function teamPeopleForLead(pages: { html: string; url: string }[], trust: { company: string; confirmedDomains: string[]; suspectDomains: string[] }): TeamPerson[] {
  return pages.flatMap(page => {
    let domain: string; try { domain = new URL(page.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return []; }
    if (!trust.confirmedDomains.includes(domain) || trust.suspectDomains.includes(domain)) return [];
    return teamPeopleFromPage(page).filter(person => key(`${person.first} ${person.last}`) !== key(trust.company));
  }).filter((person, index, all) => all.findIndex(other => key(`${other.first} ${other.last}`) === key(`${person.first} ${person.last}`)) === index);
}

/** A target team hit already satisfies the preferred role rung. */
export function shouldSearchAfterTeam(people: Picked[]): boolean { return !people.some(person => person.rung === 'target'); }

/** Team picks consume the same two slots; fallback picks still allow the ladder to run. */
export function combineTeamRolePeople(team: Picked[], role: (Omit<Picked, 'sourceUrl' | 'linkedinUrl'> & { linkedinUrl: string })[]): DiscoveredRolePerson[] {
  const combined = [...team.map(person => ({ ...person, source: 'team_page' as const })), ...role.map(person => ({ ...person, source: 'role_search' as const }))];
  return combined.filter((person, index) => combined.findIndex(other => key(`${other.first} ${other.last}`) === key(`${person.first} ${person.last}`)) === index).slice(0, 2);
}
