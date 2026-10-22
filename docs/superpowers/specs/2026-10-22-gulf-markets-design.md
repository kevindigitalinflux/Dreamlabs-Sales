# Saudi Arabia and UAE: discovery and business data — Design

Date: 2026-10-22. Author: Claude (architect). Status: DRAFT for Kevin's approval. Not built.

## Request and decisions (kickoff, 2026-10-22)
- Kevin wants the platform to start supporting Saudi Arabia and the UAE as target markets.
- This first spec covers **discovery and business data only**: finding businesses, identifying decision makers, Arabic and English names, phone formats and a region selector. **Outreach** (Arabic or bilingual templates, Sunday to Thursday send timing, compliance wording) is a later spec.

## What exists today (verified in code)
- Countries: `leads.country` allows `GB | IE | US | OTHER` (migration 064). `scrape-google-places` accepts `country: 'GB' | 'IE' | 'US' | 'other'`. `sourceAvailability` (`src/lib/scrapeMerge.ts`) allows Companies House for GB only and CRO for IE only.
- Registers wired: Companies House (UK) and CRO (Ireland, response shape unverified until Valentina's key). No Gulf register exists in the code. Saudi is not mentioned anywhere in the repo; `docs/LOOKUP-TOOLS-PLAN.md:58` lists "UAE/Dubai later".
- Deep find skips Companies House for foreign countries and applies country phone rules (Irish and US rules exist). The email checker and worker work anywhere.
- Hunter, Apollo, Firecrawl and Google Places are global APIs; their Gulf coverage must be tested, not assumed.

## Design
1. **Countries.** Add `AE` and `SA` to the country set: additive migration widening `leads_country_check`; extend the TypeScript unions and the scraper, Deep find and CSV country pickers. `OTHER` stays. Labels: "United Arab Emirates", "Saudi Arabia". Timezone hints (Asia/Dubai, Asia/Riyadh) are stored for the later outreach spec only.
2. **Discovery source: Google Places.** Works in both countries. Add region bias (`region=ae` / `sa`), result language (`en`, with an optional second `ar` pass behind a toggle to control cost) and city lists (Dubai, Abu Dhabi, Sharjah; Riyadh, Jeddah, Dammam). Reuse the existing budget and dedupe. Names in Arabic script are stored as given, plus an English name when Places supplies one.
3. **Business register data: research first, then decide.** No free, reliable, commercial-use register API is confirmed. The plan phase must research and judge each candidate on licence, access, cost and whether it lists officers: UAE (Economic Department trade licence lookups per emirate, DMCC and free-zone registries, the national economic register) and Saudi (Ministry of Commerce Commercial Registration "Wathq" API, MISA licences). The lookup-tools rule applies: free first; no paid or non-commercial-licensed source without Kevin's yes. **Fallback if none qualifies:** "web proof" only (the company website, a licence number printed in its footer or on a licence page, read by the existing scrape and Gemini grounded search). Deep find then reports the registry step as "not available for this country" in a plain line. The feature stays useful without a register.
4. **Decision makers.** Same engine: website team pages, worker scrape, Hunter and Apollo on the org's own keys (coverage in KSA and UAE tested during the build), Gemini grounded search for named owners. Arabic names: matching and email-format guessing must handle transliteration variants (Mohammed, Mohamed, Muhammad; "Al-" versus "Al"; "bin" and "ibn"). Extend `nameVariants.ts` with a Gulf-aware table and tests. Email guessing stays evidence-driven, as now.
5. **Phones.** Depends on the phone spec: E.164 parsing and classification for `+971` (mobile 05x; landline area codes 02, 03, 04, 06, 07, 09) and `+966` (mobile 05x; landline 011 Riyadh, 012 Jeddah, 013 Eastern). Arabic-Indic digits are normalized to ASCII before parsing. Existing Irish and US rules stay.
6. **Addresses and postcodes.** The UAE has no postcode system (emirate, area, P.O. box); Saudi has 5-digit postal codes plus the National Address short code. The evidence matcher in `registrySearch` and Deep find must not demand a postcode for these countries. Add country-aware address matching (city, area, P.O. box) with tests.
7. **Region selector UI.** Scraper wizard, Deep find lead card (already has a country select) and CSV import offer AE and SA. Source-availability messages become country-aware ("No register source for this country yet"). Arabic text must render correctly: `dir="auto"` on name fields; no layout flip of the app.
8. **Data and legal notes.** UAE and Saudi personal data laws (PDPL) apply: collect business contact details with source and date, honour opt-outs, no scraping of personal social profiles. Cold-email compliance for the Gulf is deferred to the outreach spec, but the plan must record the rule before any send.

## Out of scope (this spec)
Arabic or bilingual email and LinkedIn templates, send timing, Hijri and weekend scheduling, translating notes, an Arabic UI, other Gulf countries, paid registers, automatic outreach to Gulf leads.

## Open questions for Kevin
1. Which ICP and sectors first in the Gulf, and which cities? (Drives the Places queries and the first live test.)
2. Is a "web proof only" first release acceptable if no free register qualifies, or do you want to wait until a register source is chosen?
3. Do you or your team know of a UAE or Saudi business-data source you can already access?
4. Which org is the first user (DI Dreamlabs, Digital Influx Academy, other)? Keys are per org.

## Tests and delivery
Pure tests for country unions, the name-variant table, address matching without postcodes, and phone parsing (shared with the phone spec); scraper tests for region and language parameters; a live smoke test with Kevin's Places key on one Dubai and one Riyadh query before wider use. Branch `codex/gulf-markets`; Claude reviews; the country-check migration is applied by Kevin; scraper and `run-deep-find` are deployed only with Kevin's yes. Build order: phone module first (shared), then countries and Places, then the register research outcome.
