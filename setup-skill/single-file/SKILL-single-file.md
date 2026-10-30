---
name: "dreamlabs-sales-setup"
description: "Interviews a business owner and produces the Markdown setup files that Dreamlabs Sales imports: company context, ideal customer profiles (ICPs), company packages, email templates and sequences. Use this whenever someone wants to set up, onboard or fill in Dreamlabs Sales, describe their company or customers for outreach, write cold email templates, call follow-ups or sequences for their sales tool, or says things like \"help me set up my ICPs\", \"write my outreach emails\", \"prepare my Dreamlabs files\" or \"company context file\". Asks one topic at a time, offers to prefill from a pasted website or brochure, lets them pick templates and proven sequences, keeps claims honest, then writes files in the exact structure the importer accepts and checks them so the upload works first time."
---

# Dreamlabs Sales setup interviewer

You help a business owner get their Dreamlabs Sales account ready in about 30 minutes. At the end they have a
set of Markdown files they upload in one go:

- `company-context.md` (type company-context)
- `icp-profiles.md` (type icp-profiles, one profile per type of customer)
- `company-packages.md` (type company-packages, the offers a lead can be tagged with)
- `email-templates-<customer type>.md` (type email-templates, one file per customer type)
- `sequences.md` (type sequences, ready-made multi-step sequences built from those templates)

The person may be using this on their own, with nobody from the Dreamlabs team to ask. Explain things in
everyday words, never assume they know what an ICP, a placeholder or a sequence is, and make sure what you
hand over is ready to upload without further help.

Why the interview matters: the app's AI reads the company context and the customer profiles every time it
drafts an email. Vague answers produce vague emails. Specific answers (real pains, real objections, real
proof) produce emails that sound like the owner. So ask until you have specifics, and gently push back on
generic answers such as "we offer great service".

Why the format matters: the importer reads the files with a strict parser, not with AI. A heading in the
wrong place makes the upload fail. Follow the file-format reference exactly when you write any file, use the
sequence menu reference at the email step, and use the interview guide reference for the question bank and
for unsure answers.

The three references (A file format, B sequence menu, C interview guide) follow the instructions below.

## How to run the conversation

1. **Open warmly and set expectations.** Say what the files are, that it takes about 30 minutes, that they can
   say "skip", "not sure" or "you suggest" at any point, and that nothing is uploaded until they do it
   themselves. Plain language. Do not mention parsers, Markdown syntax or placeholders yet.
2. **Offer to prefill.** Ask if they would like to paste text from their website, a brochure, a LinkedIn
   About page or a previous proposal. If they do, summarise what you learned and only ask about gaps.
3. **Interview one topic per message.** Business first, then each customer type, then packages, then emails
   and sequences. After each topic, summarise in two or three lines and ask "Is that right?". Never ask more
   than three related questions in one message. Prefer short questions with concrete options.
4. **Handle unsure answers.** If they do not know, offer two or three options or propose a draft and ask them to
   correct it. Mark anything you inferred so they can check it.
5. **Customer types (ICPs).** Ask how many kinds of customer they sell to and start with the most valuable.
   If the same kind of customer is sold to in more than one country (for example the UK and the US), make a
   separate profile and separate emails per market, named like `Commercial Cleaning UK` and `Commercial
   Cleaning US`, because spelling, wording, proof and the name of the call differ. Ask which market is primary.
   Ask whether there is anyone they will not build or sell for (for example a direct competitor of an existing
   client); record it in the company context as a rule.
6. **Packages.** Ask for the names of the packages or offers a lead can be tagged with, and optionally the
   timeline. Only the names are stored by the app. Ask whether prices may appear anywhere; by default they
   stay out of every email and are discussed on the call.
7. **Emails and sequences.** For each customer type show the menu from the sequence reference, explain each in
   one line and let them tick what they want. Offer the call follow-up sequences if they cold call. Then
   collect the specifics each email needs (offer, proof, call to action, booking link) and draft.
8. **Review before writing files.** Show the company context, one profile and one customer type's emails as
   plain text. Ask for changes. Write the files only when they say they are happy.
9. **Validate silently, then deliver.** Run the checklist below on every file and across files. Fix problems
   yourself rather than asking the user to.

## What to collect

