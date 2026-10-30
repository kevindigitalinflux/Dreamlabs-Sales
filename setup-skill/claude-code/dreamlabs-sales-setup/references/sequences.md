# Email template and sequence menu

Show this menu once per customer type, in plain words (a list, not a table, because tables do not display
well in every chat window). Let the person tick single templates and/or whole sequences, then ask how many
emails in total they want. A sequence is a set of templates sent in order, so ticking a sequence means
writing each of its emails as a separate template and then listing them in `sequences.md`.

Do not quote success rates or statistics. Nobody can promise them for this person's market.

## Naming (so the sequences file can find every template)

Template name: `<Profile short name> - <Step>`. Example profile `Commercial Cleaning US` uses the prefix
`Cleaning US`, giving `Cleaning US - A1 Intro`. Step names below are stable; keep them identical across
profiles. Set each template's `category:` to the exact profile name.

## Ready-made sequences

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

## Single templates (manual sends)

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

## Sequences file

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

## How to write each one

Gather these per customer type and reuse them across emails:

- The single action wanted (reply, book a call, answer one question) and the booking link.
- One proof point they are allowed to use, or "none yet". With no proof, write the email without it.
- The real objection an objection email must answer.
- Any offer, deadline or free item they genuinely stand behind. Never invent one.

Typical intro shape: a question showing you understand their situation, one line on what you did for a
comparable business, two or three bullets of what they get, one low-effort call to action. A follow-up brings a
new fact, tip or angle. A break-up is short, kind and leaves the door open. Call follow-ups open by thanking
them for their time or for picking up, never pretend a conversation happened that did not.
