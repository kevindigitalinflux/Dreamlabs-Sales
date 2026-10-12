// The one place the AI is told about the email formatting syntax (see emailFormat.ts),
// so every email-drafting prompt words it the same way. Import-free.

/** Prompt line for every AI prompt that drafts an EMAIL body (never LinkedIn messages or notes). */
export const EMAIL_FORMAT_PROMPT_LINE =
  "The draft uses a simple formatting syntax: **bold**, lines starting with '- ' for bullet points, lines starting with '## ' for a section heading, and [text](https://url) for links. " +
  'KEEP every bit of this formatting that is in the draft, in the same places, and keep the same structure (bullets stay bullets, headings stay headings). ' +
  'You may add bold to the one or two most important phrases, or turn 3 or more parallel points into bullets, but never format more than about a third of the email, never put a whole paragraph in bold, and keep greetings and the sign-off plain. ' +
  "The '- ' at the start of a bullet line is allowed; it is not sentence punctuation. " +
  'Output the body as plain text in this syntax only: no HTML, no other markdown. The subject stays plain text with no formatting.';
