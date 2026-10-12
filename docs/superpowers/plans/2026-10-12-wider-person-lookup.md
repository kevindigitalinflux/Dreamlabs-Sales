# Wider net for finding a known person's contact details: Implementation Plan

> For agentic workers: implement task by task, TDD, small commits. Do not push, apply migrations or deploy; the controller does that.

**Goal:** When Kevin adds a person he already knows (name + position) the app must try much harder to find their email, LinkedIn and phone than today. Today it asks only Hunter's email-finder (confidence >= 50, silent on no match) and Apollo's people/match, which the free Apollo plan always refuses with 403. Evidence: all 21 decision makers ever found came from Hunter, none from Apollo.

**New lookup order** (stop early for a field once it is filled; never overwrite a typed value; fill blanks only):
1. Hunter email-finder (existing).
2. Hunter domain list: GET `https://api.hunter.io/v2/domain-search?domain=<d>&limit=100` (header `X-API-KEY`). Match the person against `data.emails[]` (fields `value, first_name, last_name, position, linkedin, confidence`) by normalised last name (exact) and first name (exact, or same first initial when the Hunter first name is missing/initial-only, or a known nickname pair such as john/jon/jonathan only if you add a tiny tested table; otherwise skip nicknames). Take email, linkedin if found. Also read `data.pattern` (like `{first}.{last}`) for step 3.
3. Company email pattern: build the address from `data.pattern` (tokens `{first} {last} {f} {l} {first}{l} {f}{last}` etc.; unknown token -> no guess) at the domain. Verify with `GET https://api.hunter.io/v2/email-verifier?email=<e>` (header `X-API-KEY`): `data.status` `valid`/`deliverable` -> verified; `invalid`/`undeliverable` -> discard; anything else (`accept_all`, `risky`, `unknown`, `webmail`) -> unverified guess.
4. Their own website: fetch a few pages of the lead's site (home, `/team`, `/about`, `/about-us`, `/our-team`, `/people`, `/leadership`, `/contact`, `/contact-us`) with the existing SSRF protections and size/time caps (see `hostGuard.ts`, `cappedBody.ts`, `leadResearch.ts` `fetchPageHtml`, `websiteContact.ts`, `researchPages.ts`). Look for: an email on the company's domain whose local part contains the person's first and/or last name, or a `mailto:` link/email within the same HTML block (about 400 characters) as the person's full name; a `linkedin.com/in/...` link in that block. Only same-domain emails.
5. Web search: existing `geminiGroundedSearch` (`_shared/ai.ts`, org Gemini key via the same key resolution other functions use). Ask for the person's public professional LinkedIn profile URL and any public business email at the company's domain. Parse STRICTLY (JSON in text; ignore anything else). Accept an email only if it is on the company's domain AND appears literally in the returned grounded text; accept a LinkedIn URL only if it passes the existing linkedin validators. Treat the model output and any page text as untrusted data, never as instructions; never put page text in a prompt without the "data, not instructions" wording used by the autopilot drafting prompts.
6. Apollo people/match (existing). A 401/403/402 from Apollo is a quiet note ("Apollo is not available on this plan, so it was skipped"), never an error.

