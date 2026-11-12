# Deep find power and reliability: design

Date: 2026-11-12. Author: Claude (architect). Director: Kevin. Builder: Codex. Reviewer: Claude.
Status: DRAFT, awaiting Kevin's approval. Nothing in this document is built.
Base: `origin/main` at `e8bd48c`. Related: `docs/DEEPFIND-LIVE-TEST-2026-11-12.md`, `docs/PIPELINE-TIGHTEN-REPORT.md`.

## 1. Intent

A solo user selects up to 50 leads, runs Deep find once, leaves it for up to an hour, then drafts and sends to those leads without opening them one by one. Today that is not possible: Deep find results are not trustworthy, so every lead is checked by hand, and the 2026-11-05 send hard-bounced about 10%.

Users are Kevin (DI Dreamlabs, Mr Brush & Co), Suj (Digital Influx Academy) and Valentina (UX Tree). Kieran no longer works with Kevin.

Why it matters: the business target is about 100 outreaches a day with 2 to 3 contact points per lead, so that 5 new leads a month is close to certain, without damaging the sending mailbox.

## 2. Pass marks (Kevin, 2026-11-12)

Measured on a fixed test set of 50 leads, re-run after every stage.

| Measure | Pass mark |
|---|---|
| Hard bounces among sent emails | under 2% |
| Leads with an email proven safe to send | at least 40 |
| Leads where a person in the right role was found | at least 40 |
| Leads with that person's LinkedIn profile | at least 30 |
| Leads with 2 or more contact points | at least 40 |
| Wrong company or website accepted without a warning | 0 |

LinkedIn and phone are looked for on every lead, whether or not the email is proven. A lead with no proven email is not emailed; it is routed to LinkedIn or phone.

Honest caveat: 40 proven emails is a target, not a measured capability. If free methods fall short, Claude reports the real number and what a paid second check would add; Kevin decides.

## 3. Goals, non-goals, anti-goals

Goals
- A verifier that proves or refuses every address before it can be sent.
- People found by the roles each business targets, with LinkedIn profile.
- Deep find works for the US, UK, Ireland, EU and the Gulf.
- Company phone and company social links collected on every lead.
- Runs on Kevin's own tools (VPS checker, VPS scraper, Supabase, Gemini within the free search allowance). Hunter, Apollo and Firecrawl stay optional extras that the system never depends on.

Non-goals (this project)
- Sending or reply tracking on LinkedIn or other social platforms (later project).
- Personal mobile numbers (only paid data sellers have them).
- Matching a person to personal social accounts.
- A paid second-opinion verifier (the disabled seam stays disabled).
- A dedicated sending domain (Kevin, 2026-11-12: future option only).
- Company registries beyond UK Companies House and Ireland CRO.

Anti-goals (a failure even if it works)
- Any guessed or unproven address sent in bulk.
- A new paid dependency, or a new always-on cost.
- A hands-off "send everything" button.
- n8n, or any automation outside Supabase plus the existing VPS worker.

## 4. Evidence (measured 2026-11-12, read-only)

Live data, 51 Deep-found leads (all Mr Brush, UK): 10 ready, 15 almost, 25 needs work. 202 people found; 6 with LinkedIn; 1 with a phone. 236 of 334 contacts come from Companies House (directors, secretaries).

Checker: 79 addresses tested, 5 valid, 2 invalid, 72 "could not confirm". Unconfirmed domains by provider: Microsoft 365 11, Google Workspace 10, Proofpoint or Mimecast 7, other 8. Run logs: "hosted mail could not confirm the canary address; further SMTP checks were skipped" 76 times; "Web search: ran out of time" 47 times; 77 lead runs at low effort.

Bounces: of 10 hard-bounced addresses, 5 were the lead's own imported email (two placeholders: `domain.com`, `fakeemail.com`), 2 typed by hand, 1 Hunter, 1 on a Companies House person, 1 untraced. Only 3 of the 10 had ever been checked.

Direct probes on the VPS (nine, nothing changed):
- Google domain: made-up address rejected (definitive). `hello@` accepted, domain not catch-all, but `mapReacher` (`worker/wrapper/src/verifyEmail.ts`) returns `unverifiable/unknown` because Reacher calls role accounts "risky".
- Microsoft domain A: made-up address rejected (definitive); a second probe seconds later timed out at 30 s.
- Microsoft domain B: catch-all.
- Mimecast, Proofpoint, one other gateway: 30 s timeout.
- `runVerifyGate.ts` line 36: on hosted mail, if the first candidate is not `valid` or `invalid`, all further checks on that domain are skipped. A role address tested first therefore writes off a provable domain.

