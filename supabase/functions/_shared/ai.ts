const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const AI_MODEL = 'gemini-2.5-flash';

async function geminiJson(prompt: string): Promise<unknown> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const res = await fetch(`${GEMINI_URL}/${AI_MODEL}:generateContent?key=${key}`, {
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

/** Personalises an already-variable-substituted draft using lead context + notes. Throws on failure. */
export async function draftEmail(input: {
  subject: string; body: string; lead: Record<string, unknown>; notes: string[]; contractorName: string;
}): Promise<{ subject: string; body: string }> {
  const result = await geminiJson(
`You are a sales assistant for Digital Influx Dreamlabs, a UK agency selling automation/AI systems to small businesses.
Personalise this follow-up email using the lead data and call notes. Keep it plain text, warm, brief, UK English.
Do not invent facts not present in the data. Keep any URLs intact. Return JSON: {"subject": string, "body": string}.

LEAD: ${JSON.stringify(input.lead)}
RECENT CALL NOTES (newest first): ${JSON.stringify(input.notes)}
SENDER NAME: ${input.contractorName}
DRAFT SUBJECT: ${input.subject}
DRAFT BODY:
${input.body}`,
  ) as { subject?: string; body?: string };
  if (!result.subject || !result.body) throw new Error('Gemini draft missing fields');
  return { subject: result.subject, body: result.body };
}

/** Suggests lead field updates from a note. Throws on failure. */
export async function parseNotes(input: { note: string; lead: Record<string, unknown> }): Promise<Record<string, unknown>> {
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
  ) as Record<string, unknown>;
}
