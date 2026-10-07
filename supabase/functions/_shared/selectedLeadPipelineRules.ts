// Pure decision helpers for the selected-leads autopilot per-lead pipeline.
// No imports, so they run in both Deno (edge functions) and Vitest (src/lib tests).

/** Per-draft AI cost accounting: the same flat 1 cent check-sequences uses. */
export const DRAFT_COST_CENTS = 1;
/** One cheap Haiku sequence pick; counted as a flat 1 cent like a draft (integer cents). */
export const PICK_COST_CENTS = 1;

export interface SequenceStepLike { delay_days: number; template_type: string; template_id?: string | null; subject_override: string | null }

/**
 * Deno/Vitest copy of check-sequences' `advance` (itself a copy of advanceEnrollment in src/lib/sequenceMath.ts).
 * `currentStep` is the 1-based step that was JUST sent. Past the last step the enrolment completes and keeps its step number.
 */
export function nextEnrollmentState(currentStep: number, steps: { delay_days: number }[], now: Date): { current_step: number; next_send_at: string | null; status: 'active' | 'completed' } {
  const next = currentStep + 1;
  if (next > steps.length) return { current_step: currentStep, next_send_at: null, status: 'completed' };
  return { current_step: next, next_send_at: new Date(now.getTime() + steps[next - 1]!.delay_days * 86_400_000).toISOString(), status: 'active' };
}

/** Text for leads.next_action_note: `next` is the 1-based step now due. */
export function followUpNote(next: number, total: number): string {
  return `Follow up: sequence step ${next} of ${total}`;
}

/** Candidate fields that decide how the email addresses its recipient. */
export interface RecipientCandidateNames { first_name: string | null; last_name: string | null; name_obfuscated: boolean }

/**
 * Template variables that must come from the chosen decision-maker rather than the lead.
 * Empty when no candidate was chosen (the lead's own owner_name then supplies first_name).
 * The full name is only used when the surname is real (Apollo hides it until revealed).
 */
export function recipientVarOverrides(candidate: RecipientCandidateNames | null): Record<string, string> {
  if (!candidate) return {};
  const first = candidate.first_name?.trim() ?? '';
  // An empty value blanks the placeholder, so a {{first_name}} template parks instead of greeting the wrong person.
  if (!first) return { first_name: '', owner_name: '' };
  const last = candidate.last_name?.trim();
  return { first_name: first, owner_name: last && !candidate.name_obfuscated ? `${first} ${last}` : first };
}

/** Name and title of the person an email is addressed to, for the AI prompt. 'unknown' when not known. */
export function recipientLabel(candidate: (RecipientCandidateNames & { title: string | null }) | null, leadOwnerName: string | null | undefined): { name: string | null; title: string | null } {
  if (!candidate) return { name: leadOwnerName?.trim() || null, title: null };
  const o = recipientVarOverrides(candidate);
  return { name: o.owner_name || null, title: candidate.title?.trim() || null };
}

/** False only when the soft deadline has passed AND the send has not started. Once SMTP began, never give up. */
export function canSendNow(p: { deadlineMs: number; nowMs: number; sendStarted: boolean }): boolean {
  return p.sendStarted || p.nowMs < p.deadlineMs;
}

/**
 * Every placeholder name that would still be a problem in the final email: keys the variable map could not fill
 * (`missingKeys` from substituteVariables), any `{{name}}` left in the text, and a catch-all 'unknown' when stray
 * braces remain without a readable name. Deduplicated, in first-seen order.
 */
export function unfilledPlaceholderNames(subject: string, body: string, missingKeys: string[]): string[] {
  const text = `${subject} ${body}`;
  const names = new Set<string>(missingKeys);
  for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) names.add(m[1]!);
  if (names.size === 0 && /\{\{|\}\}/.test(text)) names.add('unknown');
  return [...names];
}

/** Plain-English park reason for unfilled placeholders. */
export function placeholderReason(names: string[]): string {
  return `Draft has an unfilled placeholder: ${names.map((n) => `{{${n}}}`).join(', ')}`;
}

/** First word of a full name, or null when there is none. The caller must never invent a fallback like "The". */
export function senderFirstName(fullName: string | null | undefined): string | null {
  return fullName?.trim().split(/\s+/)[0] || null;
}