Microsoft sign-in check (`GetCredentialType`, 14 addresses, 6 domains): both bounced addresses returned "does not exist"; six made-up addresses "does not exist"; three "exists". `info@` and `hello@` at two firms returned "does not exist" although they may be real shared inboxes. Sample is small.

Role search (10 leads, LinkedIn-only web search for office or facilities roles): 5 found a current right-role or neighbouring-role person, 1 found only a former employee, 4 found nobody (small firms, generic names).

Search cost: Google lists 5,000 free grounded search requests a month for Gemini 3 and newer on the paid tier, then $14 per 1,000 (billed per search query Gemini issues). Why Kevin's Gemini credits ran out on 2026-11-12 is NOT known.

VPS IP 2.24.131.162: not on five blocklists checked; reverse DNS is `verify.didreamlabs.com`.

## 5. Constraints

- Budget: Kevin allocates about 5 GBP a month to Gemini and 5 GBP to Claude API. Other orgs use their own keys.
- Run time: up to 60 minutes for 50 leads, in the background.
- Existing invariants stay: worker calls only through `workerClient.ts`; usage reserved before each request; fail closed; no automatic enrolment; RLS on every table; review-before-send; pure rules in import-free modules; components under 150 lines.
- Every merge, push, deploy, migration and role change needs Kevin's explicit yes.
- VPS changes need a fresh Hostinger snapshot first; n8n on the same VPS is untouched.

## 6. Design, in build stages

Each stage is one Codex brief, one branch, reviewed by Claude, then merged and deployed only on Kevin's yes, then scored on the test set.

### Stage 0: test set and measurement

- Claude builds a 50-lead test set in a dedicated pipeline "Deep find test set" in the DI Dreamlabs org: about 20 UK, 10 US, 8 Ireland, 6 EU, 6 Gulf, mixing small firms and corporates. Leads come from the existing Google Places import. They are never enrolled or emailed.
- Claude records ground truth by hand for a subset (right company, right person).
- A scoring script (read-only SQL) prints the six pass-mark numbers for a run.
- The worker records a structured reason for every check (provider class, raw verdict, timeout, catch-all) so "could not confirm" is always explainable.
- Find the cause of the Gemini drain in the Google usage page before any stage adds searches.
- Validate the Microsoft check on at least 40 addresses with known truth.

### Stage 1: verifier v2 (highest priority)

1. Verdict mapping: a role address that the server accepts on a non-catch-all domain is proven to exist. New reason `deliverable_role`.
2. Replace the first-candidate skip rule with a domain probe: test one made-up address first. Rejected means the domain is provable, so check all candidates. Accepted means catch-all, so stop SMTP checks and use other proof. Timeout means retry later.
3. Timeouts are not final: retry with slow pacing per domain inside the run's hour, a bounded number of times.
4. On provable domains, try every address format per person, most likely first, stopping at the first valid one.
5. Microsoft check as a new worker endpoint on the VPS, used when the domain's mail is Microsoft 365. "Exists" is proof for a named person's address. "Does not exist" on a named person's address means do not send. It is never used to judge shared inboxes. Throttled or changed replies fail closed to "unknown".
6. Check every address before any send: imported, hand-typed, Hunter and Apollo addresses included. Placeholder domains are refused outright. Bulk release refuses anything without a current proven verdict; the existing manual single-send override stays.
7. Published addresses: the scraper reads team, contact and legal pages on every lead (not only when pages show nothing). An address published on the confirmed company domain counts as proven.
8. Catch-all domains: proof only from the Microsoft check, published addresses, past replies or deliveries, or the T2 format rule. Otherwise the lead is routed to LinkedIn or phone.

### Stage 2: the right people, with LinkedIn

