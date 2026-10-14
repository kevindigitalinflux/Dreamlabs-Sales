# Lookup worker, Phase 1: VPS infrastructure and tunnel

Status: PLAN, awaiting Kevin's review (2026-10-14). Nothing here has been built.
Parent doc: `docs/LOOKUP-TOOLS-PLAN.md` (strategy, personal-data stance, per-org quotas).
Scope: stand up the shared worker on the Hostinger VPS and make it reachable at `https://lookup.didreamlabs.com`. NO app or Deep find changes in this phase.

## Progress (updated 2026-10-14, evening)
- DONE Task 1 snapshot `400948` refreshed (created 12:39 UTC, expires 2026-10-15 12:39 UTC).
- DONE Task 2 baseline (n8n 200, 1.1 GB used).
- DONE Task 3 tunnel `lookup-worker` id `2bd40a93-56cc-4034-bb18-4bd40b909162`, proxied CNAME `lookup.didreamlabs.com`, token stored only in `/opt/lookup-worker/.env` (mode 600). Lesson: Windows PowerShell 5.1 strips inner double quotes when calling `ssh`, so pipe secrets to a script on the VPS (`/opt/lookup-worker/set-token.sh`) and never put quoted shell code in the one-liner.
- DONE Task 4 skeleton stack live; auth checks pass (no header 401, wrong header 401, right header 200, no direct port).
- DONE Task 5 TypeScript wrapper: secret check, global rate limit (120/min), SSRF guard (public http/https only, ports 80/443, no credentials, private/link-local/loopback/metadata/IPv6-mapped blocked, DNS pinned at connect time, redirects re-validated, size/time caps), `POST /fetch-page`. Live-tested through the tunnel including names that resolve to 127.0.0.1 (`bad_resolved_address`).
- DONE Task 6 Reacher `reacherhq/backend:v0.11.7` (MIT, confirmed LICENSE.md), internal only, HELO `srv1726663.hstgr.cloud`, `POST /verify-email` with per-domain throttle (5/min) and labels valid / invalid / risky / unverifiable (catch-all is never "valid"). Live-tested: real mailbox valid, made-up mailbox invalid, made-up domain invalid.
- 111 wrapper unit tests pass (`npm test` in `worker/wrapper`).
- DONE Task 7 scraper (Kevin chose, 2026-10-14: "copy and create our own version", stealth tooling accepted for internal use). Vendored `omkarcloud/website-email-contact-scraper` at commit `d6a92b9` (MIT) into `worker/scraper/`, all non-test source read first (no code execution, no telemetry, only calls to the scraped sites). Removed `botasaurus`, `botasaurus-server`, the React frontend and the third-party Docker base image (small `compat.py` shim replaces three helpers; `@task` decorator removed). Image: `python:3.12.8-slim-bookworm` pinned by digest, dependencies hash-locked in `requirements.lock` (30 packages), Google Chrome via patchright, non-root user, `cap_drop ALL`, 2 GB / 1.25 CPU / 512 pids caps. Internal `server.py` (secret header, 2 concurrent crawls, extra callers get 429). Wrapper route `POST /scrape-site {url, mode: homepage|key_pages|deep}`: SSRF guard on the target, 6 scrapes/min, output sanitised (sizes capped, emails re-validated, raw error text never returned). 68 of the vendored unit tests pass; 5 error because upstream's own `test_phones.py` uses a `result` fixture that does not exist (upstream bug, not ours).
- **Browser egress firewall** (`worker/scraper-firewall.sh` + systemd unit `lookup-scraper-firewall.service`, installed on the VPS and enabled): the scraper sits on its own network `scrape-egress` (172.30.50.0/24, bridge `br-scrape`) and every NEW connection from that subnet to private, link-local, loopback and VPS space is dropped, plus new connections to the VPS itself. It talks to the wrapper only over the internal `scrape-link` network. Tested from inside the container: 12 of 12 checks correct (public internet reachable; 10/8, 192.168/16, 169.254.169.254, n8n, wrapper, reacher, VPS gateway and public IP, docker host all unreachable). This, not URL checking, is what stops Chrome following a redirect or DNS trick to an internal address.
- Live results: loveliving.uk (key_pages) returned hello@, max@, david@ loveliving.uk, 3 phones, X/Instagram/TikTok/WhatsApp in 3 s (no browser needed); Chrome path proven in the locked-down container (example.com rendered in 2.9 s); n8n stayed 200 throughout.
- Each container now gets only its own secrets (`environment:` not `env_file:`), so the wrapper no longer sees `TUNNEL_TOKEN`.
- 129 wrapper tests pass.
- TODO Task 8 soak test over time and watch RAM with real Deep find load; Task 9 rollback note is in CLAUDE.md; Task 10 docs (this section and CLAUDE.md).
- NOT TESTED: surviving a VPS reboot or `systemctl restart docker` (it would restart n8n); the firewall unit is enabled and PartOf docker.service, so it should re-apply, but verify at the next planned maintenance window.

