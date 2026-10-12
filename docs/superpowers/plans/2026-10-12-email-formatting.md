# Email formatting (bold, bullets, headings, links) Implementation Plan

> For agentic workers: implement task by task, TDD, small commits. Do not push, apply migrations or deploy; the controller does that.

**Goal:** Let users format email text (bold, bullet lists, headings, links) in every email text box with a Gmail-style toolbar under the box and a live "How it will look" preview; send formatted emails as HTML plus a plain-text copy; make the AI drafting prompts keep and use the formatting.

**Architecture:** Bodies stay plain strings with a tiny marker syntax (so templates, AI drafts, sequences, review queue, DB and reply matching are unchanged). One import-free shared module parses the markers into blocks; the same blocks produce (a) the HTML email, (b) the plain-text alternative, (c) the React preview. A reusable toolbar applies/removes markers on the selected text of a textarea. No database change.

**Tech Stack:** React 19 + TS strict + Tailwind (utility classes, existing ui components), Deno edge functions, denomailer (supports `html`), vitest. Pure modules live in `supabase/functions/_shared/` (import-free) and are tested from `src/lib/*.test.ts`.

## Marker syntax (the single source of truth)

- `**bold**` inline bold.
- A line starting with `- ` is a bullet (consecutive bullet lines form one list).
- A line starting with `## ` is a heading (shown larger and bold).
- `[text](https://url)` is a link; a bare `https://...` URL is also made clickable. Only `https://` and `http://` hosts; anything else stays literal text.
- A blank line separates paragraphs; a single newline inside a paragraph is a line break.
- Everything else is literal. All text is HTML-escaped when rendered.
- Unclosed `**` is literal text (never swallow the rest of the email). Empty `****` is literal.

## Global constraints

- No default exports, named exports only, JSDoc on exported functions, Tailwind utility classes only, components under ~150 lines, loading/error/empty states where relevant.
- The unsubscribe line in every email (`click here to unsubscribe: https://...`) must still work: the bare URL becomes a link and the plain-text copy keeps the URL visible.
- If the body has NO markers, send EXACTLY as today (plain text only, no HTML part). Only add the HTML part when the body contains at least one marker (`hasFormatting`). Deliverability must not change for existing plain emails.
- Escape everything. No `dangerouslySetInnerHTML` in the client; the preview renders React elements from the parsed blocks. The HTML renderer escapes `& < > " '` in text and attribute values; link hrefs are only emitted for validated http(s) URLs.
- The AI `stripAiPunctuation` backstop (`/ [—–-] /` -> ", ") must not damage bullet lines: bullets are `- ` at the START of a line, and indentation must not trigger it. Change the regex so it only matches a dash with a non-space character before the space (`(?<=\S) [—–-] `), and add a test that a bullet line `- Item one` and an indented `  - Item` survive.
- UK English in user-facing copy. No em-dashes in new user-facing text.

## Review Focus

1. Body with only `-` hyphen text mid-line ("well-known", "2 - 3 days") must not become bullets.
2. Unclosed or nested markers (`**a`, `**a **b** c**`, `** **`) must not break or drop text.
3. HTML injection: `<script>`, `<img onerror>`, `javascript:` links in the body must come out inert.
4. A body that has no formatting sends plain text exactly as before.
5. Template variables substituted INTO a marker line (e.g. `**{{first_name}}**`) still render; a value containing `**` or `<` must not break the structure.

---

### Task 1: Shared parser + renderers (pure, tested)

**Files:**
- Create: `supabase/functions/_shared/emailFormat.ts`
- Test: `src/lib/emailFormat.test.ts`

**Interfaces (produce):**
```ts
export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'link'; text: string; href: string };
export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }   // each line is a list of inline pieces
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'list'; items: Inline[][] };
export function parseEmail(body: string): Block[];
export function hasFormatting(body: string): boolean;      // true if any bold, bullet, heading or [text](url) marker is present (bare URLs alone do NOT count)
export function renderEmailHtml(body: string): string;     // full inline-styled HTML fragment, safe, system font stack, 14-15px, 1.5 line-height
export function renderEmailText(body: string): string;    // plain-text alternative: bold markers removed, bullets as "- ", headings as the plain line followed by nothing extra, links as "text (url)" (just "url" when text equals url)
```
Rules: follow "Marker syntax" exactly. Inline parser handles `**bold**` and `[text](url)` and bare URLs (strip trailing `.,;:!?)` from a bare URL). Link text may not contain `]`. A link's href must pass `^https?://[^\s/?#@]+\.[^\s/?#@]+` else the markup stays literal. Headings are not nested in lists. Windows line endings are normalised.
HTML renderer output: `<div style="font-family:...">`; paragraphs `<p style="margin:0 0 12px">`, headings `<p style="margin:16px 0 8px;font-size:17px;font-weight:700">`, lists `<ul style="margin:0 0 12px;padding-left:22px"><li style="margin:0 0 4px">`, bold `<strong>`, links `<a href="..." style="color:#2563eb">` with `rel="noopener noreferrer"`.