/** True when the address, its domain or any parent domain is on the blocklist (entries trimmed and lower-cased). */
export function isRecipientBlocked(email: string, blocked: Set<string>): boolean {
  const norm = new Set([...blocked].map((b) => b.trim().toLowerCase()));
  const e = email.trim().toLowerCase();
  const domain = e.split('@')[1];
  if (norm.has(e)) return true;
  // A domain entry also blocks every subdomain: sub.evil.com is blocked by evil.com (parents down to two labels).
  const labels = (domain ?? '').split('.').filter(Boolean);
  for (let i = 0; i + 2 <= labels.length; i++) if (norm.has(labels.slice(i).join('.'))) return true;
  return false;
}

export interface TemplateLike { id: string; org_id: string | null; template_type: string; is_default: boolean }

/**
 * The template a step uses, exactly as check-sequences resolves it. A step naming a template id gets that one
 * (only if it belongs to this org or is shared/org-less). Otherwise the default template of the step's type,
 * the org's own before the shared one. Null when nothing matches.
 */
export function chooseTemplate<T extends TemplateLike>(templates: T[], step: { template_type: string; template_id?: string | null }, orgId: string): T | null {
  const visible = templates.filter((t) => t.org_id === orgId || t.org_id === null);
  if (step.template_id) return visible.find((t) => t.id === step.template_id) ?? null;
  const defaults = visible.filter((t) => t.template_type === step.template_type && t.is_default);
  return defaults.find((t) => t.org_id === orgId) ?? defaults.find((t) => t.org_id === null) ?? null;
}

/**
 * Faithful, id-based equivalent of the can_view_lead SQL function (migrations 018 and 023) for the run's creator
 * (the SQL uses auth.uid(), which the service role does not have). Admin of the org; or, in the default pipeline, an
 * org member who owns/was assigned the lead (or the lead has no creator); or, in a named pipeline, its owner or an
 * explicit share. Membership in the lead's org is required on top (autopilot never sends for a non member).
 */
export function canCreatorViewLead(p: {
  memberRole: string | null;
  pipeline: { is_default: boolean; created_by: string | null };
  leadCreatedBy: string | null;
  leadAssignedTo: string | null;
  shared: boolean;
  creatorId: string;
}): boolean {
  if (!p.memberRole) return false;
  if (p.memberRole === 'admin') return true;
  if (p.pipeline.is_default) return p.leadCreatedBy === null || p.leadCreatedBy === p.creatorId || p.leadAssignedTo === p.creatorId;
  return p.pipeline.created_by === p.creatorId || p.shared;
}

const isBlank = (v: unknown): boolean => typeof v !== 'string' ? v == null : v.trim() === '' || v.trim() === '—';

/** The safe fill-blank policy: found values only for fields that are blank on the lead. Never overwrites. */
export function fillBlankPatch(lead: Record<string, unknown>, found: Record<string, string | undefined>): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of ['email', 'phone', 'owner_name', 'website']) {
    const value = found[field];
    if (typeof value === 'string' && value.trim() && isBlank(lead[field])) patch[field] = value.trim();
  }
  return patch;
}

/**
 * Makes an error message safe and plain for a run-lead reason: web addresses (which can carry API keys in a query
 * string) are replaced, em/en dashes and arrows become commas or the word "to", and the text is cut to 300 characters.
 */