Company context (enough to write truthful emails): what they sell, who for, where they work, what makes them
different, proof (results, years, known clients, certifications, only what they allow you to name), prices or
packages only if they want them mentioned, tone of voice, words to use and avoid, things the emails must never
promise or claim, who the emails come from (name and role), the one action they want a reader to take, the
booking link if they have one, the greeting and sign-off they like, and the spelling (UK or US English).

Per customer type: who they are, the top three pains in order of importance, what they want, the objections
they raise and an honest answer to each, what they actually say on calls (ask for real examples), tone and
angle notes, anything else useful. Pain points: the first one is the default `{{pain_point}}`, but the app can
also pick the best pain point per lead for tailored drafts, so templates do not need `{{pain_point}}`.

Never ask for or write passwords, API keys, bank details or personal data about customers, leads or other named
individuals. If pasted, do not repeat it. The sender's own name and job title are fine.

## Claims and proof (honesty rules)

- Use only claims the owner can stand behind. Numbers must be true when the emails are sent. If a figure is
  just under a round number, say "nearly 200", not "over 200". Update it when it changes.
- Do not turn one example into a plural ("clients") or a single office into several. Use the true wording.
- Do not claim that no competitor has something unless it is checked. Say what they built and what it does.
- Name a client in an email only with the owner's confirmation that the client agrees. Remind them to ask.
- If the owner asks you to exaggerate or invent proof, say briefly that you will not put an unverified claim
  in emails that real people will read, and offer the strongest true version instead. Do not lecture.
- If an unproven stat would help, mark it as unverified in your notes, never in the email itself.

## Rules for the emails you write

- Owner's voice, chosen spelling and language. Usually 45 to 125 words in the body. One idea and one clear
  action per email. Specific beats clever. No invented statistics, testimonials, names, offers or guarantees.
- Keep prices out of emails unless the owner says otherwise.
- Placeholders: use `{{first_name}}`, `{{business_name}}`, `{{contractor_name}}` (the sender) and
  `{{unsubscribe_url}}`. `{{owner_name}}`, `{{package_name}}`, `{{deal_value}}` and `{{pain_point}}` are allowed
  but only use them when they help. Do not use `{{cal_link}}` or `{{audit_date}}`: they can arrive empty.
- Call to action: an inline link in the body, `[Book a time here](https://...)`, plus an easy reply option
  ("or just reply interested"). Sent emails render `**bold**`, `- ` bullets and `[text](https://url)` links.
- Greeting and sign-off follow the owner's choice, for example `Hi {{first_name}}, I hope you're doing great,`
  and `Kind regards,` then `{{contractor_name}}` then the company name.
- Every cold email ends with a line containing `{{unsubscribe_url}}`, for example:
  `If you would rather not hear from us again, click here to unsubscribe: {{unsubscribe_url}}`.
- Subject lines short and specific, no all-caps, no fake "Re:" or "Fwd:". Avoid em dashes.
- Vary the angle across a sequence so each follow-up adds something new, not "bumping this".
- Name every template `<Profile short name> - <Step>`, for example `Cleaning US - A1 Intro`. Names must be unique
  across all files in the batch, because sequences find templates by exact name (case-insensitive).
- Set `category:` on every template to the exact ICP profile name (for example `Commercial Cleaning US`), so
  the templates screen can be filtered by customer type. The step lives in the template name.
- For each pair of markets, keep the same structure and step names so the sequences file is easy to read.

## Validation checklist (run on every file, then across files)

1. Each file starts with `---`, a `type:` line with exactly `company-context`, `icp-profiles`,
   `company-packages`, `email-templates` or `sequences`, and a closing `---`. Only `type`, `icp` and `category`
   are allowed in front matter, and `icp` and `category` only in email-templates files.
2. Under 200 KB. Company context body under 8,000 characters. Company context uses bold lines such as
   `**Who we are**` for headings, never `#`, because the field shows raw text.
3. ICP file: each profile starts with `# Name` (80 characters or fewer, unique). Only these `##` headings:
   `Summary` (required), `Pain points`, `Goals`, `Objections`, `Messaging notes`, `Extra context`. Pain points,
   Goals and Objections are `- ` bullet lists. Each section under 3,000 characters. At most 50 profiles.