## Task 7 findings (omkarcloud/website-email-contact-scraper)
Read on GitHub 2026-10-14: created 2026-08-11, 15 stars, built on the `botasaurus` / `patchright` stealth-browser stack (anti-bot evasion), `requirements.txt` has every dependency UNPINNED, Docker base image is `chetan1111/botasaurus:latest` (an individual's Docker Hub account, unpinned tag), ships its own API server and React frontend. Concerns: supply chain (unpinned latest on a server that also holds n8n credentials), maintenance risk (very young project), and stealth evasion of bot protection is a ToS/legal grey area. Alternative that fits the DI stack: add a `/render-page` route to our own TypeScript wrapper using Playwright from Microsoft's official, version-pinned `mcr.microsoft.com/playwright` image, behind the same SSRF guard, returning rendered HTML to our existing scanner. No stealth, no third-party base image.

## Facts verified 2026-10-14 (read-only)
- VPS: Hostinger KVM 2, id `1726663`, host `srv1726663`, IPv4 `2.24.131.162`, Ubuntu 24.04, 2 vCPU, 8 GB (1.1 GB used), 96 GB disk (5.2 GB used), load ~0, up 133 days.
- Running: Docker 29.5.2 with `n8n-traefik-1` (public 80/443) and `n8n-n8n-1` (127.0.0.1:5678). n8n host `n8n.srv1726663.hstgr.cloud`. `ufw` inactive. Outbound port 25: OPEN.
- Hostinger snapshot `400948` taken 2026-10-14 11:36 UTC, EXPIRES 2026-10-15 11:36 UTC. Creating a new snapshot overwrites it.
- Cloudflare: account `Kevindigitalinflux@gmail.com's Account` (id `b4a058618973e9ada0208b7f16df1695`), zone `didreamlabs.com` (id `0b118a2e6d2127aee1c5c7f03d5e6863`, active). No tunnels yet. DNS already holds records for the apex and `sales`; `lookup` is free.
- Access: SSH as root with Kevin's key; Hostinger API token in `~/.claude/settings.json` (`HOSTINGER_API_TOKEN`); Cloudflare connection authorised for the account.

## Decisions
1. Reach the worker through a **Cloudflare Tunnel** (remote-managed), hostname `lookup.didreamlabs.com`. No new inbound port on the VPS; Traefik and n8n are not touched or reused.
2. One Docker Compose project in `/opt/lookup-worker/`, own network `lookup-net`. Only `cloudflared` talks to the internet (outbound) and only `wrapper` is the tunnel's target. `scraper` and `reacher` publish NO host ports.
3. Wrapper = small **TypeScript** service (Node 22 + Hono, Kevin's choice 2026-10-14 to stay on the DI TypeScript stack). The omkarcloud scraper stays in its own container; Task 7 checks whether it ships an HTTP server. If it is only a Python library, a tiny Python shim inside the scraper container is the one allowed exception (the wrapper itself stays TypeScript). Checks a secret header, enforces the SSRF guard, rate limits, and per-request caps (pages, bytes, seconds).
4. Auth layers: Cloudflare Tunnel + proxy (free WAF/rate limit), then the wrapper secret header. Cloudflare Access service tokens are NOT added now; add them only if an organisation outside Kevin's own is ever given worker access (see "Adding a new organisation" in CLAUDE.md).
5. Secrets: tunnel token and wrapper secret live only in `/opt/lookup-worker/.env` on the VPS (mode 600, root) and, for the wrapper secret, in Supabase (Vault / function secret) as the global fallback for Kevin's own orgs. Never in chat, git, or the project `.env`.
6. Resource limits via compose: total about 3 GB RAM and 1.5 CPU; browser concurrency 2. n8n must stay healthy (checked before and after).
7. Reacher HELO/from domain set to the VPS hostname `srv1726663.hstgr.cloud` (matches its reverse DNS); per-domain rate limit in the wrapper.

## Tasks
1. **Fresh snapshot** (Hostinger `vps_snapshots_create`, id 1726663) immediately before the first change, so it is valid for 24 h. Record the id and expiry here.
2. **Baseline** (read-only): `docker ps`, `free -h`, n8n URL returns 200, record in the progress note.
3. **Create the tunnel** with the Cloudflare API: `POST /accounts/{id}/cfd_tunnel` (config_src `cloudflare`, name `lookup-worker`), set ingress `lookup.didreamlabs.com -> http://wrapper:8080` plus catch-all 404, create proxied CNAME `lookup` -> `<tunnel-id>.cfargotunnel.com` in the zone. Fetch the tunnel token and write it straight into the VPS `.env` over SSH (do not print it).
4. **Skeleton stack:** `docker-compose.yml` with `cloudflared` and a `wrapper` that only serves `GET /health` (needs the secret header) and `GET /` 404. Start it. Verify from the outside: no header -> 401/403; correct header -> 200; direct hit on `2.24.131.162:8080` fails; n8n still 200.
5. **Wrapper hardening and tests** (written test-first, run locally): SSRF guard (public http/https only, resolve + block private/link-local/loopback/metadata ranges incl. IPv6, re-check every redirect, cap redirects, size, time), secret comparison in constant time, rate limit, structured error codes without echoing provider text.
6. **Add Reacher** (HTTP backend) on `lookup-net`, bound internally; wrapper route `POST /verify-email`, per-domain throttle, "unverifiable" for catch-all and Google/Microsoft domains. Check the LICENSE file in the repo before use (open question in the parent plan).
7. **Add the omkarcloud scraper** on `lookup-net`; wrapper route `POST /scrape-site` (domain in, emails/phones/socials out, normalised and validated). Check its LICENSE and README steps; cap browsers at 2.
8. **Limits and health:** apply memory/CPU limits, `restart: unless-stopped`, log rotation; confirm total use and n8n health after a 10 minute soak.
9. **Rollback note:** `docker compose down` in `/opt/lookup-worker`, delete the tunnel and the `lookup` CNAME, optionally restore snapshot. Written into the docs.
10. **Docs:** update `docs/LOOKUP-TOOLS-PLAN.md` and CLAUDE.md with what was actually built, ids, and the runbook.

## Out of scope (later phases)
- Phase 2: app side (`lookup_worker` provider in `orgApiKeys.ts`, `org-api-settings`, Vault storage, quota table + atomic reserve RPC, Settings UI, confirm-dialog allowances).
- Phase 3: Deep find integration (scraper, Firecrawl provider with BYO key, pattern + Reacher), provenance fields, footer company-number match.

## Review points for Kevin
- Python wrapper OK? (alternative: Node/TypeScript.)
- Browser concurrency 2 and ~3 GB total OK for the VPS you also run n8n on?
- Confirm the Cloudflare account has no billing surprise: Tunnels and the free proxy are free; Zero Trust free plan may ask for a card on first use.
