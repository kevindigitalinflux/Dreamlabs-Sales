# Phone numbers for leads and decision makers — Design

Date: 2026-10-22. Author: Claude (architect). Status: DRAFT, build order 2 of 3. Kevin answered 2026-10-22: Suj request = leads but mostly decision makers; switchboard numbers are fine. WhatsApp sending is a separate spec (not yet written). Not built.

## Request and decisions
- Source: Kevin relayed a request from Suj (Digital Influx Academy): the platform should be able to get phone numbers for leads and for decision makers. I found no written record of Suj's exact wording, so **Kevin should confirm the wording or paste it** before this spec is approved (see Open questions).
- Kevin's kickoff decision (2026-10-22): free sources first. Paid providers only through each organisation's own key (click to reveal), and only with Kevin's spending approval and cap. No paid fallback on Kevin's account.

## What exists today (verified in code, 2026-10-22)
- Columns: `leads.phone` plus `leads.additional_phones TEXT[]` (migration 038); `lead_contacts` / `decision_maker_candidates` have `phone`, `phone_status` (`not_requested | pending | revealed | not_found | failed`, migrations 030 and 050) with a guard trigger so clients cannot rewrite provider-set columns.
- Free phone sources already wired: Google Places details `formatted_phone_number` (`scrape-google-places`); own-site scrape (`websiteContact.ts`, tel: and text); the lookup worker browser scrape (`/scrape-site` returns phones with source pages); Deep find shows scraped phones in step lines and, since Phase 3, proposes company phones with strict plausibility checks.
- Paid path already present: Apollo phone reveal through `reveal-decision-maker` and `apollo-phone-webhook` (async). Apollo's free plan refuses the people/match call, so this only works with a paid plan on the org's own key (`TODO.md` V5).
- Gaps: decision makers rarely get a phone; a company switchboard number is not marked as the company line; no phone type (mobile or landline) or country format; no record of where a phone came from or when; Deep find does not offer phones on decision makers at all.

## Design
1. **Be honest about what free sources can give.** Free sources give company numbers (switchboard, reception, office), not personal direct dials. Direct dials for a named person come only from (a) a number published beside that person's name on the company's own team or contact page, or (b) a paid provider reveal. The product must label which it is, never present a switchboard as a direct line.
2. **Phone model.** Every phone carries: `value` (stored E.164 where parseable, original text kept), `kind` (`company_line | direct | mobile | unknown`), `source` (`places | own_site | worker_scrape | registry | apollo | manual | other`), `source_url` when known, `found_at`. Stored on contacts as new columns (`phone_kind`, `phone_source`, `phone_source_url`, `phone_found_at`); for leads in a small side table or JSON on `leads` (decide in the plan; additive migration, Kevin applies). Existing phones are kept as `unknown` / `manual`.
3. **Decision-maker phones, free path.** Deep find, after naming a person and confirming the domain, looks in already-fetched pages (own site and worker scrape results, no extra fetch) for a phone within the same block as the person's name; if found it becomes a suggestion `direct` or `unknown` with its source URL. Otherwise it offers the lead's company line as "Company line (switchboard)" on the person, clearly labelled, only as an Add / Dismiss suggestion. Review-before-apply rules are unchanged: leads keep blank-only auto-fill with Undo under the existing Phase 3 plausibility rules; contacts get suggestions only.
4. **Decision-maker phones, paid path (click to reveal).** Keep the existing Apollo reveal. Make the button state explicit: "Reveal phone (uses your Apollo credits)", showing the org's allowance, only when the org has its own key; disabled with an explanation otherwise. Other providers (Lusha, ZoomInfo, Cognism) are out of scope for this spec; the provider field leaves room. No automatic reveals, ever; reveals are per person and confirmed.
5. **Normalization and validation.** One shared pure module `_shared/phoneNumbers.ts`: parse to E.164 with the lead's country as default, classify mobile versus landline where the numbering plan allows (UK 07, UAE 05x, Saudi 05x), reject obvious junk (repeated digits, dates, postcodes). Supports GB, IE and US now, AE and SA via the Gulf spec. If a library is needed, propose `libphonenumber-js` in the plan and get Kevin's yes first. Replaces the scattered plausibility checks without loosening them.
6. **UI.** Lead card and contacts show phone chips with a small kind label and source tooltip, and a `tel:` link; the Power Dialer uses E.164. Pipeline list filters: "has phone" and "has direct line". No change to review-before-send for email.
7. **Limits and compliance.** No scraping of personal-data aggregator sites or social networks for phones. Business numbers only; sole-trader numbers flagged (existing stance in `LOOKUP-TOOLS-PLAN.md`). UK TPS/CTPS screening is a note for the plan: warn before cold calling. No automated calling in this spec.

## Out of scope
Automated dialing, AI voice agent, phone verification by calling or SMS, buying data lists, any new paid provider, bulk enrichment outside Deep find.

## Open questions for Kevin
1. Suj's exact request: leads only, decision makers only, or both? Is a switchboard number acceptable for a decision maker, or must it be a direct dial?
2. Is it acceptable that direct dials mostly need a paid Apollo plan on the org's own key, or should we evaluate another provider first?
3. Should Digital Influx Academy be the first org to get this, or all four at once?

## Tests and delivery
Pure tests for `phoneNumbers.ts` (formats for GB/IE/US/AE/SA, junk rejection, kind classification); engine tests for the three suggestion cases (direct beside name, company line fallback, nothing found); RLS audit for the new columns; UI checks at phone width. Branch `codex/phone-numbers`; Claude reviews; migration applied by Kevin; `run-deep-find` and any reveal function deployed only with Kevin's yes.