- [ ] Step 1: write failing tests covering: bold, unclosed/nested/empty bold, bullets (and "well-known", "2 - 3 days" NOT bullets, a lone "-" line, `-item` without space is not a bullet), headings, `##` without space not heading, link and bare URL (trailing punctuation), non-http link stays literal, `javascript:` stays literal, HTML escaping of `<script>`/quotes/ampersands in text AND link text/href, CRLF, blank-line paragraphs vs single newlines, unsubscribe line becomes a link in HTML and the URL stays in text, `hasFormatting` true/false cases, `renderEmailText` for each construct, and a snapshot-free structural check of `renderEmailHtml` for a representative email.
- [ ] Step 2: run, see fail. Step 3: implement. Step 4: run, pass. Step 5: commit `feat: email formatting parser and renderers`.

### Task 2: Toolbar text operations (pure, tested)

**Files:**
- Create: `src/lib/emailFormatEdit.ts`
- Test: `src/lib/emailFormatEdit.test.ts`

**Interfaces (produce):**
```ts
export interface EditResult { text: string; selStart: number; selEnd: number }
export function toggleBold(text: string, selStart: number, selEnd: number): EditResult;
export function toggleBullets(text: string, selStart: number, selEnd: number): EditResult;
export function toggleHeading(text: string, selStart: number, selEnd: number): EditResult;
export function insertLink(text: string, selStart: number, selEnd: number, url: string): EditResult; // wraps the selection as [selection](url); with no selection inserts [url](url)
export function activeFormats(text: string, selStart: number, selEnd: number): { bold: boolean; bullets: boolean; heading: boolean };
export function normaliseLinkUrl(raw: string): string | null; // trims; adds https:// when missing a scheme; null unless it passes the http(s) rule from Task 1 (import the helper from emailFormat or duplicate nothing)
```
Behaviour: `toggleBold` wraps the selection in `**`, or unwraps when the selection is already wrapped (markers just outside the selection, or inside it); with an empty selection it selects the word under the cursor, or inserts `****` with the cursor between the markers when there is no word. Bullets and heading act on every LINE touched by the selection: add the prefix to lines without it, remove it when ALL touched lines already have it (a heading line cannot also be a bullet: applying one removes the other). Empty lines in a multi-line selection are skipped. Selection indexes are returned adjusted so the same text stays selected. Never mutate the input.

- [ ] Step 1: failing tests (each toggle on/off, multi-line, empty selection, cursor in a word, mixed lines, heading<->bullet swap, link with/without selection, `normaliseLinkUrl` cases incl. `javascript:x` -> null, `example.com` -> `https://example.com`). Step 2-4 as usual. Step 5: commit `feat: email formatting toolbar operations`.

### Task 3: FormattedEmail preview + EmailTextEditor component

**Files:**
- Create: `src/components/emails/FormattedEmail.tsx` (renders `parseEmail` blocks as React elements; same visual rules as the HTML renderer; links open in a new tab with `rel="noopener noreferrer"`; empty body shows a muted "Nothing to preview yet")
- Create: `src/components/emails/EmailFormatToolbar.tsx` (buttons: Bold, Bullets, Heading, Link; each with an icon from lucide-react and visible text label, `aria-pressed` from `activeFormats`, min 44px touch targets like the rest of the app; Link opens a small inline URL field with Add/Cancel and a clear error for an invalid URL)
- Create: `src/components/emails/EmailTextEditor.tsx` (props: `label`, `value`, `onChange`, `rows`, optional `hint`; renders the existing `Textarea`, the toolbar BELOW it, then a "How it will look" panel using `FormattedEmail`; keeps selection after a toolbar click (restore focus + selection with a ref and `requestAnimationFrame`); toolbar buttons use `onMouseDown={(e) => e.preventDefault()}` so the selection is not lost; works with a forwarded ref when the caller needs the textarea ref (TemplateEditor inserts variables at the cursor via `bodyRef`))
- Test: `src/lib/emailFormatPreview.test.ts` is NOT needed; keep component logic thin and covered by Tasks 1-2. Do add a short test file only if a pure helper is extracted.

Requirements: the preview must update live; on mobile the preview stacks under the toolbar; show a one-line help under the toolbar: "Select text, then press a button. The preview shows how it will look in the email."; no layout shift when the toolbar state changes.

