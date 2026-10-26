# Setup file format (for the Claude skill and the app importer)

Three Markdown files fill in a new organisation: company context, ideal customer profiles (ICPs) and email templates. The app reads them with a strict, deterministic parser. No AI is used on upload. A file that does not match this format is rejected with the line number and the reason.

Rules that apply to all three files:

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
- Allowed placeholders: `{{first_name}}`, `{{business_name}}`, `{{owner_name}}`, `{{package_name}}`, `{{deal_value}}`, `{{contractor_name}}`, `{{pain_point}}`, `{{cal_link}}`, `{{unsubscribe_url}}`, plus any custom placeholder the organisation has already created. An unknown placeholder is flagged in the preview as a warning.
- Every cold email must include `{{unsubscribe_url}}` somewhere in the body.

## Guidance for the Claude skill (interview)

The skill should ask the person for everything it needs before writing any file, one topic at a time:

1. The business: what it sells, to whom, where, prices or packages it can mention, what it must never promise, and the tone of voice.
2. Each customer type: who they are, their top three pain points in order of importance, goals, the objections they raise and the honest answers, and words to use or avoid.
3. For each customer type, a short sequence of emails (introduction, follow-up, final nudge), each with a subject and a body in the owner's voice.

Then it writes three files named `company-context.md`, `icp-profiles.md` and `email-templates.md` (or one `email-templates-<icp>.md` per customer type), and shows the person each one for approval before they upload. The skill must check each file against the rules above before it hands them over.
