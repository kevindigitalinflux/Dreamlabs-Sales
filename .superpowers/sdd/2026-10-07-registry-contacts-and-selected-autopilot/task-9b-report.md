# Task 9b report: SSRF host guard hardening

RED: current logic copied into `_shared/hostGuard.ts`, 73 tests in `src/lib/hostGuard.test.ts`: 35 failed (IPv6 literals, fc/fd false positives on fcbarcelona.com/fdic.gov, single-label and .local/.internal etc., CGNAT, trailing-dot localhost, URL credentials).
GREEN: after implementation 73/73 pass; `npx tsc --noEmit` clean; --ignoreConfig syntax check clean for websiteContact.ts, hostGuard.ts, leadResearch.ts; full `npx vitest run` 27 files / 345 tests pass.

Functions whose behavior changed (both now in hostGuard.ts, re-exported from websiteContact.ts):
- `isPrivateOrLoopbackHost`: bracketed IPv6 literals handled (::, ::1, IPv4-mapped dotted and hex, fc00::/7, fe80::/10; public like 2001:db8::1 allowed); fc/fd/fe80 prefix tests no longer apply to ordinary hostnames; single-label hosts blocked; suffixes .local .localhost .internal .lan .home .corp .intranet .localdomain blocked; trailing dot stripped; CGNAT 100.64.0.0/10 blocked.
- `parseSafeWebsiteUrl`: additionally rejects URLs with credentials. Scheme check unchanged.
Unchanged: everything else in websiteContact.ts. Decimal/hex/octal IPv4 (2130706433, 0x7f.0.0.1, 0177.0.0.1, 127.1) are normalised by `new URL` and blocked (verified by tests).
leadResearch `withScheme` is private (not exported), so no direct test; it only prefixes `https://` to scheme-less values, so tests cover the resulting `https://intranet`, `https://localhost:8080`, `https://printer.local` (all blocked).
Limitation unchanged: no DNS-rebinding defense.