export function plainReason(raw: string, fallback = 'Unexpected error'): string {
  const text = raw
    .replace(/https?:\/\/\S+/gi, 'a web address')
    .replace(/\s*→\s*/g, ' to ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, 300);
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
// Bounded quantifiers keep matching linear on very long input (local part max 64, labels max 63).
const EMAIL_RE = /[A-Z0-9._%+-]{1,64}@[A-Z0-9-]{1,63}(?:\.[A-Z0-9-]{1,63}){0,10}\.[A-Z]{2,24}/gi;
// A bare domain: labels joined by dots with a 2+ letter TLD, optionally www. and a path. "e.g.", "a.m.", "1.5", "9.30am" never match.
// URLs and emails are removed first, so a domain after "...", "//", "/" or "@" is still caught.
const DOMAIN_RE = /(?<![\w-])(?:[a-z0-9-]{1,63}\.){1,10}[a-z]{2,24}(?![\w-])(?:\/[^\s<>"']*)?/gi;
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>']);
/** Removes trailing punctuation with a bounded loop from the end (linear, unlike an end-anchored regex). */
const trimEnd = (s: string): string => { let i = s.length; while (i > 0 && TRAILING.has(s[i - 1]!)) i--; return s.slice(0, i); };
const trimSlashes = (s: string): string => { let i = s.length; while (i > 0 && s[i - 1] === '/') i--; return s.slice(0, i); };
const domainKey = (token: string) => trimSlashes(trimEnd(token).toLowerCase().replace(/^www\./, ''));
/** NFKC (fullwidth forms to ASCII), ideographic full stops to dots, then zero width characters and soft hyphens removed. */
const normalise = (text: string): string =>
  text.normalize('NFKC').replace(/[。｡．]/g, '.').replace(/[​‌‍⁠﻿­]/g, '');

/** Splits text into URLs, then email addresses, then bare domains (each pass removes what it found, so nothing is counted twice). */
function extractTokens(raw: string): { urls: string[]; emails: string[]; domains: string[] } {
  const text = normalise(raw);
  const urls = [...text.matchAll(URL_RE)].map((m) => trimEnd(m[0]).toLowerCase());
  const noUrls = text.replace(URL_RE, ' ');
  const emails = [...noUrls.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
  const rest = noUrls.replace(EMAIL_RE, ' ');
  const domains = [...rest.matchAll(DOMAIN_RE)].map((m) => domainKey(m[0]));
  return { urls, emails, domains };
}

const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/**
 * Web addresses, email addresses and bare domains (acme.com, www.acme.com, acme.com/offer) in `finalText` that are not
 * allowed. Allowed: anything that appears in `templateText` or `allowed` (appended links, attachment names, the
 * unsubscribe URL), compared case-insensitively with trailing punctuation trimmed (URLs and paths exactly); a bare
 * domain that is only the host of an allowed URL or the domain part of an allowed address; and the registrable domain of
 * the lead's own website. Used to stop an AI rewrite from adding a link or contact address (mail clients make bare
 * domains clickable too).
 */
export function unexpectedLinksOrAddresses(templateText: string, finalText: string, allowed: string[], ownWebsite?: string | null): string[] {
  const known = { urls: new Set<string>(), emails: new Set<string>(), domains: new Set<string>() };
  for (const t of [templateText, ...allowed]) {
    const x = extractTokens(t);
    x.urls.forEach((u) => { known.urls.add(u); known.domains.add(hostOf(u)); });
    x.emails.forEach((e) => { known.emails.add(e); known.domains.add(e.split('@')[1] ?? ''); });
    x.domains.forEach((d) => known.domains.add(d));
    const bare = trimEnd(t.trim()).toLowerCase();
    if (/^https?:\/\//.test(bare)) { known.urls.add(bare); known.domains.add(hostOf(bare)); }
  }
  const own = ownWebsite?.trim()
    ? registrableDomain(hostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(ownWebsite.trim()) ? ownWebsite.trim() : `https://${ownWebsite.trim()}`))
    : null;
  const ownOk = own && !FREE_MAIL_DOMAINS.has(own) ? own : null;
  const final = extractTokens(finalText);
  const bad = new Set<string>();
  for (const u of final.urls) if (!known.urls.has(u)) bad.add(u);
  for (const e of final.emails) if (!known.emails.has(e)) bad.add(e);
  for (const d of final.domains) if (!known.domains.has(d) && d !== ownOk) bad.add(d);
  return [...bad];
}

/** Appends a plain opt-out line unless the body already contains the unsubscribe URL. UK English, no dashes. */
export function withUnsubscribeLine(body: string, unsubscribeUrl: string): string {
  if (unsubscribeUrl && body.includes(unsubscribeUrl)) return body;
  return `${body.trimEnd()}\n\nIf you would rather not hear from me again, you can opt out here: ${unsubscribeUrl}`;
}

/** True for a link that can really be sent to a recipient (https). A localhost or http base would give a broken opt-out. */
export function isUsableUnsubscribeUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https:\/\/[^\s/]+\/unsubscribe\/\S+$/i.test(url);
}

/** Square-bracket ([First Name]) or single-brace ({name}) placeholders left in text. */
export function hasStrayPlaceholder(text: string): boolean {
  return /\[[A-Za-z][A-Za-z _.-]{0,30}\]/.test(text) || /(^|[^{])\{[A-Za-z_][\w .-]{0,30}\}(?!\})/.test(text);
}

const MULTI_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'net.uk', 'sch.uk', 'nhs.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'com.br', 'co.in', 'co.jp', 'com.mx']);

/** Mailbox providers: an address or website on one of these never proves a business domain match. */
export const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'live.com', 'live.co.uk', 'btinternet.com', 'sky.com', 'talktalk.net', 'virginmedia.com', 'ymail.com', 'msn.com', 'gmx.com', 'gmx.co.uk', 'ntlworld.com', 'outlook.co.uk', 'googlemail.co.uk', 'mail.com', 'zoho.com', 'fastmail.com', 'hey.com']);

/** Registrable domain: www removed, last two labels, three for known suffixes like co.uk. Null for an unusable host. */
export function registrableDomain(host: string): string | null {
  const labels = host.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const last2 = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(last2) && labels.length >= 3 ? labels.slice(-3).join('.') : last2;
}

/** True when the email's domain is the lead website's registrable domain (subdomains allowed). Missing website => false. */
export function emailMatchesWebsiteDomain(email: string, website: string | null | undefined): boolean {
  const w = website?.trim();
  if (!w) return false;
  let host: string;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(w) ? w : `https://${w}`).hostname; } catch { return false; }
  const a = registrableDomain(email.split('@')[1] ?? '');
  const b = registrableDomain(host);
  return !!a && !!b && a === b && !FREE_MAIL_DOMAINS.has(a);
}

