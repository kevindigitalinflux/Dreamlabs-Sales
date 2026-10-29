# Setup file format (for the Claude skill and the app importer)

Five Markdown file types fill in an organisation: company context, ideal customer profiles (ICPs), company packages, email templates and sequences. The app reads them with a strict, deterministic parser. No AI is used on upload. A file that does not match this format is rejected with the line number and the reason.

Rules that apply to all five types:

- Plain UTF-8 Markdown, file extension `.md`, maximum 200 KB.
- The file starts with a front-matter block between two `---` lines. `type:` is required and tells the app which file it is.
- Write in plain text. No HTML, no images, no tables. Bold and lists are not interpreted, they stay as typed.
- Never put passwords, API keys or customer personal data in these files.

## 1. Company context (`type: company-context`)

One file. The whole body (everything after the front matter) is saved as the organisation's company context. The AI reads it when it drafts emails, so write it as facts about the business: what it sells, who to, where, what makes it different, tone of voice, anything it must never claim.

```
---
type: company-context
---
Mr Brush & Co is a commercial cleaning company in the UK. We clean offices, schools and ...
```

Limit: 8,000 characters in the body.

## 2. ICP profiles (`type: icp-profiles`)

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

## 3. Email templates (`type: email-templates`)

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

## 4. Sequences (`type: sequences`)

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

Add new skips existing sequence names. Replace changes only the matching sequence's steps and ICP; unrelated sequences are untouched. Every imported/replaced sequence is an **inactive draft**. Nothing is enrolled or sent. After reviewing it, explicitly enable it in the sequence editor before using it. Steps are saved together in one existing JSON row. Migration 071 is required before this importer/frontend and its updated edge bundles are deployed; the builder does not apply it.

## 5. Company packages (`type: company-packages`)

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

## Guidance for the Claude skill (interview)

The skill should ask the person for everything it needs before writing any file, one topic at a time:

1. The business: what it sells, to whom, where, prices or packages it can mention, what it must never promise, and the tone of voice.
2. Each customer type: who they are, their top three pain points in order of importance, goals, the objections they raise and the honest answers, and words to use or avoid.
3. For each customer type, a short sequence of emails (introduction, follow-up, final nudge), each with a subject and a body in the owner's voice.

Then it writes the requested files: `company-context.md`, `icp-profiles.md`, `company-packages.md`, `email-templates.md` (or one per customer type) and `sequences.md`. It shows each file for approval before upload and checks it against the rules above. Package details remain in the file for the person's review; only its labels are imported. The organisation decides whether labels may contain prices and whether email copy may quote them.
