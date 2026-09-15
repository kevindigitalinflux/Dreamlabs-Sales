import { stripAiPunctuation } from './textGuardrails.ts';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// gemini-2.5-flash was retired by Google ("no longer available to new users")
// sometime after cycle 2 shipped — discovered live during Task 5 smoke testing
// when the global-fallback path silently degraded to plain-template emails.
export const AI_MODEL = 'gemini-3.6-flash';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export type ClaudeModel = 'claude-sonnet-5' | 'claude-haiku-4-5';

const DASH_GUARDRAIL_LINE =
  'Never use em-dashes or hyphens as sentence punctuation — use commas or periods instead.';

async function geminiJson(prompt: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${GEMINI_URL}/${AI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return JSON.parse(text);
}

async function claudeText(prompt: string, model: ClaudeModel, apiKey: string, maxTokens: number): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Claude returned no content');
  return text;
}

async function claudeJson(prompt: string, model: ClaudeModel, apiKey: string, maxTokens: number): Promise<unknown> {
  const text = await claudeText(
    `${prompt}\n\nRespond with ONLY valid JSON, no other text, no markdown code fences.`,
    model, apiKey, maxTokens,
  );
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}

/** Personalises an already-variable-substituted draft using lead context + notes. Throws on failure. */
export async function draftEmail(input: {
  subject: string; body: string; lead: Record<string, unknown>; notes: string[]; contractorName: string; orgName: string; apiKey: string;
}): Promise<{ subject: string; body: string }> {
  const result = await geminiJson(
`You are a sales assistant for ${input.orgName}, a UK agency selling automation/AI systems to small businesses.
Personalise this follow-up email using the lead data and call notes. Keep it plain text, warm, brief, UK English.
Do not invent facts not present in the data. Keep any URLs intact. ${DASH_GUARDRAIL_LINE} Return JSON: {"subject": string, "body": string}.

LEAD: ${JSON.stringify(input.lead)}
RECENT CALL NOTES (newest first): ${JSON.stringify(input.notes)}
SENDER NAME: ${input.contractorName}
DRAFT SUBJECT: ${input.subject}
DRAFT BODY:
${input.body}`,
    input.apiKey,
  ) as { subject?: string; body?: string };
  if (!result.subject || !result.body) throw new Error('Gemini draft missing fields');
  return { subject: stripAiPunctuation(result.subject), body: stripAiPunctuation(result.body) };
}

/** Suggests lead field updates from a note. Throws on failure. */
export async function parseNotes(input: { note: string; lead: Record<string, unknown>; apiKey: string }): Promise<Record<string, unknown>> {
  return await geminiJson(
`You extract CRM field updates from a sales call note. Compare the note against the current lead and output ONLY fields that should change, as JSON with any of these keys:
stage (one of: new_lead, contacted, audit_booked, proposal_sent, negotiating, won, lost, not_now_nurture),
deal_value (number, GBP), package_tier (one of: pilot_systems, pilot_ai_app, pilot_full_build, automation_sprint, ai_foundation, full_build, retainer_bronze, retainer_silver, retainer_gold, custom),
next_action_date (YYYY-MM-DD), next_action_note (string), pain_point (string),
rationale (string, ALWAYS present: one sentence explaining the suggestions).
Suggest nothing you are not confident about. Today is ${new Date().toISOString().slice(0, 10)}.

CURRENT LEAD: ${JSON.stringify(input.lead)}
NOTE:
${input.note}`,
    input.apiKey,
  ) as Record<string, unknown>;
}

/**
 * Multi-lead note parsing: compares a whole conversation (original note + any
 * free-text refinements) against a lead index and proposes update/create/ambiguous
 * actions across however many leads it touches. Unlike parseNotes (one lead, one
 * patch), this is genuinely one-to-many — stateless like every AI call in this app,
 * the caller resends the full conversation each round rather than this function
 * tracking any server-side state. Throws on failure.
 */
export async function parseSessionNotes(input: {
  messages: string[]; leadIndex: { id: string; business_name: string; city: string | null; stage: string }[]; apiKey: string;
}): Promise<unknown> {
  return await geminiJson(
`You extract CRM actions from a sales rep's session notes. The rep may mention
multiple companies in one note, and may send follow-up messages correcting or
clarifying an earlier one — always re-read the WHOLE conversation and produce a
fresh, complete list of actions, not just what changed.

For each company/person mentioned, decide one of three action types:
1. "update" — confidently matches one of the leads in LEAD INDEX below. Output:
   {"type":"update","lead_id":<id from LEAD INDEX>,"business_name":<their name>,
   "patch":{<only fields that should change, keys from: stage (one of new_lead,
   contacted, audit_booked, proposal_sent, negotiating, won, lost,
   not_now_nurture), deal_value (number, GBP), package_tier (one of pilot_systems,
   pilot_ai_app, pilot_full_build, automation_sprint, ai_foundation, full_build,
   retainer_bronze, retainer_silver, retainer_gold, custom), next_action_date
   (YYYY-MM-DD), next_action_note (string), pain_point (string)>},
   "excerpt":<the relevant sentence(s) from the note>,"rationale":<one sentence
   explaining the match and the changes>}
2. "create" — mentions someone NOT in LEAD INDEX at all, a genuinely new prospect.
   Output: {"type":"create","extracted":{"business_name":<string>,
   "owner_name":<string or null>,"phone":<string or null>,"email":<string or
   null>,"website":<string or null>,"city":<string or null>,"vertical":<string or
   null>},"excerpt":<relevant text>,"rationale":<one sentence>}
3. "ambiguous" — could plausibly match 2+ leads in LEAD INDEX, or the name is too
   vague to resolve alone. Output: {"type":"ambiguous","mentioned_text":<what was
   said>,"candidate_lead_ids":[<ids from LEAD INDEX>],"excerpt":<relevant text>}

Only emit an action for something a genuine business update/mention was made about —
do not invent actions for names that only appear in passing. Today is
${new Date().toISOString().slice(0, 10)}. Return a JSON array of actions (empty
array if nothing found).

LEAD INDEX: ${JSON.stringify(input.leadIndex)}

CONVERSATION (each entry is one message from the rep, in order):
${JSON.stringify(input.messages)}`,
    input.apiKey,
  );
}