/**
 * Whether an email address FOUND during this run may be used unattended: its domain must match the lead's website,
 * and that website must have been on the lead already, or come from something other than a Google Places match.
 */
export function canSendToFoundEmail(p: { email: string; website: string | null | undefined; websiteWasOnLead: boolean; websiteSource: string | null | undefined }): boolean {
  if (!emailMatchesWebsiteDomain(p.email, p.website)) return false;
  return p.websiteWasOnLead || (!!p.websiteSource && p.websiteSource !== 'google_places');
}

export interface SendGateFacts {
  leadFound: boolean;
  sameOrg: boolean;
  /** Reason code from classifyLead when ineligible, else null. */
  ineligibleReason: string | null;
  recipientBlocked: boolean;
  enrolmentChanged: boolean;
  /** The current sequence step was already sent (sent emails linked to this enrolment >= its current step). */
  stepAlreadySent: boolean;
  recentlyEmailed: boolean;
  optedOutLeadHasAddress: boolean;
  candidateRemoved: boolean;
}

/** The first failing safeguard, in priority order, as a plain-English skip reason; null when all pass. `reasonFor` maps classifyLead codes. */
export function firstSendBlock(f: SendGateFacts, reasonFor: (code: string) => string): string | null {
  if (!f.leadFound) return 'Lead no longer exists';
  if (!f.sameOrg) return 'Lead is not in this organization';
  if (f.ineligibleReason) return reasonFor(f.ineligibleReason);
  if (f.recipientBlocked) return reasonFor('blocked');
  if (f.enrolmentChanged) return 'Sequence status changed while this lead was being processed';
  if (f.stepAlreadySent) return 'This step was already sent to this address';
  if (f.optedOutLeadHasAddress) return 'This address belongs to a lead that opted out';
  if (f.recentlyEmailed) return 'This address was emailed in the last 14 days';
  if (f.candidateRemoved) return 'The chosen decision maker was removed';
  return null;
}

/** True when the freshly loaded enrolment is the same one (id and step) the pipeline started with; both absent counts as the same. */
export function sameEnrolment(started: { id?: string; current_step?: number } | null, fresh: { id?: string; current_step?: number } | null): boolean {
  if (!started && !fresh) return true;
  if (!started || !fresh) return false;
  return started.id === fresh.id && started.current_step === fresh.current_step;
}

/** True when the enrolment's current step has already been sent: sent emails linked to it are at least its current step number. */
export function stepAlreadySent(sentLinkedCount: number, currentStep: number): boolean {
  return sentLinkedCount >= Math.max(1, currentStep);
}

export type RecipientKind = 'candidate' | 'foundEmail' | 'leadEmail';

/**
 * A website filled from Google Places during THIS run (the lead had none) is a weak match, and everything found from it
 * (the decision maker search runs on its domain, the scraped email) is unconfirmed. For any kind of recipient, the lead is
 * parked. Returns the reason, or null when the website was already on the lead or came from another source.
 */
export function placesDerivedWebsiteBlock(p: { websiteWasOnLead: boolean; websiteSource: string | null | undefined; recipientKind: RecipientKind }): string | null {
  void p.recipientKind;
  if (!p.websiteWasOnLead && p.websiteSource === 'google_places') {
    return 'Found a website and contact; please confirm they belong to this business before sending';
  }
  return null;
}