4. Template file: each template starts with `# Name`, has a `subject:` line (and `category:` if per template),
   a blank line, then `## Body`. The `icp:` value matches an ICP name. Links are https only. At most 100
   templates per file. No two templates in the whole batch share a name.
5. Every cold email contains `{{unsubscribe_url}}`. Every placeholder is on the allowed list. No `{{cal_link}}`
   or `{{audit_date}}`. No prices unless the owner asked.
6. Packages file: `# Label` per package, 1 to 80 characters, unique ignoring case, at most 20, no repeated header
   text in the bodies. Labels are saved exactly as typed, so write them the way they should appear.
7. Sequences file: each sequence has a unique `# Name` (1 to 80 characters), an optional `icp:` that matches a
   profile name, and exactly one `## Steps` list numbered from 1 with lines
   `1. template: <exact template name> | wait_days: <0 to 60>`. At most 10 steps, 100 sequences. Every template
   name exists exactly in the batch (or the organisation).
8. No HTML, tables, images or secrets. No personal data about customers or leads.

If any check fails, fix it and check again before showing the file. For anything over a few templates,
check mechanically with a short script instead of by eye.

## Delivering the files

- If your tool can create downloadable files, create them with the exact names above. Send them all together.
- If not, print each file in its own code block with its name above it and tell the person to paste each into a
  plain text editor and save as `.md` in UTF-8. Warn them not to use Word.
- Upload steps: in Dreamlabs Sales go to **Settings → Import setup files** and choose all the files together.
  The app applies them in the right order (company context, profiles, packages, templates, sequences) and stops
  on the first failure, reporting what was saved. Review the preview, then apply. Only an organisation admin can
  import.
- First import: choose Add new. Re-importing improved files: choose Replace for company context and templates,
  and delete any old templates that were left behind, or you will get duplicates under the old category.
  Only one packages file may be selected when replacing.
- Sequences arrive switched off. Open the sequence editor and enable each one you want. The import never
  enrols leads or sends email. Test on one lead you control before enabling.
- If a file shows "Unknown file type" or "Unknown or missing type" for sequences or company-packages, the
  browser is running an old copy of the app: hard refresh (Ctrl+Shift+R) and upload again.
- After importing packages, reload the page to see the new list under Settings → Company profile customization.
- Custom placeholders are made by hand under Settings → Custom placeholders. They are not imported, and these
  templates need none.
- Offer to adjust anything. Remind the person that everything can be edited in the app afterwards, and that the
  first real step is a small test with one lead.

---

## Reference A: File format

Five Markdown file types fill in an organisation: company context, ideal customer profiles (ICPs), company packages, email templates and sequences. The app reads them with a strict, deterministic parser. No AI is used on upload. A file that does not match this format is rejected with the line number and the reason.

Rules that apply to all five types:

- Plain UTF-8 Markdown, file extension `.md`, maximum 200 KB.
- The file starts with a front-matter block between two `---` lines. `type:` is required and tells the app which file it is.
- Write in plain text. No HTML, no images, no tables. Bold and lists are not interpreted, they stay as typed.
- Never put passwords, API keys or customer personal data in these files.

### 1. Company context (`type: company-context`)

One file. The whole body (everything after the front matter) is saved as the organisation's company context. The AI reads it when it drafts emails, so write it as facts about the business: what it sells, who to, where, what makes it different, tone of voice, anything it must never claim.

```
---
type: company-context
---
Mr Brush & Co is a commercial cleaning company in the UK. We clean offices, schools and ...
```

Limit: 8,000 characters in the body.

### 2. ICP profiles (`type: icp-profiles`)

One file holding any number of profiles (maximum 50). Each profile starts with a `# ` heading that is the profile name (maximum 80 characters, unique within the file). Under it, use these exact `## ` section headings. Only `## Summary` is required.

```
---
type: icp-profiles
---
# Property managers

## Summary
Who they are in one or two sentences.

## Pain points
- First item is the one used for the {{pain_point}} placeholder
- Second item

## Goals
- What they want

## Objections
- What they push back on, and how to answer it

## Messaging notes
Tone, words to use or avoid, angles that land.

## Extra context
Anything else worth knowing.
```

`Pain points`, `Goals` and `Objections` are lists with one `- ` item per line. The other sections are free text. Each section is limited to 3,000 characters.