/**
 * Infers a CSV column → lead-field mapping from headers + a few sample rows. This
 * is the ONLY AI call in the CSV flow — per-row extraction and duplicate detection
 * are deterministic (see parse-csv-leads/index.ts), so this stays cheap regardless
 * of how many rows the file actually has. Throws on failure.
 */
export async function mapCsvColumns(input: { headers: string[]; sampleRows: string[][]; apiKey: string }): Promise<unknown> {
  return await geminiJson(
`Map these CSV column headers to CRM lead fields. Valid target fields:
business_name (required — the company/organisation name), owner_name, phone, email,
website, address, city, postcode, vertical (industry/sector). A header maps to at
most one field; a field may be left unmapped if no header fits. Use the sample rows
to judge intent when a header name alone is ambiguous (e.g. a column of email
addresses maps to "email" even if its header is just "Contact"). Return JSON:
{"mapping":{<header string>:<one of the field names above, or null if unmapped>}}.

HEADERS: ${JSON.stringify(input.headers)}
SAMPLE ROWS: ${JSON.stringify(input.sampleRows)}`,
    input.apiKey,
  );
}

/**
 * Sonnet-only: 2-4 short bullet-style personalization talking points for a
 * lead, generated once and reused across every subsequent touch (the caller
 * is responsible for only invoking this when no `ai_summary` note exists
 * yet — see check-sequences). Throws on failure, same contract as draftEmail.
 */
export async function generateLeadNotes(input: {
  lead: Record<string, unknown>; icpParams: Record<string, unknown> | null; apiKey: string;
}): Promise<string> {
  const text = await claudeText(
`You are a sales researcher. Given this business's data (and the ICP it was found against, if any),
write 2-4 short bullet-style personalization talking points a salesperson could use in a cold email —
a likely pain point implied by its rating/review count, a plausible angle from its industry/location.
Do not invent facts not present in the data. Plain text bullets, one per line, no preamble.

LEAD: ${JSON.stringify(input.lead)}
ICP: ${JSON.stringify(input.icpParams)}`,
    'claude-sonnet-5', input.apiKey, 300,
  );
  return stripAiPunctuation(text.trim());
}

/**
 * Claude-backed sibling to draftEmail's contract — writes the actual
 * subject/body for cold-email/JV-pitch/LinkedIn content. `model` is chosen
 * by the caller (Haiku for routine drafting, Sonnet for LinkedIn DMs and
 * complex-reply responses). Throws on failure.
 */
export async function draftEmailClaude(input: {
  subject: string; body: string; lead: Record<string, unknown>; notes: string[];
  contractorName: string; orgName: string; apiKey: string; model: ClaudeModel;
}): Promise<{ subject: string; body: string }> {
  const result = await claudeJson(
`You are a sales assistant for ${input.orgName}, a UK agency selling automation/AI systems to small businesses.
Personalise this outreach email using the lead data and any notes (which may include AI-generated
personalization talking points from an earlier research pass — use them as real context, not as
text to quote verbatim). Keep it plain text, warm, brief, UK English. Do not invent facts not
present in the data. Keep any URLs intact. ${DASH_GUARDRAIL_LINE} Return JSON: {"subject": string, "body": string}.

LEAD: ${JSON.stringify(input.lead)}
NOTES (newest first): ${JSON.stringify(input.notes)}
SENDER NAME: ${input.contractorName}
DRAFT SUBJECT: ${input.subject}
DRAFT BODY:
${input.body}`,
    input.model, input.apiKey, 600,
  ) as { subject?: string; body?: string };
  if (!result.subject || !result.body) throw new Error('Claude draft missing fields');
  return { subject: stripAiPunctuation(result.subject), body: stripAiPunctuation(result.body) };
}

/**
 * Cheap Haiku classification: is this reply a short acknowledgment/plain
 * yes-or-no/out-of-office ("simple"), or does it raise a real question,
 * objection, or multiple points ("complex")? Falls back to "complex" on any
 * ambiguous or unparseable model output — the more expensive path is the
 * safer default to fail into, not the cheaper one.
 */
export async function classifyReply(input: { replyBody: string; apiKey: string }): Promise<'simple' | 'complex'> {
  const text = await claudeText(
`Classify this email reply as exactly one word: "simple" (a short acknowledgment, a plain yes/no,
an out-of-office) or "complex" (a real question, an objection, multiple points raised, anything
needing actual judgment to respond to well). Reply with ONLY that one word.

REPLY:
${input.replyBody}`,
    'claude-haiku-4-5', input.apiKey, 10,
  );
  const label = text.trim().toLowerCase();
  return label === 'simple' ? 'simple' : 'complex';
}
