# Handoff

## Domain block safety

- Deep find "Not their domain" now asks to confirm in place (Block / Cancel, Escape cancels), then shows "Blocked <domain>." with Undo.
- `unblockDeepFindDomain` (src/lib/deepFind.ts) uses the user session (RLS) with compare-and-set on `blocked_domains`; coded errors UB1-UB4. Undo puts the domain back in `email_domains` only if it was there before the block.
- Lead panel: "Blocked domains" list with Restore (src/components/pipeline/BlockedDomains.tsx).
- Deep find results: amber callout when the lead own website or email domain is blocked (BlockedOwnDomainNotice).
- Engine step line now ends "You can restore it from the lead page." (text only; edge function needs a deploy to show it).
- No SQL or migration changes.