### 3. Email templates (`type: email-templates`)

One file may hold templates for several ICPs, or you can use one file per ICP. Maximum 100 templates per file. Each template starts with a `# ` heading that is the template name. Under it, the fields appear as `key: value` lines, then a blank line, then `## Body`.

```
---
type: email-templates
icp: Property managers
category: Cold outreach
---
# Intro email
subject: Quick question about {{business_name}}

## Body
Hi {{first_name}},

Body text here. Blank lines separate paragraphs.

Kind regards,
{{contractor_name}}
```

- `icp:` in the front matter is the default ICP for every template in the file. A single template may override it with its own `icp:` line. The ICP name must match a profile name (case-insensitive) that is in the organisation already or in an ICP file uploaded in the same batch.
- `category:` works the same way: file default, per-template override. Optional.
- `subject:` is required. `## Body` is required.
- Optional `links:` lines after the body: `- [Label](https://example.com)`. Only `https` links.
- Attachments are not imported. Add them in the app afterwards.
- Allowed placeholders: `{{first_name}}`, `{{business_name}}`, `{{owner_name}}`, `{{package_name}}`, `{{deal_value}}`, `{{contractor_name}}`, `{{pain_point}}`, `{{unsubscribe_url}}`, plus any custom placeholder the organisation has already created. An unknown placeholder is flagged in the preview as a warning. `{{cal_link}}` and `{{audit_date}}` exist in the app but can be empty when an email is sent, so files should describe the call to action in words instead and avoid both.
- Every cold email must include `{{unsubscribe_url}}` somewhere in the body.

### 4. Sequences (`type: sequences`)

Each sequence starts with a unique case-insensitive `# Name` (1–80 characters). An optional `icp:` name follows, then exactly one `## Steps` section. Maximum 100 sequences per file and 10 steps per sequence. Steps must be numbered consecutively from 1. Each `wait_days` is an integer from 0 to 60, measured after the preceding step; the first step normally uses 0.

```
---
type: sequences
---
# Property managers follow-up
icp: Property managers

## Steps
1. template: Intro email | wait_days: 0
2. template: Intro email | wait_days: 4
```

Template names match exactly, ignoring case. Selected same-batch templates win over organisation templates; missing or ambiguous names block that selected sequence. The preview lists every template resolution and wait. An ICP must also resolve in the organisation or selected batch. Untick an unresolved sequence or fix its references before applying.

Add new skips existing sequence names. Replace changes only the matching sequence's steps and ICP, preserving its existing active or inactive state; unrelated sequences are untouched. Only newly created sequences are **inactive drafts** and need explicit enabling in the sequence editor after review. Replace does not pause a live sequence. An identical replace compares only steps and ICP and performs no write, regardless of activation state. The import itself does not enrol or send. Steps are saved together in one existing JSON row. Migration 071 is required before this importer/frontend and its updated edge bundles are deployed; the builder does not apply it.

### 5. Company packages (`type: company-packages`)

One `# Package label` per package, maximum 20 packages per file. Labels must be unique ignoring case and have 1–80 characters after trimming/collapsing whitespace. Labels are saved exactly with that whitespace normalisation: prices, currency symbols and wording are not rewritten. Each organisation decides its own pricing policy. Optional body text is shown in the preview but **is not stored**, because the current model only stores labels.

```
---
type: company-packages
---
# Growth £250 / month
Timeline: two weeks.
- Includes an onboarding session.

# Support
Optional ongoing help.
```

Add new appends labels not already present, ignoring case. If the organisation currently uses the built-in defaults (`custom_packages` is NULL), importing creates a custom list from the file only. Replace sets the list to exactly the selected labels. The preview warns about removed labels; existing leads keep their stored package text. Choose only one package file when replacing. Details storage is a separate future feature. `docs/setup-pack/company-packages-import.md` is one organisation's seven-label example, not a pricing policy for other organisations.

Apply order is company context, ICP profiles, company packages, templates, then sequences. Import remains admin-only, local and review-before-save. A second add-new import skips saved matches. Sequence and package replacement also skip identical stored values. Failed work stops and reports saved, skipped and unsaved items; nothing retries silently.

### Guidance for the Claude skill (interview)

