# Debt annotations extracted from CLAUDE.md — verify against docs/debt.md, then delete this file

CLAUDE.md's debt section was pruned to an index on 2026-07-12. Most detail
already lives in docs/debt.md ("full entries in docs/debt.md"), and ALL removed
text is preserved in git history of CLAUDE.md. But a handful of CLAUDE.md
annotations carried dates **later** than the last known debt-file sync — check
each is present in docs/debt.md; if not, merge the entry below, then delete
this file.

---

## #149 — double SAND/SILT units after Accept-litho (Tier G, open)

Code re-verified 2026-06-22 — narrowed to ONE owner policy call: the
find-or-create key is the deterministic 2-tuple `(litho_main_soil_code, sig)`
where `sig` includes the admixture `amount` qualifier (`KL:Z` vs `KL:M`) but
excludes `locally`, so two SANDs differing only in admixture amount become two
units BY DESIGN. The find-or-create already DEBUG-logs
`Created/Found … sig='{sig}'`, so the next dogfeed just enables DEBUG + reads
the two `sig=` values — no instrumentation to add, no blind code change.
Question for the owner: should `amount` join `locally` outside the bucket?
(History: v1 merge-on-accept reverted, v2 no-merge shipped, v3 straddle-retired
reverted; A2 2026-06-04 removed straddle-split entirely, so any residual
doubling is the admixture-sig-drift hypothesis.)

## #134-C-bulk — litho↔geo bulk snap (SHELVED 2026-06-22)

Owner directive: build nothing, delete nothing. Scoping the bulk-snap UX
surfaced the deeper question "should litho↔geo reconcile at edit-time at all,
or stay independent + reconcile at build/geotech?"; system-architect pass
concluded the build-time `divide_picks_by_geology` already covers ~90 % of the
need without a 2D FK, and edit-time drag-propagation is a silent-side-effect
risk. Leading direction = a corridor-scale "Reconcile with geology" review in
the geotech inspector. Revisit placement at geotech-inspector design; if
placement lands on "defer", this is moot and #162/#157 re-scope. See
[[project_litho_geo_reconciliation_placement]].

## #99 + #138 — CLOSED-STALE 2026-06-23

Litho drag-clamp-through-rejected-layers (#99) and drag-lock-after-merge
(#138): never reproduced across the post-May litho rework. Re-open if seen in
a live project.

## #3 / #5 — re-scope license keys → subscription activation (2026-06-25)

Commercial model pivoted to annual subscription (CLAUDE.local.md → Commercial
planning). When #3/#5 are picked up, re-scope from "license keys" to
"subscription activation"; also update `docs/commercial-direction.md`'s
license-key framing.

## #200 — Electron pre-distribution hardening (remaining scope)

F5 backend-stdout→DevTools DB-DSN leak RESOLVED (packaged builds log to
`<logs>/backend.log`). Remaining: `file://` wildcard in `isInAppNavigation`;
DevTools+Reload roles live in the *packaged* View menu (gate on
`!app.isPackaged`); Electron pinned at first `42.x` patch via caret with
EOL/support-window unverified (bump to latest 42.x, pin exact, verify the
window).

## #155 — litho bulk flow (secondary levers still open)

Primary lever shipped 2026-05-28 (incremental
`RecomputeAllAbsencesForModel(only_formation_ids=...)`). Secondary levers still
open: frontend per-anchor setState fan-out in `handleSuggestAllLitho`
(N renders), section-scoping, and the suggest phase.

## #131 — verify-and-close candidate

#131-c (lithology-coloured gradient seam ribbon) SHIPPED 2026-05-28 and
dogfeed-confirmed; #131-a/#131-b were structurally mooted by the body-with-
extent refactor, which was itself retired 2026-06-06. Nothing of #131 appears
to remain open — verify and close in docs/debt.md.

## #220 — smooth non-blocky litho 3D (Tier D, Phase 5 visual)

Fit planes/surfaces through the midpoints of the voxel model's contact faces
(horizontal top/base + vertical lateral seams) to remove the voxel staircase,
keeping the voxel labelling as watertight/interfingering ground truth.

## #79 — DOV Phase-2 import wall

~54 s decomposes as parse-bound, not network-bound — instrument the offload
path before any further speed work.

## #17 — legacy NULL-permkey

Recovery runbook documented; no backfill code per 2026-05-17 architect review.