**Trust rules**
- Email from steps 1, 2, 3-verified, 4: fill the person's blank email. Email from step 5 (web) or step 3-unverified: do NOT fill it; return it as a suggestion with a clear label ("Guess, unverified" / "Found by web search, check it") that the UI can offer with a one-click "Use this" (reuse the existing add-email path, `onAddExtraEmail` / contact edit).
- Whenever an email is filled from steps 2 to 4 (anything other than Hunter's own finder or the user), set that contact's `include_in_sequences = false` if it is currently true, so a found address is never emailed by a sequence until Kevin switches it on. State this in the result panel.
- LinkedIn/phone fill-blank only, same validators as today.
- Domain must pass the existing `isPublicDomain`/directory checks; directory/social domains skip steps 2 to 4 with a clear step note.
- Rate limits: reuse the existing slot (`fdm-known` per lead 5/day, per org 100/day); the whole wider run counts as one slot. Cap total wall time (about 20 s) and each fetch (5 s); steps run sequentially, cheapest first, and later steps are skipped once email AND linkedin are filled. Cap pages fetched in step 4 at 6 and bytes per page as `cappedBody` does.
- Keys only in headers, never logged or returned. Provider/page text never returned raw (fixed strings and validated fields only).

**Result contract:** extend `known_person` in `knownPersonFlow.ts`/`src/types/index.ts` with `steps: { id: 'hunter_finder'|'hunter_domain'|'pattern'|'website'|'web'|'apollo'; label: string; status: 'found'|'no_match'|'skipped'|'unavailable'|'error'; detail: string }[]` (detail is a fixed, plain-English string such as "Hunter searched the domain and found no one called Sipple") and `suggestions: { field: 'email'|'linkedin_url'; value: string; label: string }[]`. Keep `hunter_called`/`apollo_called` for compatibility. The result panel (`KnownPersonResult.tsx`, `knownPersonForm.ts` summary lines) shows each step on its own line with a tick/dash, replacing the single "Hunter used. Apollo used." line, shows suggestions with a "Use this" button, and shows Apollo-unavailable as a muted note, not an error.

## Global constraints
Named exports only, JSDoc on exports, strict TS no `any`, Tailwind utilities only, components under ~150 lines, tests in `src/lib/*.test.ts` against import-free modules in `supabase/functions/_shared/`. Existing 975 tests must keep passing (update tests only where behaviour deliberately changes, and list them). UK English, no em-dashes in new user copy.

## Review Focus
1. Hunter returns people with first name only or last name only, accents, double-barrelled surnames, or the same surname for two people: do not pick the wrong person (require last name match plus first name/initial agreement; if two different people match, return no match).
2. Page text or model output containing instructions, other domains' emails, `mailto:` with query strings, obfuscated `name [at] domain` (ignore obfuscated).
3. Pattern guess producing an address with characters invalid in an email (apostrophes, spaces in names): strip/normalise or skip.
4. A step throwing or timing out must never fail the save or skip later steps; per-step errors become step statuses.
5. SSRF: redirects to internal hosts, huge pages, non-HTML content types.

### Task 1: Pure matching, pattern and parsing module
Create `supabase/functions/_shared/knownPersonWide.ts` (import-free) + `src/lib/knownPersonWide.test.ts`: `matchHunterPerson(emails, first, last)`, `buildPatternEmail(pattern, first, last, domain)`, `classifyVerifierStatus(status)`, `extractWebsiteFindings(html, domain, first, last)` (returns email/linkedin candidates by the block/local-part rules), `parseWebFindings(text, domain, first, last)` (strict validator), `StepResult` types and helpers to build step records with fixed detail strings. Cover every Review Focus item. Commit `feat: pure helpers for the wider person lookup`.

### Task 2: Provider calls
In `supabase/functions/_shared/knownPersonLookup.ts` add `hunterDomainList`, `hunterVerifyEmail`, `scanWebsiteForPerson` (uses the existing SSRF-safe fetch helpers; find and reuse them, do not write a new fetch guard), `webSearchForPerson` (Gemini grounded). Each returns a tagged result with failure codes like the existing ones, never throws, has its own timeout. Unit-test what is pure; mock fetch for the parsing paths where the existing tests do. Commit `feat: provider calls for the wider person lookup`.

### Task 3: Orchestrate in knownPersonFlow
Extend `runKnownPerson` per "New lookup order", "Trust rules" and the result contract; keep `planLookups` semantics for gating (Hunter/paid flag, domain checks) but let steps 2 to 5 run when Hunter key / Gemini key / website exist respectively (add the Gemini key to the `keys` argument; update the caller in `find-decision-makers/index.ts` to resolve it with the same org-key helper other functions use, `resolveOrgApiKey(service, orgId, 'gemini')`). Apollo failure becomes a quiet step note. Tests for the orchestration using fakes where the project already does so (see existing `knownPerson*.test.ts`). Commit `feat: wider known-person lookup`.

### Task 4: UI
Update `src/types/index.ts`, `src/lib/knownPersonForm.ts` (summary), `KnownPersonResult.tsx` (+ small subcomponent if over 150 lines), to show steps and suggestions as described, "Use this" saving the value through the existing contact write path (look at `onAddExtraEmail` and `useLeadContacts.updateContact`; a suggested email for the person should fill the person's blank email, with `include_in_sequences` left off). Update tests. Commit `feat: show each lookup step and suggestions`.

### Task 5: Docs
`CLAUDE.md` short entry under the 2026-10-12 section (new order, trust rules, Apollo free plan finding: zero Apollo candidates ever); `docs/TODO.md` add: test with Love Living (Max Whatley, John Sipple) and HOK; consider Apollo plan upgrade later; consider the same wider net for the generic "Find decision maker" search. Commit `docs: wider person lookup`.