The skill should ask the person for everything it needs before writing any file, one topic at a time:

1. The business: what it sells, to whom, where, prices or packages it can mention, what it must never promise, and the tone of voice.
2. Each customer type: who they are, their top three pain points in order of importance, goals, the objections they raise and the honest answers, and words to use or avoid.
3. For each customer type, a short sequence of emails (introduction, follow-up, final nudge), each with a subject and a body in the owner's voice.

Then it writes the requested files: `company-context.md`, `icp-profiles.md`, `company-packages.md`, `email-templates.md` (or one per customer type) and `sequences.md`. It shows each file for approval before upload and checks it against the rules above. Package details remain in the file for the person's review; only its labels are imported. The organisation decides whether labels may contain prices and whether email copy may quote them.

### House conventions (learned from the first real import, 2026-10-29)

- **Company context headings** are bold lines, for example `**Who we are**`, never `#`, because the field shows the text raw.
- **Email body formatting:** sent emails render `**bold**`, `- ` bullets and inline `[text](https://url)` links. Use an inline link for a booking page instead of `{{cal_link}}`.
- **Template category** is the exact ICP profile name, so the templates screen filters by customer type. The step is carried in the template name, for example `Cleaning US - A1 Intro`.
- **Template names must be unique across the batch.** Sequences find templates by exact name, ignoring case.
- **Sequences arrive inactive.** Enable them in the sequence editor. Importing never enrols or sends.
- **Package labels only** are stored. Write each label the way it should appear in the lead's package dropdown.
- **Re-importing:** use Replace for company context and templates; an old template under a different category will not be replaced, so delete it. Choose only one packages file when replacing.
- **Stale browser:** if "Unknown or missing type" appears for `sequences` or `company-packages`, hard refresh (Ctrl+Shift+R) and upload again. The package list shows under Settings, Company profile customization, after a reload.
- **Custom placeholders** are not imported; they are made by hand under Settings, Custom placeholders.

---

## Reference B: Email template and sequence menu

Show this menu once per customer type, in plain words (a list, not a table, because tables do not display
well in every chat window). Let the person tick single templates and/or whole sequences, then ask how many
emails in total they want. A sequence is a set of templates sent in order, so ticking a sequence means
writing each of its emails as a separate template and then listing them in `sequences.md`.

Do not quote success rates or statistics. Nobody can promise them for this person's market.

### Naming (so the sequences file can find every template)

Template name: `<Profile short name> - <Step>`. Example profile `Commercial Cleaning US` uses the prefix
`Cleaning US`, giving `Cleaning US - A1 Intro`. Step names below are stable; keep them identical across
profiles. Set each template's `category:` to the exact profile name.

### Ready-made sequences

A. **Core cold outreach (recommended start)**: A1 Intro (day 0), A2 Follow-up with a new angle (+4 days),
   A3 Break-up (+6 days). For people who have never heard from you.
B. **Extended cold outreach**: Intro, Value follow-up, Proof or short case, Objection handler, Break-up.
   For higher-value or slower sales.
C. **Find the right person**: C1 Gatekeeper ask (day 0), C2 Gentle follow-up (+4). For a general inbox such
   as info@ where you want to be pointed to the decision maker.
D. **Quote or proposal chase**: Check-in after sending, Answer likely questions, Last check before closing the file.
E. **Re-engage cold leads**: "Still relevant?" check, Final offer or new reason to talk.
F. **Meeting follow-up** (singles, sent by hand): F1 Meeting recap and next step, F2 No-show recovery.
G. **Call follow-up: spoke to the owner** (for people who cold call): D1 After call: thanks for your time
   (day 0), D2 After call: new angle (+3), D3 After call: soft close (+5). Reference what was discussed in
   words only, never invent what was said.
H. **Call follow-up: no answer or voicemail**: V1 Voicemail or no answer (day 0), V2 Voicemail follow-up (+4).

### Single templates (manual sends)

1. Intro email (problem first, one question)
2. Follow-up with a new angle
3. Proof email (one short result, client type or example)
4. Objection handler (address an objection from the profile honestly). Offer one per common objection,
   for example O1 Objection: already have software, O2 Objection: happy as we are.