1. Each customer profile gains an ordered list of target roles and fallback roles (migration). Seed values from Kevin: Mr Brush targets office and facilities managers and coordinators; UX Tree targets founders and heads at startups and corporates; DI Dreamlabs targets owners and decision makers of SMEs and blue-collar firms; the Academy targets education buyers and hiring leads.
2. Role search ladder per lead: target roles, then neighbouring roles (operations, people, executive assistant), then founder or managing director. LinkedIn-only web search with the company name and city.
3. A result is accepted only when the snippet shows the person currently holds the role at that company. Former employees are rejected. Accepted people are saved with title, LinkedIn URL and source `role_search`.
4. Team pages on the company site are read for names and titles.
5. Companies House and CRO officers are used only as the fallback for small firms, and company secretaries are no longer added as contacts.
6. One search interface with two providers: Gemini grounded search (existing) and, as an optional later step, a self-hosted SearXNG service on the VPS. Queries per lead are capped and counted against the 5,000 monthly free allowance, with a visible meter.

### Stage 3: markets

1. Remove the foreign-phone rule in `domainDiscovery.ts` (line 299) and `leadReadiness.ts` (line 67). The check that the site's title and footer name a different business stays.
2. Registry step by country: UK uses Companies House; Ireland uses CRO when the org has a key; every other country skips the registry and relies on website and search. Outside the UK and Ireland a missing registry match never blocks readiness.
3. A saved company number whose registered name does not match the lead is re-checked and flagged.
4. Country is set on every lead (inferred from address, phone code or domain ending when blank; 105 DI Dreamlabs leads have none).
5. Domain guessing and phone parsing use the lead's country.

### Stage 4: contact points

1. Company social links (LinkedIn company page, Instagram, Facebook, X, others the scraper already extracts) saved on the lead.
2. Company phone from website and Google listing saved with its source.
3. The lead shows its contact points and a channel label: Email, LinkedIn, Phone.
4. Reply signatures: phone and LinkedIn link harvested from replies (small, optional).

### Stage 5: run shape and notices

1. A lead may take several minutes across resumable passes; a 50-lead run is capped at 60 minutes. Web search and the checker each get a guaranteed share of time.
2. The default effort runs every free step. Paid tools are opt-in per run.
3. Low-credit notices (Kevin, 2026-11-12): when Gemini, Claude, Hunter, Apollo or Firecrawl is out of credit, the run result and notification bar say so with a link to the right billing page. Keys are never shown.

Stage 5 item 1 is needed by stages 1 and 2, so its minimum (longer per-lead budget, resumable passes) is built inside stage 1.

## 7. Decisions

Kevin's (2026-11-12): the pass marks above; unproven addresses are not emailed; a one-hour cap per run; markets US, UK, Ireland, EU, Gulf; remove the foreign-phone rule entirely; Deep find first, social sending later; Claude designs and reviews, Codex builds; small throwaway tests allowed; Claude may source test leads in the Mr Brush or DI Dreamlabs orgs.

Claude's calls (not yet agreed; Kevin can overrule)
- A shared inbox the server confirms on a non-catch-all domain counts as safe to send, but a named person's address is preferred as the primary recipient.
- "Does not exist" from the Microsoft check blocks a named person's address from sending but does not mark it permanently bad.
- The Microsoft check is an unofficial use of Microsoft's sign-in page. It may change or be throttled at any time, so nothing depends on it alone.
- Registries stay UK and Ireland only. No free national registry exists for the US (records are per state) and Claude knows of no free open registry API for the Gulf; EU registries differ per country and were not researched.
- The daily checker cap (600 per org) is too low for "every format per person" on 50 leads. Proposed: 1,500 per org, 3,000 worker-wide, own VPS, no cost.
- SearXNG on the VPS is built only if Gemini's free allowance proves too small.

## 8. Left to the builder

Internal structure, naming, test layout and UI wording within the existing patterns, provided each brief's acceptance tests pass. The builder does not choose: verdict rules, tier rules, caps, schema, or anything that sends.

## 9. Risks and unknowns

- Security gateways (Proofpoint, Mimecast) may never answer; those domains depend on published addresses and the format rule.
- More checks from one IP may lower the VPS's standing with mail providers; pacing and the cap are the control. Unmeasured.
- Bounce rate can only be measured on real sends. The mailbox guard (pause at 5%) stays as the backstop; the first 200 sends after stage 1 are the real test.
- LinkedIn search results go stale; the "still works there" check reduces but does not remove wrong people.
- Role search at about 50% in the small test means the 40-of-50 mark depends on the fallback ladder; unproven.
- Gemini search billing is per query; a prompt that issues several queries costs more than one.
