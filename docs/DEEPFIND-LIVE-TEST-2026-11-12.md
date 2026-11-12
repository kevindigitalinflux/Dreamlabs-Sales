# Deep find live test, 2026-11-12 (Kevin + Claude)

First live run after the pipeline-tighten rollout (main `79fcc5d`). 10 leads, effort Medium. Result: 5 ready (Accenture, Arup, Build Space UK, Brandnation, Capital Office), 2 almost (Adrem Careers, 21 Forbes Place), 3 needs work (Brainlabs, ASOS, Campden Media). No address was auto-applied on any lead (`auto_applied` empty on all 10); the ready leads were ready because they already had a saved address that counted as T1/T2.

## What the data showed (Brainlabs, lead `fedc02dc-45da-446a-b7c7-0e0803db0a34`)

1. **Gemini out of credits.** 9 of 10 runs logged "Gemini says the plan is out of credits (error 402)". Gemini does the web search, the Companies House AI proof and the people lookups, so the new auto-pick of a Companies House company could not run. Kevin is topping up the Gemini account. Why the credits ran out so fast is NOT known; nobody has measured Gemini usage. Check the Google AI Studio usage page before assuming the new company-proof calls caused it.
2. **Hunter out of credits.** 0 of 50 searches left, renews 2026-11-17.
3. **Website wrongly marked suspect.** `websiteSuspicion` flags a site as "may belong to another company" when its phone numbers are not UK numbers. Brainlabs is a global firm, so `brainlabsdigital.com` (the correct site) was refused, never read, and forced `needs_work`. ASOS and Campden hit the same rule. Fix proposal: foreign phone numbers alone must not make a site suspect when other evidence agrees (company name on the site, the domain matches known contact email domains).
4. **Email checker did not guess; it ran out of time.** On `brainlabs.com` the checker gave definite answers (4 saved addresses "do not exist"), so that mail server rejects fake addresses and guesses can be proven there. But the engine tried only 1 format per person: the per-domain limit is 4 check starts per 60 s, the lead gets about 100 s, 4 candidates were skipped for time and 1 for the domain wait. With no proven address there is no T1, and T2 needs at least 2 proven addresses of different people sharing a format (only 1 existed), so no T2 either.
5. **Wrong Companies House company.** The saved number `15333869` is BRAINLABS AUS HOLDCO LIMITED. Because a number was already saved, the auto-pick never ran. This adds the "company match needs checking" label only; it does not block ready.
6. 21 Forbes Place still showed the old missing key `verified_email` after the run; check which code path wrote it.

## Proposed build (not briefed yet; Kevin to approve)

1. Do not mark a website suspect on foreign phone numbers alone when other evidence agrees.
2. Deep find continuation (second pass): when a lead ran out of time or domain wait with checkable candidates left, queue a follow-up pass that checks every format per person; a proven valid address becomes T1 and feeds the domain pattern for T2.
3. Re-check a saved Companies House number whose registered name does not match the lead name; offer better candidates.
4. **Low-credit notices (Kevin, 2026-11-12):** tell the user in the app when a paid service needs topping up (Gemini, Anthropic/Claude, Hunter, Apollo, Firecrawl) with a clear message and a clickable link to the right billing or usage page. Show it where the run result appears and in the notification bar; detect 402/429 usage-exhausted answers and the Hunter account balance (already read). Never show keys. Org-own keys: show the notice to org admins; global-fallback services: platform owners only.

## Decisions and constraints

- Dedicated sending domain: future option only, not now (Kevin, 2026-11-12). Verification quality must keep bounces low.
- Kevin will bring in the Fable 5.2 model after he sorts the Gemini top-up. Resume from the START HERE block in `CLAUDE.md` / `docs/HANDOFF.md`, then this file.