- [ ] Steps: implement, `npx tsc --noEmit`, `npm run build`, commit `feat: email text editor with formatting toolbar and preview`.

### Task 4: Use it in every email text box and show formatted bodies

**Files (modify):** `src/components/emails/TemplateEditor.tsx` (Body box -> `EmailTextEditor`, keeping `bodyRef` variable insertion working; replace the existing plain "Preview (sample lead)" body rendering with `FormattedEmail` of the substituted preview text), `src/components/emails/RecipientDraftCard.tsx`, `src/components/emails/EmailComposer.tsx` (the single-editor Body textarea; rename the label from "Body (plain text — lands in inboxes better)" to "Body"; keep the diff view), and every other place that SHOWS an email body as text (grep `whitespace-pre-wrap` near email `body`/`log.body`/draft bodies: sent-mail history, Waiting to release / review queue, lead email timeline). Those read-only places render with `FormattedEmail`. If a place edits a body in another textarea, use `EmailTextEditor` there too. Sequence step editors only choose templates; confirm and note it.

- [ ] Steps: find all places (list them in your report), change them, check the app builds and types, run the full test suite, commit `feat: formatting toolbar and formatted display across emails`.

### Task 5: Send as HTML + plain text

**Files (modify):** `supabase/functions/_shared/smtp.ts`, `supabase/functions/_shared/sendLeadEmail.ts` (only what is needed), tests in `src/lib/emailFormatSend.test.ts` for the pure choice helper if you extract one.

Requirements: `sendMail` gets an optional `html?: string`. When the body `hasFormatting`, pass `content` = `renderEmailText(body)` and `html` = `renderEmailHtml(body)` to denomailer (it builds multipart/alternative); otherwise exactly today's `content: msg.body` only. Keep header-injection stripping, attachments, Message-ID untouched. The `email_logs.body` keeps the raw marker text (so the queue and history re-render it). Verify denomailer 1.6.0 supports `html` together with `content` and attachments (read its source in the Deno cache or the repo docs; if unsure say so). Add the pure helper `buildMailContent(body): { content: string; html?: string }` to a shared module and unit test it (no markers -> no html; markers -> both; unsubscribe URL present in both).

- [ ] Steps: implement, tests, syntax check the Deno files the same way earlier tasks did (`--ignoreConfig` style check, grep for TS1 errors), commit `feat: send formatted emails as HTML with a plain-text copy`.

### Task 6: AI drafting prompts keep and use formatting; guardrail fix

**Files (modify):** `supabase/functions/_shared/ai.ts` (`draftEmail`, `draftEmailClaude`, and any other prompt that drafts email bodies), `supabase/functions/_shared/selectedLeadSteps/draft.ts`, `supabase/functions/_shared/textGuardrails.ts`, other drafting prompts found by grepping `plain text` / `Keep it plain` / `DRAFT BODY` / `Return JSON: {"subject"` across `supabase/functions` (check-sequences, check-replies auto-draft, generate-email, run-selected-autopilot paths). Create `supabase/functions/_shared/emailFormatPrompt.ts` exporting one constant `EMAIL_FORMAT_PROMPT_LINE` used by all of them so the wording lives in one place. Test: `src/lib/emailFormatPrompt.test.ts` + extend the textGuardrails tests.

Prompt wording (adapt only for fit): "The draft uses a simple formatting syntax: **bold**, lines starting with '- ' for bullet points, lines starting with '## ' for a section heading, and [text](https://url) for links. KEEP every bit of this formatting that is in the draft, in the same places, and keep the same structure (bullets stay bullets, headings stay headings). You may add bold to the one or two most important phrases, or turn 3 or more parallel points into bullets, but never format more than about a third of the email, never put a whole paragraph in bold, and keep greetings and the sign-off plain. Output the body as plain text in this syntax only: no HTML, no other markdown."
Replace "Keep it plain text" with the above where it appears for email bodies (NOT in LinkedIn DM or note-generation prompts). Guardrail: change `stripAiPunctuation` regex as in Global constraints, test it; add a test that bullet and heading lines survive `stripAiPunctuation` for both `-` and `##`.

- [ ] Steps: implement, tests, syntax check, full suite, build, commit `feat: AI drafts keep and use email formatting`.

### Task 7: Docs

**Files:** `CLAUDE.md` (a short entry under the 2026-10-12 session section: marker syntax, where it is rendered, the HTML-only-when-formatted rule), `docs/TODO.md` (add: send a formatted test email to your own address and check it in Gmail and on a phone; optional italic / numbered lists later).
- [ ] Commit `docs: email formatting`.

## Out of scope

Italic, numbered lists, images, colours, a full WYSIWYG editor, LinkedIn DM formatting, re-formatting old sent emails in bulk.
