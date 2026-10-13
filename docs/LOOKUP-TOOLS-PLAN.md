# Lookup tools plan (agreed 2026-10-14, NOT built yet)

Why: Hunter's free plan (50 credits a month) runs out within days and a single provider made Deep find weak (Love Living test, 2026-10-12/13). Goal: replace what Hunter does with free and self-hosted tools so Deep find can find people and their emails for 25 to 200 leads a day for about £0 to £10 a month.

## Tools we will add (alongside what already exists)

| Job | Tool | Where it runs | Cost | Status |
|---|---|---|---|---|
| Find emails, phones, socials on a company's site (JavaScript and bot-protected sites too) | omkarcloud `website-email-contact-scraper` (MIT, Python, escalates to real Chrome) | Hostinger KVM 2 VPS, in Docker, behind a small wrapper API | £0 | vetted by Kevin (Codex review) + README read 2026-10-14 |
| Read a page's text for people, roles and bios, and map a site | Firecrawl (hosted) | Firecrawl cloud, ~1,000 credits a month (1 credit per page) | £0 on the free allowance | tested on loveliving.uk 2026-10-14: found Max Whatley, David Sipple, hello@, address, company number 14030207 in 1 credit |
| Light page scanning, team pages, footer company number | Our own website scanner | Supabase edge functions (already built) | £0 | exists; keep as the first, cheapest step |
| Generate likely addresses (pattern guesser) and verify them (SMTP) | `reacherhq/check-if-email-exists` (README says MIT; HTTP backend in Docker) | Hostinger VPS, Docker, beside the scraper | £0 (proxies only if volume grows) | to be tested: outbound port 25 must be open |
| Existing | Hunter (credits), Companies House, DNS checks, Gemini web search | as now | as now | live |

Not adopting: `madeinoz67/madeinoz-osint-skill` (no licence found, data-retention and prompt-injection concerns). Revisit only if its licence is confirmed.

## Order of operations for one lead (cheapest first, stop when enough is found)
1. Companies House (company, officers) + known people on the lead.
2. Domain discovery (variants, DNS mail check, footer company number match).
3. Our own site scanner on every confirmed domain (free).
4. omkarcloud scraper through the worker when the site needs a browser or the scanner found little.
5. Firecrawl on the team/about page when roles and bios are still missing (cap per lead).
6. Email format inferred from known addresses, then candidate addresses for each person built from the pattern.
7. Verify candidates with Reacher (free); Hunter verifier only if credits remain.
8. Web search (Gemini) to narrow and corroborate.
Everything found is shown with its source and a confidence label; nothing is added to sequences until switched on.

## Worker design (VPS)
- One Docker Compose stack with its own network: `scraper` (omkarcloud), `reacher` (HTTP backend), and a thin `wrapper` API.
- The wrapper is the ONLY thing reachable from outside, over HTTPS with a secret header, rate-limited. The scraper's ports 3000 and 8000 and Reacher's 8080 bind to localhost / the internal network only.
- SSRF guard in the wrapper: accept only public http(s) hosts, resolve and block private / link-local / loopback addresses, re-check every redirect, cap pages, size and time.
- No route to n8n or its credentials; no secrets in the containers except the wrapper secret; memory/CPU limits (about 2 to 3 GB and 1.5 CPU in total), concurrency 2 to 3 browsers.
- Supabase edge function (Deep find engine) calls the wrapper; results are validated again server side; the worker never writes to our database.
- Reacher politeness: per-domain rate limit, set a proper HELO/from domain, never verify the same domain in bursts (avoids getting the VPS IP blocklisted). Catch-all domains and Google Workspace / Microsoft 365 often cannot be verified reliably: label those results "unverifiable", not "valid".

## Personal data stance (Kevin's decision 2026-10-14)
We WILL collect named people's business contact details where findable (not just role inboxes). To stay on the right side of UK GDPR / PECR:
- Record the source and date for every address (provenance), shown on the contact.
- Business-context data only (work email, work phone, role, LinkedIn URL); no special-category data, no private social posts.
- Sole traders and partnerships are individual subscribers under PECR: mark them (flag) and apply the stricter rules for marketing email.
- Honour opt-outs everywhere (existing unsubscribe link and `opted_out`), and keep a way to delete a person on request.
- Found-by-guess addresses are labelled unverified and never auto-added to sequences.
(This is a note, not legal advice.)

## Before building: checks for Kevin
1. On the VPS run `nc -vz smtp.gmail.com 25` (or `timeout 5 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' && echo open`). If it hangs, Hostinger is blocking outbound port 25: ask Hostinger support to unblock it, or plan an SMTP proxy / a second small server for Reacher.
2. Confirm which Hostinger plan the n8n VPS is: KVM 2 (2 vCPU, 8 GB), CPU 1%, memory 13%, disk 5%.
3. Decide the domain for the wrapper (for example `worker.<your-domain>`) and let Cloudflare proxy it.

## Open questions
- Reacher licence: README says MIT; confirm the LICENSE file in the repo before use.
- Whether to add the footer company-number auto-pick (Companies House) first: small and free, no new tools.
- Firecrawl monthly credit cap per organisation.