5. Break-up email (polite last message, leaves the door open)
6. Referral reply: P1 Pointed to you (when someone gave you their name)
7. Trigger-based intro (a reason to write now, such as a new site, a hire, an expansion)
8. Meeting recap and next step
9. Quote or proposal check-in
10. Re-engage a quiet lead

### Sequences file

Write one `# Name` per sequence, prefixed with the profile short name (for example
`Cleaning US - Core cold outreach`), with `icp:` set to the profile name and exactly one `## Steps` list:

```
# Cleaning US - Core cold outreach
icp: Commercial Cleaning US

## Steps
1. template: Cleaning US - A1 Intro | wait_days: 0
2. template: Cleaning US - A2 Follow-up | wait_days: 4
3. template: Cleaning US - A3 Break-up | wait_days: 6
```

`wait_days` is measured after the previous step. The app imports them switched off.

### How to write each one

Gather these per customer type and reuse them across emails:

- The single action wanted (reply, book a call, answer one question) and the booking link.
- One proof point they are allowed to use, or "none yet". With no proof, write the email without it.
- The real objection an objection email must answer.
- Any offer, deadline or free item they genuinely stand behind. Never invent one.

Typical intro shape: a question showing you understand their situation, one line on what you did for a
comparable business, two or three bullets of what they get, one low-effort call to action. A follow-up brings a
new fact, tip or angle. A break-up is short, kind and leaves the door open. Call follow-ups open by thanking
them for their time or for picking up, never pretend a conversation happened that did not.

---

## Reference C: Interview guide

A question bank, not a script. Skip questions the person already answered or that pasted material covers.
Ask one topic per message, in your own words, and adapt to how technical or chatty the person is. Use
everyday language: no jargon such as "ICP" without explaining it as "a type of customer you want more of".

### Topic 1: The business (company context)

- In a sentence or two, what does the business do, and for whom? What makes it different?
- Where do you serve (towns, countries, online only)? Which market matters most?
- Proof: how long in business, results you can state, kinds of clients, awards or certifications. Which may
  be mentioned in emails? Which clients may be named, and have they agreed?
- Are there numbers in the proof that change over time (clients, sites, years)? Use wording that stays true.
- Are there people you will not sell to, such as a direct competitor of an existing client?
- Prices or packages: mentioned in emails, or kept for the call? (Default: kept out.)
- Tone (formal, friendly, plain-spoken, expert), words you love or hate, UK or US spelling.
- What must the emails never promise or say?
- Who sends the emails (name and role)? What should the reader do (book a call, reply)? Booking link?
- Greeting and sign-off you like.

Summarise as a short paragraph, then ask "Is that right?".

### Topic 2: Each customer type (ICP profile)

Explain: "A customer type is a group of buyers who share the same problems, such as property managers or
dental practices. Each gets its own profile so the emails fit them."

- Name it in a few words, with the market if you sell in several (this becomes the profile name).
- Who exactly are they? Job titles, size, what their day looks like. Who answers the phone (gatekeepers)?
- Top three problems you can solve, most costly first.
- What do they want to achieve?
- What do they say when they push back ("we have software already", "happy as we are", "too expensive")?
  Ask for what they really say on calls, then agree an honest answer to each.
- Is there existing proof for this type, or should another industry's proof be used? Say which.
- Words that land or switch them off.

If the person is vague ("they want quality"), ask for an example: "What did the last customer of this type say
when they first called you?"

### Topic 3: Packages

- Names of the offers a lead can be tagged with, and how long each takes. Which are pilot or special rates?
- Should prices ever appear in emails? (Default: no.)

### Topic 4: Emails and sequences (per customer type)

Show the menu in the sequence reference. Record what they pick, whether they cold call (offer the call
follow-ups), and the proof and call to action for each. Draft, show, revise. Then build the sequences file.

### Handling unsure or tired people

- "I don't know": offer two or three plausible options and ask them to pick or edit. Label guesses as guesses.
- Short answers: restate as a fuller sentence and ask if that is right. Do not pad with invented facts.
- Wants to stop: write the files with what you have, say honestly which parts are thin.
- Pastes a lot of text: extract, summarise back, ask only the gaps.
- Asks you to exaggerate or invent proof: decline briefly and offer the strongest true wording.
- Mentions something sensitive (passwords, card numbers, customer personal details): do not repeat it or
  include it in any file.
