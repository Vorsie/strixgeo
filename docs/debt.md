# Known Architectural Debt

Items that need a focused session — bigger than a quick fix, smaller
than a phase. Tracked here so each one is visible in PR / commit
context without rediscovering it from grep. **Order is strict
priority — top is highest, bottom is lowest. Tiers are grouped, but
within each tier the order also matters.**

Priority is **milestone-gated**. The next build milestone is the
**Geotechnical-subdivision stage** (Phase 4 MVP step 4 —
lithostratigraphic unit → NAD packing class + CPT-derived indicators).
It cannot start until the **lithostratigraphic stage is finished** — so
the items that finish the litho stage are the top group, **above an
explicit gate**. Within every group the order is also strict priority.
This list is the canonical ordering, not the numeric order of the
sections that follow.

### ═══ G. Before the Geotech stage — finish the litho stage ═══

The litho ghost-review workflow must be solid before geotech
subdivision is built on top of it. Priority order:

* **#120** — RESOLVED 2026-05-25 (band-rect clamp to investigation depth)
* **#121** — correlation polygon-ribbon rendering, lens-aware (design work — after #101)
* **#122** — correlation edge opacity fade + body-hover spike (polish — after #121)
* **#123** — clay→silt correlation suggestion bug (needs owner reproduction)
* **#99** — drag-clamp through rejected layers (awaiting owner reproduction — code investigated, G34b passes)
* **#138** — drag-lock after litho merge (needs owner reproduction — filed 2026-05-26)
* **#139** — RESOLVED 2026-05-27 (CanvasHints correlate-blocked pill + toolbar gate)
* **#140** — RESOLVED 2026-05-28 (owner directive: decouple). Accept-all no longer fires auto-correlate — the `autoCorrelateContacts` call was removed from `handleAcceptAllBulkLitho`, so bulk accept never silently creates correlation edges / surprises the user with amber edges. Auto-correlate is now run only via the explicit toolbar action (`handleAutoCorrelate`, unchanged). B3 test pins that accept-all does not auto-correlate.
* **#141** — RESOLVED 2026-05-27 (SplitToolbarButton — Correlate as primary verb, Auto-correlate + Accept correlations under the caret; amber-tint mode-on signal preserved on the primary)
* **#142** — RESOLVED 2026-05-27 (accepted ghost hidden + pending wears hatching overlay)
* **#143** — RESOLVED 2026-05-28. Litho contact boundary lines were drawn in the formation colour, so an accepted contact vanished into its own band (worse once #145 made band fill == formation colour). Fixed: litho contacts now paint a near-black line (`#0f172a`) over a light halo (`#f8fafc`) so the boundary reads against every lithology pastel incl. the dark KLEI/VEEN bands; geological contacts keep the formation-coloured line (no regression). Two vitest pins (litho near-black+halo / geological unchanged).
* **#144** — RESOLVED 2026-05-28. The title was a misdiagnosis: every contact mutation already writes to the DB immediately by design (DB is the live source of truth, `.gmproj` is the snapshot — CLAUDE.md "Project files"). The real defect was that the four litho accept handlers (`handleAcceptLithoSuggestion`, `handleAcceptAllLithoSuggestions`, `handleAcceptBulkLitho`, `handleAcceptAllBulkLitho`) skipped the `addToSessionImports` session-imports manifest that `handleCreateContact`/seed/pinch-out all populate — so `projectDirty` never lit after an accept, the close/quit unsaved-changes prompt never fired, and the `.gmproj` on disk silently went stale (data safe in the DB, but the user's portable artefact out of sync with no warning). Fix: feed each accept's `created_contact_ids` / `created_formation_ids` into `addToSessionImports`, guarded on non-empty so found-only (re-accept) stays clean; `handleAcceptAllBulkLitho` aggregates across anchors into one call per kind. No staged-commit refactor (which the dogfeed title implied) was needed. D1/D2/D3 in `useGeologicalModel.suggestion.test.ts` pin it.
* **#145** — RESOLVED 2026-05-28. `_create_litho_formation` stamped `color="#9ca3af"` (grey placeholder, "Phase 2 assigns" — never did). Fixed: added `LITHOLOGY_COLORS` + `LITHOLOGY_FALLBACK_COLOR` to `shared/constants/litho_constants.py` (mirrors the frontend table); the create now stamps `LITHOLOGY_COLORS.get(code, fallback)`. Backfill migration `11878f8a5732` stamps the lithology colour onto every legacy grey row by `litho_main_soil_code` — verified on the dev DB (78 litho formations: GRIND/ZAND/SILT/KLEI/VEEN all correct, zero grey left). Unit pin `test_c1`.
* **#146** — RESOLVED 2026-05-28. Once #145 made the stored `formation.color` authoritative for litho units, the `lithoFormationColor` frontend override (2 call sites: `ContactsLayer` band map + `LithologyInspector` chip) became obsolete and was deleted — every read-side surface (section bands, labels, 3D viewer, exports, .gmproj) reads `formation.color` directly. `LITHOLOGY_COLORS`/`LITHOLOGY_LABELS` stay (ghost overlay still needs them at suggest-time, before a formation row exists); the table now carries a "keep byte-identical to the backend mirror" note. PC3b vitest reworked to pin the stored-colour read.
* **#147** — RESOLVED 2026-05-27 (immediate-clear of lithoContacts on model switch + pill unit count scoped to this-model contacts + refetch formations on model delete)
* **#148** — RESOLVED 2026-05-27 (inspector pill + roster are now model-scoped via #147 follow-up; the "1 unit retained" symptom can no longer render. Toast wording is accurate after the same fix)
* **#149** — OPEN; double SAND/SILT units after Accept-litho. v1 (accept-time same-litho merge) reverted; v2 (no merge, straddle kept) shipped but doubling persists; v3 (straddle-split also retired) reverted per owner directive "i want it to split on the geologic boundary but that is not what was happening here". The actual doubling cause is NOT straddle and NOT segmenter-merge drift — investigation pending. See [[feedback-litho-accept-verbatim-copy]]
* **#153** — RESOLVED 2026-05-28 (accept-all-bulk wall-clock). PROFILED 2026-05-28 on oudenaarde (42-anchor corridor on Cross-section 1, 26 with suggestions, 479 layers, real backend HTTP). Findings: (a) per-anchor accept time is FLAT, not growing (growth ratio 0.85x at N=26) — the statically-traced O(N²) terms (per-call `list_formations`, `_recompute_litho_display_orders`) do NOT bite at realistic N; deprioritise the "cache list_formations" idea. (b) the dominant driver was the **seeded-array leak (#154)** — a bloated `seeded_formation_contact_ids` (~12k stale ids) ~3×'d per-anchor accept (≈140 ms bloated vs ≈50 ms clean) because each accept reads+unions+rewrites the full UUID[] and commits. Fixing #154 roughly halves the wall-clock. (c) post-#154 clean-array phase split: suggest 1.09 s (42 calls, separate "Suggest all" action) · accept-litho 1.34 s (26 calls, ~51 ms each = round-trip + DB + commit) · recompute-all-absences **1.24 s (one call — now the biggest single phase)** · auto-correlate 0.10 s → bulk-accept (accept+recompute+autocorr) ≈ 2.68 s. (d) recompute-all-absences OPTIMISED 2026-05-28 — query-level profile showed the per-absence UPSERT loop (400 round-trips / 212 ms) + per-(formation×section) redundant corridor/observation loads were the cost. Fixed by batching the UPSERT into one multi-row `INSERT…ON CONFLICT` and hoisting the per-section corridor/observation loads to once-per-section (cached across formations): **1015→377 ms, 756→274 queries** on the 13-formation × 2-section oudenaarde shape, outputs identical (written 400 / wedge 44). (e) RESOLVED 2026-05-28 — the last lever, the batch accept endpoint, shipped: `POST .../contacts/batch-accept-litho-suggestions` accepts all anchors in one transaction (one commit), seeds the section once with the aggregated contact ids, and runs the inference recompute once. `BatchAcceptLithoSuggestions` loops `AcceptLithoSuggestions(commit=False, defer_inference=True)`; the router aggregates + seeds + recomputes. Frontend `handleAcceptAllBulkLitho` now makes ONE `batchAcceptLithoSuggestions` call instead of N accepts + a separate recompute (auto-correlate stays separate, #140). Verified end-to-end on oudenaarde: 26 anchors → 553 contacts + 13 formations in a single 1.4 s call (incl. the recompute). Net: an N-anchor bulk accept dropped from N+2 calls / ~2N+1 commits to 1 call / 3 commits. All three contributors (seeded-array leak #154, recompute O(F×S) work, per-anchor round-trips/commits) now closed. (filed dogfeed 2026-05-27; profiled + optimised + batched 2026-05-28). Integration tests added (`test_batch_accept_litho.py` BT1-BT5: one-transaction + single-seed, idempotent re-accept, bad-anchor isolation, run_inference toggle, 422 guard; `test_recompute_all_absences.py` RA1-RA2: inferred-absence write + batched-UPSERT idempotency) — the recompute use cases now have their first direct coverage (closes part of the #116 gap). (f) FOLLOW-UP 2026-05-28 — owner dogfed and reported "only slightly faster". Re-profiled: the first batch endpoint batched the *transaction* (N commits→1, N round-trips→1) but NOT the per-anchor work, which on localhost is the real cost. Query profile of the accept loop (26 anchors) showed 926 queries / 754 ms dominated by a per-layer existence `SELECT` before every insert (~580), the project-formation list + geology surfaces re-loaded per anchor, and the display-order recompute (a growing full scan) run per anchor. Fixed with `BatchAcceptContext`: load geology surfaces + formation lookup once, answer contact find-or-create from an in-memory map (no existence SELECT) with the INSERT deferred to the batch flush, run display-order once. Result: accept loop **754→203 ms, 926→137 queries**; full batch endpoint end-to-end **1395→567 ms (~2.5×)**, outputs identical. **NOTE:** the running backend must be restarted to pick up all of this.
* **#154** — RESOLVED 2026-05-28 (seeded-array leak: nothing ever removed ids from `cross_section.seeded_formation_contact_ids`. Every contact-create unioned ids in; delete + Clear-litho-model never pruned them, so the array grew unbounded across suggest→accept→delete cycles — live oudenaarde sections carried 11,960 / 18,884 seeded ids of which 99% referenced already-deleted contacts. Fix: `CrossSectionRepository.remove_seeded_contact_ids` (targeted, wired into `DeleteFormationContact`) + `prune_orphan_seeded_ids` (GC vs live project contacts, wired into `ClearLithoModel`), both flush-only so the unseed is atomic with the row removal. Verified on dev DB: Clear pruned Cross-section 1 12,557→124 and Cross-section 2 18,884→105. Stale-id rendering was always tolerated [filter-by-membership at the prop boundary] so nothing was visibly broken — the cost was the unbounded array re-write per accept, the main #153 contributor.)
* **#150** — RESOLVED 2026-05-28 via **#131-c** (shipped). Reframed from "grey + orange edges look weird" into the lithology-coloured gradient seam ribbon: each correlation renders a band split into the above/below lithology colours (a contact bounds exactly two lithologies), fading across the gap when the lithology differs (a lens). Shipped as the #131-c gradient ribbon (`contactStripeColors` + two-stripe `linearGradient` render in `CorrelationEdgesOverlay`, edge-to-edge, ±6 px, approved=solid+seam / pending=faded+dashed). The cheap interim token fix was correctly NOT done. See #131.
* **#151** — RESOLVED 2026-05-27 (right-click menu on litho band → Remove; on empty space → Add new suggestion)
* **#152** — RESOLVED 2026-05-27 (hard 10 cm clamp + near-cursor popup on litho contact drag)
* **#76** — RESOLVED 2026-05-25 (straddle split toast wired)
* **#133** — PHASE 1 SHIPPED 2026-05-26 (schema + endpoints + gesture + renderer); Phase 2 (auto-correlate + lens detection) and Phase 3 (migration + retire old model) remain open
* **#134-A** — RESOLVED 2026-05-27 (litho-geo snap tolerance moved onto ``view_state.litho_segmenter.litho_snap_tolerance_m`` + Settings → Litho segmenter NumberRow; default 0.20 m, range 0.01-5.0 m)
* **#134-B** — RESOLVED 2026-05-27 (in-flight drag-readout snap indicator — amber "↦ snap on release: 12.34 m" line + dot on the litho axis when the cursor is within ±tolerance of a geo contact on the same investigation)
* **#134-C** — single-suggestion path RESOLVED 2026-05-27 (handleAcceptLithoSuggestion returns the API result; the wrapper runs findGeoSnapCandidates against the accepted depth and opens the LithoGeoSnapDialog for the new contact id). Bulk paths split out as #134-C-bulk
* **#134-C-bulk** — OPEN; extend the post-accept snap check to accept-all-focused + bulk-one + bulk-all paths. Needs (a) a stable per-suggestion → created_contact_id mapping across straddle splits, and (b) a queue UI to surface N candidates one at a time without flooding the user (filed dogfeed 2026-05-27)
* **#155** — OPEN (improvement target, deferred). ROOT CAUSE IDENTIFIED 2026-05-28 (DB-direct per-phase profile of the full oudenaarde flow): **`RecomputeAllAbsencesForModel` re-processes the ENTIRE litho model on every bulk accept**, so it scales with total model size, not with the size of the accept. Two apples-to-apples runs (26-anchor corridor):
  * **clean model** (553 contacts, ~13 formations × 2 sections): suggest 0.74 s · accept 0.19 s · seed 0.01 s · **recompute 0.36 s** · auto-correlate 0.12 s = backend **1.42 s**.
  * **accumulated model** (1331 contacts, more formations): **recompute 3.09 s** (8.5×, superlinear) → backend total **4.15 s**.

  So the felt ~4 s on a real project IS the recompute: a real project's established litho model is large, and `RecomputeAllAbsencesForModel` (run once per bulk accept when `run_inference=True`) iterates *every* formation that has any contact in the model × *every* section — regardless of which formations/sections this accept actually touched. The #153 optimisation (batched UPSERT + per-section corridor/observation cache) cut the per-(formation×section) *constant* but not the *O(model-size) scope*. accept-loop + seed + auto-correlate are all small (≤0.2 s each); they are NOT the problem.

  **Secondary (frontend, smaller):** `handleSuggestAllLitho` calls `setGhostsByAnchor` PER anchor inside a 5-way-concurrent fan-out → N section re-renders during one "Suggest all", each re-rendering the *accumulating* ghost columns (O(N²) render); and the post-accept `refetchLithoContacts` + `refetchFormations` re-pull + re-render the whole model. Real, but the backend alone is 4.15 s on a large model, so recompute dominates.

  **Fix direction (deferred):** make recompute **incremental** — only recompute the formations touched by the just-accepted contacts, and only the sections those contacts lie on (the batch already knows the created/found formation ids + the `section_id`). That turns O(model) back into O(accepted). Alternative: defer inference to an explicit "refresh inference" action / background pass instead of synchronously in every accept (UX trade-off: section absences/wedge-tips would lag until refresh). Frontend follow-ups: coalesce the suggest fan-out into one `setState` after all anchors (one render, not N), and confirm the post-accept refetch isn't re-pulling the entire model. **IMPLEMENTED 2026-05-28 (primary lever):** incremental recompute shipped — `RecomputeAllAbsencesForModel.execute(only_formation_ids=...)` re-infers only the formations a batch accept touched (created+found across anchors), wired through the batch endpoint. Turns per-accept inference from O(model size) into O(touched). Measured on a synthetic 30-formation model: full recompute 301 ms vs incremental 50 ms for 5 touched (**6×, exactly proportional to formations processed**). RA3 integration test pins the scoping. So a re-accept onto an established model now recomputes a handful of formations instead of all — the dominant ~3 s cost on real projects drops proportionally to the touched/total ratio. **STILL OPEN (secondary levers):** (1) frontend — `handleSuggestAllLitho` does a `setGhostsByAnchor` per anchor (N section re-renders of the accumulating ghost columns, O(N²) render); coalesce to one setState. (2) section-scoping — incremental recompute still processes affected formations × ALL sections; could further scope to the sections whose corridor contains the accepted investigations. (3) the suggest phase (N segment calls) is now the larger backend chunk on a fresh accept. **When to revisit:** re-profile a real large project after the frontend reload to confirm the felt improvement, then pick up the frontend render lever if still slow. (filed dogfeed 2026-05-28; root-caused + primary lever shipped same day)

* **#157** — thin slivers in accepted litho from straddle-split at geo boundaries (likely same root as #149; snap litho→geo + min-sliver-thickness guard — owner dogfeed 2026-05-28)
* **#159** — drag-lock after deleting an accepted litho unit (can't drag the lower contact up into the freed space; #138/#99 family — owner dogfeed 2026-05-28)

* **2026-05-29 dogfeed batch — RESOLVED (section rendering + auto-correlate + lens cleanup).** A long dogfeed thread; all shipped to `develop` on 2026-05-29. (a) **Section surface through picks** — `surfaceThroughPicks` on ContactsLayer draws the active formation surface as a chord through the user's *placed* contacts, not a TIN slice along the section line (which sat ~1 m below for off-line investigations because the slice samples at the line, not at the borehole); SectionPanel passes it for the active surface on all three views (backdrop already did this via `referenceContacts`). (b) **Section-order auto-correlate adjacency** — `AutoCorrelateContactEdges` gains `section_id`; adjacency = consecutive in-corridor columns along the section, not the model-wide map-plane relative-neighbourhood graph (which crossed intervening columns for off-line tests → "spaghetti" on the section). Domain `auto_correlate_contact_edges(adjacency=…)` override; the toolbar passes the active section; no section → RNG fallback. (c) **Lithology-only correlation grouping** — the grouping key dropped from `(parent, above, below)` to `litho_main_soil_code` alone; same-lithology contacts correlate in depth order via adjacency + depth-window + MNN. The old triple blocked obvious correlations whenever a column had a boundary-edge parent mis-assignment or one extra interbed (different below-code). (d) **Full-band correlate hit target + void-clear** — the correlate hit-rect is sized to the whole band (click the band body, not just the thin boundary line); a click in the void clears the armed source (reuses SectionPanel's pan-safe background-click hook). (e) **Lens degeneracy guard** — `detect_lenses_from_graph(max_lens_thickness_m)` rejects a lens body thicker than the cap (a near-whole-column "lens" born from a loose correlation); `DetectLithoLenses` reads it from `view_state.litho_segmenter.max_lens_thickness_m` (0 = off, default 5 m) — Settings → Litho segmenter → "Lens max thickness (m)". Existing spurious lenses reconcile away on the next correlate. (f) **Delete-lens gesture** — right-click a wedge → confirm → dissolves the lens by deleting its two defining edges (above↔target, below↔target); the detector then reconciles the row away (the metadata-only DELETE endpoint would have left the body in the graph). (g) **Lens-candidate marking** — an *enclosed* contact correlating to neither neighbour gets an amber diamond in correlate mode (the "no-target middle layer" → pinch out, don't correlate). **Interim:** marking only; a one-click candidate→pinch-out conversion + two-sided lens geometry stay future work (the latter is the Phase-5 #101 / interfingering carve-out). **Watch item:** lithology-only grouping can pair same-lithology beds across a formation boundary when depth coincides — bounded by adjacency + depth-window + MNN; revisit if a wrong correlation surfaces.

### ═══ GEOTECH-STAGE GATE — everything below waits ═══

* **B. Commercial launch gates + pre-distribution hardening:** #2, #3, #4, #5, #6, #7, #47
* **D. Phase-4 export step + post-launch / Phase 5:** #104, #105, #13, #106, #107, #44, #52, #56, #11, #100b, #101, #70, #71, #79, #93, #95
* **E. Lower technical debt:** #16, #17, #27, #41, #62, #65, #68, #82, #114, #124, #125, #126, #155, #156, #158

*(Tiers A "Phase 4 engineering blockers" and C "current work" are
retired into this structure — the remaining Phase-4 work is the
explicit Geotech-stage gate above plus #104 the export-step gap. #28 /
#39 and most of the old Tier-E list resolved across the May 2026
campaign. #104–#117 filed 2026-05-22 from a six-agent full-codebase
audit. See git log on ``develop`` for history.)*

When an item is resolved, **delete it from this list** — its
implementation history lives in the relevant commit on ``develop``,
not here. Numbers stay stable through a debt-fixing campaign (do
not renumber after each fix); explicit cleanup passes (last done
**2026-05-16: six-agent codebase audit added #29–#50, #24 deleted
(Modal semantic-token migration shipped) + #51 (inspector token
migration, de-scoped from the same pass's quick-fix batch). Tier C
campaign began 2026-05-16: #30 resolved (Export stage hub shipped),
#52 filed (PDF report export), #29 resolved (Plaxis 2D per-section
exporter shipped), #31 resolved (section CRS allowlist guard),
#33 resolved (Geology empty-state CTA + 3-case copy), #32 resolved
(geotech-units round-trip already covered by
``test_bundle_carries_geotechnical_units`` — confirmed green, no code
change), #34 resolved (elevation PATCH stales dependent TINs in-
transaction), #35 resolved (pinned_order survives Build) — Tier C
fully cleared. **Same day re-tier:** Tier B (bundling/commercial)
deferred (app not feature-ready for packaging); Tier C reopened as
the "current work" tier — #37, #38, #12, #41, #43, #51, #40, #36
moved up from D/E (data-loss landmine + roadmap-gating
velocity/refactor work + cheap dogfeed friction); #37 + #38 + #51
+ #43 + #36 resolved same day (model-aware `delete_model`;
contact-mutation use cases unit-covered in the pre-commit suite;
inspector chrome migrated to semantic tokens; Data-stage Esc-to-map
peel restored; excluded_borehole_ids now filtered in TIN recompute).
**2026-05-17:** #12 R1–R5 shipped (App.tsx 3,200→1,001); then the
net-first step — useShellContextValue.test (renderHook net, written
first) + verbatim memo → useShellContextValue (App.tsx 1,001→833);
the shellContextValue silent-staleness risk + #53 NETTED. **#12
RESOLVED (deleted) on substantive completion + owner-approved revised
DoD**: 3,200→833, dangerous memo isolated+netted, Sidebar gone;
strict `<400` de-scoped (architect-optimistic literal vs the
documented coordinator-pattern floor ~480–520 — chasing it = low-value
churn). #53 reframed (net now exists; residual = hand-maintained dep
array). #41 un-folded → stands alone. **#40 resolved** — geology.py
monolith split into a per-cluster package (75 integration tests
green, 27 routes byte-identical). **#41 part (a) done + re-tiered to
E** (2026-05-17): the pure geometry (`cesiumGeometry.ts`) extracted
VERBATIM + 13 vitest cases — the 585c714 bug class is now netted; the
residual component-mount smoke needs a Cesium mock harness, far lower
value once the math is covered. **Tier C now empty** — current work
drops to Tier D/E. **#50 resolved 2026-05-17** (Virtuele Boring model
codes codelist-gated before fan-out). **#49 resolved 2026-05-17**
(crossings validator collapsed to one model-contacts query). **#46
resolved 2026-05-17** (shared `shell/ToolbarPrimitives.tsx` extracted
at the rule-of-three window + `busy` in-button spinner wired on every
long verb). **#45 partial 2026-05-17** (shared `EmptyState`/
`LoadingState` primitive shipped + GeotechnicalCanvas/DataCanvas
then **#45 fully resolved 2026-05-17** — DataInspector adopted the
shared primitive via a new `compact` variant). **#48 progress-logging
shipped 2026-05-17** (restore loops now have
[i/total] DEBUG + phase summaries; only the cosmetic procedural-logger
style remains — #48 stays open, rescoped). **#42 resolved
2026-05-17** — all three multi-class offenders split: formation_contact
→ package + re-export, tin_surface + geology_validator value objects
→ domain/value_objects/ (verbatim, importers unchanged). **#18
resolved 2026-05-17** — stale surfaces suppress crossings validation
(shared useCrossingsValidation hook + neutral pending-build banner;
auto re-validates on Build). 26 open items**) compact them. Commit messages and code comments written
before a cleanup pass continue to reference the OLD numbers — that's
an unavoidable cost of the renumber. Sections #2–#28 below remain in
their prior numeric order; #29+ are appended in numeric order — read
the five-tier list above for true priority.

---

## 2. Bundled Postgres distribution path not prototyped (medium → blocking before beta)

**What.** CLAUDE.md "Distribution model" plans an installer that
bundles Postgres + PostGIS (the Plaxis pattern). No prototype
exists. Failure modes are non-trivial for a solo dev: port
conflict on ``localhost:5433``, Windows Defender quarantine of the
Postgres binary, upgrade paths across Postgres major versions.
Distribution risk that hits before any geotech engineer sees the
UI.

**Why deferred.** Not blocking development; current dev flow uses
Docker Compose. User-deferred 2026-05-15: bundling waits until the
feature set is ship-ready (UI rework, geotechnical model,
parametrisation, PDF reports, 3D viewer all still open) — a
packaged installer is worthless ahead of what it wraps.

**Fork analysis already done** — see
[distribution-db-decision.md](distribution-db-decision.md):
embedded-Postgres vs SQLite+SpatiaLite costed against the real
codebase surface (Fork A ~1–2 days, zero Python blast radius;
Fork B ~1–2 weeks, touches the array-backed depth-series schema).
Recommendation recorded: Fork A, SQLite as a documented escape
hatch. Pick up from that doc when revisiting — no need to re-derive.

**When to revisit.** When the v1.0 feature set is ship-ready, and
before the first clean-box coworker install. Build the Fork A
prototype on a clean Windows machine without Docker per the
decision doc's "proposed build step".

## 3. License key + activation system (medium → blocking before paid release)

**What.** No licensing today; anyone with the binary can run it.
For a paid release we need a license token system. Suggested shape:

* Signed offline tokens (Ed25519). Token carries: license_id, user
  email, tier, issued_at, expires_at (or "perpetual"), optional
  machine fingerprint.
* App verifies the signature at launch against an embedded public
  key. No phone-home required for daily use — important for the
  offline-on-site use case.
* Online activation only once per machine (claim the token to the
  user's email), to prevent infinite resharing.
* A small backend (single endpoint, single signing key) issues
  tokens after Stripe webhook.

**Why deferred.** Pre-revenue. Building this before paying customers
exist is the wrong order of operations.

**When.** Before opening any paid checkout. Plan ~1 week of solo
work: token format + signing CLI + verifier in the Electron main
process + a thin "Activate license" UI.

## 4. Project-by-id endpoints rely on "only caller is local user" (medium → day-1 of #3)

**What.** ``POST /projects/{id}/duplicate`` (project.py) and
``PATCH /projects/{id}/view-state`` operate on the resolved row
without an identity check. Today that's correct (single user, no
auth). When debt #3 lands, these endpoints will need a
``user_owns(project_id)`` predicate threaded through.

**Resolved (2026-05-19) — IDOR scope-guard half**: All CPT and
borehole by-id endpoints (``GET /cpt/{id}``,
``GET /cpt/{id}/plot``, ``DELETE /cpt/{id}``,
``PATCH /cpt/{id}/elevation``, ``GET /borehole/{id}``,
``PATCH /borehole/{id}/elevation``) now require
``?project_id=UUID`` and reject cross-project ids with 404 via
``get_in_project_or_404`` (VULN-1..7). Application layer use
cases ``CreateFormationContact``, ``AcceptLithoSuggestions``,
``UncorrelateLithoUnits`` have defence-in-depth scope checks
(VULN-9..12). Frontend ``client.ts`` / ``useInvestigationData.ts``
/ ``useSectionData.ts`` updated in lockstep. Unit suite 895 green.

**What remains.** The auth-threading step (``user_owns`` predicate
on project-level endpoints) still waits on debt #3.

**Why deferred.** No auth shipped.

**When to revisit.** Day-1 of debt #3 license-token work — auth
scaffolding must thread ``current_user`` through these routes
before any token-gated call ships.

## 5. Tamper / reverse-engineering hardening (low — pragmatic posture, residual)

**What's still open.** The malformed-input audit pass landed: every
DOV XML parser uses ``defusedxml`` (billion-laughs + external DTD
guards); ``project:read-file`` and ``fs:read-file`` apply size caps
before allocating Buffers; the API has its own body-size + GEF-upload
caps. What's left is the licensing-side hardening tied to debt #3:

* Defeat casual bypass (renamed exe, deleted license file).
* Token store + verification on each launch (already in #3's scope).
* No anti-debug, no obfuscation, no DRM theatre.

**Why low priority.** Geotech engineers don't pirate software at
scale. The .strix format is also not inherently sensitive — losing
the geometry of someone's site investigation isn't catastrophic the
way leaking a movie pre-release is.

**When.** Folds into debt #3's license-key work before paid release.

## 6. Installer + code signing + auto-update (medium → blocking before paid release)

**What.** electron-builder produces .exe / .dmg / .deb / .AppImage,
electron-updater handles deltas. Windows requires EV code signing
(~€200–400/year for a hardware-token cert) to avoid SmartScreen
"untrusted publisher" warnings that scare off enterprise IT.
macOS notarization is similar (~€100/year Apple Developer
membership + signing + Apple notary upload). Linux can ship
unsigned today.

**Why deferred.** Same as #3 — pre-revenue, premature.

**When.** In parallel with #3, before the first paid release.
Auto-update is especially important because future .gmproj format
upgrades depend on every user reaching the build that introduced
the upgrade path.

## 7. Marketing site + market-facing name (medium → blocking before paid release)

**What.**

* Trademark search for the market-facing name. "Strix" is a
  codename only; check both word marks and design marks before
  committing.
* Domain (.com + .eu likely both needed for BE/NL audience).
* Landing page: hero with the 90-second demo video, three
  "what does it do" bullets, founding-member email signup, FAQ,
  privacy / terms. Tailwind on Astro or similar — keep it boring.
* Demo video: DOV bbox import → borelog → save → wipe DB → reopen.
  Under 90 seconds.

**Why deferred.** Useless without the v1.0 MVP gate behind it. A
landing page that promises features the app doesn't have is worse
than no landing page.

**When.** As soon as the v1.0 MVP gate is real (layer model +
exports). Start collecting emails before announcing pricing — the
list calibrates demand and the launch send is the conversion event.

**Naming collision to resolve.** "Strix" (our codename) sits one
letter off "`.stix`" (Deltares D-Stability file extension). Same
audience (BE/NL geotech), same tools shelf, and we will likely
ship a `.stix` exporter via GEOLib. Engineers searching for
"strix file" or "stix export" will confuse the two. Treat this as
a hard constraint when picking the market-facing name — neither
"Strix" nor any close phonetic variant survives this. Trademark +
domain search needs to clear against both word marks AND the
common-knowledge association with D-Stability files.

## 11. Pluggable regional stratigraphy catalog for NL / international (medium — Flanders covered, NL open)

**What.** G3Dv3 (shipped 2026-05-14) closes the Flanders side of
the canonical-stratigraphy question: ``infrastructure/codelists/
g3dv3_catalog.py`` resolves every named G3Dv3 formation / member
to a Dutch name, age_rank, color, and H3D code, with a JSON alias
map (``data/g3dv3_aliases.json``) bridging historical names
(Ieper / Ieperiaan → Kortrijk). Auto-populate uses age_rank when
every newly-created formation resolves in the catalog and falls
back to depth-derived ordering otherwise.

The open question: **NL** (BRO / TNO Dutch stratigraphic chart),
**FR/EN multilingual labels** for the BE bilingual market, and
the interface that lets a project carry a "regional catalog"
preference. Today's code hard-codes G3Dv3 — switching to BRO for
a NL project, or showing French/English names for a BE
francophone user, requires either a sibling catalog file +
loader, or a small abstraction over both.

**Why deferred.** Flanders is the v1.0 launch market and is fully
covered. NL expansion is a Phase 5+ direction (see CLAUDE.md
"Commercial Direction") — adding a catalog before there's a NL
customer is premature.

**When to revisit.**

1. **First NL pilot user** lands and reports formations from BRO
   not resolving.
2. **Multilingual UI work** kicks off — the catalog needs FR/EN
   name columns alongside name_nl.
3. **A second catalog file appears** (BRO export) — the third
   case for the "regional stratigraphic catalog" abstraction
   (per the rule of three).

**Implementation sketch when revisiting.** Add
``data/bro_units.json`` alongside G3Dv3. Refactor
``G3Dv3Catalog`` → ``RegionalCatalog`` with a constructor that
takes a catalog file path. Project metadata gains a
``regional_catalog`` field (default: ``"g3dv3"``). Consumers
(auto-populate, manual-create autocomplete) resolve the catalog
from the project's preference. ``name_nl`` becomes
``name_by_locale: dict[str, str]`` when the FR/EN need lands —
data migration is one-time on the existing JSON.

**Principle (user-confirmed 2026-05-14): stratigraphic ordering
must be CORRECT AT CREATE TIME, not via a repair button.** Today
G3Dv3 makes this true for Flanders projects; the NL extension
must follow the same rule.

## 13. Geotechnical units invisible to the section editor (medium — Phase 5 trigger)

**What.** ``geotechnical_unit`` rows (formation → unit
hierarchy) only surface in ``InterpretationPane``.
``FormationContact`` carries ``formation_id`` only — no
``geotechnical_unit_id``. The section editor and ``App.tsx`` never
receive the units. Section view cannot distinguish "weathered
crust of Boom Klei" from "undisturbed Boom Klei". Correct per MVP
scope ("subdivision — structure only") but the contact model has
no hook point for unit assignment.

**Why deferred.** MVP gate defers per-unit parameters and per-unit
visual distinction to Phase 5. Formation-level geometry is the
export target for v1.0.

**When to revisit.** When per-unit parameters land (Phase 5) and
downstream exporters (Plaxis material library) need unit-level
contacts. At that point ``FormationContact`` needs either
``geotechnical_unit_id`` FK or a separate ``GeotechnicalContact``
entity. Design the anchor before Phase 5 export work begins.

## 16. Telemetry / crash reporting (low)

**What.** No Sentry-equivalent. Frontend ``log.*`` calls go to the
devtools console; user-side crashes are invisible to us.

**When.** Before any non-solo user.

## 17. Legacy `dov_permkey = NULL` rows — documented recovery, no backfill code (low)

**What.** Refresh-on-duplicate keys per-row dedup on `dov_permkey`
(partial UNIQUE `(parent_id, dov_permkey) WHERE dov_permkey IS NOT
NULL`). Rows stored before that PR have `dov_permkey = NULL`;
`dov_dedup.py` filters NULL out, so they never dedup → the first
re-import of a previously-imported bbox creates duplicate observation
/ sample / lab-test rows for those legacy boreholes.

**Resolution (2026-05-17, system-architect review): document-and-defer,
do NOT build a backfill.** Rationale:

* **Affected population is currently zero.** Dev DB wiped 2026-05-10;
  all local rows are post-PR. Pre-ship distribution is coworker-only
  fresh installs (`project_coworker_distribution.md`) — nobody has a
  pre-PR DB.
* **A network-rematch backfill is more dangerous than the bug.** The
  true permkey is `last_path_segment(fiche_url)` — not reconstructable
  from stored domain values, so it needs a DOV re-fetch + heuristic
  re-match. NULL = visible recoverable duplicate; a *wrong* permkey =
  silent dedup against the wrong upstream identity (data corruption).
  The migration author already chose NULL-over-guess for this reason.
* **Folding the heal into the re-import dedup path is unsafe on the
  six lab families.** Their only unambiguous identifier *is* the
  permkey: a sample can carry multiple legitimate runs of the same
  test type, so a `(sample_id, test_type)` domain key collides and
  would silently merge genuinely-distinct lab tests. Permanent
  complexity on the critical ingest path for zero current users.

**Recovery runbook (if a legacy-NULL DB ever exists).** Per-project
re-import, not a script: open the affected project, delete the
permkey-less observations/samples/lab-tests (or wipe the project and
re-import the bbox). The import re-fetches from DOV and stamps
permkeys on every row; refresh-on-duplicate fills missing children.
Wipe-and-reimport sidesteps the match ambiguity entirely. For a
coworker-beta DB (a few dozen boreholes) this is a five-minute action.

**When (precise trigger).** Only if a build is handed to someone who
has been running a **pre-permkey-PR binary against a non-empty DB**
(not merely "a non-solo user" — a fresh install has no legacy NULLs).
If that fires and the runbook is judged too heavy, build the
**standalone one-off script** (`scripts/`, NOT an Alembic migration —
it does network I/O), dry-run default, with this safety bar baked in:

* Per parent, re-fetch + re-parse the DOV source; stamp ONLY on an
  unambiguous exact match (re-parsed child count == NULL-row count and
  stable-key sequence matches exactly). Any count mismatch / ambiguity
  → stamp nothing for that parent, log a WARNING with the parent id +
  affected row ids.
* Per-family stable match key (medium confidence): observation /
  sample = `(parent_id, type, depth_top_m, depth_base_m)` with ~1 mm
  float tolerance. **The six lab families MUST refuse to backfill** —
  domain-key collision risk is unacceptable; instruct wipe-and-reimport
  for those instead.
* Tests: SQLite-fixture unit tests — stamps the lone NULL match;
  leaves an already-stamped row untouched; count-mismatch (0 or 2
  parsed vs 1 NULL) → no stamp + WARNING; lab-family backfiller →
  always no-stamp + instruct-reimport. No live-DOV integration test
  needed before the trigger.

## 22. CPT detail chart conflates raw curves with Ic/SBT interpretation — RESOLVED 2026-06-01

**Resolved.** ``CptChart.tsx`` is now raw-only: the Robertson Ic curve,
SBT zone bands, zone labels, second x-axis tick row, Ic legend entry,
and SBT colour-key strip were all removed. ``CptChart`` renders only the
measured channels (qc / fs / Rf / u2 / Qt).

The Ic curve + SBT zone bands live in a new dedicated component:
``desktop/src/renderer/src/shell/stages/parameters/CptIcSbtChart.tsx``.
It is embedded in the Parameters stage's per-test tab
(``PerTestTab.tsx``) — clicking a CPT row with a loaded Ic series
expands the chart in a panel below the table.

Data source unchanged: the same ``plot.ic`` field from the
``/cpt/{id}/plot`` endpoint, sourced from
``robertson_2015.ic_series_2015``. No backend change.

Tests: 9 new pins in ``CptIcSbtChart.test.tsx`` (IC1–IC7 + two title
props); ``CptChart.test.tsx`` updated — the old "renders Ic SBT strip"
pin is now the inverse "does NOT render Ic / SBT" pin. 1548 vitest +
tsc clean. 1549 total (1 pre-existing skip).

## 27. Bathymetry / water-surface DEM cells — no bed-elevation data (low — Tier E)

**What.** The DEM clip rule (§11.3) flags any vertex that lands on a
NoData cell as ``dem_cell_low_confidence``, which covers the known
bathymetric failure mode: LiDAR returns the water-surface elevation for
rivers, lakes, and canals rather than the bed, so a formation contact
beneath a water body gets clamped to the wrong surface. No bathymetric
data source (Vlaamse Hydrografische Atlas, AHN4 water-body mask, NGI)
is integrated today — the flag is a placeholder that tells the engineer
"check this vertex manually."

**Why deferred.** Ingesting a bed-elevation raster requires (a) a
second tile-cache provider wired into ``DemProviderFactory``, (b) a
water-body mask to route DEM queries to the bathymetric provider when
the (x, y) is within a water polygon, and (c) source data that covers
the same EPSG:31370 / EPSG:28992 footprints. None of the three pub-
lished Belgian or Dutch bathymetry services offer a convenient WCS
interface — the Vlaamse Hydrografische Atlas ships as shapefiles, not
a tile service, so this is a full ingestion project. The initial
``dem_cell_low_confidence`` flag still honours Data Integrity Rule §5
(flag, don't raise) and gives the engineer enough signal to act.

**When to revisit.** When a dogfooding user reports that a water-
adjacent project has unreliable formation tops and the ``low_confidence``
flags are insufficient. At that point evaluate: (a) a shapefile-backed
water-body mask that routes cells to a null sampler vs a bed sampler,
(b) a simple "depth below water surface" heuristic from
``BHVlaBathymetry`` data, or (c) accept the limitation and expose it
in the UI as "DEM accuracy may be reduced near water bodies."

## 28. Surface confidence signal — RESOLVED 2026-05-21 (true per-vertex gradient follow-up shipped same day)

**Follow-up ship 2026-05-21 (late evening — owner directive "geen half
werk").**  The original implementation rendered the continuous distance-
to-data signal as a BINARY split (>= 0.7 → full alpha; < 0.7 → faded).
A user-visible cliff at the threshold made the cue read as "two
distinct regions" instead of the smooth distance signal underneath.

Replaced with true per-vertex gradient end-to-end:

* **``utils/tinConfidence.ts``** gains:
  * ``computeVertexConfidence`` — averages incident triangle
    confidences onto each vertex.
  * ``confidenceToAlphaMultiplier`` — linear lerp
    ``[CONFIDENCE_FLOOR, 1.0] → [LOW_CONFIDENCE_ALPHA_MULTIPLIER, 1.0]``.
    Clamped at both ends.
  * ``partitionByConfidence`` kept as back-compat but no longer used
    by the production renderers.
* **``Geology3DViewer``** gains a custom Cesium ``Appearance`` with
  GLSL shaders that read a per-vertex ``color`` attribute (vs the
  one-color-per-primitive ``PerInstanceColorAppearance``).
  ``buildTinPrimitiveWithVertexColor`` packs per-vertex RGBA into the
  geometry attributes; the GPU interpolates per-pixel across each
  triangle. Result: a TRUE gradient — no bands, no cliff.
  ``rebuildSurfacePrimitives`` drops the high/low partition; emits one
  primitive per formation per render. When the confidence-fade toggle
  is OFF, falls back to the original ``PerInstanceColorAppearance``
  path (uniform alpha — visually disables the cue at zero perf cost).
* **``ContactsLayer``** drops the dHigh/dLow concatenated paths; emits
  ONE ``<path>`` per slice segment with per-segment opacity =
  ``baseOpacity × confidenceToAlphaMultiplier(segmentConfidence)``.
  ~50-200 SVG nodes per polyline; modern browsers handle thousands
  without issue. When the toggle is OFF, falls back to a single
  concatenated path with uniform opacity.
* **Split-mode caveat.**  In split (clipped) mode the Cesium triangle
  soup loses vertex sharing.  Each clipped triangle is rendered with
  a SOLID alpha = average of its three source vertices' alphas
  (within-triangle gradient lost in split mode; across-triangle
  continuity preserved).  Acceptable per "geen half werk" call: the
  user uses split for inspection, not gradient study.
* **Tests.**  A1-A6 on ``confidenceToAlphaMultiplier`` + V1-V4 on
  ``computeVertexConfidence``.  Existing ContactsLayer pins updated
  to query a child segment path (the testid now hangs off a ``<g>``
  wrapper, opacity lives on the children).
* **Result.**  1064/1064 vitest + tsc clean.  The visual shows
  continuous fading from data-backed regions out toward the hull;
  the section editor mirrors the same gradient per-segment.

## 28-orig. Surface confidence signal — RESOLVED 2026-05-21

Owner directives chosen:
* **Metric: hull-edge + edge-length gradient.** Hull-edge triangles
  (any edge appearing in only one triangle) get a fixed
  ``CONFIDENCE_FLOOR = 0.3``; interior triangles grade by
  ``maxEdgeLength / medianEdgeLength`` (1× median → 1.0, 2× → 0.5,
  clamped at floor). Edge length is horizontal-plane only — vertical
  spread is the signal we render, not the sparsity metric.
* **Render: opacity fade.** Low-confidence triangles render at
  ``LOW_CONFIDENCE_ALPHA_MULTIPLIER = 0.45`` × the default alpha.
  Threshold for the band split is ``CONFIDENCE_THRESHOLD = 0.7``.
* **Surface: 3D viewer + section editor.** Both consumers split into
  two render passes per formation — high band at full alpha, low band
  faded. Same testid pattern on both surfaces.

**Implementation.** Pure helper ``utils/tinConfidence.ts``:
``computeTriangleConfidence(vertices, triangles): number[]`` plus
``partitionByConfidence(confidence): { high, low }`` for the band
split. Cost is O(triangles) once per render.

**Degenerate-TIN escape hatch.** A triangulation with NO fully-
interior triangle (every triangle has at least one hull-edge) has
nothing to grade against — a 3-contact surface or a 4-corner square
split would otherwise render perpetually faded. The helper detects
this and returns uniform ``1.0`` for the whole surface. The signal
activates only once 5+ vertices form a triangulation with an
interior triangle, which matches the "model has enough data to
distinguish dense from sparse" intuition.

``Geology3DViewer.tsx``: each formation's TIN now builds TWO Cesium
primitives — high-band triangles at the existing ``ALPHA_FRESH``
/ ``ALPHA_STALE``; low-band triangles at the multiplied alpha. The
helper called on the un-offset vertices; the per-formation z-offset
applied to the position copy before primitive build. Ground-surface
render unchanged (the terrain layer is not an interpretation).

``sliceTin`` extended: each ``SlicePoint`` now carries
``triangleIdx?: number`` — the index of the triangle the crossing
came from. Two consecutive points in the sorted polyline are
crossings of the same triangle, so the segment between them inherits
that triangle's confidence band.

``ContactsLayer.slicedPolylines`` builds two SVG paths per formation
(``dHigh`` + ``dLow``) by walking consecutive point pairs and
appending each segment to the band matching the triangle's
confidence. Renders as two ``<path>`` elements inside a ``<g>``
keyed by formation id; the high path keeps the original testid
``formation-surface-{id}``, the low path adds ``-low`` for assertions.

**Tests.** T1-T6 + P1-P3 in ``utils/tinConfidence.test.ts`` (9
cases: empty input, degenerate single-triangle, degenerate 4-spoke
fan, interior triangle in a 3×3 grid, median threshold, zero-edge
degeneracy + partitionByConfidence boundary cases). S1 in
``utils/sliceTin.test.ts`` pins the new ``triangleIdx`` field on
every SlicePoint. ContactsLayer integration tests pass unchanged
because the degenerate-TIN escape hatch keeps small fixtures at
full confidence. 1045/1045 vitest + tsc clean.

**Documented residual (out of scope for #28 itself).** The
kriging / RBF interpolator (Phase 5) will provide a proper variance
metric; this distance heuristic becomes throwaway code at that
point. The ``method`` query param already scaffolds for it; the
``computeTriangleConfidence`` helper goes away cleanly when the
variance-based metric replaces it.

---

> The items below (#29–#50) were added by the 2026-05-16 six-agent
> codebase audit (senior-code-reviewer, system-architect,
> security-reviewer, staff-engineer, product-strategy-advisor, and
> ux-reviewer-as-general-purpose-proxy). They are in numeric order;
> their true priority is the five-tier list at the top of this file.

## 41. `Geology3DViewer.tsx` component-level smoke still absent (Tier E — residual; pure helpers extracted + netted 2026-05-17)

**What.** Part (a) is **done** (6c5389a): the pure coordinate math —
`computeBasemapBounds`, `sampleTinZ`, `clipTrisToHalfSpace`,
`clipTexTrisToHalfSpace` — was extracted VERBATIM into
`cesiumGeometry.ts` with 13 vitest cases (`cesiumGeometry.test.ts`)
covering the barycentric sampler, the footprint bbox/url math and the
Sutherland–Hodgman half-space clip incl. the textured st-lerp.
Geology3DViewer dropped 1,739→1,580 lines. **This is exactly the bug
class the 585c714 `flyToCutFace` ReferenceError was, and it is now
netted.** The remaining residual is part (b): a `Geology3DViewer.
test.tsx` mount smoke for the *component shell* (effect wiring, the
two-click split-line state machine, the `widgetRef.current == null`
guards).

**Why deferred / re-tiered to E.** The component smoke needs a Cesium
mock module or headless-WebGL harness — `new Cesium.CesiumWidget`
throws under jsdom and the mount effect sets `widgetRef.current` to
the constructed widget (the null guard only holds if construction is
intercepted), so the smoke needs a non-trivial inert-Cesium stub
(separate tooling investment). With the *pure math* now covered, the
marginal value of a shell-mount smoke is much lower than when this was
a Tier-C blocker — the named bug class no longer rides on it.

**When to revisit.** Before Phase 5 or first external release, OR
opportunistically when a Cesium test-mock is built for any other
viewer work. Fix: stand up `test/cesiumMock.ts` (inert
CesiumWidget/Scene/Camera/ScreenSpaceEventHandler + real math
classes), then `Geology3DViewer.test.tsx` mounting with empty props
(every builder early-returns on empty data) asserting no throw +
split-line click reducer transitions.

## 44. Cross-stage selection — per-stage visualisation of the carried scope (Tier D — follow-on from 2026-05-21 ship)

**What.** Owner decision 2026-05-21: selection carries across stages
(the "scope" semantic). The state-level work is **done** — the
`marqueeSelectedIds` set already persists structurally (owned by
App.tsx, above the stage-canvas `key={activeStageId}` boundary), and
the new `SelectionFooter` in `StageSpine` surfaces the carry to the
user as a small "N sel." badge visible from every stage with a clear
button.

The remaining work is each stage actually USING the carried set as
its scope:

* **Sections** — corridor source picks from the selection set; toolbar
  verbs that act on "selected investigation" gain a "selected set"
  mode.
* **Geology** — the model's `excluded_borehole_ids` toggle should be
  pre-seeded by the selection set (one-click "model only the selected
  boreholes"); the 3D viewer highlights selected investigations.
* **Lithology** — "Suggest all" / "Accept all" bulk verbs default to
  the selected set, not every visible borehole.
* **Parameters** — per-test table filters to the selected set when
  the set is non-empty.

**Why deferred.** The carry-feedback ship (footer + the bus already
exists) makes the metaphor honest. Each per-stage hookup is its own
small product call (e.g., does Geology's "in-model" toggle REPLACE
the set or ADD to it?) and should be designed alongside the next
substantive change to that stage.

**When to revisit.** When dogfeed flags a specific stage where
manual re-picking the same investigations after the carry-aware
walk feels redundant. At that point, ship the per-stage consumer for
THAT stage with the concrete workflow in front of you.

## 47. `project_bundle.py` column auto-enumeration → silent `.gmproj` format drift (Tier B — backwards-compat re-arm trigger)

**What.** `build_project_bundle` / `restore_project_bundle` enumerate
every ORM column via `__mapper__.column_attrs` so new columns "ride
along automatically." Convenient pre-ship; a forward-compat liability
once backwards-compat re-arms: adding any column to any bundled ORM
model silently changes the emitted `.strix` shape with no version
bump, no conscious decision, no round-trip test. The manual
`_SKIP_COLUMNS` set is the only gate.

**Why deferred.** Backwards-compat is suspended pre-ship (owner
directive 2026-05-16); the enumeration is a real time-saver during
rapid Phase-4 work and the risk is zero while no external `.strix`
file matters.

**When to revisit.** At the backwards-compat re-arm trigger (first
external distribution — ties to #3). Then: audit every bundled ORM
class for columns that should NOT be portable (caches,
server-managed timestamps) and promote them to `_SKIP_COLUMNS`; add a
fixture test per top-level bundle array asserting its exact column
set, so a new column forces a conscious format-version decision.

## 52. PDF report export (Tier D — Phase 5 reporting deliverable; slice 1 shipped 2026-05-21)

**Slice 1 shipped 2026-05-21.** Single-section PDF report. Engine
choice: ReportLab (layout + text) + matplotlib (figures, Agg headless
backend) — both deps added to pyproject.toml. The exporter
``infrastructure/exporters/section_pdf_report_exporter.py`` consumes a
``SectionSnapshot`` + a ``ReportMetadata`` bundle (title / author /
notes / date) and produces PDF bytes via ``SimpleDocTemplate``.

Content shipped:
* Title block with the user-editable title.
* Project metadata table (project, section, EPSG, vertical datum,
  section length, author, date).
* Optional free-text notes under the metadata table.
* Main figure (A4 portrait, ~180 mm × 130 mm):
  * Section drawing — depth × along-section distance, investigation
    columns at packed-but-nudge-capped positions (35 m cap per the
    owner directive — see ``infrastructure/exporters/pdf_layout.py``).
  * Formation contact polylines threaded across columns, formation
    name labels, colour-keyed legend.
  * **Location-map inset (top-right)** with the section line + every
    investigation as a dot + explicit **L / R end-of-line markers** so
    the engineer reads the orientation correctly off the figure.
* Footer: project + section + generation timestamp + page number.

Surfaces:
* Endpoint: ``GET /projects/{pid}/sections/{sid}/export/pdf`` with
  ``model_id`` required and ``title`` / ``author`` / ``notes``
  optional query params.  Same Content-Disposition pattern as the
  existing DXF / Plaxis 2D section endpoints.
* Frontend: new ``ReportMetadataDialog`` (title / author / notes —
  default title built from section name) opened from the Sections
  toolbar's ``Export ▾`` dropdown (third item, alongside Section DXF
  + Plaxis 3D script).  App-level ``handleExportSectionPdf`` owns
  the save-dialog + file-write flow.
* ``SectionSnapshot`` extended additively with ``start_x / start_y /
  end_x / end_y`` so the exporter can render the location-map inset
  without re-fetching the section row.  Pre-#52 test fixtures with
  the default ``0.0`` keep working (the map degenerates to a single
  point when endpoints are zero).

Tests:
* P1-P8 on ``packed_column_positions`` (empty / length-mismatch /
  no-nudge / pack-from-overlap / cap-binds / order-preserved / edge-
  gap / default-cap pin).
* Integration: ``test_pdf_export_happy_path`` +
  ``test_pdf_export_works_without_metadata`` — 200 OK,
  ``application/pdf`` content-type, ``%PDF`` magic header,
  Content-Disposition filename.
* D1-D4 vitest pins on ``ReportMetadataDialog`` (default title,
  trimmed-value submit, cancel = no submit, empty-title fallback).
* 924 unit + 6 cross-section integration + 1053 vitest green; tsc
  clean.

**Slices B / C / D still open under #52.**

* **Slice B — Project geometries report** (per the owner ask): all
  sections + investigation inventory + formation names, no parameter
  values.  One PDF for the whole project, not per-section.  Reuses
  the same exporter primitives (matplotlib figures + ReportLab
  layout); the main new piece is the section-list iteration + a top-
  level project location map.
* **Slice C — Full geological + lithological report**: slice B plus
  per-section pages for BOTH the geological model AND the litho
  model, plus per-borehole stratigraphy tables and per-CPT
  segmenter-derived layer stacks.  No parameter values yet.  Bigger
  paginator work than slice B.
* **Slice D — Full report with parameters (Phase 5)**: slice C plus
  per-unit parameter tables (φ′ / c′ / cu / E50 / OCR / Vs / G0 / M
  — Phase 5 backend work, not just a reporting layer).  Owner
  directive holds: parameter VALUES stay out of v1.0 (MVP scope is
  characterisation indicators only — Ic zone, Dr, NAD class,
  γ-estimate).  Slice D ships alongside the Phase-5 backend port.

**Original-entry residuals (kept for slice-B/C/D rationale).**

**What.** The Export stage hub (shipped with #30) surfaces machine
targets — DXF, Plaxis 3D (Plaxis 2D / D-Series / GeoStudio / IFC as
they land). It does NOT produce a human-readable **PDF report**: a
formatted document an engineer hands to a client / files in the
project dossier (project header, location map, investigation
inventory, borelogs, cross-section figures, the formation/geotech
model summary, derived parameters once Phase 5 lands). Every
incumbent (gINT, D-Series, GeoStudio) ships a report generator; its
absence is a credibility gap the moment a consultancy asks "can I
get a deliverable out of this?". CLAUDE.md "Build Sequence" already
lists "PDF reports" under Phase 5.

**Why deferred.** A report engine is a real subsystem (layout/
templating choice — ReportLab / WeasyPrint / headless-Chromium —,
figure rendering from the section + 3D views, a template the user
can brand, pagination). The v1.0 MVP gate is the *machine* export
path (layer geometry → design tools); the report is the *human*
output and is genuinely Phase 5 scope, not a launch-demo blocker.
Building it before per-layer parameters + statistics exist (also
Phase 5) means the report would have half its content blank.

**When to revisit.** Phase 5, alongside derived parameters +
statistics (the report's richest content depends on them). Pull
earlier ONLY if a pilot consultancy makes a signed PDF deliverable a
hard procurement requirement before then — in which case ship a thin
interim (project header + investigation inventory + section figures,
parameters section explicitly "not yet computed"). When built it
becomes another `ExportCard` in the Export hub (the #30 canvas was
designed so new targets are one card — no toolbar/inspector change).
Decide the engine on the renderer/back-end split: a Python-side
generator (ReportLab/WeasyPrint) keeps figures reproducible and
testable; a renderer-side print-to-PDF reuses the live Cesium/recharts
views but couples the report to Electron. Lean Python-side unless the
3D figure fidelity forces the renderer path.

## 60. SeedLithoFromGeologicalModel use case orphaned — RESOLVED 2026-06-01 (Branch B)

**Resolution (2026-06-01).** Discovery confirmed Branch B: the full
4-layer chain (use case, API endpoint on two URLs, `client.ts`
`seedLithoFromParent`, `handleSeedLithoFromParent` in `useGeologicalModel`)
is wired end-to-end and already covered by 5 integration tests
(`tests/integration/api/test_seed_litho_from_parent.py` S1–S5: happy
path, idempotency, section seed, non-litho guard, scope guard — all
passing). The "orphan" framing was accurate for the frontend-caller gap:
`handleSeedLithoFromParent` is returned from the hook but never consumed
by a production component. No code was deleted (debt entry said premature
to do so; a future automated litho-seed workflow may want the endpoint).
Debt closed: the backend chain is tested; the missing frontend verb is a
feature concern, not debt.

---

## 56. Manual-lump cross-project reuse + standalone group editor (Tier D — deferred)

**What.** The manual stratigraphy lumping map (`stratigraphy_lumping.map` in
the `.gmproj` bundle, scope step 7) is per-project and entirely in the user's
hands — the system never infers synonymy.  Two things are missing from the
complete UX story:

1. **Cross-project reuse** — if a user lumped "Quartair: Holoceen veen" and
   "Vlaamse Vallei" → "Holoceen" for project A, they want to reuse that
   grouping for project B without re-doing the work.  The correct shape is an
   explicit **"Import lumping from project..."** action (opens a file-picker,
   merges the other project's `stratigraphy_lumping.map`).  NOT auto-import,
   NOT a shared user-global library — every merge is an explicit user decision.
2. **Standalone group editor** — a panel where the user can edit existing
   lumping groups (rename the target, drag raw names between groups, un-lump a
   name) outside of a live Fill-from-boreholes run.  Today the only edit
   surface is the FormationSelectionDialog triggered by "Fill from boreholes".

**Why deferred.** The per-project map is usable at v1.0; the cross-project
import and the standalone editor are convenience features.  They are non-trivial
UI (file-picker, merge strategy, drag-between-groups) and would delay the
stratigraphy-lumping slice without adding correctness.

**When to revisit.** When a user explicitly asks to reuse a project's
grouping elsewhere (i.e. the per-project constraint becomes friction in
real dogfooding).  Not before.

---

## 62. Pinch-out ghost-UX follow-ups (Tier E — post-slice review residue)

The pinch-out ghost-UX slice shipped 2026-05-18; senior + ux review
blockers were all fixed (stale-ghost-on-section-switch, 409 local-state
refresh, role/Esc/focus a11y, no-blank-overlay, loading flash, dark
mode, no-undo legibility, panel position, context-menu double-close).
Three reviewer items were deliberately deferred:

**What.**
1. ~~**`window.confirm` for contact delete** (`ContactsLayer.tsx`)~~ —
   **DONE 2026-05-20**: replaced with `DeleteContactConfirmDialog`
   (focused 2-button Modal + default-focus on Cancel + danger-variant
   "Delete contact" action button). 5 D-tests pin the contract; the
   pre-existing ContactsLayer tests were rewritten to drive the new
   dialog flow instead of `window.confirm` (53/53 green). Generic
   ConfirmDialog primitive deferred per "extract on the second copy"
   — wait until a 4th destructive confirm needs the same shape.
2. ~~**Pinch-out direction is hardcoded `'right'`** (`SectionsCanvas.tsx`)~~
   — **v1-min DONE 2026-05-20**: `handlePreviewPinchOut` now
   auto-retries the opposite direction on a 422 carrying the backend's
   `code: 'pinch_out_geometry_error'` discriminator. A west-pinching
   formation or R→L-drawn section is silently retried and the preview
   state carries the direction that actually worked (so the commit
   uses it too). 4 PO-tests pin the contract: happy path no-retry,
   geometry-error retry succeeds, geometry-error retry also fails,
   non-geometry error skips retry. **Residual:** the full
   target+direction picker before the dry-run (the user explicitly
   picks instead of relying on inference) stays Phase-5/post-v1
   per the original code comment.
3. ~~**`PinchOutResult` returns `CrossSectionOrm`** (infra type) into the
   application layer~~ — **DONE 2026-05-20**: `PinchOutResult` no
   longer carries an `updated_section: CrossSectionOrm | None`
   field. Section-seeding (the explicit-content invariant) moved
   from the use case into the router, matching the existing pattern
   in `AcceptLithoSuggestions` / `autoPopulate` / `discoverFromStrat`.
   Seed-id set equals `created_contact_ids` in both the happy +
   idempotent paths, so the router needed no extra info. The use
   case dropped the `CrossSectionRepository` import entirely;
   `CrossSectionOrm` is still imported but only for the geometry
   load (legitimate application-layer USE of an infra type, not
   RETURN). 15 pinch-out unit + 3 pinch-out integration + full
   120/120 API integration green.

**Why deferred.** (1) + (2) v1-min + (3) all shipped 2026-05-20
(above). Fixing (3) at the original session tail risked unreviewed
churn across already-large changes; here it landed alongside (2) as
the same-area cleanup.

**When to revisit.** (2)'s full target+direction picker — when a real
user wants to override the inference (the auto-retry covers the
opaque-422 case for now). Nothing left on (3).

## Historical note — 2026-05-13 security-reviewer audit pass

The remaining audit findings — #35 CORS, #36 CSP+window-open+
unpkg, #37 IPC paths, #38 bundle bounds, #39 GEF cap, #41
recent-projects, #43 error messages — landed in the same session.
Open items kept: the auth-threading work (now **debt #4**, was #40)
+ the ESLint reason-rule enforcement project (was #42, never broken
out as its own numbered entry — bigger than 30 min).

---

## Resolved — kept as design-rationale anchor

These entries are RESOLVED and live OUTSIDE the numbered priority
list. They stay in this file because the design rationale anchored
here is load-bearing context for anyone reading the relevant code,
not because they're still actionable.

### Contact selection toolbox (resolved 2026-05-13, refined 2026-05-13)

Implemented the day after the debt was filed. Cross-column drag,
Ctrl-toggle + Shift-range multi-select, box-marquee select,
multi-drag with preserved Δm offsets, ESC peel, batch backend
(``PUT /contacts/batch``) all shipped. Refined within the same
dogfooding session after the user hit two real friction points
that broke initial design assumptions:

* **Marquee vs pan conflict.** Original design: any plain drag on
  background = marquee. But pan is also plain drag → the marquee
  ate every pan attempt. Refined: marquee requires **Shift held**.
  Plain drag falls through to pan. Convention matches Figma /
  Plaxis Designer (navigation = default verb, selection = modifier
  verb). Shift-launched marquee is always additive — to "replace
  via marquee", ESC first then Shift-drag.
* **Cross-column drag should COPY, not MOVE.** Original design
  picked MOVE based on "drag = relocate" intuition. Real workflow
  is "stamp my known-good interpretation from borehole-A onto thin
  CPT-B nearby" — the user wants COPY. Refined: plain cross-column
  drag = **COPY** (creates new contacts at target via N parallel
  POSTs; originals stay). **Alt+drag = MOVE** (the original
  re-anchor behaviour, opt-in). Same-column drag stays MOVE
  (depth-only re-pick — copy makes no sense at same anchor).

The remaining v1 simplifications stand:

* **Cursor position.** Drop where the cursor releases — the section
  view behaves like a 2D drawing surface.
* **Multi-anchor selection collapses to one target column.** Rare
  case; intentional v1 simplification.
* **Out-of-bounds depths are allowed.** Contact rows simply record
  depth_top_m > investigation depth; the section renders them
  out of bounds. User can fix by re-picking or deleting.

**Open follow-ups under this anchor** (low priority, captured here
so they don't get re-filed as new items):

* COPY uses N parallel POSTs (Promise.all). Partial-failure leaves
  some contacts created and others missing; the toast warns. Promote
  to a real ``POST /contacts/batch-create`` endpoint with single-
  transaction commit when failure rates start to bite.

---

## 64. Litho 3D viewer — split-viewport mode — RESOLVED 2026-06-01

`LithologyCanvas` now wires `splitMode` / `splitPlane` / `splitLine`
state identically to `GeologyCanvas`. The `Geology3DViewer` "Split
model" button arms the two-click draw interaction; the litho toolbar
Reset button collapses the split via `resetLithoSplitViewportCallback`
(same pattern as `resetSplitViewportCallback` in `GeologyCanvas`).
`onExitSplit` is wired so the "Single view" button inside the viewer
also collapses. No code added to `Geology3DViewer.tsx` — the wiring
was purely in `LithologyCanvas.tsx` + `LithologyStage.tsx`. C3 test
pins the exported callback. 53 vitest + tsc clean 2026-06-01.

---

## 65. Excluded-boreholes UI for the Lithology inspector (Tier E)

**What.** The Lithology stage inspector has no "excluded boreholes"
UI — the litho model's `excluded_borehole_ids` is set only via
the backend, never surfaced. Mirrors the geological inspector's
toggle, which the engineer can flip when a borehole's stratigraphy
disagrees with the rest of the corridor.

**Litho crossings validator carved out (was the second half of #65,
2026-05-21):** the original entry claimed "litho surface crossings
are silently undetected" — incorrect. `ValidateModelCrossings`
DELIBERATELY returns `[]` for any model whose `kind` is in
`NON_STRATIGRAPHIC_KINDS` (lithostratigraphic + geotechnical),
because interfingering sand-and-clay is real geology, not a
superposition error. The frontend wiring would always show empty
banners (or a falsely-promising "Build to validate" pending banner
that resolves to no issues). Closed as wontfix — the deliberate
no-op is the correct behaviour.

**Why deferred.** The litho inspector is deliberately read-only
at v1.0 (formations are project-scoped shared vocabulary; CRUD
stays in GeologyInspector). An exclusion toggle is the first
mutation the litho inspector would carry, so it merits a small
product call: does it follow the geo pattern (PATCH the model's
`excluded_borehole_ids`, refresh, rebuild affected surfaces)? Or
does it need extra UI for "this borehole is excluded from
geo+litho" vs "litho-only" vs "geo-only" cases?

**When to revisit.** Next dogfeed session that flags a litho
unit polluted by a single anomalous borehole — at that moment
the exclusion-toggle UX is concretely informed by the case the
user wants to handle.

## 66. Admixture aggregation heuristic — RESOLVED 2026-05-21

The original entry only ever lived as a one-liner in CLAUDE.md's Tier E
("``_aggregate_admixtures`` uses >50% thickness-weighted majority;
owner-tunable at dogfeed; revisit if thin interbedded sequences produce
wrong dominant admixtures"). Resolved before that revisit became a
dogfeed report, so this is the canonical record.

Owner directives chosen:
* **Two-threshold + presence count.** Include an admixture when its
  total thickness >50% of the run (primary, dominant signal) OR
  thickness >25% AND present in >=3 source layers (secondary,
  pervasive-interbedded signal). The presence floor is what
  distinguishes "thin secondary signal that IS the geological
  character" (kept) from "concentrated in a couple of fat layers"
  (dropped — neither dominant nor pervasive).
* **Thickness-weighted dominant amount.** When the same ``soil_code``
  appears with different ``amount`` values (e.g. ``zwak`` siltig in
  some layers, ``sterk`` siltig in others), the output's amount is
  whichever variant has the larger summed thickness across
  contributing layers. Geotechnically honest: the merged label
  reflects the dominant strength.

**Implementation.** ``litho_segmentation._aggregate_admixtures``
refactored from canonical-key-by-(soil_code:amount) to grouping by
``soil_code`` alone, then resolving the dominant amount per soil_code
at the inclusion step. Thresholds hoisted to module constants
``ADMIXTURE_MAJORITY_THRESHOLD`` (0.5), ``ADMIXTURE_SECONDARY_THRESHOLD``
(0.25), ``ADMIXTURE_PRESENCE_FLOOR`` (3) so the owner can tune one
line at the next dogfeed report. ``locally`` inversion logic
unchanged (any global → result global; all local → result local).

**Tests.** A1-A6 + A1b/A4 boundary cases in
``tests/unit/domain/services/test_aggregate_admixtures.py``: primary
threshold included (66%) / excluded at exactly 50% / secondary
threshold included (30% across 3 layers) / excluded under presence
floor (30% across 2 layers) / below both thresholds (20%) / dominant
amount selection across mixed strengths / locally inversion both
directions. 913/913 unit + tsc clean. The 28 pre-existing
segmentation + accept tests still pass — the broader segmenter behaviour
is invariant under the heuristic change because the previous tests
used uniformly-attributed admixtures.

**Documented residual.** Tuning is a one-line edit to the three
module constants. The next dogfeed report of "wrong dominant
admixture in this particular borehole" is the natural trigger to
adjust — ship a real case alongside any further change.

## 68. CorrelationEdgesOverlay uncorrelate menu state lives inside a `pointerEvents:none` SVG `<g>` (Tier E — robustness)

**What.** The Slice-4 `CorrelationEdgesOverlay` owns its uncorrelate
context-menu state and renders the menu as a `<foreignObject>` inside
the overlay's root `<g style={{ pointerEvents: 'none' }}>`. It works
because `foreignObject` HTML children do not inherit the SVG
`pointer-events:none` — an SVG-spec oddity. The robust shape is the
existing `ColumnContextMenu` pattern: lift the menu state to
`SectionPanel` and render it as HTML above the SVG.

**Why deferred.** Functionally correct on the only runtime Strix ships
(Electron/Chromium, pinned). The reviewer's concern is a *speculative*
future Chromium-upgrade regression, not a present bug — the lift is a
non-trivial refactor (state ownership move + render relocation) not
worth the churn/risk pre-ship (review S6).

**When to revisit.** First sign the uncorrelate menu mis-behaves after
an Electron/Chromium bump, OR when the section context-menu surfaces
are next consolidated (fold the lift into that pass).

## 70. Decision-log table for ML training — schema scaffold + per-decision wiring (Tier D — post-MVP ML, owner-audited)

**What.** Ship a `user_decision_log` table that captures every manual
user decision in the app (litho suggestion accept, suggestion reject,
formation contact create / move / delete, formation rename / reorder /
pin, build trigger, sync geology, manual composition pick, cross-
section seed, geotech NAD assignment, …). Schema sketch: `id UUID PK`,
`project_id UUID FK`, `user_id UUID NULL` (filled once auth lands —
debt #3 / #4), `decision_type VARCHAR` (discriminator: `litho_accept`,
`litho_reject`, `contact_create`, `contact_move`, …),
`decision_at TIMESTAMP`, `before_state JSONB NULL` (the suggested /
prior state), `after_state JSONB NULL` (the committed state),
`context JSONB` (anchor ids, model id, section id, …).

**Suggestion-surface inventory (every one of these MUST instrument
`record_decision` when it ships).** Owner directive 2026-05-24: ML
training over user-made changes is a confirmed v1.0+ target across
**all** suggestion surfaces, not just the litho segmenter. Adding a
new suggestion gesture without wiring the decision log is technical
debt the moment it lands. Current and committed surfaces:

| Surface | When it fires | `decision_type` tokens |
|---|---|---|
| Litho segmenter (Suggest verb) | User accept/reject of ghost layer | `litho_accept`, `litho_reject`, `litho_modify_then_accept` |
| Litho segmenter — bulk accept | User clicks "Accept all (N)" | `litho_bulk_accept` (one row per ghost in the bulk, payload includes the bulk batch id) |
| Manual contact mutation | User creates / drags / deletes a contact | `contact_create`, `contact_move`, `contact_delete` |
| Manual composition picker | User picks lithology + admixtures on a layer | `composition_pick`, `composition_modify` |
| Formation rename / reorder / pin (drag stratigraphic column) | User mutates the formation ordering | `formation_rename`, `formation_reorder`, `formation_pin_toggle` |
| Build 3D model trigger | User clicks Build | `build_trigger` (context: which formations were stale) |
| Sync geology → litho seed | User runs "Fill from boreholes" / "Seed from stratigraphy" | `geology_sync`, `section_seed` |
| Pinch-out extrapolation (geology axis right-click) | User confirms ghost wedge | `pinch_out_commit` |
| **#101 Position 4 — formation_absence inference acceptance** | User confirms a `source='inferred'` absence → promotes to `'manual'` | `absence_confirm_inferred` |
| **#101 Position 4 — formation_absence override** | User overrides an inferred absence type (lens-edge → fault / unconformity / erosion) | `absence_override_type` (payload includes from / to source values) |
| **#101 Position 4 — name lens body** | User attaches a name to a body | `lens_name` |
| **#101 Position 4 — create perpendicular companion** | User accepts the auto-create offer | `companion_section_create` |
| **#127 auto-correlate — edge acceptance** | User confirms a `source='auto'` correlation edge → promotes to `'manual'` | `correlation_confirm_auto` |
| **#127 auto-correlate — edge rejection** | User deletes a `source='auto'` edge | `correlation_reject_auto` |
| **#127 auto-correlate — manual edge added** | User creates a correlation edge by hand (no auto suggestion to confirm or reject) | `correlation_manual_create` |
| Geotech stage (Phase 5 — NAD assignment, parameter values) | User commits NAD class or design parameter | `geotech_nad_assign`, `geotech_param_commit` |
| Parameters stage (Phase 5 — correlation formula vs Excel lookup pick) | User picks the method for a parameter | `parameter_method_pick` |
| Map / DataInspector — investigation review (hide / accept / flag) | User marks an investigation reviewed | `investigation_review` |

Owner caveat 2026-05-24: "there are a lot [other targets] I haven't
flagged yet" — this inventory is the current snapshot. When a new
suggestion gesture lands, append to this table in the same commit
as the gesture itself. The list is the contract; the implementation
catches up.

For each decision, store **only the suggested position and the last
committed position** (owner directive 2026-05-20). Intermediate drag
previews are NOT logged — transient UI state, not decisions.

Each relevant use case calls a shared `record_decision(decision_type,
before, after, context)` helper at its commit step. The helper
inserts the row in the same transaction so partial-decision failure
(use case rolls back) doesn't leave a phantom log row.

**Why deferred.** Owner explicitly asked the ML wiring to live in
post-MVP debt so the ML training pipeline can be audited rigorously
by hand after launch. The log table itself ships now (captures data
from day 1); the ML reader / training pipeline is the deferred half —
see #71 / #72.

**When to revisit.** As each use case lands or is touched, add the
`record_decision` call alongside its existing commit. Don't bulk-wire
in one pass — risks coupling unrelated paths. The log starts useful
the moment ONE use case is wired; broader coverage compounds.

## 71. ML training pipeline that consumes the decision log (Tier D — post-MVP, owner-audited)

**What.** Read `user_decision_log` rows and train **one model per
suggestion surface** (see the inventory in #70). Each surface gets
its own predictor that conditions on (suggested output + input
features + user's accept/reject/modify pattern). v1.0+ targets:

* **Litho segmenter** — predict which ghost layers the user will
  keep / move / reject. Inputs: segmenter output + (qc / Ic /
  soil_code at depth) + project metadata.
* **Position 4 absence inference** — predict which `'inferred'`
  absences the user will promote vs override-to-fault. Inputs:
  body geometry + neighbour observations + project geology.
* **Auto-correlate (#127)** — predict which `'auto'` correlations
  the user will confirm vs delete. Inputs: column geometry +
  depth window + dip features.
* **Composition picker** — predict the lithology + admixture
  combination the user is most likely to commit given the prior
  layers + the segmenter's per-layer Ic / qc context.

Outputs in every case: ranked refined suggestions. Re-trains as the
log grows. Each surface is trained INDEPENDENTLY (no cross-surface
joint model in v1.0+; future work) so a low-signal surface doesn't
contaminate a high-signal one.

**Why deferred.** Owner directive — audit ML rigorously by hand
before any pipeline ships. ML accuracy claims need a human-in-the-
loop validation round; the log table (#70) is the data plumbing for
that audit. The training itself is post-MVP — geotechs care about
deterministic, reviewable outputs first.

**When to revisit.** After the decision-log table has accumulated N ≥
200 litho accepts across ≥ 3 real projects AND the owner has spot-
audited a representative sample. Don't fit a model on toy data.


## 82. Drag-from-ghost-edge → correlation (Tier E — Phase 2.5 gesture follow-on)

**What.** When a ghost-layer boundary is being dragged, allow the
drag to leave the source column horizontally and land on a
neighbouring band — auto-accept the source ghost and create a
correlation edge in one gesture. Two sub-variants:

- **B.** Drop on an accepted band → auto-accept source ghost +
  fire `handleCorrelate(srcFormationId, targetFormationId)`.
- **C.** Drop on another ghost → auto-accept BOTH ghosts (target
  may straddle the parent geology, requiring a composition picker)
  + create the edge.

**Why deferred.** Owner scope decision 2026-05-20 (debt #78 split):
the smallest valuable slice — drag-INSIDE-correlate-mode on
accepted bands — shipped first because it doesn't overload the
existing ghost edge-resize handle. Variants B + C require
direction-dominance detection on the resize drag (horizontal-vs-
vertical motion), DOM-level hit-testing across ghost component
instances (acceptable, the data attribute pattern from #78 ports
directly), and an auto-accept code path that, for variant C, must
also handle straddle + composition-picker dialogs.

**When to revisit.** Next time the dogfeed user says "I wanted to
drag a ghost boundary to the next CPT" (the original 2026-05-20
dogfeed complaint, still active). The toolbar Correlate gesture
(now with the 1-drag enhancement from #78) is the workaround until
then. Variant B is the cleaner first slice — straddle handling on C
is non-trivial.


## 79. DOV Phase-2 parse-offload diagnostic + re-baseline (Tier E — performance investigation)

**What.** The current cold-import wall-clock for 316 deep CPTs is
~54 s (per `CLAUDE.local.md`). Benchmark says parse is ~170 ms per
CPT on the event loop, so 316 × 170 ms ≈ 53.7 s — the entire wall
matches parse, not network. Memory notes a `ProcessPoolExecutor`
parse offload is implemented (`PARSE_OFFLOAD_MIN_BYTES = 50_000`)
that should bring this to roughly `316 × 170 ms / Ncores ≈ 13 s
on a 4-core box`. The fact that we still see ~54 s suggests one
of: (a) the offload isn't firing for some reason, (b) the byte
threshold is too high in practice, (c) the baseline was measured
before the offload landed and was never re-run.

Plan when revisited:
1. Add per-CPT decomposition timing in Phase 2 — network wait,
   ElementTree parse, Polars frame build (3 timers, ~30 LOC).
2. Re-import the same 316-CPT bbox cold; log the split.
3. If parse is on the event loop → check why offload isn't firing
   (threshold, ProcessPool initialisation, single-import path
   that skips it).
4. If parse IS in the pool but wall is still high → check process
   start-up cost (cold-pool overhead is high; warm-pool reuse
   might be needed).

This bench-then-decide approach is cheap (3-min dogfeed import +
30 LOC) and avoids speculative refactor of the wrong layer.

**Why deferred.** Phase-2 throughput isn't a v1.0 MVP blocker — the
import works, just takes longer than ideal. The decomposition is a
prerequisite for any further work (local DOV mirror, parse-pool
warm-up, etc.) so it should land BEFORE the next attempt at speed.

**When to revisit.** Next time the dogfeed import noticeably annoys
the user with wait time; OR before the first external distribution
where speed-of-first-import shapes the trial experience. Local
DOV mirror is the ceiling-break above this (already noted in
`CLAUDE.md` "DOV Import" section).

ChatGPT cross-check 2026-05-20: confirmed the format-switch (JSON
vs XML) is marginal (<1 s) and HTTP/2 is irrelevant for this
workload (large single-document exports, not many small requests).
The real win is at the parse layer + eventual mirror.



## 85. Right-click insert layer — RESOLVED 2026-05-21

Owner directives chosen:
* **Sentinel 10 cm thickness, then drag** — inserted layer arrives
  thin; user immediately resizes via the standard drag handles. The
  upper neighbour keeps its base; the lower neighbour's depth_top is
  auto-edited to shared_boundary + sentinel so the three layers stay
  geometrically consistent.
* **Blank picker prefill** — composition picker opens with empty
  initial values (the existing normalisation defaults the main soil
  to ZAND; user picks from there).

**Implementation.** New ``LithoSuggestionGhostColumns`` props
``onInsertLayer(afterIdx, composition)`` (single-anchor) +
``handleInsertLithoLayer(anchorId, afterIdx, composition)`` callback
on ``useGeologicalModel``. The actual state mutation is the pure
helper ``utils/lithoLayerInsert.ts``: splices the new
``LithoLayerSuggestion`` at ``afterIdx + 1``, shifts every
accepted/rejected index above ``afterIdx`` by +1, shifts every edits
Map key above ``afterIdx`` by +1, and patches the (now-shifted) lower
neighbour's ``depth_top_m`` edit to ``shared_boundary + sentinel``.
Sentinel constant ``INSERT_LAYER_SENTINEL_THICKNESS_M = 0.1`` (10 cm).
The new layer inherits ``parent_formation_id`` from the upper
neighbour as a sensible default (backend re-resolves at accept time
via the standard contact/TIN path — debt #87).

A new 6 px transparent ``<rect>`` overlays each shared boundary
between two adjacent pending layers (skipped when either neighbour
is accepted/rejected, when ``onInsertLayer`` is not wired, or at the
last layer). ``onContextMenu`` opens the boundary menu (rendered via
``createPortal`` at the click position) with a single "Insert layer
here…" item. Clicking opens the existing
``LithoGhostCompositionEditor`` in insert mode (empty initial
values). The picker's Save fires the parent callback chain.

Wiring: ``SectionsCanvas`` puts ``onInsertLayer`` on both the
single-anchor ``lithoGhostState`` (with the focused anchor's id
captured at the call site) and the bulk ``bulkLithoGhostState``
(anchorId resolved at each per-anchor mount in ``SectionPanel``).
The bus interface accepts the optional prop on both bundle types —
zero regression on callers that don't opt in.

**Tests.** I1-I7 in ``lithoLayerInsert.test.ts`` (pure helper):
sentinel depth applied / lower neighbour's depth_top edit at
shared+sentinel / accepted+rejected indices shift / indices at-or-
below afterIdx unchanged / edits Map keys shift correctly / upper
neighbour's edited depth_base drives the boundary / new layer
inherits parent_formation_id. R1-R5 in
``LithoSuggestionGhostColumns.test.tsx``: boundary strip rendered
between adjacent pendings when onInsertLayer wired; not rendered
when opt-out; not rendered between pending and accepted; right-click
opens the boundary menu; Insert action opens picker and Save fires
onInsertLayer with afterIdx + composition. 1036/1036 vitest + tsc
clean.

## 83 cascade + 84 merge prompt — RESOLVED 2026-05-21

Owner directives chosen:
* Cascade behaviour: **Multi-collapse with prompt** — drag clamps walk
  through ALL same-parent pending neighbours; release opens a single
  confirm dialog naming the layers about to be absorbed.
* Merge wording: **Merge title with NAD fallback** — title morphs
  between "Merge N <Lithology> layers (NAD K)?", "Merge N <Lithology>
  layers?", and "Collapse N layers?" based on the shared
  ``suggested_lithology`` + ``suggested_nad_class`` of the dragged
  layer and the chain.
* Geological boundary rule: **Refuse across boundary** — the cascade
  hard-clamps at the first layer whose ``parent_formation_id`` differs
  from the dragged layer's parent OR whose ``spans_boundary`` is true
  (straddler). The geological signal beats the NAD signal.

**Implementation.** ``computeDragBounds`` returns ``collapseChainAbove``
+ ``collapseChainBelow: number[]`` (replacing the prior single
``collapseIdx{Above,Below}: number | null``).  Pure walk helpers
``findCascadeChainAbove`` / ``findCascadeChainBelow`` traverse same-
parent same-non-straddle pending neighbours; the gap-fill regime
(rejected between dragged and first pending) wins over cascade by
returning an empty chain; accepted barriers and geological barriers
also empty the chain.  The drag state's mouseup gate now defers to
``MergeConfirmDialog`` whenever ``snapped`` AND the chain contains
any non-self entry; Confirm fires the deferred ``onEdit(idx, depth)``
+ shared-boundary propagation + ``onReject(...)`` per chain entry;
Cancel drops the whole gesture (no edits, no rejections — the
pre-drag visual is restored on the next render because no commit
happened).  The #81 self-collapse path (chain == [own idx]) bypasses
the dialog — that gesture is the user's explicit "fold this layer"
intent and asking is friction.

The merge dialog title comes from a pure helper
``buildMergeConfirmTitle(dragged, chain)`` that computes the
commonality.  When all four checks agree (same litho, all NAD non-
null, same NAD), the title carries the NAD parenthetical; when any
NAD is null, the title drops the parenthetical; when lithology
mixes, the wording falls back to "Collapse".

**Tests.** Cascade chain pure tests C1-C6 + dialog title M1-M5 in
``LithoSuggestionGhostColumns.cascade.test.ts`` (11 cases — cascade
3-chain, geological boundary stop, spans_boundary barrier, accepted
barrier, rejected-gap inhibits cascade, top-drag mirror; title NAD
shared, NAD fallback, mixed-litho collapse, empty defensive, total-
count plural).  ``LithoSuggestionGhostColumns.test.tsx`` updated:
G32 + G33 now drive Confirm in the dialog (was: assert inline edit
+ reject); new G37 pins Cancel as a no-op.  Backwards-compat: all
pre-existing tests pass — non-snap drags, rejected-gap (#83 v1.2 G34),
self-collapse (#81) all still commit inline without the dialog.

**Documented residual (#85 still open).** Right-click on a shared
boundary to insert a layer between two pendings stays Tier E; the
gesture surface is different (insertion, not collapse) and the
deferred design pieces (where the new layer's thickness comes from,
composition prefill, hit zone) don't share infrastructure with the
cascade.  The cascade ship doesn't change #85's trigger condition.

## 86. Horizontal drag-to-copy composition — RESOLVED 2026-05-21

Owner directives chosen:
* Drag-start detection: **Alt/Shift modifier + drag** — Alt key
  disambiguates the copy-composition gesture from the existing
  edge-resize handles. No positional logic needed.
* Cross-investigation: **Same-column + cross-investigation** — drop
  on any pending ghost layer in any column. Valid targets highlight
  amber on hover.
* Overwrite semantics: **Confirm on overwrite** — if the target has
  an existing edit, open a confirm dialog naming source + target
  compositions; default-focus Cancel.

**Implementation.** `LithoSuggestionLayer` accepts an
``onCopyMouseDown`` callback fired only when ``e.altKey`` is held on
mousedown over a pending layer's body rect. The existing accept /
dbl-click / context-menu handlers stay on the same rect; the
preventDefault + stopPropagation on the Alt path suppresses the
click event that would otherwise fire onAccept.

Every pending layer rect stamps two data attributes —
``data-litho-anchor-id`` (the investigation id) + ``data-litho-idx``
(the suggestion index) — used by a document-level mousemove +
mouseup effect on the parent component to resolve the drop target
via ``document.elementsFromPoint``. Cross-investigation targets are
found purely by attribute lookup, no React context or shared state
needed. JSDOM-safe (the resolver guards on
``typeof document.elementsFromPoint``).

Drop target receives the dragged layer's
``(suggested_lithology, suggested_admixtures)``. Same-anchor drops
fire the existing ``onEdit(idx, edit)``; cross-anchor drops fire the
new ``onCrossColumnPaste(targetAnchorId, targetIdx, edit)`` callback,
which `SectionsCanvas` wires to ``handleEditBulkLitho`` (the existing
bulk edit handler that already routes to any anchor in the unified
``ghostsByAnchor`` Map — debt #77).

Overwrite detection: when the target's effective composition is
already overridden by an existing edit, the gesture defers to
``CopyCompositionConfirmDialog``. Confirm fires the deferred
``onEdit`` / ``onCrossColumnPaste``; Cancel drops the gesture. The
dialog names source + target compositions via the same
``formatLithoDisplayName`` helper the ghost rects use for their
in-place labels.

Drag preview: floating amber chip via createPortal at fixed
clientX/Y, follows the cursor. The hovered drop-target rect gets
an amber 2 px stroke override.

**Tests.** Q1-Q6 in ``LithoSuggestionGhostColumns.test.tsx``:
Q1 Alt+mousedown arms copy + renders preview chip (no onAccept).
Q2 same-column drop fires onEdit with composition.
Q3 drop on already-edited target opens dialog; Confirm commits.
Q4 dialog Cancel = no-op.
Q5 plain (non-Alt) mousedown does not arm copy.
Q6 cross-anchor drop fires onCrossColumnPaste (not onEdit).
1024/1024 vitest + tsc clean.

**Documented residuals.** Cross-column overwrite detection is
intentionally conservative: only same-anchor edits trigger the
confirm dialog. The bulk edits Map is not visible from inside the
source component instance; checking it would require lifting the
edits Map to a shared bus. Owner-pragmatic — same-column overwrite
is the common case (the user just edited a composition and is
pasting next door); cross-column overwrite without confirmation is
a one-step undoable action via re-opening the editor.

## 95. Lithology gesture cheatsheet + drag-and-drop discoverability (Tier D)

**What.**  Dogfeed 2026-05-21: "How do I drag-and-drop lithology?
shift click is select alt click and normal click just pan?"  The
section editor's bottom strip lists four gestures (drag = pan,
scroll = zoom, right-click = focus column, double-click = open) but
misses the rest of the surface — Shift+click marquee selection,
Alt-drag MOVE vs plain-drag COPY, the drag-resize handles on contact
rows in the inspector, and the row-reorder drag on the formation list.
None of these are discoverable except by reading docs/ux.md.

The fix has two layers:

1. **Per-stage gesture pill** (bottom-left corner) — always-on, lists
   the 5–6 gestures relevant to the current stage with a 3-letter key
   abbreviation (e.g. "Shift = marquee").  Same place as the section
   editor's current footer hint; just always-present and richer.
2. **Help → Cheatsheet** menu item that opens a full grid of every
   gesture across every stage.  Searchable, copy-pastable.

**Why deferred.**  Discoverability work is in-scope for the v1.0 polish
pass alongside debt #93 (first-use tutorial).  Both deliverables share
the "engineer reads tooltips when stuck" failure mode and benefit
from being authored together.  Content authoring (the actual gesture
list per stage) is the load-bearing piece, not the code.

**When to revisit.**  Same trigger as #93 — pre-coworker-binary.  The
first dogfeed user's "how do I X" questions become the cheatsheet's
top entries.

## 93. First-use tutorial + per-stage "next step" hinting (Tier D — onboarding)

**What.** No onboarding exists today. A new engineer opening Strix
for the first time sees an empty welcome screen, then a stage with
toolbar verbs whose preconditions are implicit ("Suggest litho" needs
a CPT focused; "Seed" needs formations defined; "Build" needs
contacts placed). The workflow IS discoverable by reading tooltips,
but reading every tooltip on every disabled button is a slow path to
the first useful action.

Two related deliverables under one entry:

1. **First-use tutorial** — a game-like guided walkthrough that fires
   the first time a user opens Strix.  Coach marks (numbered amber
   tooltips with arrows) point at the right control to click next.
   Example flow: "Welcome → click New project → enter a name → click
   Import DOV → draw a bbox → walk to Geology → define a formation →
   walk to Sections → draw a section → click Seed for new tests →
   Build → done."  Skippable with a top-right "skip tutorial" link;
   re-launchable from the Help menu.
2. **Per-stage "next step" hinting** — empty-state-driven guidance
   that surfaces the most useful next action whenever the user lands
   on a stage.  Examples:
   * Geology stage with no formations → "Define your first formation
     (the geological backbone of the project)" overlay on the empty
     formation list.
   * Sections stage with a section but no contacts → "Open this
     section and pick depths, OR click Seed for new tests to
     auto-populate from borehole stratigraphy."
   * Lithology stage with no litho model → "Create a litho model that
     refines your geological backbone."
   * Parameters stage with no per-test data → "Run Lithology first to
     get NAD packing class indicators."

   Each hint disappears when the precondition is met.  Persistent —
   not a one-time tutorial; the hint is always available when the
   precondition is unmet.

**Why deferred.** This is a v1.0-launch deliverable, not a v1.0-MVP
gate.  Three reasons:

* **Content authoring is the load-bearing piece**, not the code.  The
  tutorial copy + per-stage hints need to be written by an engineer
  who has dogfeed the workflow end-to-end and knows which steps the
  user gets stuck on.  We're still finding those steps.
* **Implementation is straightforward but boilerplate-heavy** — a
  small coach-mark library (or react-joyride) + ~12 hint surfaces
  across stages.  Maybe two days of code, three days of copywriting.
* **Premature shipping risks calcifying the wrong workflow.**  The
  litho gesture surface alone resolved 5 dogfeed-driven debts this
  week (#83, #84, #85, #86, #87).  Pinning a tutorial against today's
  shape before the workflow is stable creates churn.

**When to revisit.**  Pre-coworker-binary or pre-paid-revenue,
whichever lands first.  Trigger: the first dogfeed user other than
the owner.  The first 5 things that user gets stuck on become the
tutorial's first 5 coach marks; the next 5 stage-empty-states become
the persistent hints.  Until then, every dogfeed observation that
ends "the user didn't know they could click X" should be filed as a
candidate hint here (not as a separate debt) so the eventual
authoring pass has a ready list.

**Related shipped surfaces that already do part of this job.** Empty-
state cards exist (``EmptyState`` primitive in
``desktop/src/renderer/src/components/EmptyState.tsx``) and are used
in several places (LithologyInspector when no model, Geology3DViewer
when no surfaces, etc).  The hint system is the next-step evolution
of this primitive — same shape, but driven by stage-state instead of
hard-coded text and always visible (not just when the surface is
truly empty).

## 92. "New tests" workflow — RESOLVED 2026-05-21

**What.** When an engineer imports new CPTs or boreholes into a project
whose geology + lithology models are already built, incorporating the
new tests is fiddly: "Suggest all" re-runs the segmenter on every
visible investigation (idempotent server-side, but wastes time on
already-accepted ones), and "Seed from stratigraphy" places contacts
on every borehole (idempotent — skips duplicates — but the user has no
explicit "won't touch my work" affordance). The dogfeed workflow asked
for two new toolbar verbs scoped to "investigations not yet in the
active model's contacts" plus a confirmation that new tests
automatically appear on existing section profiles.

**Resolution shipped 2026-05-21.** Three pieces:

1. **Tests auto-draw on existing profiles — already true.** Verified
   in ``useSectionData.ts:242``: ``projectedCpts = useMemo(() =>
   investigationsOnSection(section, cpts, excludedCptIds), …)``. The
   section's investigation set is recomputed live against the current
   project investigation list, so newly-imported tests in the
   corridor buffer appear automatically with their data column
   (qc/fs curves, borehole log) — no contacts required. No code
   change needed.
2. **"Suggest for new tests" button** (SectionsToolbar litho axis,
   next to "Suggest all"). Computes ``newTestAnchors`` — the existing
   ``bulkAnchors`` filtered by the new helper
   ``filterAnchorsWithNoLithoContacts`` — and passes the filtered
   list to the existing ``handleSuggestAllLitho``. Tooltip names the
   count; toast on the empty case.
3. **"Seed for new tests" button** (SectionsToolbar geology axis,
   next to "Seed"). Computes ``newTestBoreholeIds`` — visible
   boreholes filtered by the new helper
   ``filterBoreholesWithNoGeologyContacts`` — and passes the filtered
   list to the existing ``handleAutoPopulateFromStratigraphy``.
   Tooltip names the count; toast on the empty case.

**Implementation.** New pure helpers in ``utils/newTestFilter.ts``
(``filterAnchorsWithNoLithoContacts`` / ``filterBoreholesWithNoGeologyContacts``)
both O(N+M), unit-tested in isolation. The two toolbar handlers
``handleSuggestNewTests`` / ``handleSeedNewTests`` are thin wrappers
that delegate to existing bulk handlers with a filtered list — zero
backend change, zero new endpoints. Both safe to click twice (second
click finds zero new tests + toasts). The synthetic-contact path
(``cpt_id`` AND ``borehole_id`` both null — pinch-out wedges) is
explicitly ignored: synthetic contacts can't make an investigation
"non-new" because they aren't anchored to one.

**Tests.** F1-F6 + G1-G4 vitest pins in
``utils/newTestFilter.test.ts`` (10 cases — empty inputs, excluded
investigations, synthetic-contact handling, input-order preservation,
elevation_m propagation, CPT-vs-borehole separation). 1059/1059
vitest + tsc clean.

**ux-review pass 2026-05-21** (`ux-reviewer` subagent on the diff).
Three should-fix items applied:

1. *Empty-state shape*: was "stay-and-toast" on zero count — required a
   click to learn there was nothing to do. Now: button disabled when the
   filtered count is zero, with the tooltip carrying the explanation.
   Matches ``docs/ux.md`` § "Loading + error feedback" pattern (the
   trigger should signal its operational state visually before a click).
2. *Toast kind*: zero-count toast was ``'success'`` which is wrong
   semantic — "success" means "the action completed". A no-op is not
   completion. Toast calls removed entirely once the button is disabled
   (handler keeps a defensive ``if (length === 0) return`` guard).
3. *Label shape*: ``(N)`` parenthetical now renders for ALL N when a
   model is active (including ``(0)``), instead of being suppressed at
   zero. Removes the ambiguity between "count is zero" and "count not
   yet computed" and reinforces the disabled visual.

Tooltip wording also revised to engineer-actionable: "All visible
investigations already have litho contacts — import new tests to use
this button" (vs the prior "No new tests — every investigation has
litho contacts already" which left the engineer wondering what to do
next).

Deferred (consider): the reviewer flagged button-order — "for new
tests" should lead because after the first dogfeed pass it becomes
the more-common click. Left for the owner; the existing-first order is
the safe default until the dogfeed user weighs in.

## 91. Stale-TIN straddle-fallback diagnostic — RESOLVED 2026-05-21

The original tracking was a one-liner in CLAUDE.md's Tier E that
collided with the existing ``#68`` (CorrelationEdgesOverlay). Resolved
under a fresh number to clean the bookkeeping at the same time.

**What.** ``AcceptLithoSuggestions._compute_straddle_splits`` falls
back to depth-ordered geology contacts when the parent geology TIN is
stale or absent. The fallback is geometrically correct but less
precise than a fresh TIN sample; the response carries
``stale_tin_fallback_count`` per the contract introduced with #87.
Frontend only logged the count to the debug log — the dogfeed user
never saw a signal that the geology model needed a rebuild.

**Resolution.** Three pieces:

1. ``useGeologicalModel`` accumulates a new ``lithoStaleTinSessionCount``
   state across every accept-litho-suggestions response in the current
   session. Cleared on (a) successful geology rebuild + (b) the
   existing ``clearLithoSuggestions`` reset.
2. Exposed via ``geoModel`` on the ShellContext bus alongside
   ``lithoStaleSurfaceCount`` (mirror surface).
3. ``LithologyInspector`` renders an amber pill
   (``litho-stale-tin-pill``) next to the existing stale-surface
   banner whenever the counter is non-zero, with copy "N stale-TIN
   straddle fallback(s) this session — rebuild geology for precision."
   Singular wording for N=1.

**Tests.** T1-T3 vitest pins in ``LithologyInspector.test.tsx``: pill
renders with the count when > 0 / hidden when 0 / singular wording
for 1. Hook-level integration covered through the existing accept-
litho test paths (all four accept sites bump the counter). 1049/1049
vitest + tsc clean.

**Bookkeeping note.** The previous CLAUDE.md Tier E note listed this
item as "#68" which collided with the docs/debt.md ``#68``
(CorrelationEdgesOverlay uncorrelate menu). Tier E in CLAUDE.md is
updated to drop the stale-TIN reference and the new #68/#91 numbers
no longer collide.

## 87. Orphan litho units — RESOLVED 2026-05-21

Owner directive: **extrapolate from TIN with engineer notification + a
final action to decide; backfill existing orphans on migration.**
Shipped end-to-end this session.

**Backend.** `_compute_straddle_splits` now falls through to TIN
extrapolation when `_parent_fid_for_depth` returns None AND geology
surfaces exist AND the investigation carries an `elevation_m`. New
`_extrapolate_parent_from_tins(target_z, surfaces, inv_x, inv_y)`
samples every non-stale TIN at the investigation, converts the
suggestion's depth-below-ground to absolute z via
`inv.elevation_m - depth_top_m`, and picks the youngest formation
(smallest surface elevation still `>= target_z`) — that's the
formation "active" at the target elevation. The result rides on
`_StraddleResult.extrapolated`. Stale TINs are skipped (the safer
"no parent" over a possibly-wrong extrapolation; engineer rebuilds
to retry). When extrapolation can't resolve (above all surfaces,
outside every footprint, no elevation), the row falls back to the
orphan path with `parent_formation_id=NULL`.

**Schema.** New `geological_formation.parent_extrapolated` boolean
column (NOT NULL DEFAULT false). Stamped at creation by
`_create_litho_formation`; never toggled on find. Cleared by the
inspector's confirm/reassign/detach PATCH. Alembic migration
`d4e5f6a7b8c9` adds the column AND backfills existing orphan litho
units: for each, picks one of its contacts, loads the investigation
+ parent geology model surfaces, runs the same youngest-above-target
extrapolation as the runtime path, and on success sets
`parent_formation_id` + `parent_extrapolated=True`. The migration
inlines its own `evaluate_tin_at` (Alembic must stay independent of
evolving app code) and prints a backfill diagnostic with fixed /
unfixable counts.

**API.** `AcceptLithoSuggestionsResponse` carries
`extrapolated_formation_ids` + `orphan_formation_ids` (additive,
default `[]` for backward compat). `GeologicalFormationResponse`
carries `parent_extrapolated`.
`GeologicalFormationUpdateRequest` accepts `parent_extrapolated` +
`parent_formation_id` so the inspector dialog can Confirm
(clear the flag), Reassign (set new parent + clear flag), or Detach
(parent_formation_id=null + clear flag) in one PATCH.

**Frontend.** New `formatAcceptParentSummary` helper drives one
warning toast per accept ("N parents extrapolated, M unassigned —
review in Lithology inspector"). `useToasts` widened to a third
`warning` kind (amber background). The four accept handlers
(single, all-focus, single-bulk, all-bulk) emit the summary; the
bulk-all variant aggregates across anchors so the user sees ONE
toast at end-of-pass. `LithologyInspector` renders an amber dot
(`Circle` filled) on extrapolated OR orphan unit rows; clicking
opens a new `ConfirmParentDialog` (parent select default-focused,
button label morphs Confirm/Reassign/Detach based on the
selection). Submitting PATCHes both fields in one call and
refetches formations.

**Tests.** 7 new unit tests on `_compute_straddle_splits` (E1 no
geology → orphan; E2 TIN finds parent; E3 above all surfaces →
orphan; E4 outside footprint → orphan; E5 stale TIN skipped; E6 no
elevation disables; E7 contact-based wins over extrapolation). 3
integration tests on the accept endpoint (X1 extrapolated path +
flag + response list; X2 orphan path; X3 PATCH clears the flag).
6 unit tests on `formatAcceptParentSummary` (A1-A6: empty / single /
plural / orphan-only / combined wording). 3 vitest pins on
LithologyInspector (P1 clean rows skip the dot; P2 extrapolated
rows render the dot + open the dialog; P3 Confirm PATCHes both
fields). Existing fixtures got `parent_extrapolated: false`
auto-inserted after `parent_formation_name`.

**Documented residuals (out of scope for #87 itself).**
* The dogfeed user's existing 1 reparented + 2 unfixable orphans
  are now classified — the unfixable ones need engineer review via
  the Detach UX before they enter a `.gmproj` bundle handoff.
* A `CHECK` constraint
  `litho_main_soil_code IS NULL OR parent_formation_id IS NOT NULL`
  is still NOT added — the migration backfilled what it could, but
  the orphan path is intentionally kept open (TIN unavailable, no
  elevation, suggestion above youngest formation). Adding the
  constraint would force engineer-side resolution before commit,
  which the owner has not asked for.

---

> The items below (#97–#103) were filed 2026-05-22 from a litho
> ghost-review dogfeed session. They are a related cluster — the
> "add / edit / merge a litho layer" surface — best done as one or
> two focused passes, not scattered micro-patches.


## 98. Litho ghost-review: "add a layer" discoverability + right-click Split (Tier G — before the Geotech stage)

**What.** Adding a litho layer during ghost review has no discoverable
home. The only path today is the #85 boundary insert-strip — a 6 px
hover-only `<rect>` on the shared boundary *line* between two pending
layers. The owner, dogfeeding, could not find it. Left-click on the
column cannot be the answer — single-click on a ghost layer is
deliberately inert (misclick safety, owner directive 2026-05-22) and
the suggestion overlay covers the click-to-place-contact path beneath.

Owner-approved fix (2026-05-22): add **"Split layer"** to the
pending-layer right-click context menu (alongside Accept / Edit
composition / Reject). It splits the layer in two at its midpoint;
both halves inherit the original composition; the user drag-resizes the
new boundary and edits whichever half differs. A `splitLithoLayer` pure
helper mirrors `insertLithoLayer` (`utils/lithoLayerInsert.ts`);
`onSplitLayer` wires through SectionPanel → SectionsCanvas →
`useGeologicalModel`. The hover boundary-strip stays as the quick
precise option.

Splitting at the exact right-click depth (vs the midpoint) was
considered — deferred as a refinement; it needs screen-coord→depth
math, and midpoint+drag is robust and consistent with how the user
resizes everything else.

**Why deferred.** A real feature (helper + tests + the menu item + a
four-component prop chain). Owner green-lit but surfaced at the tail of
a long session; deserves its own focused implementation.

**When to revisit.** Immediately — owner explicitly green-lit it. The
first task of the next litho-workflow pass.

## 99. Litho drag-resize clamp does not pass through rejected layers — investigated, code correct in the obvious reading (Tier G — verify with owner; G34b pins the mirror)

**What.** Dogfeed 2026-05-22: the user rejected a litho ghost layer,
then tried to drag the boundary of the sand layer below it *up* and
reported they could not pull it past the rejected layer to reach the
layer above.

**Investigation 2026-05-23.** The hypothesis from the original entry —
"clamp picks the bounding neighbour by raw index (`idx±1`) instead of
the next *non-rejected*" — does NOT match the code.
`findCascadeChainAbove` / `findCascadeChainBelow`
(`LithoSuggestionGhostColumns.tsx:243` / `:278`) already skip rejected
layers (`continue` on `rejectedIndices.has(i)`), return the next
non-rejected as the barrier, and `computeDragBounds` clamps at its
NEAR edge — i.e. the layer-above's BASE. A new test **G34b** mirrors
the existing G34 (which only covered base-drag DOWN) for the exact
owner scenario — top-drag UP through a rejected layer — and passes on
first run. The code is correct for the obvious interpretation.

Two remaining possibilities for what the owner actually hit: (a) the
clamp at A.BASE is correct but the visual ("touches A's bottom edge
but does not enter A") read as "couldn't pull onto A"; (b) the actual
topology was different (an accepted layer in the chain, more than one
rejected, or a same-parent cascade case that fired the merge dialog
and was cancelled).

**Why deferred.** Cannot fix what is not reproducing. G34b is the
regression net for the obvious interpretation.

**When to revisit.** Next time the owner hits the symptom — capture
the exact layer set (lithologies, accepted/rejected/pending, parent
formations) so the scenario can be re-modelled. If (a) is the real
answer, the followup is a UX nudge (e.g. a visible boundary glyph at
the clamp) rather than a logic change.

## 100b. Inspector-select sticky reveal of correlation edges (Tier D — follow-on to #100)

**What.** #100 shipped the hover-to-reveal half of the design (chip
hover → that body's edges + same-body chip halo appear). The other
half — clicking a formation in the `LithologyInspector` to STICKY-
reveal that body's edges across the section — was scoped out because
it needs new cross-component state: `selectedFormationId` shared
between the inspector and the `CorrelationEdgesOverlay`. Hover is the
exploratory gesture; sticky-select is for STUDYING a body without
keeping the cursor parked on a chip.

Shape when picked up: extend `useShellContextValue` (or equivalent
shell context) with `selectedFormationId: string | null` and a setter;
add an `onClick` handler on each `LithologyInspector` formation row
that flips it (toggle if already-selected); add `selectedBodyOrdinal:
number | null` prop on `CorrelationEdgesOverlay` that ORs with the
local hover state when deciding which body's edges to render. Visual
treatment is identical to the hover path (halo + lines); only the gate
shape changes.

**Why deferred.** v1 shipped hover-only to keep the change focused.
Adding a shared selection state is small (~30 lines) but spreads
across three files (inspector, shell context, overlay) and deserves
its own commit.

**When to revisit.** Next litho-workflow UX pass, or when a dogfeed
session has the user wanting to "pin" a body's edges to study them
without holding the cursor.

## 101. Litho lens / pinch-out body representation — Position 4: correlation-implies-absence + inference (Tier G — session 2026-05-24 blocker)

**⚠ ARCHITECTURAL PIVOT (owner directive 2026-05-24, late session).**
The Slices 1-7 build that landed earlier today (46 commits on
``develop``, reviewer-clean) implemented Approach C — explicit
lens-as-entity with a "Mark as lens" gesture and per-lens absence
rows. Mid-build the owner identified the design dissonance: **for
Flanders without faulting/folding, lens-ness is implied by the
correlation topology + corridor-scoped observation data — the user
should not have to declare a lens, only correlate normally**. The
"Mark as lens" gesture is redundant ceremony for the common case
and only earns its keep for naming, perpendicular-companion
attachment, and overriding inferred absences when complex geology
(faulting / unconformity / erosion) makes the inference wrong.

The decision: **Position 4 — auto-infer lenses from correlation
topology + observation data; keep the explicit gesture as an
override/naming layer.** The Approach C build gets refactored on
top of the just-landed clean base. The section-local wedge
geometry from Slice 2 carries forward unchanged; the use case +
schema + dialog get rebuilt around the inference model.

### Position 4 architecture

**Inference engine.** A new pure-domain service in
``src/groundmodel/domain/services/lens_inference.py``. Runs after
every correlation-edge mutation and observation-data mutation.
For each body (a connected component in the
``litho_correlation_edge`` graph, identified by
``(parent_formation_id, litho_main_soil_code, body_ordinal)`` from
the existing resolver), for each in-corridor investigation that
lacks a contact for the body, the engine checks
``ObservationLayerOrm`` rows at that investigation against the
body's depth range. If a different lithology is observed at the
overlapping depth, the engine writes a
``formation_absence(formation_id, investigation_kind,
investigation_id, source='inferred')`` row. Idempotent:
re-running produces the same set. Preserves rows with
non-``'inferred'`` ``source`` (does not overwrite user intent).

**Schema reshape.**

| Before (Approach C) | After (Position 4) |
|---|---|
| ``litho_lens(id, app_project_id, model_id, parent_formation_id, name, primary_section_id, ...)`` — lens IS the body | ``litho_lens(id, model_id, formation_id, body_ordinal, name, primary_section_id, companion_section_id, ...)`` — lens is METADATA attached to a body identified by ``(formation_id, body_ordinal)`` |
| ``litho_lens_absence(id, lens_id FK, investigation_kind, investigation_id)`` — absence scoped to a specific lens | ``formation_absence(id, formation_id, investigation_kind, investigation_id, source)`` — absence scoped to a formation; bodies derive their absences via corridor-membership of the body's contacts vs the formation's absence rows |
| ``formation_contact.lens_id`` FK column | **DROPPED.** Body identity is computed by the resolver, not stored on the contact. |

The ``source`` enum starts at v1.0 with ``'inferred' | 'manual' |
'observed'``. Phase 5+ extensions: ``'fault' | 'unconformity' |
'erosion'`` — when present, the absence is NOT a lens-edge
absence and wedge geometry does NOT apply at that investigation.

**Q1/Q2/Q3 owner directives (re-checked under Position 4):**

* **Q1 (multi-lens-per-formation) — STILL HOLDS.** Two clay
  drapes at different elevations within the same parent
  formation become two distinct ``body_ordinal`` values via the
  existing resolver. Each can have its own slim ``litho_lens``
  metadata row attached (name, companion) or stay unnamed.
* **Q2 (absent-investigation auto-prepopulation) — REPLACED BY
  AUTO-INFERENCE.** Under Approach C, Q2 was "the dialog
  pre-populates checkboxes from segmenter output". Under Position
  4, the inference engine writes ``formation_absence`` rows
  directly — no dialog needed for the common case. The original
  positive-evidence guard from Q2 stays: the engine ONLY infers
  an absence when there's a different lithology observed at the
  body's depth range. No data → no inference (UNKNOWN, not
  ABSENT).
* **Q3 (perpendicular companion fallback length) — UNCHANGED.**
  ``max(2 × buffer_m, 100m)`` when no investigation is found on
  a side. The companion-creation gesture moves from the lens
  creation flow to the "Inspect lens body" panel.

**Gesture surface.**

* **Default (Flanders, zero friction):** user correlates; the
  inference engine writes ``source='inferred'`` rows; wedge
  synthetic contacts materialize via the existing Slice 2
  geometry; section renders inferred wedges with a PROVISIONAL
  visual style (dashed outline, ~40% fill opacity, small "auto"
  badge).
* **Explicit gestures (override / naming / companion):**
  right-click on a body in the section view → **"Inspect lens
  body"** panel. Shows the body's present columns, inferred /
  manual / other absences with their ``source``, wedge tip
  locations. Actions:
  - **Name this lens** → creates a ``litho_lens`` metadata row
    attaching the name to ``(formation_id, body_ordinal)``.
  - **Create perpendicular companion section** → existing Slice
    4 endpoint, re-keyed by ``(formation_id, body_ordinal)``.
  - **Confirm absences** → promotes ``source='inferred'`` rows
    to ``source='manual'``; the wedges re-render with solid
    style. Lock-in gesture.
  - **Override absence at column X** → change ``source`` to
    ``'fault'`` / ``'unconformity'`` / ``'erosion'`` (Phase 5
    enum extension); wedge geometry no longer applies at that
    column. v1.0 ships ``'inferred' | 'manual' | 'observed'``
    only — extending the enum is a small follow-up migration.

**Visual treatment in the section view.**

* ``source='inferred'`` absences → dashed wedge outline, ~40%
  opacity, "auto" badge near the body
* ``source='manual'`` absences → solid wedge outline, ~70%
  opacity, no badge (user-confirmed)
* ``source='observed'`` absences → same as ``'manual'`` for
  rendering (observed = positive evidence the user can review
  but doesn't need to confirm)
* Phase 5+ non-lens absence types render with their own iconography
  (fault tick, unconformity squiggle) and no wedge tip

**The "Mark as lens" dialog goes away.** Replaced by the right-
click "Inspect lens body" panel. The companion-offer modal stays
(triggered from the panel's "Create perpendicular companion"
action).

**Why this is better than Approach C.**

1. **Matches LeapFrog UX feel** — model emerges from data; no
   redundant gesture
2. **Single source of truth** — body identity comes from the
   resolver; lens metadata is decoration, not authority. Editing
   correlation → lens topology updates automatically.
3. **Future-proof for complex geology** — the ``source`` enum
   extends to fault / unconformity / erosion as Phase 5
   geology-aware features land
4. **Flanders-first scoping** — the inference engine is
   geologically sound for subhorizontal Cenozoic strata; complex
   geology gets the override path

### What from Approach C carries forward

| Slice | Fate |
|---|---|
| Slice 1 — ``litho_lens`` table | **Slim.** Drop ``parent_formation_id``; keep id / model_id / formation_id / body_ordinal / name / primary_section_id / companion_section_id. Drop ``formation_contact.lens_id``. |
| Slice 1 — ``litho_lens_absence`` table | **Rename + reshape** to ``formation_absence`` with ``source`` enum; drop ``lens_id`` FK, add ``formation_id`` + ``source``. |
| Slice 2 — ``lens_pinch_out_geometry.py`` + 24 unit tests | **KEEP UNCHANGED.** Section-local wedge math is exactly what the inference engine triggers. |
| Slice 3 — ``CreateLithoLens`` use case | **Replace** with ``RecomputeFormationAbsencesForBody`` (driven by the inference engine) + a thin ``NameLensBody`` for the explicit naming gesture. Wedge-tip materialization moves to a separate ``MaterializeWedgeTipsForFormation`` triggered by absence-mutation hooks. The atomicity + scope-leak + modelId fixes from the post-reviewer pass port to the new use cases. |
| Slice 4 — perpendicular companion endpoint | **Re-key.** Lookup by ``(formation_id, body_ordinal)`` instead of ``lens_id``. Logic unchanged. |
| Slice 5 — ``MarkAsLensDialog.tsx`` + menu wiring | **Throw out.** Replaced by ``InspectLensBodyPanel.tsx`` triggered from right-click on a body. The ``CompanionOfferDialog.tsx`` from the fix-up pass survives — same trigger, different upstream. |
| Slice 6 — list endpoint | **Adapt.** Returns auto-detected (every body with absences in corridor) + named (with metadata row) lenses. |
| Slice 7 — bundle persistence | **Refactor schema** to match new tables (``formation_absences[]``, slim ``litho_lenses[]``, no ``lens_id`` on contacts). |

### Honest cost

Estimated ~3 days of focused work. The Slice 2 geometry + Slice 4
companion endpoint logic + Slice 7 bundle structure carry
forward unchanged or near-so. The refactor target is the schema +
the use cases + the dialog UX.

### Why blocking now (unchanged)

Without lens support the litho model is a half-truth for any real
BE/NL dataset. Every other litho-stage UX fix is downstream of the
lens architecture. Now is the right time to land Position 4 — pre-
ship amnesty is in effect (no upgrade chain needed), the schema can
be cleanly reshaped, no external users to break.

### When to revisit

Now. Sequence: refactor in place on top of the just-landed clean
base. The 46 existing #101 commits stay on ``develop``; the
refactor is additive + subtractive on top.

---

## 101 (historical — superseded by Position 4 above). Litho lens / pinch-out body representation — Approach C scoped (was Tier G blocker, now historical)

**What.** The litho (and geological) model currently assumes
layers / surfaces are laterally continuous across the investigation
set. Real geology has **lenses** — a body present at some
investigations that pinches out laterally before reaching others.
There is no model representation for "this sand unit is present here
and here, absent there." The user-invoked pinch-out wedge tool (shipped
2026-05-18) does deterministic dip-extrapolation-to-crossing for a
*single terminal wedge edge* — it is NOT a general lens; true
interfingering lens geometry between control points is the harder
facies-geometry problem.

Open question to resolve before building: how is a lens stored — a unit
flagged absent at certain investigations? a unit whose surface may
terminate inside the corridor? — and how do the TIN build, the section
slice, and the exporters treat a body that is not everywhere.

**Idea — perpendicular section auto-create (owner, 2026-05-22).** A lens
is a 3D body; a single cross-section only constrains it in one
direction. When the user draws a lens on a section, pop up an offer to
**auto-create a perpendicular cross-section** through it — perpendicular
to the original section, centred on the lens. The perpendicular section
auto-extends its length until it reaches an investigation — ideally one
on *each* side of the lens, so a real test brackets the lens extent in
the orthogonal direction (fall back to one side, or a default reach, if
the other side has no test in range). Two perpendicular sections then
give orthogonal control points and make the lens body genuinely
3D-modellable.

Guard: **at most one perpendicular section per lens.** Before offering
the popup, check whether the lens already has a perpendicular section
and suppress / disable the offer so the user cannot create two. This
implies the lens is a first-class entity that *owns* its sections — a
concrete pull on the "how is a lens stored" question above: the store
needs a lens id that a cross-section can point back at, plus a flag
marking a section as the lens's perpendicular companion.

**Resolved design questions (owner, 2026-05-24).** Dogfeed surfaced
that real BE/NL fluvial-deltaic data cannot be modelled as continuous
units — the user reports "before lens is wired, I can't make a litho
model." Three open questions answered, picking **Approach C — skinny
Lens entity, deferred TIN/export**:

* **Q1. Multi-lens-per-formation.** Two clay lenses at different
  elevations in the same column → **two LithoLens entities sharing
  the same parent formation**. Each lens has its own id, own bracket
  of contacts, own perpendicular companion section. The formation's
  ``litho_main_soil_code`` stays a property of the formation; the
  lens carries identity and absence semantics.
* **Q2. Absent-investigation pre-population.** When the user clicks
  "Mark as lens" on a clay unit in column A, the dialog
  **auto-pre-populates** the absent set from the segmenter result:
  any in-corridor investigation with positive evidence of a
  different lithology at the same depth range is flagged ABSENT by
  default. Columns with no test in range or with the same lithology
  default to PRESENT/UNKNOWN. The user overrides with per-
  investigation checkboxes before submit. Auto-detection MUST require
  positive evidence (different lithology at overlapping depth) — never
  guess absence from no data.
* **Q3. Perpendicular-section auto-extension fallback.**
  ``max(2 × buffer_m, 100 m)`` when no investigation is found on a
  side. Ensures the companion section is always meaningful at
  section-view scale even when the lens sits at the corridor edge.

**Approach C scope (the build):**

| Layer | Change |
|---|---|
| Schema | New ``litho_lens(id, project_id, model_id, parent_formation_id, name)``. ``formation_contact`` gets nullable ``lens_id`` FK. ``cross_section`` gets nullable ``companion_lens_id`` FK + ``is_lens_companion bool``. New join ``litho_lens_absence(lens_id, investigation_id, investigation_kind)``. |
| Backend | ``CreateLithoLens(contacts[], absent_investigation_ids[])`` use case — creates lens, tags contacts, records absences. ``CreatePerpendicularCompanion(lens_id)`` use case — computes perpendicular bearing through the lens centroid, auto-extends per Q3 fallback, creates the section, links via ``companion_lens_id``. ``ExtrapolatePinchOut`` extended to accept optional ``lens_id`` so wedge tips inherit lens identity. |
| Frontend | Right-click menu item on a litho unit: **"Mark as lens"** → dialog with the corridor's investigations + pre-populated absence checkboxes (Q2) + lens name field. Submit → POST lens + offer to auto-create the perpendicular companion. Sections marked ``is_lens_companion=true`` get a small badge in the header so the user knows their origin. |
| TIN | Untouched in this pass — lens contacts contribute to the parent formation's surface as today. Lens-aware TIN math (closed body geometry) stays Phase 5. |
| Export | Untouched. DXF / Plaxis still emit lens as a continuous formation that pinches via wedges — engineering-defensible, not geologically airtight. Lens-aware export is Phase 5. |
| Rendering | Polygon-ribbon correlation (#121) becomes lens-aware: edges tagged with ``lens_id`` get stronger fill (~35% opacity) + dashed top/base boundary (signals "closed body"). Ribbon endpoints respect pinch-out tip contacts so a ribbon reaching an absent column thins to zero at the wedge tip. |
| Bundle | ``litho_lenses[]`` + ``litho_lens_absences[]`` arrays in ``.gmproj`` v3. ``companion_lens_id`` on every section; ``lens_id`` on every contact. Additive — opens cleanly in builds that ignore it (still in pre-ship amnesty window). |

**Pre-build pinch-outs: section-local math at mark-time, no
deferred resolve (owner, 2026-05-24 dogfeed, revised after the
LeapFrog comparison).** The first design — ghost contacts with
null synthetics resolved at Build time — was rejected: it forces
the user to revisit after build to see the lens materialise, and
the partial-geometry state pollutes the bundle round-trip and the
section renderer. LeapFrog's UX promise is "enter data, see
results, no revisit"; ghost-resolve violated it.

The revised design: **compute the wedge tip section-locally at
mark-time, in 2D, using only the data already in front of the
user.** The lens-marking gesture has far more context than the
geology right-click "Extrapolate pinch-out…" gesture and does NOT
need a TIN:

* The section line geometry (start/end (x, y), EPSG) is on the
  cross-section row.
* The present-column contacts for the pinching lithology on this
  section, projected onto the section line, give a 2D polyline
  for the formation in (along_m, elevation_m) space.
* The present-column contacts for the deeper *target* lithology
  (parent formation's next-older neighbour by `display_order`)
  give a parallel polyline.
* The absent-column section position is a known scalar (the
  column's along_m).
* Linear regression / dip-along-section between the two adjacent
  present contacts on the pinching side gives the local dip;
  intersect with the target polyline → wedge tip in (along_m,
  elevation_m). Project back to world (x, y) using the section
  line direction vector → `synthetic_x`, `synthetic_y`.
  Elevation comes straight from the intersection. **All three
  synthetic-* fields populated at mark-time.**

New use case `ComputeLensPinchOutTipsSectionLocal(lens_id,
section_id)` — frontend or backend, doesn't matter for the math
(the inputs are all in the cross-section's already-loaded state).
Backend is cleaner for atomicity: one transaction commits the
lens + absences + synthetic contacts in one POST. Result:
**marking a lens commits a fully-resolved synthetic contact row
with non-null synthetics; the section renderer shows the wedge
immediately; no revisit.**

When the user later clicks Build, `compute_tin` includes the
lens synthetic contacts as ordinary FormationContact rows — no
special resolver, no second compute path, no flag to track. The
two computation methods (TIN-based for geology right-click,
section-2D for lens-mark) produce comparable rows; the lens path
just doesn't gate on TIN existence.

**Why this is cleaner than ghost-resolve:**

| Concern | Ghost-resolve (rejected) | Section-local at mark (chosen) |
|---|---|---|
| Revisit after Build | Required | None |
| Synthetic-contact states | Two (ghost + resolved) | One |
| Build step special path | `resolve_ghost_pinch_outs` | None — synthetics are ordinary rows |
| Bundle carries partial geometry | Yes | No |
| User mental model | "Marked → wait → resolved" | "Marked → done" |
| Math source of truth | TIN (for resolve) | Section-2D at mark; TIN at slice (independent) |

**Edge cases.** Lens at corridor edge (only one adjacent present
column): dip-extrapolation toward the absent side using the same
direction-heuristic the geology pinch-out uses today, just on
the section polyline instead of the TIN slice. Target lithology
missing on this section: explicit error at mark time, same as
the TIN path produces today. New investigation added later:
existing lens synthetics stay valid (they're real (x, y, elev)
rows tied to the lens id); the user can edit the lens to
recompute if the new column changes the inferred geometry.

**The post-#118 bandage stays.** The disabled-state on the
geology right-click `Extrapolate pinch-out…` gesture is correct
for that gesture (it is genuinely TIN-dependent — single
contact, no lens, no explicit target). After #101 ships, that
gesture remains TIN-gated; the lens-marking path is the new
primary affordance for pre-build pinch-outs.

**What Approach C buys immediately.** Lens has identity; the
perpendicular companion section is auto-created with the right
geometry; pinch-outs are tagged with the lens; multiple distinct
lenses of the same lithology don't collide; lens pinch-outs are
computed at mark-time in section-2D so the user sees the wedge
immediately with no revisit required after Build; the bundle
round-trips.

**What it does NOT yet do.** Lens-aware closed-body TIN (Phase 5),
lens-aware DXF/Plaxis export (Phase 5), cross-section lens correlation
("lens A on section 1 = lens B on section 2 because they're the same
3D body" — Phase 5 — until then the user manually correlates each
lens body via the perpendicular companion).

**Why blocking now.** Without lens support the litho model is a
half-truth for any real BE/NL dataset. Every other litho-stage UX
fix is downstream of the lens entity (the polygon-ribbon
rendering, the body-hover, the section header chrome all want to
know about lens identity).

**When to revisit.** Now — this is the lead session-2026-05-24
blocker. Sequence: #118 (pinch-out for Litho — half day) → this
(~5–7 days) → #119 / #120 / #121 / #122 in any order.

## 102. Merge button for a same-lithology boundary (Tier G — before the Geotech stage)

**What.** Dogfeed 2026-05-22: after "Suggest litho", the segmenter
sometimes produces adjacent layers with the *same* lithology stacked on
each other (sand on sand). This is by design — the segmenter splits on
Robertson zone integer changes, which correlate with packing-density
(NAD-class) transitions, and the no-auto-merge directive (#74 history)
keeps those splits because the geotechnical model needs them. But the
user wants a way to merge them when a split is *not* wanted.

Owner directive (2026-05-22): **not** automatic — a user-initiated
**Merge** action. When a boundary (ghost or committed contact) has the
same lithology on both sides, offer a "Merge" affordance; the user
decides, layer by layer. This reconciles with the no-auto-merge
directive: the splits are still produced (the geotech model needs
them); merging is an explicit user choice.

Shape: a small merge button / context-menu item that appears only on a
same-lithology boundary; merging removes the boundary and unions the
two layers. The resulting composition / NAD handling (dominant or
re-aggregated) is a sub-decision for the implementing pass.

**Why deferred.** A new gesture on the boundary surface; small but needs
the merge-composition rule decided. Not a blocker — the user can already
drag-resize one layer to absorb the other.

**When to revisit.** The litho-workflow UX pass — natural companion to
#98 (the boundary is the shared surface).

---

> The items below (#104–#117) were filed 2026-05-22 from a six-agent
> full-codebase audit (code-quality+logging+tests / architecture+future-
> proofness / security / cleanliness / UX / documentation). ~67 raw
> findings consolidated into 14 items. None overlap the existing
> backlog. All sit BELOW the Geotech-stage gate — they are tech debt,
> hardening and polish, not litho-stage-finishing work.

## 104. Three-level export gap — snapshots carry geological-level data only (Tier D — Phase-4 MVP export step)

**What.** `GroundModelSnapshot` and `SectionSnapshot` carry only
`formation_id` / `formation_name` from the geological model. Neither
carries `litho_main_soil_code`, `nad_class`, `instance_ordinal`, or the
three-level hierarchy. So `PlaxisExporter`, `DxfSectionExporter`,
`PlaxisSectionExporter` export the geological level only — the
lithostratigraphic level is not in any exporter output, and the
geotechnical level will not be either once it lands. ("The litho
stage isn't done until a user can build a litho without annoyances" —
owner 2026-05-23. The build path works; the dogfeed papercuts in
Tier G + this export gap are both part of finishing it.)

**Why deferred.** The v1.0 MVP gate's step 5 is "export the three-level
model geometry with unit identifiers". The build paths for litho /
geotech contacts exist; the snapshot-assembly step does not project
them into the export contract. Not yet built because the geotech stage
itself is not built — but the litho-level gap is real today.

**When to revisit.** Phase-4 MVP export step, after the geotech stage.
Extend `SectionSnapshot` + `BuildSectionSnapshot` to include litho-level
contacts keyed by `model_id`; `SectionFormation` gains optional
`litho_main_soil_code` / `nad_class`; exporters pick the level from the
`model_id` argument they already take. No schema change.

## 106. Application layer is welded to the ORM (Tier D — clean-architecture leak)

**What.** ~20+ geology use cases (`accept_litho_suggestions.py`,
`create_formation_contact.py`, `rebuild_model_surfaces.py`,
`recompute_formation_surface.py`, `validate_model_crossings.py`, …)
import ORM classes, run `select(...Orm)` queries inline, and in several
cases RETURN `*Orm` objects as their public type (`create_formation_
contact -> FormationContactOrm`, `update_formation_contact`,
`extrapolate_pinch_out -> list[FormationContactOrm]`). The router then
hands the ORM object straight to FastAPI serialisation. The domain
layer is clean (zero infra imports — verified); the application layer
is the leak. Returning ORM types also means a new ORM column silently
appears on the API wire (the live-API analogue of #47).

**Why deferred.** The geology use cases grew alongside the ORM;
`GeologyRepository` exists but covers ~30% of the query surface. Not a
runtime bug — a structural deviation from the stated layer rule.

**When to revisit.** Before Phase-5 statistics work (which adds bulk
queries that must be testable in isolation). Cheapest first step: add
`FormationContactResult` dataclasses for the three ORM-returning use
cases so the API boundary stops leaking.

## 107. Schema integrity hardening — constraints, FKs, indexes (Tier D)

**Partially resolved 2026-06-01 (waves 1 + 2).** All landed migrations:
`a1c2d3e4f5a6` (domain-invariant CHECKs: `geological_model.kind`,
`formation_contact.source`, `body.body_ordinal >= 0`,
`body.extent_<side>_kind` enums), `b2d3e4f5a6b7` (kind ↔
`parent_geological_model_id` NULL invariant — geological MUST have NULL
parent, litho/geotech MUST have non-NULL parent), `c3e4f5a6b7c8`
(partial-unique dedup indexes on cpt + borehole `(app_project_id,
project_id, test_id) WHERE app_project_id IS NOT NULL`), `t4u5v6w7x8y9`
(partial-unique `UNIQUE(app_project_id, kind) WHERE is_active = TRUE` —
at most one active model per project per kind; dedup-correction pass for
any pre-existing duplicate-active rows), `u5v6w7x8y9z0` (read indexes:
`idx_formation_contact_model_cpt` on `formation_contact(model_id, cpt_id)`,
`idx_litho_contact_corr_model_contact_a/b` on
`litho_contact_correlation_edge(model_id, contact_a_id)` and `…contact_b_id`).
13 integration tests pin all constraints at
`tests/integration/db/test_schema_invariants.py`.

**Still open:**
- `geological_formation` litho-column co-nullation CHECK: the intended
  `litho_main_soil_code IS NULL OR parent_formation_id IS NOT NULL`
  invariant CANNOT be added as a DB constraint yet. `AcceptLithoSuggestions`
  legitimately creates `GeologicalFormationOrm` rows with
  `litho_main_soil_code` AND `parent_formation_id=NULL` as an "orphan
  accept" fallback when no geological TIN surfaces exist (documented as
  `orphan_formation_ids` in `AcceptLithoSuggestionsResult`; debt #87 tracks
  the manual-confirm/reassign flow). Adding the CHECK would break this
  path. Revisit when debt #87 lands and the accept-path is redesigned to
  disallow orphan units entirely, or when the accept path is made to always
  assign a parent.
- `cpt.app_project_id` / `borehole.app_project_id` are `nullable=True`
  (Phase-1 leftover) and no table has a real FK to `project` — orphan
  rows are possible. Folds into the backwards-compat re-arm (#3 / #47).

**Why deferred (remaining).** The orphan-accept path is an intentional
application-layer design (not a schema bug); the app_project_id NOT NULL
+ FK work must be coordinated with the backwards-compat re-arm (#47)
and a one-time orphan/NULL backfill.

**When to revisit.** Co-nullation CHECK: when debt #87 (orphan-unit
inspector + reassign/detach flow) lands and the accept path is hardened.
FK + NOT NULL: the backwards-compat re-arm (#3 / #47).

## 108. RESOLVED 2026-06-01. Documentation refresh — docs/ + CLAUDE.md drifted from the shell + Phase-4.
Surgical pass on all four debt-entry targets:
- `docs/desktop.md`: directory tree rewritten to reflect the staged-screen shell
  (AppShell / StageSpine / stages/*, hooks/*, shell/); Sidebar.tsx deletion noted;
  `projectFile.ts` format-version clarified (v3 outer file / v4 bundle payload).
- `docs/api.md`: v2→v4 bundle reference updated; SSE streaming import (CPT + borehole),
  PDF export, DEM sample endpoint all added; litho layers / contact-correlations /
  accept-litho / batch-accept / seed-litho block added; bodies block expanded from
  one-liner to full per-endpoint prose (bodies/detect, suggest-pinch-outs, PATCH/DELETE
  bodies/{bid}, extents/{side}, boundary GET/PUT, perpendicular-companion,
  formations/{fid}/absences GET/POST).
- `docs/parsers-dov.md`: HTTP/2 claim corrected to HTTP/1.1 (no-op confirmed live
  2026-05-17); timing table updated to ~54 s / 316 deep CPTs with payload-bound note;
  module layout expanded to cover `parsers/dov/`, `parsers/cpt/dov/`,
  `parsers/borehole/dov/`, `parsers/lab/dov/`; borehole + VB import paths documented.
- `src/groundmodel/infrastructure/parsers/dov/dov_http.py` docstring: HTTP/2 bullet
  corrected (no-op on live DOV; retained so a future upgrade is auto-picked-up).
- `src/groundmodel/api/schemas/project/project_bundle.py` docstring: v3→v4 bundle shape.

Partial / residual still open:
- CLAUDE.md Project Structure tree + Domain Model (Pressuremeter/SPT/VST note) — not
  touched; CLAUDE.md is the canonical living document and those sections are already
  flagged-and-context-noted in the codebase; editing them risks diverging from the
  owner-maintained narrative.
- `docs/geology-stage-architecture.md` + `docs/ui-shell-architecture.md`
  "pre-implementation" tag — those files were not updated; their drift is lower-impact
  (internal architecture notes, not the orientation docs a second contributor reads
  first). Filed as residual for a future pass before the coworker binary.
- ~5 source-comment `InterpretationPane` references and `ux.md` — not updated here;
  scope of `InterpretationPane` removal cleanup is outside the three orientation docs
  this entry targeted.

## 109. BaseExporter ABC split — RESOLVED 2026-06-01

Replaced the single `BaseExporter` ABC with two shape-correct ABCs:
`ProjectExporter(GroundModelLogger, ABC)` for project-wide exporters
(`PlaxisExporter`, `DSheetExporter`, `GeoStudioExporter`) and
`SectionExporter(GroundModelLogger, ABC)` for section-scoped exporters
(`DxfSectionExporter`, `PlaxisSectionExporter`). The `# type: ignore[override]`
suppressions are gone — the ABC parameter type matches each concrete class.
`SectionPdfReportExporter` keeps direct `GroundModelLogger` inheritance
(two-argument `export(snapshot, metadata)` is incompatible with the ABC).
`base_exporter.py` deleted. 1133 unit tests green.

## 110. Export-path duplication — RESOLVED 2026-06-01

Backend duplication fully addressed (frontend `App.tsx` handlers out of scope
for this backend-only debt item):

- **Plaxis helpers** (`_emit_imports_and_connect`, `_emit_materials`,
  `_emit_global_layers`, `_material_variable_name`, `_py_str`): extracted to
  `plaxis_script_helpers.py` as module-level functions behind a
  `_HasNameAndOrder` Protocol. `PlaxisExporter` and `PlaxisSectionExporter`
  both import from it — a Plaxis-API change is now one edit. Subsumes #169.
- **Section-export router boilerplate** (`BuildSectionSnapshot` +
  `ParseError→404` + CRS guard + safe filename stem): extracted to
  `_build_export_snapshot()` and `_section_safe_name()` in `cross_section.py`.
  Each of the three section-export handlers (`/export/dxf`, `/export/pdf`,
  `/export/plaxis2d`) is now 2-3 lines of unique logic.

## 111. useGeologicalModel duplication — litho-accept block + bypassed helper — RESOLVED 2026-06-01

The two halves are both closed:

**Payload half (shipped 2026-05-29):** `utils/lithoAccept.ts` —
`buildLithoAcceptBody` / `lithoAcceptTuningParams` / `recordCreatedRows`.

**Ghost-mutation half (shipped 2026-06-01):** `_updateGhostEntry` extended
to accept a function form `(existing: BulkAnchorGhost) => Partial<BulkAnchorGhost>`
so callers whose partial depends on existing state (Set mutations) can compute
it inside the setState callback and stay atomic. Five sites migrated:
`handleRejectBulkLitho`, `handleAcceptBulkLitho`, `handleRejectLithoSuggestion`,
`handleAcceptLithoSuggestion`, `handleAcceptAllLithoSuggestions`.
Two "unreject" sites kept as direct `setGhostsByAnchor`: they guard on
`!rejected.has(idx)` and return `prev` unchanged — `_updateGhostEntry` always
produces a new Map and cannot short-circuit the no-op case.

The "extract `applyAcceptResult(...)`" idea was evaluated and declined: the
~40-line "post-success block" varies enough across the four accept handlers
(different ghost-marking shape, different undo labels, `handleAcceptAllBulkLitho`
uses a `BatchAcceptLithoSuggestionsResponse` rather than the single-accept type)
that extraction would require passing ~6 callbacks — more plumbing than the
inline code it replaces. The counterweight rule applies.

## 112. Bundle / restore + API input bounds — RESOLVED 2026-06-01

All three gaps closed:
- `_MAX_CPT_SERIES_ROWS = 100_000` added to `project_bundle.py`; the
  restore loop checks `_series_row_count(cpt_payload)` and drops the
  series (CPT row is still inserted) with a WARNING when over-cap.
- `BodyBoundaryWriteRequest.upper_nodes` / `lower_nodes` capped at
  10 000 via `Annotated[list[…], Field(max_length=…)]` (S3 folded in).
- `export_section_pdf` `title` / `author` / `notes` query params capped
  at 256 / 256 / 4096 chars via `Query(max_length=…)`.
- The `_validate_tin_payload` structural check (malformed tuples crash
  the TIN code) was deferred — the existing size cap on `vertices` /
  `triangles` is sufficient for the pre-coworker-binary threat model;
  the structural check can land in a future hardening pass.
20 unit tests pin all three surfaces in `test_security_hardening.py`.

## 113. Security pattern-risk cleanup — RESOLVED 2026-06-01

All five items closed:
- `Settings.secret_key` default: `_warn_on_default_secret_key` model
  validator emits `RuntimeWarning` when key is still `"change-me"`. The
  auth layer (#3/#4) hardens this to an assertion.
- CQL injection guard: module-load `assert all("'" not in p …)` against
  `DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS` in `dov_scalar_observation_client.py`.
  All 9 current parameter values are quote-free (confirmed live).
- `DOV_VALID_PERMKEY_RE`: switched from `^…$` (line anchors) to `\A…\Z`
  (true string anchors), consistent with `virtuele_boring_client.py`.
- `MapView.tsx` `attribution` binding: comment added at all three sites
  naming the XSS risk and DOMPurify as the fix if attribution goes dynamic.
- IPC `window:set-title`: `title.slice(0, 256)` before `mainWindow.setTitle`.
Unit tests in `test_security_hardening.py` pin items 1–3; items 4–5 are
comment / truncation changes verified by code review.

## 114. Large-file readability — bundle restore fn + ContactsLayer (Tier E)

RESOLVED 2026-06-01. `_restore_project_bundle_impl` decomposed into 11
named async phase helpers (`_restore_cpts`, `_restore_boreholes`,
`_restore_formations`, `_restore_geotech_units`,
`_build_valid_formation_ids`, `_restore_geological_models`,
`_restore_cross_sections`, `_restore_investigation_reviews`,
`_restore_bodies`, `_restore_formation_absences`,
`_restore_contact_edges`, `_restore_lens_shapes_and_nodes`) plus a
`_uuid()` coercion helper. The orchestrator now reads as a linear
phase-sequence. 16 bundle integration tests + 1133 unit tests green.
`ContactsLayer.tsx` Stage-A useMemo body extracted to exported module-level
`computeSlabsAndPolylines()` pure function (unit-testable without
mounting). 1539 Vitest tests green, tsc clean.

## 116. Test coverage gaps — RebuildModelSurfaces + SectionPdfReportExporter (Tier D)

RESOLVED 2026-06-01. `tests/integration/application/test_rebuild_model_surfaces.py` (RS1–RS7: happy path, empty model, stale-flag clear, orphan stale surface, age-reorder direction, litho kind-scope guard, idempotent rebuild) and `tests/integration/exporters/test_section_pdf_report_exporter.py` (PE1–PE6: valid PDF magic, Info-dict metadata, multi-investigation, empty section, notes block, no-contacts) added. RS5 is `xfail(strict=True)` — it exposed a direction bug in `_reorder_by_age` (see #175); the xfail becomes the regression guard once #175 is fixed.

## 118. Wire pinch-out gesture for the Litho axis (Tier G — session 2026-05-24 blocker)

**What.** `SectionsCanvas.tsx:984` gates `pinchOutGhostState` behind
`if (isLitho || !activeGeologicalModel) return undefined`, so the
right-click → "Extrapolate pinch-out…" gesture is unreachable on the
Litho axis. Backend (`POST .../contacts/pinch-out`,
`ExtrapolatePinchOut`) is formation-id-keyed and works fine for litho
formations — only the frontend gate needs to flip. The
target-formation derivation (next-older by `display_order`) already
runs against `axisFormations` which is axis-swapped, so it should
drop in unchanged.

**A4 implication (2026-05-30).** Shape A made litho's source of
truth ``litho_layer`` with an anchor XOR constraint. Pinch-out FCs
are anchor-less synthetics (``borehole_id`` AND ``cpt_id`` NULL,
carrying ``synthetic_x/y/elevation_m``) — they don't fit the LL
shape. The LL→FC trigger and the A4 historical-delete migration
both explicitly skip anchor-less rows so existing pinch-out
infrastructure on geological models keeps working. Re-arming this
debt item for litho needs a design call:
* Option A — keep litho pinch-outs on ``formation_contact``
  permanently (carve-out forever). The FE branch on isLitho that
  routes /contacts vs /layers for pinch-out already exists post-A4.
  Smallest path; tradeoff is "litho axis is Shape A except for
  this one gesture".
* Option B — extend ``litho_layer`` with synthetic_x/y/elevation_m +
  a third anchor-or-synthetic CHECK variant. Makes Shape A truly
  uniform but is a schema change + ORM addition + trigger update.
The dogfeed need (clay wedges, sand pinch-outs in fluvial-deltaic
sequences) hasn't changed — but the implementation surface is
larger post-A4 than it was on 2026-05-24.

**Tests to add.** Litho ghost-preview → confirm → contact rows
appear with `source='pinch_out_extrapolation'` on the litho model.
When #101 lands, extend the test: pinch-out with `lens_id` carries
the lens tag onto the synthetic contacts.

**Why deferred.** Phase-4 carve-out — pinch-out was scoped to the
geological model when shipped 2026-05-18. Dogfeed 2026-05-24
surfaced that litho models genuinely require it (clay wedges, sand
pinch-outs in fluvial-deltaic sequences are everywhere in BE/NL
data) and #101's lens entity assumes pinch-out wedges can ride on
litho contacts.

**When to revisit.** First step of the session-2026-05-24 sequence.
Prerequisite for #101. Half-day with tests.

## 119. Litho segmenter: same-lithology auto-merge (Tier G — design work, before Geotech stage)

**What.** `segment_cpt` in `litho_segmentation.py` currently splits
on every Robertson SBT zone integer change. Zones 5/6/7/8 all map to
ZAND via `ROBERTSON_ST_TO_LITHOLOGY`, so a uniform sand column gets
stacked Z6 ZAND → Z7 ZAND → Z8 ZAND layers (one per density step).
Add a post-pass after the greedy-merge step that collapses adjacent
runs of the same `suggested_lithology` into one suggestion. The
merged layer's `mean_qc_mpa` and `dr_pct` become thickness-weighted
aggregates; `suggested_nad_class` becomes the dominant class by
thickness. Real lithology transitions (ZAND → KLEI) keep their
boundary.

**Reverses** the 2026-05-20 owner directive ("we accept the
over-split shape in the litho stage… no auto-merge of adjacent
same-lithology layers"). New directive (owner 2026-05-24): **no
AUTO segmentation based on packing density**. The user's manual
Split gesture (`utils/lithoLayerSplit.ts`) is unchanged and still
creates same-lithology sub-units when the engineer wants them — the
over-split shape is accepted **only if user-picked**.

**Implications for the MVP gate.** CLAUDE.md's MVP gate step 4 lists
per-unit Ic / Dr / NAD class / γ-estimate as litho-stage outputs.
After this change those indicators MOVE from litho to geotech (the
geotech stage runs its own segmentation pass with a density-aware
merge rule). CLAUDE.md needs the corresponding edit when this lands:
litho = lithology only; density goes with geotech. Litho inspector
still shows AGGREGATE Dr/NAD on the unit for context.

**Migration.** Already-accepted litho contacts in existing projects
are unaffected — change is to the suggest path, not the persisted
shape.

**Why deferred.** Design work (not a bug) — architectural reversal of
a previous owner directive. Triage 2026-05-25: #127's auto-correlate
makes the over-split state less painful (adjacent same-lithology
bodies auto-correlate to the same body ordinal), but the segmenter
still emits them and the manual merge UX is friction. Classified as
B (design work before Geotech stage, not a pure bugfix).

**When to revisit.** Before starting the Geotech subdivision stage —
the litho inspector must show lithology-only units, not density-split
sub-units, or the geotech stage's NAD-class-per-unit mapping will
work against the wrong granularity. Half-day backend + bench update +
CLAUDE.md MVP scope edit (density indicators move from litho to
geotech).


## 123. Correlation suggestion bug: clay → silt cross-lithology pair (Tier G — needs reproduction)

**What.** Dogfeed 2026-05-24 user-reported: at least one committed
correlation edge connects a KLEI unit on one column to a SILT unit
on another, despite `correlate_litho_units.py:145` rejecting
cross-lithology pairs at the server. Hypotheses:

* (a) Frontend bypassed the validator on a specific gesture path
  (e.g. drag-from-ghost-edge variant — see #82) and posted a
  cross-lithology pair the server accepted because the frontend
  signalled OK before the body validator ran.
* (b) A formation's `litho_main_soil_code` was set wrong at
  creation (e.g. via "Mark as lens" or a bulk-rename action),
  making two formations that *display* as different lithologies
  actually share the same `litho_main_soil_code` and pass the
  server check.
* (c) The chip/band rendering uses a different `formation_id` than
  the edge data references (visual mismatch only — no real
  cross-lithology edge in DB).

**Diagnosis path.** Query the `litho_correlation_edge` table for
the user's project and join through both endpoints'
`geological_formation` to detect any pair with mismatched
`litho_main_soil_code`. If a real cross-lithology edge exists,
trace the create path; if not, the bug is in the renderer.

**Why deferred.** Cannot diagnose blind — needs a specific
reproduction point in the user's project. Triage 2026-05-25:
classified as C (needs reproduction). The diagnostic SQL is cheap
but the result is ambiguous without knowing which project + section
+ column pair shows the mismatched chips.

**Evidence needed for diagnosis.**
- The project ID and section ID where the symptom is visible.
- The two column names (investigation IDs) showing clay and silt
  bodies connected by the same correlation edge.
- Output of:
  ```sql
  SELECT e.id, fa.litho_main_soil_code AS litho_a,
         fb.litho_main_soil_code AS litho_b
  FROM   litho_correlation_edge e
  JOIN   geological_formation fa ON fa.id = e.formation_a_id
  JOIN   geological_formation fb ON fb.id = e.formation_b_id
  WHERE  fa.litho_main_soil_code != fb.litho_main_soil_code;
  ```
  If this returns rows, the mismatch is real (hypotheses a or b).
  If empty, it's a renderer/display mismatch (hypothesis c).

**When to revisit.** Owner provides the evidence above. Until then
no code change is possible without risk of fixing the wrong layer.

## 124. CreateLithoLens — split into geometry service + DB-loading layer (Tier E)

**What.** `create_litho_lens.py` is 780+ lines. The wedge-tip geometry
(`_load_formation_contacts_on_section`, `_commit_wedge_tips_for_absent`,
`_project_to_along`, `_load_target_contacts_on_section`) is pure
section-geometry logic that mixes with ORM session calls. A thin
`LithoLensGeometryService` (domain-layer, session-free) holding the
pure math + a DB-loading layer above it would make the geometry unit-
testable in isolation without needing an async session mock.

**Why deferred.** The 780-line file is well-structured internally;
the split is a refactoring exercise, not a correctness fix. Slicing it
now would widen the PR without delivering user value.

**When to revisit.** When a Phase 5 lens-geometry variant (e.g.
interfingering shape, multi-section aggregation) forces the geometry
logic to grow. At that point the split pays for itself immediately.
Filed from #101 senior-code-reviewer pass, 2026-05-24.

## 126. LithoLensOrm.name: change from VARCHAR(120) to TEXT (Tier E)

**What.** `LithoLensOrm.name` is mapped as `String(120)` (PostgreSQL
`VARCHAR(120)`). Per CLAUDE.md conventions, free-form label columns
should be `TEXT` — `VARCHAR(N)` is for fixed-spec values (codes, enums,
IDs). A lens name entered by the user is free-form; a 120-char cap
invites surprise truncation.

**Why deferred.** Backwards-compat rule is suspended (pre-ship). A
small migration to `ALTER COLUMN name TYPE TEXT` is the fix; it is
mechanical and non-breaking.

**When to revisit.** Any migration-bearing session while the backwards-
compat suspension is still in effect. One migration line.
Filed from #101 senior-code-reviewer pass, 2026-05-24.

## 127. RESOLVED — Auto-correlate litho bodies on accept / import

**What.** When the user accepts litho suggestions per CPT / borehole
or imports new tests, the system should **automatically propose
``litho_correlation_edge`` rows** for same-lithology contacts on
adjacent columns within a distance-aware depth threshold. The
inference engine + wedge materialisation from #101 Position 4
then runs over the auto-correlated graph, so the model emerges
from imported data with minimal user gestures. Manual override
remains: user can delete auto-edges, add edges the algorithm
missed, and any manual edge is preserved across re-runs.

**Owner directive 2026-05-24 (post-#101 Position 4 lock-in).**
Identified mid-refactor as the missing trigger that makes the
inference engine actually pay off in practice — without
auto-correlate, the user still has to manually create every
correlation edge before the engine sees anything to work with.

**Algorithm (v1.0) — bottom-up sweep with dip transfer.**

Owner refinement 2026-05-24: process formations in stratigraphic
order from deepest (lowest ``display_order`` = oldest) to
shallowest. In Flanders deep = Tertiary marine deposits, which
correlate cleanly because they're laterally extensive, subhorizontal,
and sharply-contrasting lithologies. Each formation's accepted edges
feed a per-column-pair dip estimate that **predicts the centre of
the next-shallower formation's candidate window** — so by the time
the algorithm reaches the Quaternary (where lens-prone shallow
geology produces wild variability), the search window is centred at
the geologically-expected depth rather than naïvely "same depth at
A as at B".

**Tertiary-base is NOT required (owner caveat 2026-05-24).** Many
BE/NL sites have no Tertiary contact in the dataset: polders with
thick Holocene over Pleistocene where CPTs refuse before Tertiary;
Brabant Massif edges with Palaeozoic bedrock under thin Quaternary;
urban / shallow investigations that never reach Tertiary even when
it exists deeper. The algorithm degrades gracefully — "bottom-up"
means **deepest-available first**, not Tertiary-specific. The sort
is ``display_order ASC`` regardless of what's in the dataset; if
the deepest formation here is Pleistocene fluvial sand, the
algorithm processes that first.

What changes without a Tertiary base is the **magnitude of the
dip-transfer benefit**, not whether the algorithm runs. To stop a
noisy dip estimate from sparse deep edges propagating false
predictions upward, use **confidence-weighted dip transfer**: the
dip predictor only kicks in for a column-pair once that pair has
``min_edges_for_dip_transfer = 3`` accumulated correlated edges.
Below that threshold, fall back to naïve "same depth" centre with
the full distance-scaled window for the next formation. Tertiary-
rich sites get the benefit immediately; Quaternary-only sites get
it once enough Quaternary edges accumulate; sparse / heterogeneous
sites gracefully degrade to mutual-nearest-on-wider-window without
contamination from a poorly-estimated dip.

The compounding effect: false positives drop sharply on the
Quaternary because the dip baseline (Tertiary OR sufficiently-rich
deep Quaternary) is calibrated from below. Matches how a geotech
engineer correlates by hand — deep markers first, then work up.

Algorithm:

```
sort formations by display_order ASC  (oldest/deepest first)
estimated_dip = {}  per column-pair

for F in formations:
    for (A, B) in all column pairs within max_distance_m:
        # Predict where F's contact at B should be given A's
        if estimated_dip[(A, B)] is set:
            predicted_b_depth = contact_a.depth + dip * dist(A, B)
        else:
            predicted_b_depth = contact_a.depth  (naïve fallback)

        window = base_threshold + distance_factor * dist(A, B)
        candidates = {
            (C_a, C_b) on (A, B) :
                C_a.formation_id == C_b.formation_id == F.id
                AND |C_b.depth - predicted_b_depth| < window
        }

        edges += mutual_nearest_neighbour(candidates)

        # Update dip from accumulated correlated pairs on (A, B).
        # robust_slope_fit = Theil-Sen / median-of-pairs (NOT OLS) —
        # one shallow outlier mustn't contaminate the Tertiary baseline.
        estimated_dip[(A, B)] = robust_slope_fit(edges_between(A, B))
```

Defaults: ``base_threshold_m = 2.0``, ``distance_factor = 0.01`` (so
5m apart → ~2.05m window, 500m → ~7m window), ``max_distance_m =
500`` (configurable per-project).

**Same-formation constraint.** Auto-correlate operates strictly
within a single formation per loop iteration — the resolver already
groups by ``(parent_formation_id, litho_main_soil_code)`` so cross-
formation edges would be rejected by the use case anyway. Filtering
at candidate generation avoids wasted candidate computation.

**Disambiguation — mutual nearest neighbour.** A column-pair
(A, B) may have multiple candidates within threshold within a
single formation (e.g. two thin sand layers at A correlate-able
with two at B). For each C_a, find the closest C_b by predicted-
depth-residual; for each C_b, find the closest C_a; correlate ONLY
when they are each other's mutual nearest. Drops the many-to-many
fan-out cleanly.

**Idempotency.** Add ``source`` enum to ``litho_correlation_edge``
(``'manual' | 'auto'``). Re-running auto-correlate is additive on
non-existing pairs only — never overwrites manual edges. Deleted
auto-edges DO get recreated on re-run for v1.0 (no per-edge
suppress list yet); Phase 5 adds a "rejected by user" flag so
deletions stick.

**Provisional rendering.** ``source='auto'`` edges render
dashed/~40% opacity (same treatment as ``source='inferred'``
absences from #101 Position 4). User confirms → promote to
``'manual'``, edges render solid/~70%.

**Refinements deferred to Phase 5.**

* **Cross-formation dip-transfer guard.** v1.0's bottom-up sweep
  assumes subparallel surfaces between adjacent formations (true
  in Flanders Cenozoic — Boom Klei dips at roughly the same
  angle as Diest Sand above it). Angular unconformities (BE-
  Limburg Pre-Tertiary / Tertiary contact, some southern-Dutch
  outcrops) violate this; the dip transferred forward from below
  is wrong above the unconformity. Phase 5 detects the
  discontinuity (large per-column-pair dip jump between adjacent
  formations) and resets the dip estimator at the unconformity.
* **Stratigraphic ordering constraints.** Reject correlation
  pairs whose connected component would imply layer inversion
  (ZAND-on-CLAY at A vs CLAY-on-ZAND at B for the same bodies).
* **Per-formation override of thresholds.** Some formations (peat
  drapes, thin clay markers) need tighter windows than thick
  sand units. v1.0 has one global threshold + dip-predicted
  centre; Phase 5 allows per-formation window overrides.
* **User-rejected edge suppress list.** When the user deletes an
  auto edge, remember and don't re-propose it on the next run.

**Where it fires.**

* After ``acceptLithoSuggestions`` use case commits (the
  natural moment — new contacts just landed)
* After ``importCpt`` / ``importBorehole`` use case commits (when
  raw data arrives — though contacts only exist after accept, so
  this might be redundant)
* Explicit toolbar trigger on the Litho axis: ``Auto-correlate
  now`` button (or a Suggest dropdown item)
* User toggle in Settings: ``Auto-correlate on accept`` default
  ON (per-project, ``view_state.litho_auto_correlate.enabled``)

**Composition with #101 Position 4.**

Position 4's inference engine fires off correlation-edge
mutations. Auto-correlate creates those mutations. Zero conflict
with the running refactor; this slice is additive on top.

**Estimated cost.** ~2 days post-#101 Position 4 (was 1.5 — the
bottom-up sweep + dip estimator adds ~half a day for the loop
refactor + the Theil-Sen / robust-slope fit + tests covering dip
transfer accuracy and degenerate column-pairs):
* Pure domain service ``auto_correlate_litho_bodies(contacts,
  formations, investigations, params) → list[CorrelationEdge]``
  iterating formations in ``display_order`` ASC with per-column-
  pair dip state accumulated across the loop
* Pure domain helper ``robust_slope_fit`` — Theil-Sen / median-
  of-pairs (NOT OLS) so a single shallow outlier can't poison
  the deep-baseline dip
* Confidence gate ``min_edges_for_dip_transfer = 3`` — dip
  predictor only used after the column-pair has accumulated
  enough deep correlations; falls back to naïve same-depth
  centre below the threshold (handles Tertiary-less sites
  gracefully)
* Heavy unit tests (~25 cases): threshold scaling, mutual-NN
  tie-breaking, same-formation filter, idempotency, edge cases,
  **dip transfer between formations (Tertiary→Quaternary)**,
  **Tertiary-less sites: degenerate Quaternary-only correlation**,
  **dip-transfer confidence threshold (< 3 edges → fallback)**,
  degenerate column-pairs with no shared formations, outlier
  resistance in the dip estimator
* Constants in sibling ``auto_correlate_constants.py``
* Application use case + POST endpoint + frontend client method
* Settings entry for the thresholds (fits the existing Settings
  dialog from the locale-tolerant numeric input work)
* Toolbar button + toast announcing "N auto-correlations created
  — review or confirm" in the LithologyInspector
* Hook into ``acceptLithoSuggestions`` for the on-accept fire

**Why deferred.** #101 Position 4 must land first — the inference
engine + correlation-edge source enum + provisional rendering
treatment are prerequisites. After #101 + **#128 (Playwright
e2e)** land, this slice ships next.

**Sequencing change (owner directive 2026-05-25):** **#128 ships
BEFORE #127**, not after. Rationale: the #101 Position 4 build
generated three post-merge bug fix-up rounds (initial fix-up
post-Approach-C reviewer, Position-4 fix-up #2, materialiser
``ground_level_m``, then the #129 dogfeed batch). Every one of
those was a cross-boundary integration bug — passed unit + tsc +
reviewer, surfaced only at owner smoke-test. Building #127 on
top of the current unblocked-but-still-leaky stack means more of
the same. Land #128 first → the auto-correlate work inherits the
6-flow smoke set as its own regression net.

*(#127 RESOLVED 2026-05-25 — Auto-correlate shipped across 6 slices. Slice 1:
CHECK constraint ``ck_litho_correlation_edge_source`` (migration j4d5e6f7a8b9).
Slice 2: pure domain service ``auto_correlate_litho_bodies`` + ``robust_slope_fit``
(Theil-Sen 1-D dip estimator) + ``_mutual_nearest_neighbour`` + 33 unit tests.
Slice 3: ``AutoCorrelateLithoBodies`` use case + ``POST .../auto-correlate``
endpoint (``source='auto'`` batch insert → flush → run_resolver → absence
recompute + wedge materialisation → single commit).
Slice 4: ``AutoCorrelateResult`` type + ``api.geology.autoCorrelate`` in
``client.ts``; ``handleAutoCorrelate`` hook + fire-on-acceptAll in
``useGeologicalModel``; ``Auto-correlate`` toolbar button (``testid=litho-auto-correlate``)
in SectionsToolbar; ``source='auto'`` edges render at 40% opacity / ``3 5`` dash
in CorrelationEdgesOverlay.
Slice 5: ``countAutoCorrelationEdges`` helper in ``db_helper.ts``; e2e flow
``flow_auto_correlate.spec.ts`` (happy path + idempotency + wrong-kind 422).
Slice 6: docs/debt.md + CLAUDE.md updated.
See commits on ``develop`` from 2026-05-25.)*

*(#128 RESOLVED 2026-05-25 — Playwright e2e smoke harness shipped. 6 flows:
boot+open, single-accept, bulk-accept (15 s budget + defer_inference invariant),
correlate + mismatch rejection, InspectLensBodyPanel reachable, bundle round-trip.
``playwright.config.ts`` + ``tsconfig.e2e.json`` + ``electron_launch.ts`` +
``db_helper.ts`` + ``build_synthetic_fixture.py`` + 6 ``flow_*.spec.ts`` files.
Pre-commit hook wires ``test:e2e:smoke`` after Vitest when backend reachable.
Regression anchors: revert ``2d4d7913`` → single_accept red; revert ``2ad9bb6e``
→ boot_open + inspect_lens red. The harness also caught a previously-undetected
4th missing ``detail=`` kwarg in ``name_lens_body`` during the fix-up pass —
exactly the class of bug it was built for. See commits on ``develop`` from
2026-05-25.)*

## 130. Playwright e2e coverage expansion — ongoing convention + backfill plan (Tier B)

**What.** #128 shipped the harness foundation (6 flows). #130
tracks the **ongoing convention** + **prioritized backfill** of the
remaining user-facing surface so the harness compounds into a real
regression net rather than stagnating at 6 flows.

The harness's value proposition was proven on its own fix-up pass:
the agent caught a **4th missing ``detail=`` kwarg** in
``name_lens_body`` that the original #129a fix had missed. Without
the harness, that bug ships silently — exactly the class of bug
that bit Position 4 four times. Every additional flow sets another
such trap.

### Convention — load-bearing from #127 onward

**Every new user-facing gesture ships with at least one e2e flow in
the same commit batch as the gesture itself.** The pattern:

1. Add the gesture (use case + endpoint + frontend wiring)
2. Add the ``data-testid`` attributes the flow needs
3. Write the spec at ``desktop/tests/e2e/flow_<name>.spec.ts``
4. **Verify the spec catches a regression** of the gesture — intentionally break the gesture, run the flow, confirm red, restore
5. Ship the whole bundle as one slice

A gesture without a flow is incomplete-as-shipped from #127
onward. Reviewers reject otherwise.

### Tier-1 backfill targets (high payoff — schedule alongside existing slices)

These cover the user-facing surface where class-of-bug regressions
have already happened OR are statistically most likely:

* **Project lifecycle** — *(DONE 2026-05-25)* Flows A–E shipped:
  new-project creation + 422 rejection (A), save round-trip +
  view-state PATCH + invalid-payload 422 (B), open-recent IPC +
  add-recent + ghost-entry error banner (C), unsaved-changes dialog
  testids + save/discard/cancel API branches (D), settings dialog
  open + litho-prefs PATCH/bundle + theme localStorage (E).
  12 new `data-testid` attributes added across WelcomeScreen,
  NewProjectDialog, SettingsDialog, UnsavedChangesDialog,
  DirtyAsterisk, StageToolbar. DB helpers countProjects /
  getProjectByName / getProjectViewState added to db_helper.ts.
  All 13 commits on develop; tsc + vitest 1181/1181 green.

* **Suite reliability — fixture isolation (2026-05-25):** 16 of the
  Flows A–J Geology-stage specs were failing. Root causes diagnosed
  and fixed in 10 commits on develop:

  *Source-code fixes (backend):*
  - `GeologicalFormationCreateRequest` and `ProjectCreateRequest`:
    added `field_validator` to reject whitespace-only names with 422
    (Pydantic `min_length=1` passes a single space).

  *Spec bugs fixed (Fix shape C):*
  - `db_helper.ts`: SQL queries referenced non-existent `app_project`
    table (correct ORM name is `project`). Fixed in 3 queries:
    `countProjects`, `getProjectByName`, `getProjectViewState`.
  - `flow_crossing_validator`: `beforeAll` sliced `cpts[0..2]` which
    are all on y=214000 (collinear) → degenerate TIN → 0 crossings
    detected. Fixed: use 4 CPTs including CPT[3] at y=214300 to break
    collinearity; replaced constant-depth contacts with per-CPT depth
    arrays ([1,1,9,1]/[7,7,2,7]) so surfaces actually intersect.
  - `flow_settings_dialog`, `flow_save_project`: PATCH /view-state
    body was `{key:val}` but `ProjectViewStatePatchRequest` requires
    `{patch:{key:val}}`. Also fixed `require('electron')` in
    `app.evaluate` → `{ BrowserWindow }` destructuring.
  - `flow_fill_from_boreholes` idempotency test: backend allows
    duplicate formation names, so raw POST twice always grew the
    count. Rewrote to test `discover-from-stratigraphy` idempotency
    (same candidates both calls) + apply-with-cleanup pattern.
  - `flow_crossing_validator` CPT URL: used
    `/projects/{id}/cpts` (404) instead of `/cpt/?project_id={id}`.

  *Harness design gap (test.skip with TODO):*
  - 4 "testid present" tests require the Geology stage open with a
    project loaded, which the welcome-screen harness never does. All
    4 skipped with `test.skip(true, 'Requires project open in harness
    — fixture .gmproj not yet wired')`.

  *Fixture cleanup:*
  - `_cleanup_litho_state` previously only deleted litho child
    formations; scratch geological formations from
    `flow_crossing_validator` (A/B pairs) and failed test runs
    accumulated → wrong `countFormations` baselines. Rewritten to
    delete all non-fixture models and formations by comparing against
    the 3 deterministic UUID5 fixture IDs.

  **Final state:** 45/49 pass, 4 skip (testid-without-project),
  0 fail. Suite is order-independent (confirmed by two consecutive
  runs without fixture reset). Dev DB not touched.

* **Geology stage** — Create formation, drag-reorder + pin,
  Build 3D model (TIN trigger), Sync geology, Delete formation.
  Every TIN-build path went through reviewer-without-runtime-test
  and shipped at least once with a latent bug.
* **Litho manual gestures** — Split layer, Merge same-lithology
  boundary, Pinch-out (right-click → Extrapolate, both axes),
  Composition picker (per-axis litho swap + admixtures).
* **Export** — DXF section, Plaxis 3D, Plaxis 2D section. Exports
  are downstream of everything; a regression here lands on
  customers before us.

### Tier-2 backfill targets

* **Undo/redo** — for every mutation path. The undo stack is one
  of the most error-prone surfaces; multiple partial-undo bugs
  have shipped historically.
* **Settings dialog** — locale-tolerant numeric inputs (comma vs
  period acceptance), theme toggle (light/dark/system), litho
  segmenter prefs persisting through .gmproj round-trip.
* **Empty-project edge case** — boot, no investigations, every
  stage page renders without crashing.
* **Backend-unreachable error path** — kill the API server mid-
  session, verify the frontend degrades gracefully instead of
  white-screening.

### Tier-3 backfill targets (lower payoff)

* **Performance benchmarks** — DOV import wall-clock budget per
  the CLAUDE.local.md baseline; alert if a slice regresses it
  by > 25%.
* **3D viewer load** — Cesium brittleness on dev / CI machines
  without GPUs; the ``STRIX_DISABLE_GPU`` path needs its own
  flow.
* **DOV bbox import** — slow (~50s cold for shallow CPTs),
  network-dependent, skip-by-default but available as a
  nightly job.

### Backfill scheduling

* **#127 ships with flow 7** (auto-correlate) per the convention.
* **Half-day immediately after #127** — dedicate one slice to
  Tier-1 project-lifecycle + geology-stage flows. Aim for 5-6
  new flows. Total harness footprint after that: ~12-13 flows.
* **Per-slice from then on**: every Phase 4 / Phase 5 slice adds
  1-2 flows.
* **Pre-coworker-binary**: a final backfill sweep closes any
  remaining Tier-1 gaps before debt #3 license-keys ships.

### Anti-patterns to avoid

* **Don't write happy-path-only flows.** Every flow must also
  include at least one rejection / error path (#128's
  ``flow_correlate.spec.ts`` covers both same-litho success AND
  cross-litho rejection — copy that shape).
* **Don't share state between flows.** The litho-state cleanup
  pattern in ``build_synthetic_fixture.py`` exists because the
  #128 agent originally hit cascading failures from cross-flow
  state bleed. New flows MUST be runnable in any order.
* **Don't add ``waitForTimeout`` arbitrary sleeps.** Use
  ``waitForResponse`` / ``waitForSelector`` / ``expect().toBe*``.
  Flake = root cause unfound; never paper over.

### When to revisit

Continuously. Each new feature includes its own flow as a ship
requirement. Tier-1 backfill happens immediately after #127.
Pre-distribution sweep closes residuals before any external
user sees the build.

## 131. Ribbon: lens-aware variant + pinch-out terminus (Tier G — unshipped half of #121)

**What.** #121 shipped 2026-05-25 with the basic ribbon shape: continuous
polygon ribbons per body ordinal, replacing per-edge dashed lines (CE-R1/R2/
R3/R4 pin the geometry). Two distinguishing features from the original
debt #121 spec did NOT ship:

* **Lens-aware variant** — when an edge connects two contacts that belong
  to a known lens body, the ribbon should render with ~35% fill opacity
  (vs the default 20%) + dashed top/base boundary lines, signalling
  "closed body, not continuous formation".
* **Pinch-out terminus** — when a ribbon endpoint reaches a column where
  the formation is ABSENT (the pinch-out wedge tip), the polygon should
  thin to zero at the wedge-tip x-position rather than at the column-line x,
  producing a visible triangular taper instead of a square truncation.

**Why deferred.** Both halves are blocked on plumbing the implementation
agent discovered missing:

* The ribbon's lens-aware branch needs ``lens_id`` exposed on the
  ``LithoCorrelationEdge`` API response (and ideally as a FK on the ORM
  ``LithoCorrelationEdgeOrm``). Today the ORM identifies lens bodies via
  ``LithoLensOrm`` keyed by ``(model_id, formation_id, body_ordinal)`` —
  the edge knows the body_ordinal indirectly via its contacts' formations,
  but the join is implicit. Adding a denormalised ``lens_id`` column +
  surfacing it in the API response would unblock the branch (~20 lines
  + migration).
* The pinch-out terminus branch needs the section component's props to
  carry a ``formationAbsences`` array (or per-investigation pre-computed
  "is the formation absent here?" lookup) alongside the existing contact
  list. The materialised wedge-tip x is already in the ``litho_lens.
  wedge_tip_along_m`` column from the #118 + #101 work; it just isn't
  threaded into ``CorrelationEdgesOverlay``.

**Owner ribbon-colour spec (added 2026-05-28, folded in from #150).**
Beyond the opacity/dash distinction above, the ribbon's FILL should
encode the lithologies it separates:

* The ribbon is split into the lithology colour **above** the contact
  and the lithology colour **below** it. A contact bounds **exactly
  two** lithologies (owner: "a layer contact can't have more than 2
  lithologies") — so the split is always two-way, never N-way.
* At the two ends (contact A on investigation 1, contact B on
  investigation 2) the above/below pair may differ — that is a lens /
  facies change across the gap. Each end takes its own pair.
* The colours **fade into each other across the middle** of the
  ribbon (a horizontal gradient from end-A's pair to end-B's pair),
  so a lens reads as a smooth facies transition rather than a hard
  seam.

This is the substantive design piece (a gradient-filled ribbon with
per-end lithology pairs), distinct from the lens-aware opacity/dash
styling and the pinch-out taper above. Needs the above/below
lithology at each contact — derivable from the per-investigation
band stack already computed in ``buildBandMap`` (the band below a
contact is the contact's own formation; the band above is the
previous shallower contact's formation), so it likely does NOT need
the ``lens_id`` FK that gates the opacity/dash variant. Brainstorm
the rendering (SVG ``linearGradient`` per ribbon vs per-segment fill,
interaction with the existing body chips, >0 vs faded when an end has
no band above/below) before building.

**#131-c SHIPPED 2026-05-28** (the #150 fold-in — lithology-coloured
gradient seam ribbon). Frontend-only in ``CorrelationEdgesOverlay``:
``contactStripeColors`` helper derives above/below lithology colour per
contact (below = own formation, above = next-shallower, null when
topmost); each edge renders two ``<polygon>`` stripes filled by a
horizontal ``<linearGradient>`` from contact-A's colour to contact-B's
(so a lens reads as a fade); approved = solid + near-black seam line,
pending = faded (0.32) + dashed amber outline + drag handles; the above
stripe is omitted on topmost contacts. After dogfeed: anchored at each
column's INNER edge (gap-spanning, not centre-to-centre) + slim ±6 px
height. SC1-SC4 + CC8/CC9 + SR1/SR2/SR3 pin it; 33 vitest + tsc clean.
Dogfeed-confirmed correct — the one "wrong colour" report turned out to
be the ribbon faithfully colouring a #157 CLAY sliver as the "above"
lithology (a data artifact, not a ribbon defect). See spec
``docs/superpowers/specs/2026-05-28-litho-gradient-ribbon-design.md`` +
plan ``docs/superpowers/plans/2026-05-28-litho-gradient-ribbon.md``.

**Still open under #131:** #131-a (lens-aware opacity/dash variant —
blocked on the ``lens_id`` FK) and #131-b (pinch-out terminus taper —
blocked on threading ``formation_absence`` into the section components).
Both gated as before.

## 132. Correlation-graph-aware inference on uncorrelate (Tier G — Phase 5 design issue)

**What.** ``test_r7_uncorrelate_reruns_inference_without_error`` asserts
that uncorrelating FA ↔ FB causes the recompute hook to RETRACT the
inferred absence row that the correlate phase wrote. Today the
``count_after < count_before`` assertion fails. Marked ``xfail`` 2026-05-25
pending the Phase-5 design.

**Investigation (2026-05-25).**

The initial diagnosis was "body collapses to zero contacts on uncorrelate
→ engine doesn't recognise collapse case." Shape A fix shipped (commit
``daa5a952``): ``infer_formation_absences`` now emits all existing
inferred rows into ``to_retract`` when ``body_contacts`` is empty. The
guard is correct + unit-tested but does NOT solve the test case.

Why: correlation in Position 4 lives at the FORMATION level
(``litho_correlation_edge.formation_a_id`` ↔ ``formation_b_id``), not
at the CONTACT level. After uncorrelate, the contacts themselves survive
unchanged. ``RecomputeFormationAbsencesForBody`` loads
``body_contacts = all contacts for (model, formation)`` per the
intentional MVP simplification documented at
``recompute_formation_absences_for_body.py:155-168``:

> "For Position 4 MVP: we treat ALL contacts for (model, formation) as
> the body's contacts. Multi-body disambiguation (ordinal > 1) is a
> Phase 5 refinement..."

So after uncorrelate ``body_contacts == [the surviving contact]``,
non-empty. The engine has no visibility into the correlation graph;
same inputs → same UPSERT of the same row → count unchanged.

**Why deferred.** True retraction requires the inference engine to
become correlation-graph-aware (an isolated formation must produce no
inferred absences in the corridor). That's the Phase-5 multi-body-
disambiguation work the MVP simplification explicitly defers. Two
shapes when the time comes:

* **Shape C — engine takes correlation-graph context.** A new input
  parameter ``is_isolated_body: bool`` (or richer ``correlation_neighbors:
  list[UUID]``) flows from the recompute. Engine retracts when isolated.
* **Shape D — recompute pre-filters.** The recompute use case loads the
  correlation graph, detects isolation, and calls infer with
  ``body_contacts=[]``. Composes with the already-shipped Shape A guard.

Shape D is the cheaper transitional path (no domain-engine signature
change). Shape C is the cleaner endgame.

**When to revisit.** Phase 5 multi-body disambiguation, OR when a
dogfeed session reports phantom absences surviving uncorrelate as a
user-visible bug.

**What ships today (2026-05-25).** Shape A guard + xfail mark + unit
anchors for the empty-body-contacts safety net. The Phase-5 retraction
remains the open work.

## 133. Boundary-to-boundary correlation — RESOLVED 2026-05-26

**Shipped.** Phase 2+3 combined in a single PR. Contact-level
auto-correlate with boundary-signature filter (no Theil-Sen) +
``user_approved`` column + ``AcceptContactCorrelations`` use case +
``DetectLithoLenses`` (consumes #135 topology, ``user_approved=True``
only) + ``MaterialiseLensCompanions`` (section-scoped gate: every
contact on primary section has an approved outbound edge).
``ResolveLithoInstances`` + ``PropagateLithoAdmixtures`` rewritten to
derive the formation graph from contact edges. ``litho_correlation_edge``
table dropped; formation-level use cases, endpoints, body-click gesture,
ribbon rendering, and Resolve button all removed in the same PR.
NAD-based scoring deferred (Phase 5 — circular dependency at litho
stage).

(Original filing kept below for design rationale + history.)

---

## 133 (filing). Boundary-to-boundary correlation (contact-level edges — replaces formation-level model)

**What.** The current correlation model connects two FORMATIONS
(``litho_correlation_edge.formation_a_id`` / ``formation_b_id``). The
new model — owner directive 2026-05-25 — connects two CONTACTS
(``litho_contact_correlation_edge.contact_a_id`` / ``contact_b_id``).
Two correlated contacts bound a body. A layer between two pairs of
correlated contacts on adjacent columns whose lithology differs from the
connecting body is a LENS — the first representation of facies geometry
that is not available in the formation-level model.

Concrete scenario (owner dogfeed):

> "Column A: …sand, SILT, clay… Column B: …sand, clay…  
> Correlate the sand/SILT top boundary to the sand/clay top boundary
> on column B, AND the SILT/clay base boundary to the same clay top.
> The silty interval on A is now a lens."

**Why phased.** The full migration touches ~15+ files (ORM, migration,
use cases, router, schemas, API client, gesture, renderer). Landing it
in one commit risks half-broken state across a nightly build. Three
clean phases:

**Phase 1 (shipped 2026-05-26 — this entry):** Schema +
endpoints + manual gesture + basic renderer support.
- New table ``litho_contact_correlation_edge`` (contact-level edges).
- ``POST / DELETE / GET .../contact-correlations`` endpoints.
- Frontend: contact-boundary click gesture in correlate mode (boundary
  line becomes the hit target instead of the body band).
- Renderer: point-to-point lines between correlated contacts alongside
  the existing body-level ribbons.
- ``contactCorrelateMode`` standard-on whenever the toolbar's correlate
  mode is active (owner directive 2026-05-26). Both gestures coexist;
  Phase 3 removes the legacy body-click surface.
- Old formation-level endpoints + edge table retained; NOT migrated.

**Phase 2 (next slice, after dogfeed proves Phase 1):**
- Auto-correlate at contact level (new ``AutoCorrelateContactEdges``
  use case: same bottom-up + dip-transfer heuristic but on contacts
  not formations).
- Lens detection: walk the contact-edge graph; a layer whose top +
  base contacts are both correlated across columns AND whose body
  lithology differs from the flanking bodies is a LENS. Store result
  in ``litho_lens``.
- Lens-aware ribbon styling (composes with #131).

**Phase 3 (before any external distribution):**
- Migrate existing formation-level edges to contact-level (best-effort:
  pick the shallowest contact in each formation's column as the
  canonical boundary).
- Remove the old formation-level correlate gesture from the UI.
- Keep the old API endpoints as deprecated, accept-no-new-writes
  paths for the backwards-compat window.

**When to revisit.** Phase 2: next slice after Phase 1 dogfeed
confirms the boundary-click gesture is usable. Phase 3: before first
external/paid distribution (backwards-compat re-arm trigger).

## 134-A. Litho-geo snap tolerance configurable per-project (Tier G) — RESOLVED 2026-05-27

**What.** Move the ``LITHO_GEO_SNAP_TOLERANCE_M`` constant in
``SectionsCanvas.tsx`` onto
``view_state.litho_segmenter.litho_snap_tolerance_m`` and surface it
in the litho-segmenter Settings section.

**Resolution.** New ``lithoSnapToleranceM`` field on
``LithoSegmenterPrefs`` (default 0.20 m, range 0.01-5.0 m).  Read +
patch round-trip through ``readLithoSegmenterPrefs`` /
``buildLithoSegmenterPatch`` with the same field-independent fallback
as the other numeric keys.  ``SettingsDialog`` gained a NumberRow
under "Litho segmenter" with hint copy explaining both directions
(larger catches near-misses, smaller lets you place off a boundary
without nagging).  ``SectionsCanvas`` retired the hard-coded constant
and now reads from prefs via ``useMemo(project?.view_state)``.

**Tests.** Five new cases in ``lithoSegmenterPrefs.test.ts`` (default,
valid, low-out-of-bounds, high-out-of-bounds, non-numeric) plus the
extended roundtrip + at-bounds tests covering the new field.

## 134-B. Litho-geo snap visual indicator on the dragger (Tier G) — RESOLVED 2026-05-27

**What.** Pre-release telegraph for the snap dialog: while a litho
contact is being dragged, the drag readout indicates whether the
post-release prompt will fire (i.e. the cursor is within ±tolerance
of a geological contact on the same investigation).

**Resolution.** New optional ``geoSnapToleranceM`` prop on
``ContactsLayer``.  When set (litho axis only) AND
``referenceContacts`` is non-empty, the drag readout gains an extra
amber "↦ snap on release: 12.34 m" line + a small amber dot at the
cursor anchor whenever ``findGeoSnapCandidates`` returns ≥1
candidate at the current drag depth.  Gated paths render unchanged
when the prop is absent (geological axis or pre-Sync litho axis).

``SectionPanel`` forwards the prop on the litho axis only.
``SectionsCanvas`` passes ``lithoSnapToleranceM`` from the prefs
(same source as the existing drag-path post-release wrapper, so the
in-flight indicator and the dialog stay in sync after tolerance edits).

## 134-C. Litho-geo snap on the accept-litho-suggestions paths (Tier G) — PARTIALLY RESOLVED 2026-05-27

**What.** Extend the snap-prompt to fire when a litho suggestion is
accepted, not only when an already-committed litho contact is
dragged.

**Resolution (single-suggestion path).** ``handleAcceptLithoSuggestion``
now returns ``Promise<AcceptLithoSuggestionsResponse | null>`` (was
``Promise<void>``).  The ``sectionAwareAcceptLithoSuggestion`` wrapper
in ``SectionsCanvas`` awaits the result, then runs the same
``findGeoSnapCandidates`` check the drag path uses — at the accepted
suggestion's ``depth_top_m`` against the geological backdrop on the
same investigation.  When candidates exist, the existing
``LithoGeoSnapDialog`` opens for the new contact id taken from
``result.created_contact_ids[0]`` (upper-half on a straddle, single
contact otherwise).

15 test fixtures updated to satisfy the new return type.

**Still open (filed as #134-C-bulk).** ``handleAcceptAllLithoSuggestions``
+ ``handleAcceptBulkLitho`` + ``handleAcceptAllBulkLitho`` accept N
suggestions in one call; ``created_contact_ids`` is a flat list
without 1:1 mapping to input suggestions (straddle splits muddle
the index).  Surfacing N snap candidates would also need a queue UI
to prompt them one at a time without flooding the user.  Owner
directive: ship single-path first, revisit if bulk-path slivers
become a dogfeed pain point.

## 134-C-bulk. Litho-geo snap check on bulk accept paths (Tier G — split out from #134-C)

**What.** Extend the post-accept ``findGeoSnapCandidates`` check
(landed for the single-suggestion path 2026-05-27) to the three
bulk accept paths in ``useGeologicalModel.ts``:

* ``handleAcceptAllLithoSuggestions`` — accept every non-rejected
  ghost on the focused investigation.
* ``handleAcceptBulkLitho`` — accept one ghost on any anchor in
  bulk mode.
* ``handleAcceptAllBulkLitho`` — accept all non-rejected ghosts
  across every bulk anchor (the corridor-wide sweep).

**Why split out.** Two non-trivial sub-problems past the single-path
shape:

* **Stable suggestion → created-contact-id mapping.**  The accept
  endpoint returns a flat ``created_contact_ids`` list.  For a
  straddle split, one input suggestion produces two contacts; for
  an idempotent re-accept, it produces zero (the id lands in
  ``found_contact_ids`` instead).  The post-check needs to know,
  per input suggestion, which contact id (if any) it should snap.
  The cleanest server-side fix is to return a per-suggestion
  result object alongside the flat lists: ``[{ suggestion_idx,
  created_contact_ids: [...], found_contact_ids: [...], straddled:
  bool }]``.  That's a schema change + a router/use-case touch.
* **Queue UI.**  A corridor accept-all can produce N candidates
  across multiple investigations.  Opening N modal dialogs in
  sequence (the way the single path does) floods the user.
  Options: (a) a single grouped dialog listing every candidate
  with per-row snap/move-geo/skip controls, (b) a queue ribbon at
  the top of the section that pops candidates one at a time with
  "skip rest", (c) a bulk-snap toast that defers individual
  resolution to drag-time.  Owner decision needed before code.

**When to revisit.** When dogfeed shows users hitting bulk-accept
slivers despite the drag-path prompt working.  Pair with #134-C-
bulk and the underlying schema decision on per-suggestion result
objects.

## 135. Two correlation edges from one contact for lens topology — RESOLVED 2026-05-26

**Shipped.** Lens-aware contact-correlate state machine in
``CorrelationEdgesOverlay`` driven by a new ``lastTargetTestId`` field on
``ContactGestureState``. After the first successful correlation the
source stays armed and the target investigation id is remembered; a
subsequent click on a *different* contact in the *same* target
investigation fires a second edge from the same source — the
lens-pinch-out gesture. Generalises to N≥2 clicks (stacked lenses).

Conservative branches: clicking another contact in the source's own
investigation re-arms to it (server would reject same-investigation
self-edges anyway); clicking a contact in a *third* investigation
clears sticky and re-arms instead of silently firing across an unrelated
test.

Schema unchanged — the canonical-ordered unique constraint on the
``(model_id, contact_a_id, contact_b_id)`` triple already permits two
distinct pairs that share an endpoint. Renderer unchanged — one line
per edge, no dedupe, so two edges A→B1 and A→B2 paint as a fork from
A's screen position.

**Adjacent fix.** Phase 1's ``api.geology.listContactCorrelations`` /
``createContactCorrelation`` / ``deleteContactCorrelation`` were
referenced from ``SectionsCanvas`` but had never been wired up in
``client.ts`` — the gesture has been silently failing through the
catch-block since Phase 1 shipped (the backend router, use case,
schemas, repo, and renderer all exist). The three thin wrappers + the
``LithoContactCorrelationEdge`` TS type were added in this commit
alongside the gesture state machine. Without them the lens-pinch-out
gesture would have had nothing to write either.

Tests: ``CorrelationEdgesOverlay.test.tsx`` CC1–CC7 pin the seven branch
paths of the state machine (idle-arm, disarm, first-edge, lens,
source-test re-arm, third-test re-arm, stacked-lens).

(Original filing kept below for design rationale + history.)

---

## 135 (filing). Two correlation edges from one contact for lens topology (Tier G — gesture extension)

**What.** Extend the boundary-to-boundary correlate gesture (debt #133)
so the user can draw both a TOP edge and a BOTTOM edge originating from
the SAME contact. Use case: lens pinch-out terminus on the receiving
column — the lens's top and bottom contacts on column A both converge to
a single contact (or location) on column B where the lens disappears to
zero thickness.

Concretely the user wants this gesture sequence to be expressible:

1. Click the lens's TOP contact on column A
2. Click the corresponding TOP boundary on column B (likely the same
   formation top at column B's lens-free depth)
3. Click the lens's BOTTOM contact on column A
4. Click the SAME contact on column B (the pinch point — lens has zero
   thickness here, both arms terminate at one boundary)

Result: two ``litho_contact_correlation_edge`` rows sharing a
``contact_b_id``. The renderer draws both lines from column A's two
contacts converging at column B's single contact — the classic
pinch-out wedge geometry.

**What probably needs to happen.**

* **Schema**: already supports it. The unique constraint is on the
  canonical-ordered ``(model_id, min(a, b), max(a, b))`` pair — two
  different rows ``(A5, B)`` and ``(A7, B)`` are distinct pairs because
  ``A5 != A7``. No schema change needed.
* **Gesture state machine**: today's contact-correlate flow likely
  resets the "first pick" state after each edge commits. That's fine for
  independent edges; for lens topology the user wants to immediately
  start a SECOND edge that re-uses one endpoint. Either:
  - The state machine stays one-edge-at-a-time and the user just clicks
    twice more for the second edge (re-picking the shared contact). Two
    extra clicks but no UI changes required.
  - OR: add a "compose lens" mode — after committing one edge, hold a
    modifier (Shift?) on the next click to keep the previous contact
    armed as one end of a new edge. Faster but extra UX surface.
  Default: ship the simple shape (two clicks per edge, no modifier).
  Revisit if dogfeed shows the click cost is friction.
* **Renderer**: confirm `CorrelationEdgesOverlay` doesn't dedupe or
  consolidate edges that share an endpoint. Each edge should render as
  its own line. If the basic ribbon helper from #121 merges shared-
  endpoint pairs, the lens wedge won't render — must keep them
  visually distinct OR add explicit pinch-out wedge rendering at the
  shared endpoint (which is closer to #131's deferred lens-aware
  ribbon work).
* **Lens detection (Phase 2 of #133)**: when the lens-detection use
  case lands, the "two edges from A converging to one contact on B"
  pattern is the structural signature it should look for. Phase 2 reads
  this topology and creates the lens entity.

**Why deferred.** Phase 1 of #133 shipped the manual contact-correlate
gesture with a one-edge-at-a-time state machine. The above gesture works
TODAY in principle (the user can click 4 times to make 2 edges sharing
one endpoint), but the UX hasn't been verified against the renderer
and the lens-detection consumer isn't built yet. Worth a focused slice
once the user has dogfed Phase 1 enough to know which UX shape
(simple-two-clicks vs Shift-compose) feels right.

**When to revisit.** Alongside #133 Phase 2 (auto-correlate at contact
level + lens detection). The lens-detection work needs this gesture
shape to work so the user can express the lens topology that
auto-correlate is expected to also produce.
Filed from dogfeed session 2026-05-26.

## 137. Section wheel zoom drifts off the cursor when columns are packed/nudged — RESOLVED 2026-05-29

**What.** In the Sections stage, wheel-zoom (``SectionPanel.handleWheel``)
anchored on a point offset from the cursor. The symptom shows up "to the
right" / drifting, most visibly in litho mode where the Spacing slider is
used and columns are dense.

**Root cause (the earlier stray-``<svg>`` hypothesis was WRONG).** The main
chart ``<svg>`` IS the first descendant of the container, so
``querySelector('svg')`` returns the right element — ``rect.left`` was never
the problem. The actual cause: the section has TWO horizontal mappings. The
linear ``xToScreen`` (viewport along-distance ↔ screen px) and a piecewise
**warp** (``warpedXToScreen`` via ``warpAnchors``) that moves each column from
its true projected X toward a packed position (the Spacing slider lerp) plus
collision nudges. Columns/bands/DEM are drawn at the WARPED position, but
``handleWheel`` inverted only the LINEAR map to find the world point under the
cursor — so whenever spacing < 1 or columns collided, the feature under the
mouse sat at a warped X the zoom was blind to, and content drifted while
zooming. At spacing=1 with no collisions the two maps coincide, which is why
it "worked" by default and read as a litho-only bug.

**Fix.** Invert the warp instead: pure helper
``sections/sectionWarp.ts::warpedScreenXToAlong(px, anchors, scaleH, fallback)``
(unit-tested — identity / packed / round-trip / extrapolation). ``handleWheel``
calls it with the live ``warpAnchors`` (bridged via a ref because the handler
is declared above the warp memo); the linear inverse is the no-anchors
fallback, so spacing=1 behaviour is byte-identical. Commits on develop
2026-05-29.

**Residual (OPEN, Tier E — low priority).** Owner dogfeed 2026-05-29 after the
fix: zoom in close-spaced / heavily-nudged litho mode is "still a bit to the
right" — a small offset, not the full pre-fix drift. The warp inversion fixed
the gross error; a sub-column residual remains, most likely because
collision-nudge anchors are sampled at column centres so the inverse is
piecewise-linear between anchors and a cursor landing mid-segment maps
slightly off. **Why deferred:** the main bug is gone; the residual is cosmetic
and does not lose the user's place. **When to revisit:** if the offset grows
noticeable at extreme spacing, or bundle with any future `warpAnchors`
density/interpolation change. No root cause confirmed — needs a measured
repro (cursor X vs landed-feature X at spacing < 0.5 with collisions).

## 138. Drag-lock after litho merge — handle becomes immovable (Tier G — needs repro)

**What.** After merging two same-lithology layers on a litho ghost
column, the surviving layer's boundary handle sometimes refuses to
move — neither up nor down. The user reports this is intermittent
("sometimes it is impossible to drag a boundary up or down (possible
after merging)").

**Why deferred.** The DR1 / DR2 regression tests
(``LithoSuggestionGhostColumns.test.tsx``) cover the basic "merged
layer still draggable" path and pass. The repro must be a specific
state where ``computeDragBounds`` returns ``boundsAboveM ===
boundsBelowM`` for the survivor, which would clamp the cursor at the
current depth and visually look like the handle is frozen. Candidate
paths:

* Zero-thickness rejected stub from a prior merge sitting between
  the survivor and its true neighbour. ``findVisibleNeighbourAbove/
  Below`` skips ``rejected`` indices but reads the underlying
  ``suggestions[i]`` depths; a stub with ``depth_top_m === depth_base_m
  === survivor.depth_base_m`` would collapse the bound.
* Stale entry in the ``edits`` Map referencing the absorbed (now-gone)
  layer's old idx after a helper-driven absorb shifted indices. The
  partner predicate gate (G33c, shipped 2026-05-26) prevents the
  chain emission but does NOT scrub the post-shift edits Map.

Need an exact dogfeed repro to pick the path:
1. Suggest all on a CPT.
2. Pick two adjacent same-lithology layers and merge them via
   right-click "Merge layers" OR drag-to-collapse.
3. Try to drag the merged layer's base. Note: does the handle's
   cursor change? Is the snap indicator stuck? Capture the React
   DevTools state for ``ghostsByAnchor`` so the ``edits`` Map and
   ``rejected`` Set are visible.

**Fresh repro (dogfeed 2026-05-27).** Owner reproduced the lock on
a different scenario:

> "dragged the sand layer up to absorb a silt layer that was between
> the sand and the clay boundary, now i cant drag the upper contact
> of the clay anymore"

Sequence:
1. Suggest all (CPT GEO-10/172-S3 per the image).
2. Pending layer stack contained CLAY | SILT | SAND (CLAY on top,
   SAND on bottom, SILT in between).
3. Dragged the lower SAND's TOP edge UP through the SILT → SILT got
   absorbed (chain-rejected) and SAND extended up to where the SILT
   used to end.
4. Tried to drag CLAY's TOP contact → frozen.

This is the **across-the-merge boundary** variant of the candidate-2
hypothesis: after absorb, ``edits[SAND_idx].depth_top_m`` extends up
to CLAY's old bottom.  When walking ABOVE from CLAY for edge='top',
``findVisibleNeighbourAbove`` skips no rejected layers (CLAY is at
the top of the active region), so it lands on whatever pending or
accepted neighbour sits above CLAY.  If THAT neighbour's
``depth_top_m`` (or ``depth_base_m`` on a shared boundary read)
equals CLAY's current top after the cascade, the upward bound
collapses to ``own.topM``.  Need to inspect ``ghostsByAnchor`` post-
absorb to confirm which edit is collapsing the bound.

**When to revisit.** Next session — repro is now deterministic.  Fix
candidates:
* Validate ``edits`` Map post-absorb: drop entries whose top/base
  collapse to their neighbour's matching edge.
* Add a defensive ``boundsAboveM > own.topM`` (resp. ``boundsBelowM
  < own.baseM``) check in ``boundFromNeighbour`` — when the computed
  bound equals the current edge, fall back to the next neighbour
  past it instead of locking the handle.
Filed from dogfeed session 2026-05-26, refined 2026-05-27.

## 140. Accept-all-bulk silently auto-correlates → surprises user with amber edges (Tier G)

**What.** ``useGeologicalModel.handleAcceptAllBulkLitho`` (line 4457-
4469) fires ``api.geology.autoCorrelateContacts`` automatically after
every bulk-accept of litho suggestions.  This creates ``source='auto'``
edges with ``user_approved=false``, which render as amber-dashed
correlation lines in ``CorrelationEdgesOverlay``.  Owner dogfeed
2026-05-27: "I didn't press autocorrelate however?" — the user does
not associate the post-Accept-all amber lines with their Accept-all
gesture.

**Why deferred.** Two design directions, owner decision needed:
* **(a) Remove the auto-trigger.** Require an explicit Auto-correlate
  click.  Cleaner mental model but loses the "correlations stay
  fresh after every accept" property.
* **(b) Keep the auto-trigger, surface it.**  Add a follow-up toast
  ("Accept-all triggered auto-correlate — N edges created, click
  Accept correlations to approve") so the user attributes the
  amber lines to the right gesture.  Or add a settings toggle to
  disable the auto-trigger per project.

The single-Accept path (handleAcceptLithoSuggestion) does NOT have
the auto-trigger today — only the bulk path does.  That asymmetry
is itself worth a look in the same pass.

**When to revisit.** When the owner picks (a) vs (b).  Either fix
is small (lines to remove vs lines to add).
Filed from dogfeed session 2026-05-27.

## 141. Combine three correlation toolbar buttons into a grouped affordance (Tier G — UX polish) — RESOLVED 2026-05-27

**What.** The Correlate / Auto-correlate / Accept-correlations
buttons sat as three separate ``ToolbarButton`` instances in
``SectionsToolbar``.  They share a precondition (``sectionHasLithoContacts``
+ ``activeLithoModel`` + ``hasSection``) and form a workflow
(manual or auto correlate → approve).  Owner dogfeed 2026-05-27:
"maybe combine these 3 buttons in a dropdownish menu".

**Resolution.** Picked option (a) from the original three: one
``SplitToolbarButton`` with Correlate as the primary verb (single
click toggles correlate mode) and Auto-correlate + Accept
correlations as caret items.  Reasoning:

* The Correlate mode toggle has a visible active state (amber tint)
  that benefits from being permanently on screen; hiding it inside
  a dropdown would lose that signal.
* Auto-correlate and Accept correlations are one-shot async verbs
  — fine to live behind one extra click.
* The shape preserves the existing CT4/CT5 single-click ergonomics
  on the mode toggle.

Two small extensions to ``SplitToolbarButton``:

* New ``amber`` prop mirrors ``ToolbarButton``'s amber tint for
  the mode-on affordance on the primary half.
* The primary-acts-as-caret fallback (dogfeed 2026-05-23) now
  requires at least one menu item to be enabled — previously
  ``items.length > 0`` was enough, which would have made the
  Correlate primary appear clickable even when all three verbs
  share the same disabled gate.  When every item is disabled
  together (the #141 case) the button is now truly disabled.

**Tests.** CT1-CT11 + ACW1-ACW3 + S5-* adapted: ``openCorrelateCaret``
helper opens the dropdown before the test queries the Auto-correlate
/ Accept correlations items by testid.  CT5/CT8 switched to the
``correlate-mode`` testid to disambiguate the regex collision with
the caret's aria-label.  Two post-flight tests (S5-5, ACW3) re-open
the caret after the in-flight ``finally`` clears so the menu re-
renders with the up-to-date enabled state.

**Files.** ``ToolbarPrimitives.tsx`` (amber + smarter fallback);
``SectionsToolbar.tsx`` (collapse); ``SectionsToolbar.correlate.test.tsx``
(adapt 12 test sites + new helper).

## 143. Accepted litho contacts have low visibility on the litho axis (Tier E) — RESOLVED 2026-05-28

**What.** Owner dogfeed 2026-05-27: "the accepted litho contacts are
a bit hard to see".  Root cause: ``ContactsLayer`` drew each litho
contact's top-boundary line in ``layer.color`` (the formation
colour) — identical to the band it bounds, so the line vanished into
the fill.  #145 made this strictly worse (band fill == formation
colour exactly).

**Resolution.** The per-layer top segment now branches on whether the
formation is a litho unit (``litho_main_soil_code != null``):

* Litho contact → a light halo line (``#f8fafc``, width+2, opacity
  0.6) painted first, then a near-black line (``#0f172a``) on top.
  The near-black reads on the light pastels (ZAND/SILT/GRIND); the
  halo carries the contrast on the dark bands (KLEI ``#6b7280``,
  VEEN ``#92400e``) where near-black alone would muddy.
* Geological contact → unchanged (formation-coloured line, no halo).

Owner picked "black + thin light halo" from the visibility options.
Two vitest pins: litho contact line is ``#0f172a`` + halo present;
geological contact line stays ``formation.color`` + no halo.
Constants ``LITHO_CONTACT_LINE_COLOR`` / ``LITHO_CONTACT_HALO_COLOR``.

## 144. Accept-all (litho) writes directly to DB — wire it through the dirty/manual-save model (Tier G)

**What.** Owner dogfeed 2026-05-27: "accept all - auto saves - we
need to wire it through a dirty/manual save flow".  Today the bulk
"Accept all" path in ``useGeologicalModel.handleAcceptAllBulkLitho``
(and the single-accept ``handleAcceptLithoSuggestion``) POSTs the
generated contacts straight to ``accept_litho_suggestions``, so the
DB row count goes up before the user has had a chance to review +
explicitly save.  This violates the project-wide two-stage save
contract (see ``memory/project_two_stage_save_model.md``): per-
project decisions should mark the project dirty and only land in
the DB + ``.gmproj`` on File → Save.

**Why deferred.** The two-stage model lives at the metadata layer
today; contact mutations were always direct-to-DB.  Wiring accept
flows through it touches the application layer (the accept use
case becomes a STAGED commit), the bus (a new staged-contacts
buffer next to ``ghostsByAnchor``), the lifecycle dirty bag, and
the .gmproj bundle restore path (so a half-accepted-but-unsaved
session can be replayed on next open).  Substantial — touches
every layer.

**Open design questions:**
* Does the staged commit live in-memory only, or in a session-
  scoped DB table that the .gmproj round-trip can capture?
* The same model should probably extend to every contact mutation
  (drag/PATCH, delete, copy-drag, pinch-out, …), not just the
  litho accept flows.  Scoping it just to litho accept is a half-
  measure; doing it for all contact mutations is a bigger refactor.
* Litho ghost state (``ghostsByAnchor``) is already in-memory and
  pre-DB — the staged-accept could just keep the contact in ghost
  state with an ``accepted-but-unsaved`` flag, then commit the
  batch on File → Save.

**When to revisit.** Sequenced with #142-B / #142-C deferred slices
+ any other "user expected this to be reversible" dogfeed reports.
Likely a multi-session feature.  Pair with #142's path-B follow-
through so the staged accept + the ghost-follows-contact-depth
visual stay aligned.
Filed from dogfeed session 2026-05-27.

## 145. Backend litho-formation create stamps grey placeholder color (Tier E) — RESOLVED 2026-05-28

**What.** ``_create_litho_formation`` created new
``GeologicalFormationOrm`` rows with ``color="#9ca3af"`` (neutral
grey) + a comment ``# Phase 2 assigns per lithology`` that never
landed.  Every litho formation stored grey instead of its lithology
colour, so any consumer reading ``color`` directly (exports, .gmproj
bundle, the read-side surfaces in #146) showed grey.

**Resolution.**
* Added ``LITHOLOGY_COLORS: dict[str, str]`` + ``LITHOLOGY_FALLBACK_COLOR``
  to ``shared/constants/litho_constants.py`` — the backend mirror of
  the frontend ``lithoConstants.ts`` table (kept byte-identical; both
  files carry a sync note).
* ``_create_litho_formation`` now stamps
  ``color=LITHOLOGY_COLORS.get(litho_main_soil_code, LITHOLOGY_FALLBACK_COLOR)``.
* Backfill migration ``11878f8a5732`` stamps the lithology colour onto
  every legacy grey row matched by ``litho_main_soil_code`` (one UPDATE
  per base lithology; downgrade reverts only un-hand-edited rows).
  Verified on the dev DB: 78 litho formations (GRIND 1 / ZAND 30 /
  SILT 20 / KLEI 23 / VEEN 4) all carry the correct hex, zero grey.
* Unit pin ``test_c1_created_litho_formation_uses_lithology_color``.

## 146. Remaining grey surfaces post-#145 frontend override (Tier E) — RESOLVED 2026-05-28

**What.** Before #145, a frontend ``lithoFormationColor`` override
patched the grey at two render sites (LithologyInspector chip +
ContactsLayer per-column band) but every OTHER read-side surface
(section labels, contact lines, 3D viewer, exports) read
``formation.color`` directly and showed grey for litho units.

**Resolution.** #145 made the stored ``formation.color`` authoritative
for litho units (correct at create + backfilled), so the override
became dead weight and was **deleted** rather than spread to the
remaining surfaces.  Both call sites now read ``formation.color``
directly; every other surface was already doing so, so they became
correct automatically with no edit.  ``LITHOLOGY_COLORS`` /
``LITHOLOGY_LABELS`` / ``LITHOLOGY_FALLBACK_COLOR`` stay in
``lithoConstants.ts`` — the ghost-suggestion overlay still colours a
layer from them BEFORE any formation row exists.  ``LITHOLOGY_COLORS``
now carries a "keep byte-identical to the backend mirror" note.
PC3b vitest reworked to pin the stored-colour read (was pinning the
removed override).

## 148. Clear button leaves one unit + misleading toast (Tier G) — RESOLVED 2026-05-27

**What.** Owner dogfeed 2026-05-27 (screenshot): after clicking
the "Clear" button on a litho model, the inspector read
``0 contacts, 1 unit`` and a toast fired "Litho model already
empty."

**Root cause.** Both halves were the same #147-class confusion
between project-scoped vocabulary and model-scoped content:
* The pill read ``lithoFormations.length`` (project-scoped).  If
  another litho model in the project referenced the same formation
  (e.g. CLAY), ``ClearLithoModel``'s orphan sweep correctly left
  CLAY alone (still referenced by the sibling) — and the pill on
  the now-empty model surfaced that survivor as "1 unit retained",
  visually contradicting the just-emptied contact count.
* The "already empty" toast was correct on the SECOND click (model
  had been wiped on the first click, second click had nothing to
  delete) but co-existed with the wrong "1 unit" pill, reading as
  a contradiction.

**Resolution.** Today's #147 follow-up rewrote the pill unit count
to ``new Set(lithoContacts.map(c => c.formation_id)).size``
(model-scoped) and the LithologyInspector roster now filters
``lithoFormations`` to those referenced by ``lithoContacts``.  Both
surfaces now read "0 contacts, 0 units" / empty-state after a
Clear, regardless of how many shared-sibling units survive in the
project vocabulary.  The "already empty" toast wording is now
accurate (fires only when the model genuinely has no per-model
content to delete).  ``ClearLithoModel``'s orphan-aware sweep was
correct all along; the bug was on the consumer side.

**No code change for #148 specifically.**  Symptom can no longer
render after the #147 follow-up landed.

## 149. Double SAND / SILT units after Accept-litho (Tier G — OPEN)

**What.** Owner dogfeed 2026-05-27 reported "double sand or silt
units" appearing in the inspector after Accept-litho, even when
the suggestion view showed a single merged SAND ghost.  The
three-revision evolution:
* v1 (shipped + reverted same day): added accept-time
  ``merge_adjacent_same_lithology`` gated on the project toggle.
  Owner re-dogfeed (image #22 → image #23) showed user-split SAND
  ghosts being silently re-merged on Accept; reverted.
* v2 (same day): removed the merge but kept the straddle-split.
  Owner re-dogfeed showed double SAND units still appearing
  because a single ghost crossing an Antropogeen → Quartair
  boundary was auto-split into two contacts under two different
  parent_fids — two units in the inspector, stacked atop each
  other in the section.
* **v3 (final).** Straddle-split also retired.  ``AcceptLithoSuggestions``
  is now a strict 1:1 copy of the suggestion shape regardless of
  geo-boundary crossings.

**Resolution (v3).** ``_compute_straddle_splits`` early-returns
the single-interval, no-boundaries branch.  The multi-boundary
iteration block was deleted.  Each ghost becomes ONE contact;
its ``parent_formation_id`` is the geo formation at the ghost's
TOP depth (via ``_parent_fid_for_depth``).  If the engineer wants
a ghost split at a geo boundary they use the Split-layer gesture
manually before accepting.

``straddle_split_count`` and ``stale_tin_fallback_count`` on
``AcceptLithoResult`` are kept on the response schema for API
back-compat but always 0.  The frontend's "N straddle splits"
warning toast and the "N stale-TIN fallback" pill never fire
under the new rule (next cleanup pass can drop the fields
entirely).

**v3 reverted same day.** Owner re-dogfed and clarified: "i want
it to split on the geologic boundary but that is not what was
happening here".  Straddle-split is the wanted behaviour — the
three-level model needs to assign each interval to its geo
formation, and a ghost crossing the boundary geologically IS
two stratigraphic units (one in the upper formation, one in the
lower).  The doubling the owner saw is from some OTHER mechanism
(filed as #154).

**Final state (v2).** ``AcceptLithoSuggestions.execute`` neither
merges adjacent same-litho ghosts (Suggest-time only) nor
adds any v1-style merge pass.  Straddle-split inside the loop
is unchanged — one ghost crossing a geology boundary → two
contacts under different parent_fids.

**Tests.** AC1 (two adjacent SAND ghosts → 2 contacts), AC2
(one merged SAND ghost → 1 contact), AC3 (SAND/KLEI/SAND triple
→ 3 contacts) pin the verbatim-copy / no-merge invariant.  A2
(ghost spanning boundary → 2 contacts under upper + lower
parent_fids) and A3 (stale TIN falls back to depth-ordering)
pin the straddle behaviour.

**Lesson (so far).** The pending-ghost view IS the user's intent
for adjacency, but the three-level model's geo-parent assignment
runs on top of the verbatim copy.  Don't conflate the two:
merging adjacent same-litho ghosts is reshape; straddle-split
on a geo boundary is the model's correctness rule.  Memory:
[[feedback-litho-accept-verbatim-copy]].

**Still open: actual doubling cause.**  After v2 ships the
verbatim-copy rule and v3 is reverted (straddle restored), the
owner reports the doubling still happens in some scenario —
"i'm still seeing some double sand or silt units after i click
accept litho, how hard can it be to just take the merged litho's
from suggestions and make them permanent ... i want it to split
on the geologic boundary but that is not what was happening
here".  AcceptLithoSuggestions has exactly one place that
creates new ``GeologicalFormation`` rows
(``_create_litho_formation``).  Two formations from "one ghost"
can only come from:

* **Straddle-split** — RULED OUT per owner directive.
* **Admixture-sig drift across investigations.**  The
  find-or-create key is
  ``(parent_formation_id, lithology, canonical_admixture_signature)``.
  Two ghosts on different investigations with the SAME lithology
  but slightly different aggregated admixtures land in different
  formation rows — most plausible candidate for bulk-accept
  scenarios where the "same" SAND layer running through 5
  boreholes produces 5 formation rows.
* **A re-accept missing idempotency.**  ``_find_or_create_contact``
  keys on ``(model_id, formation_id, depth_top_m, anchor)``.
  Float drift between consecutive accepts of the "same" ghost
  would create a duplicate contact — same formation though, so
  visually it would be ONE band with an interior boundary, NOT
  two units in the inspector.  Probably not the cause.
* **Auto-populate vs Suggest aggregation mismatch.**  When
  auto-populate fires before Suggest, observation layers might
  already create formations with one admixture shape; then
  Suggest segments aggregate differently and the accept lands
  in a NEW formation row instead of reusing the existing one.

**When to revisit.** Future dogfeed — owner to reproduce + share
an example of the two units' admixture tooltips so we can see
whether the sigs actually differ.  Once the cause is identified,
the fix likely lives in the segmenter aggregation (stabilise
the admixture signature) or in the find-or-create key (relax
admixture matching).

## 153. Accept-all-bulk wall-clock is 5–10 s on oudenaarde-shape projects (Tier G)

**What.** Owner dogfeed 2026-05-27: clicking Accept-all-bulk on
the oudenaarde project takes 5–10 seconds before the section
view refreshes.  The handler loops over N investigations in the
section corridor, fires one ``POST .../accept-litho-suggestions``
per anchor with ``defer_inference=true``, then calls one
``recompute-all-absences`` after the loop.

Per-call work that scales with N:
* ``GeologyRepository.list_formations(project_id)`` — SELECTs
  every formation in the project (geological + litho).  Runs
  once per anchor; identical results across the loop.  Likely
  the heaviest repeated query on a long-running project.
* Per-suggestion existing-contact SELECT (idempotency check).
* INSERT contact + INSERT formation (when new).
* ``_recompute_litho_display_orders`` (3 SELECTs + UPDATE).
* Single commit (fsync).

**Why deferred.** Three credible fix shapes, each with cost:

* **A. New endpoint** — batch all (anchor, suggestions, section_id)
  tuples into one ``POST .../accept-litho-suggestions-bulk``.
  One transaction, one ``list_formations`` SELECT shared across
  anchors.  Biggest win, biggest refactor (new use-case shape,
  new schema, new frontend wiring).
* **B. Frontend parallel calls** — replace the serial loop with
  ``Promise.all``.  Cheap to write but UNSAFE: parallel accepts
  with the same litho composition would race on find-or-create
  and produce duplicate formation rows.  Needs an atomic upsert
  on ``GeologicalFormation`` first.
* **C. Profile first** — instrument the per-phase wall clock on
  one accept call (project_formations SELECT vs commit vs
  recompute) so we know which bottleneck to attack.  Cheap;
  blocks the others.

**When to revisit.** After (C) — a 30-minute profiling pass on
the oudenaarde project to identify the bottleneck.  Don't pick
between (A) and (B) by guessing; the right answer depends on
whether the cost is HTTP round-trip, SELECT, or commit.

Filed from dogfeed session 2026-05-27.

## 150. Correlation suggestions render in mixed grey + orange (Tier E) — REFRAMED 2026-05-28 → #131

**What (original).** Owner dogfeed 2026-05-27: "correlation
suggestions are grey or orange (weird)".  ``CorrelationEdgesOverlay``
uses ``CONTACT_EDGE_COLOR=#10b981`` (emerald, approved) vs
``UNAPPROVED_EDGE_COLOR=#f59e0b`` (amber, pending).  The emerald at
0.65 opacity reads as washed-out grey next to the amber.

**Reframe (owner directive 2026-05-28).** Asked whether to sharpen the
emerald/amber pair or unify, the owner described a different model
entirely: the correlation BAND (ribbon) between two correlated
contacts should be **split into the lithology colour above and below
the contact**; a contact bounds **exactly two lithologies** (owner
note "a layer contact can't have more than 2 lithologies"); when the
above/below lithology differs between the two ends (a lens), each end
takes its own colour pair and the colours **fade into each other
across the middle** of the ribbon.

That is the lithology-coloured gradient correlation ribbon — a
ribbon-rendering feature, not a colour-token swap. It supersedes the
"sharpen vs unify the edge colour" question (the cheap interim fix is
NOT being done). The spec now lives on **#131** (the lens-aware ribbon
work), which this folds into.

## 156. "Edit in Geology stage" deep-link lands on the 3D viewer + "contact not found" (Tier E)

**What.** Owner dogfeed 2026-05-28: right-clicking a *geological*
(reference) contact on the litho axis → "Edit in geological stage" lands
on the **Geology stage 3D Cesium viewer** (the globe) and fires "Couldn't
find the contact in the current project" twice. The geological model is
edited on **cross-sections**, not the 3D viewer, so the deep-link should
open the section view with that contact focused — not the globe.

**Root-cause hypothesis.** The `onEditInGeologyStage` handler navigates to
the Geology stage (whose default surface is the 3D viewer) and then tries
to focus the resolved `parentGeoContactId` (from
`refGeoContactByAnchorAndFormation` in `ContactsLayer`). The focus lookup
misses (→ the double toast), and the landing surface is wrong. Two things
to fix: (a) route the deep-link to the **Sections** stage with the
relevant section open (or the Geology stage's section-editing context),
not the 3D viewer; (b) pass a contact id the target view can actually
resolve (the double "not found" suggests the id is unresolved or the
target's loaded contact set doesn't include it).

**When to revisit.** Next litho/geology navigation pass. Confirm the
intended target with the owner (Sections stage vs a section-mode Geology
stage) before wiring.
Filed from dogfeed session 2026-05-28.

## 157. Accepted litho units get thin slivers from straddle-split at geo boundaries (Tier G) — CORE + SETTINGS KNOB SHIPPED 2026-05-28

**SHIPPED 2026-05-28 (lever b, the min-thickness guard).**
`_compute_straddle_splits` now drops any geology boundary within
`min_piece_thickness_m` of the ghost's top OR base (a sub-tolerance
crossing → would leave a sliver), and assigns the whole ghost to the
formation covering its **midpoint** (robust: a ghost 99% in the lower
formation no longer mis-parents to the thin upper one). Boundaries clear
of both edges still split. Threaded through `execute()` +
`BatchAcceptLithoSuggestions` as `straddle_min_piece_thickness_m` and
exposed as a per-project **Settings → Litho segmenter → "Sliver guard (m)"**
NumberRow (`view_state.litho_segmenter.straddle_min_piece_thickness_m`,
default 0.20 m, range 0.01–5.0 m), mirroring the #134-A snap-tolerance
knob. AS1-AS3 unit pins + 8 Pydantic schema tests + frontend pref tests.
**Caveats:** (1) preventive, not retroactive — slivers already in the DB
persist until those anchors are re-accepted; no retroactive cleanup was
written (re-accept is safer). (2) This is lever (b); lever (a)
suggestion-stage snap was NOT done — the midpoint-assignment guard made it
unnecessary for the sliver symptom. The deeper structural fix (couple
coincident litho/geo boundaries so they can't drift apart) is **#162**.
Dogfeed-confirmed working 2026-05-28.

**Original entry (for context):**

**What.** Owner dogfeed 2026-05-28: after merging adjacent litho units in
the *suggestion* view and accepting, thin sliver units appear in the
accepted model (e.g. a ~10 cm SAND sliver wedged between CLAY and SAND).
The owner's read is correct: the suggestion merge **is** preserved as one
ghost, but `AcceptLithoSuggestions` **straddle-splits** each ghost at the
geological formation boundaries it crosses (the three-level model assigns
each interval to its geo parent). When a litho ghost boundary sits a few
cm off a geo boundary, the split leaves a sub-tolerance sliver.

**Almost certainly the same mechanism as #149** (the "double SAND/SILT
units after accept" reports): a merged ghost straddling a geo boundary →
two units, the thinner reading as a sliver / the pair reading as a
"double". Treat #157 and #149 as one root cause.

**Fix direction (owner asked "would suggestion-stage snap help?" — yes).**
Two complementary levers:
* **(a) Snap the litho boundary to a near geo boundary before the split**
  — the owner's suggestion-stage snap idea, applied to the straddle-split
  input. If the ghost boundary is within tolerance of a geo boundary,
  align them so the split produces no sliver. Reuses the #134 litho-geo
  snap tolerance (`view_state.litho_segmenter.litho_snap_tolerance_m`,
  default 0.20 m).
* **(b) Minimum-sliver-thickness guard** — when a straddle-split would
  create a segment thinner than the tolerance, absorb it into the adjacent
  segment instead of emitting it. A safety net for the cases (a) misses.

Recommendation: do both — snap is the principled fix, the min-thickness
floor is the backstop. **Decide the snap direction** (move litho to geo,
the common case, vs move geo to litho) with the owner; default to
litho→geo since the geo model is the substrate.

**When to revisit.** This is litho-finishing (Tier G), above the geotech
gate — slivers make the accepted model visibly wrong. Pair with the #149
investigation; they likely close together.
Filed from dogfeed session 2026-05-28.

## 158. Thin litho bands/slivers are hard to click — expand the hit target (Tier E)

**What.** Owner dogfeed 2026-05-28: thin litho bands (incl. the #157
slivers) are hard to click for select/right-click — the band rect is a
tiny target, made worse by the #137 zoom bug (pan-and-zoom dance to get
close). Request: make the click pointer "more sensitive."

**Fix direction.** Give thin bands a **minimum hit-height** that exceeds
their visual height (expand the invisible click-capture rect beyond the
band for bands below ~N px), or route a click near a boundary to the
nearest band. Mind the interaction with #152's contact-drag hit-strips
(`DRAG_HIT_HALF_HEIGHT_PX = 5`) and the band right-click menu (#151) so
the expanded targets don't fight each other. Lower priority than #157
(which *reduces the number of slivers* and so reduces how often this
bites).

**When to revisit.** Polish pass, ideally after #157 lands (fewer slivers
to click).
Filed from dogfeed session 2026-05-28.

## 159. Drag-lock after deleting an accepted litho unit — RESOLVED 2026-05-29

**What.** Owner dogfeed 2026-05-28: after removing an accepted litho unit,
the contact below it can no longer be dragged **up** — the two-ended drag
cursor stops appearing and the contact is locked in place.

**Root cause (not the clamp).** The original #152-clamp hypothesis was
DISPROVEN by a live repro: a guarded clamp diagnostic never fired, and the
deleted contact is pruned from every array the clamp reads. The real cause
is a **hit-strip overlap on the litho axis**. Each geological contact gets
an invisible reference hit-strip (`referenceContactHitStrips`, right-click →
"Edit in Geology stage"), rendered AFTER the litho drag-strips so it paints
on top with `pointer-events: all`. That strip was suppressed only when a
litho contact was **coupled** (`parent_geo_contact_id`) to the geo contact.
But the #134 litho-geo snap dialog ("Snap litho" / "Move geo") leaves the
litho and geo contacts at the **same depth without coupling them** — so the
reference strip sat exactly on top of the litho drag-strip and ate its
hover + mousedown. The deletion in the original repro was incidental; the
trigger is litho/geo coincidence.

**Fix.** `referenceContactHitStrips` now also suppresses a reference strip
when a litho contact on the same anchor is **coincident** (within
`REFERENCE_COINCIDENCE_EPSILON_M` = 1 cm), not only when coupled — same
rationale as the coupled case (the litho contact's own strip handles drag,
its menu still offers "Edit in Geology stage"). RS3 (ContactsLayer.test)
pins the coincident-uncoupled case; RS2 (the 2 m-apart control) still keeps
its strip. GD5 reworked: the old Slice-D z-order assertion (ref strip on
top of a coincident litho contact) encoded this very bug and now asserts
suppression. Commits 58236f87 / 1466bac8 / 049915df on develop.

**Note.** The milder pixel-overlap variant (litho/geo *near but not
exactly* coincident, ~5–15 cm at low zoom) is intentionally NOT covered —
the 1 cm epsilon targets the snap-produced exact coincidence. Widen if
dogfeed reports it.
Filed from dogfeed session 2026-05-28.

## 160. Two-stage save — revert-to-last-save on close (Tier D) — SHIPPED 2026-05-29

**SHIPPED 2026-05-29 ("B", owner directive 2026-05-29 — promoted above the litho
gate).** Approach: instead of a per-mutation staged-commit layer (the heavy option
below), close-without-save **reverts the DB to the last-saved .gmproj** via a new
**replace-restore**. The DB stays the live source of truth during the session; only
the close-flow "Don't Save" branch reverts. Slices:
- **Backend:** `_wipe_project_scoped_rows` + `restore(..., replace=True)` +
  `POST /projects/{id}/restore?replace=true` — wipe the project's child collections
  (geological models by `kind` for the RESTRICT self-FK, then formations / sections /
  reviews / cpts / boreholes; DB cascades the rest) then the existing idempotent
  insert, in one transaction → DB matches the bundle EXACTLY. Integration test pins
  mutation/create/delete revert. Commits 2b0760db / 978876b3 / fb4e6325.
- **Frontend:** `hasUnsavedMutations` flag set by `handleUpdateContactDepth` /
  `handleDeleteContact` / `handleBatchUpdateContacts` (OR'd into `projectDirty` so the
  close prompt fires); `revertToLastSaved` re-reads the .gmproj and replace-restores;
  `handleUnsavedDiscard` reverts (saved project) or falls back to discardSessionImports
  (never-saved), full project reload on the next open. Commits 8b6b955e / 7e7c3d70 /
  44bed339 / 86a3d92c / 30867e38 + tests c599811d / 38fb1a9c. Spec:
  `docs/superpowers/specs/2026-05-29-two-stage-save-replace-restore-design.md`.

**Mutation coverage (expanded 2026-05-29).** `markMutated` now fires from contact edits
(depth/delete/batch), link/unlink litho↔geo, dedupe, toggle-borehole, clear-litho-model,
auto-correlate, clear-suggestions, delete (litho) model, and the section-local edits
(lens-shape, correlation create/delete, Ctrl-drag edge duplicate/retarget). Commits
f6135255 / bb6a92b9 + fixtures 285dbad3. **Still not flagged (known, low-priority):**
GeologyInspector formation-property edits (reorder / rename / colour / pin) and model
create/activate (deliberately excluded — bootstrap auto-create + navigation would dirty
every open). Project **metadata** revert stays on the separate metadata two-stage-save
model.

(Original filing kept below for history.)

---

## 160 (filing). Two-stage save for litho accepts + pending discard-on-close

**What.** Owner dogfeed 2026-05-28 (re-raised, with a wink): "if i close,
non-accepted lithos [should be discarded] and accepted lithos should also
be dirty and only persist if the user saved." I.e. the full two-stage
save (see ``memory/project_two_stage_save_model.md``) applied to litho:
accepted contacts/units stay *reversible in-memory* and only land in the
DB + ``.gmproj`` on File → Save; pending suggestions are dropped on close
without saving.

**Why this is bigger than #144.** #144 (RESOLVED) only made accept flows
mark the project *dirty* (the amber flag + the unsaved-changes prompt fire).
The architecture is still **DB-is-the-live-source-of-truth**: every contact
mutation (accept, drag, delete, correlate) writes to the DB immediately.
True two-stage save means a STAGED commit layer — accepts buffered
in-memory, flushed on save, replayable from the bundle on reopen — which
touches the application use cases, the section bus, the lifecycle dirty
bag, and the restore path (exactly the deferred scope #144's entry called
out). Substantial; spans every layer.

**When to revisit.** When the owner decides reversibility-until-save is
worth the cross-layer refactor — likely alongside a broader "undo stack
for the section editor" effort. Pair with #144's deferred staged-commit
notes. Not a v1.0 gate (the data is safe in the DB today; the gap is
"accepts aren't undoable by closing without saving").
Filed from dogfeed session 2026-05-28.

## 161. Manual correlation can create a self-loop contact edge (Tier E — minor)

**What.** Owner dogfeed 2026-05-28: after a manual "Correlate" the resolver
logged ``_run_resolver: skipped 0 orphan + 1 self-loop contact edge(s)``.
A self-loop = an edge whose two contacts resolve to the same node in the
body graph (most likely two contacts on the **same** investigation, which
isn't a valid cross-investigation correlation). The resolver guards against
it (skips it), so it's non-fatal, but the edge shouldn't be creatable: the
correlate gesture / ``CorrelateLithoContacts`` should reject a same-
investigation pair up front (and the ribbon would render a degenerate
zero-gap band for it).

**When to revisit.** Cheap guard — add a same-anchor rejection in the
correlate use case + the gesture. Fold into the next correlation-gesture
pass.
Filed from dogfeed session 2026-05-28.

## 162. Couple coincident litho ↔ geological contacts (Tier D — structural; the deeper #157 fix) — SHIPPED 2026-05-28 (Slice 1)

**SHIPPED 2026-05-28 (Slice 1 — the full coupling behaviour).** Spec +
plan: `docs/superpowers/specs/2026-05-28-litho-geo-contact-coupling-design.md`
+ `docs/superpowers/plans/2026-05-28-litho-geo-contact-coupling.md`. Built
subagent-driven, 8 tasks:
* **Schema:** nullable self-FK `formation_contact.parent_geo_contact_id`
  (litho→geo) `ondelete=SET NULL` → unlink-on-geo-delete is free at the DB
  layer. Migration `a6a91e68f15a`. Exposed on the contact response schema
  (Py + TS).
* **Accept couple-step:** `_geo_contact_to_link` (nearest geo contact within
  `couple_tolerance_m`); on accept a litho contact within tolerance of a geo
  contact links to it and **snaps the geo contact to the litho depth**
  (geo follows litho — the placed boundary is authoritative). No geological
  contact is ever created; the existing straddle-split already makes the
  litho contacts at geo boundaries, coupling adds the link. Touched geo
  formations are reported up.
* **Auto-rebuild:** after an accept that moved a geo contact, the parent geo
  model's surfaces rebuild once (whole-model — `RebuildModelSurfaces` has no
  formation scoping; gated on a non-empty touched set so a no-coupling accept
  pays nothing; once per batch).
* **Bidirectional propagation** in `UpdateFormationContact`: moving either
  coupled contact moves its partner, with an equal-depth **loop guard** and
  direct repo writes (no use-case re-entry / cross-merge). litho→geo
  propagation marks the geo surface **stale** (rebuild on next Build) rather
  than auto-rebuilding — consistent with the normal contact-edit path,
  avoids a whole-model TIN recompute per drag.
* **Unlink valve:** `UnlinkLithoFromGeo` use case + `POST
  .../contacts/{id}/unlink-geo` + a context-menu "Unlink from geology" item
  (shown only on coupled litho contacts) + a coupling glyph on coupled
  contacts.
* **Tolerance knob:** coupling reads the existing
  `litho_snap_tolerance_m` pref (no new knob); the Settings → Litho
  segmenter snap-tolerance NumberRow was relabelled "Litho↔geology snap (m)"
  to make clear it governs coupling.

**Implementation deviations from the plan (all benign):** (1) the bundle
restore second-pass backfill turned out **unnecessary** — SQLAlchemy's
unit-of-work topologically sorts self-referential FK inserts, so
`parent_geo_contact_id` round-trips as-is (verified by a reversed-order
round-trip test); no `project_bundle.py` change. (2) `RebuildModelSurfaces`
has no `only_formation_ids` scoping → whole-model rebuild, gated on a
non-empty touched set. (3) propagation marks-stale instead of auto-rebuild
(above).

**Relationship to #157:** for the coincident case, coupling subsumes the
#157 sliver guard — a linked litho boundary tracks its geo boundary so a
sub-tolerance gap can't form. The #157 midpoint-guard stays as the
no-geo-contact fallback.

**Slice 2 SHIPPED 2026-05-28** — manual "Link to geology" action. Backend
`LinkLithoToGeo` use case + `POST .../contacts/{id}/link-geo` (links a litho
contact to the nearest geo contact on its investigation within tolerance,
snaps geo→litho, marks the geo surface stale — no auto-rebuild; returns null
when none in range); 5 unit pins. Frontend: `linkLithoToGeo` client call +
`handleLinkLithoToGeo` (toasts when null) + a "Link to geology" context-menu
item shown on UNcoupled litho contacts (the inverse of "Unlink from
geology"), threaded SectionPanel→SectionsCanvas→ContactsLayer; LG1/LG1b
vitest pins. This is the link/unlink toggle the owner asked for ("to
unlink/relink when necessary").

**Drag/menu regression FIXED 2026-05-28** (commit `060436ea`). Coupling
snapped litho contacts coincident with geo contacts, so the geological
reference hit-strip (renders on top, `pointerEvents:all`, only a right-click
handler) overlapped the litho drag-strip → it ate the mousedown (litho
contact wouldn't drag) and the right-click (showed the geo "Edit in Geology
stage" menu instead of the litho menu with Unlink). Fix: suppress the
reference hit-strip wherever a litho contact is coupled to that exact geo
contact — the litho strip then wins, and its menu already carries BOTH "Edit
in Geology stage" and "Unlink", so nothing is lost. Vitest-pinned.

**Auto-rebuild-vs-mark-stale RESOLVED 2026-05-28** (owner directive): drags
+ manual link/propagation moves mark the geo surface **stale** (rebuild on
next explicit Build); only the **accept** path auto-rebuilds. Avoids a
whole-model TIN recompute on every drag.

**Still open (minor):** a `link-geo` endpoint integration test (the use case
has 5 unit pins + the endpoint mirrors `unlink-geo` which has the CP4
integration test; the gap is only the HTTP round-trip for link). Pick up in
the fresh session.

**Original entry (design rationale) below.**

**What.** Owner question 2026-05-28: "if a litho boundary is within 20 cm
of a geological boundary, shouldn't we couple them automatically so that
if one moves the other moves too?" The geological instinct is correct — a
litho boundary coincident with a geological formation boundary IS the same
physical surface (e.g. the top of Boom Klei is both a geo contact and the
top of a litho unit), so they should move together rather than drift apart
and produce slivers (#157).

**Why NOT auto-couple-by-proximity (the analysis the owner asked for):**
* **Implicit magic.** Auto-linking two contacts because they're <20 cm
  apart silently creates a dependency the user didn't declare; later
  moving one jumps the other unexpectedly. The #134 snap is deliberately
  EXPLICIT (a prompt) for exactly this reason.
* **Fragile trigger.** A proximity threshold as the coupling switch is
  jumpy — 19 cm couples, 21 cm doesn't, dragging across the line
  couples/decouples.
* **Ambiguous direction.** geo→litho (parent drives child) is sound — the
  litho model refines the geo substrate. litho→geo (a litho edit mutating
  the upstream geological model) inverts the hierarchy and would surprise.

**Recommended shape (if/when built):** an EXPLICIT, STORED, geo→litho
contact link. When a litho contact is created from / snapped to a geo
contact (via "Seed from geology" [#60] or a "keep linked" option on the
#134 snap prompt), persist a nullable `parent_geo_contact_id` FK on
`FormationContact`. A geo-contact move then propagates to its linked litho
contacts (parent drives child); moving the litho contact does NOT
auto-move the geo, but COULD offer "also move the geological boundary" as
an explicit action. This is the #134 snap made durable + the contact-level
analogue of the existing formation-level `parent_formation_id`.

**Why this is the deeper #157 fix.** A coupled litho boundary literally
tracks its geo boundary, so a sub-tolerance gap can never form → no
slivers, structurally. #157's shipped midpoint-guard is the pragmatic
"now" fix; #162 is the structural "eventually" fix that subsumes it. Only
the SUBSET of litho boundaries the user declares coincident are coupled —
most litho boundaries add detail WITHIN a geo formation and couple to
nothing.

**Why deferred.** Real feature: schema (`parent_geo_contact_id` FK +
migration), propagation logic on geo-contact move, lifecycle (geo contact
delete → unlink the orphan), `.gmproj` bundle round-trip, restore path,
and UI to show/break the link. Phase-shaped, not a quick fix. The #157
guard removes the immediate pain, so this can wait for a deliberate design
pass.

**When to revisit.** When slivers / litho-geo drift keep biting despite
the #157 guard, OR when "Seed from geology" (#60) is revived — that's the
natural moment to add the stored link. Design alongside #134 (snap) and
#60 (seed) since all three are facets of the geo↔litho contact
relationship.
Filed from owner question, dogfeed session 2026-05-28.

## 163. Auto-correlate refinements — adjacent-only, depth band, refresh, deletion, split (Tier G)

Owner dogfeed 2026-05-28 (multiple). All pre-existing auto-correlate
(#127/#133) behaviour — NOT introduced by the coupling work. Grouped here;
each sub-item is independently shippable.

* **(a) Adjacent-tests-only (the headline algorithm change).** SHIPPED
  2026-05-28. Auto-correlate ran model-wide (no section context — owner's
  "along the section" framing didn't map to a 1-D order), and `_mnn_by_id`
  keys on canonical contact ids not geometric sides, so skip-over diagonals
  survived (test 1↔3 over test 2 = spaghetti). Owner directive: "just do all
  and delete all spaghetties" → keep it model-wide. Fix: a
  relative-neighbourhood-graph adjacency gate (`_relative_neighbourhood
  _adjacency`) over the model's participating investigations — a pair A-B is
  dropped if a third test lies in the RNG lune between them. For collinear
  tests this is exactly the consecutive chain (1-2, 2-3, …); generalises to
  a 2-D scatter, so it kills the spaghetti everywhere, not just per-section.
  Computed once, group-agnostic. Pinned by the 4-collinear-tests unit test.
* **(b) Depth-match window now user-tunable.** SHIPPED 2026-05-28. Exposed
  the auto-correlate depth-match window as a Settings → Litho segmenter
  NumberRow ("Auto-correlate depth window", default 0.5 m, range 0.05–5.0 m,
  persisted in `view_state.litho_segmenter.auto_correlate_depth_window_m`).
  `handleAutoCorrelate` reads it and passes it to the endpoint, which builds
  `AutoCorrelateContactParams(base_depth_threshold_m=…)`. Widen to catch
  correlations across dipping beds; narrow to reject loose matches. Dip-aware
  auto-tuning stays future work — the knob is the pragmatic answer.
* **(c) Results don't render until manual refresh (image #8).** SHIPPED
  2026-05-28. The guessed cause ("missing refetch in `useGeologicalModel`")
  was wrong — the contact-correlation edge state lives in `SectionsCanvas`,
  not the hook, so `handleAutoCorrelate` (fired from the sibling
  `SectionsToolbar`) could not refetch it directly. Fix: a coordinator
  refetch nonce (`correlationEdgesRefetchNonce`, same cross-boundary pattern
  as `geoDeepLinkTarget`) — `handleAutoCorrelate` bumps it via the new
  `requestCorrelationEdgesRefetch` arg on success, and `SectionsCanvas`
  lists it in its edge-refetch effect deps. AC1/AC2 pin the hook contract.
* **(d) Hard to grab a correlation endpoint to re-target (image #9).**
  SHIPPED 2026-05-28, then **REDESIGNED 2026-05-29** (task #31 — supersedes
  the 22 px endpoint-handle approach). The tiny endpoint handles
  (`unapproved-grab-a/b` rects + `DRAG_HANDLE_SIZE`/`DRAG_HANDLE_HIT_SIZE`)
  are gone. The whole seam is now grabbable as two transparent
  midpoint-split line zones (`edge-grab-a/b`, `EDGE_DRAG_HIT_WIDTH = 18`,
  inset at the contacts so contact-drag still wins there). Each half drags
  its NEARER endpoint. The drag MODEL also changed: plain left-drag retargets
  the grabbed end; **Ctrl/Cmd-drag leaves the original edge and creates
  another from the same anchor to the drop** ("create an extra boundary where
  I drag to") → forms a wedge when the drop is the layer's other boundary
  (1↔2 → DetectLithoLenses). Replaces the earlier same-investigation
  lens-split heuristic with an explicit modifier. CE-D1/CC11/CC12 pin the
  zones; the drag commit itself (window mousemove/up + `elementsFromPoint`)
  is dogfeed-verified, not unit-tested. Commits on develop 2026-05-29.
* **(e) Right-click anywhere on a correlation → delete.** SHIPPED 2026-05-28,
  adjusted 2026-05-29 by the (d) redesign. `onRequestDeleteEdge` +
  `EdgeContextMenu` unchanged; the right-click hit target now lives on the
  `edge-grab-a/b` zones for UNAPPROVED edges and on the full-ribbon
  `edge-hit-<id>` polygon (`EDGE_HIT_STROKE_WIDTH`) for APPROVED edges (which
  have no grab zones). SectionsCanvas reuses `handleDeleteContactCorrelation`
  (optimistic remove + DELETE + refetch). CE-E1/E2/E3 pin it.
* **(f) Right-click a suggestion → "split suggestion into 2" for lenses.**
  Owner wants to split one litho suggestion into two contacts that can be
  dragged apart, to model a lens (a unit that pinches in/out between tests).
  This is a lens-authoring gesture — relates to the deferred lens work
  (#131-a lens_id, #101). Design the gesture: right-click a ghost/accepted
  band → "Split into two" → creates two contacts at the band's top/base (or
  at a chosen depth) that the user drags independently; the pair is a lens
  body. Bigger than (a)-(e); needs its own design pass alongside the lens
  model.

**Priority within #163:** (a)+(b)+(c) SHIPPED 2026-05-28; (d)+(e) SHIPPED
2026-05-28 then redesigned 2026-05-29 (whole-seam grab + Ctrl-drag, task #31).
Only (f) split-suggestion-into-2 for lenses remains — a feature needing a
design pass alongside the lens work (#131-a lens_id / #101). Note the
2026-05-29 Ctrl-drag now offers a complementary drag-based lens path (anchor →
both boundaries), so (f) is no longer the ONLY route to a lens — its remaining
value is splitting a single suggestion in place. Tier G (litho-finishing)
since auto-correlate is part of the litho stage. Filed from dogfeed session
2026-05-28.

**Dogfeed follow-ups 2026-05-29 (both SHIPPED):**
- **Bottom layer never auto-suggested.** The mutual-nearest-neighbour step
  ran group-wide keyed on canonical `(min, max)` contact ids, so along a
  chain of tests one column could "win" a shared contact and orphan the
  matching boundary on its other neighbour — verified in the dev DB
  (`019e6f56-…`): S33's deepest KLEI @ 15.47 m sat 0.57 m from S13's deepest
  KLEI @ 14.90 m yet had no edge. Fix: MNN now runs **per adjacent
  column-pair** (RNG adjacency already blocks skip-over spaghetti), letting a
  contact link to both its chain neighbours. Pinned by
  `test_chain_does_not_orphan_a_boundary_when_neighbour_matches_a_third_test`.
  Needs a backend restart to take effect.
- **Could not delete an accepted correlation.** The backend DELETE deletes
  regardless of approval; the bug was the hit target. Approved edges show no
  grab handles, so only the thin 14px seam (not the visible coloured ribbon)
  was right-clickable. Fix: the right-click hit target is now a band-shaped
  polygon covering the full ribbon (inset at the column ends so
  contact-dragging still wins). Pinned by CE-E3.

---

# ═══ Overnight code-health audit (2026-05-28) ═══

Filed from a four-agent read-only audit (backend duplication, frontend
duplication, test+logging coverage, Playwright wiring) run 2026-05-28 night.
These are **code-health / maintainability** items, not dogfeed bugs — none
blocks the litho stage. They are NOT auto-implemented: the high-value ones are
god-component splits + a generic-component extraction, exactly the multi-file
refactors that want a human in the loop before execution. Ranked roughly by
value within each area. Effort S/M/L.

## 164. Generic `<ContextMenu>` — RESOLVED 2026-05-29

Shipped `components/ui/ContextMenu.tsx` (`{items:[{label,onClick,danger?,
disabled?,reason?,topBorder?,testid?}], header?, onClose, ariaLabel?, testid?,
portal:'svg'|'fixed'|'absolute', x, y, width?, height?}`). All four menus —
`ColumnContextMenu`, `ContactContextMenu`, and the `BodyContextMenu` +
`EdgeContextMenu` pair — are now thin wrappers that build an items array; the
positioned container, the danger/disabled/reason item styling, the divider
borders, and the dismiss logic (svg backdrop click/right-click vs DOM document
click + Esc) live once in the component. The `portal` prop encodes the
`<foreignObject>` (canvas) vs DOM (fixed/absolute) split; the SVG variant keeps
the dark inline styling so the canvas look is unchanged, the DOM variant uses
the shared light+dark Tailwind chrome. The latent double-`onClose` bug is fixed
for every DOM menu (item clicks call `stopImmediatePropagation` once, in the
component). Esc now closes every variant. 7 new component tests (CM1–CM7) +
all existing consumer tests (ColumnContextMenu 8, CorrelationEdgesOverlay 37,
ContactsLayer 83) pass unchanged; full suite 1436 green. Per-file commits on
develop 2026-05-29.

## 165. Generic `<ConfirmDialog>` + `Button` forwardRef — RESOLVED 2026-05-29

(a) `ui/Button.tsx` now uses `forwardRef` (FR5 test pins it). (b) Shipped
`components/ui/ConfirmDialog.tsx` `{open, title, body, confirm, secondary?,
cancelLabel?, cancelTestid?, onCancel, busy, labelledBy, titleTestid?,
cardClassName?, testid?}` — it owns the Modal + the default-focus-Cancel ref
effect + the Cancel/[secondary]/confirm button row. The optional `secondary`
action covers the three-button cases, so all four confirms collapse onto it:
`DeleteContactConfirmDialog` (danger), `CopyCompositionConfirmDialog` (primary),
`ReCorrelateConfirmDialog` (Skip secondary + Re-correlate danger),
`UnsavedChangesDialog` (Discard ghost secondary + Save primary). Each is now a
thin wrapper passing rich title/body as ReactNode; every testid + role + the
cancel-focus a11y is preserved (existing dialog tests pass unchanged).
`LithoGeoSnapDialog` also dropped its two plain-`<button>` workarounds for
`Button` (it default-focuses Snap, not Cancel, so it stays a bespoke 3-button
Modal rather than a ConfirmDialog). `PinchOutGhostOverlay` left as-is — a compact
inline ghost-preview panel with bespoke full-width styling, not a modal confirm,
so forcing `Button` there would be a visual change for no real dedup. 5 new
ConfirmDialog tests (CD1–CD5) + Button FR5; full suite 1442 green. Per-file
commits on develop 2026-05-29.

## 165b. `.gitignore` e2e artifacts — SHIPPED 2026-05-28

`desktop/tests/e2e/_results/` + root `.e2e-backend.err` (run artifacts) were
untracked and at risk of accidental commit; added to `.gitignore`.

## 166. Backend project-scope guard re-hand-rolled in `application/` — RESOLVED 2026-05-29

Shipped `application/scope_guard.py::load_scoped_or_raise(session, orm_class,
entity_id, project_id, *, label, attr="app_project_id")` (pure async, no logger;
raises `ValueError` with an identical message for missing-vs-wrong-project so the
two can't be distinguished). 4 unit tests. Migrated the **single-stage** sites —
load-by-id + own `app_project_id` + message references that id — across 12 files:
`create_formation_contact`, `accept_contact_correlations`,
`auto_correlate_contact_edges`, `correlate_litho_contacts` (×2),
`propagate_litho_admixtures` (×2), `name_lens_body` (×2),
`recompute_all_absences_for_model`, `recompute_formation_absences_for_body` (×3),
`recompute_formation_absences_for_formation`, `upsert_formation_absence`,
`extrapolate_pinch_out`, `accept_litho_suggestions` (×4). Full unit suite (1102)
+ integration API suite (170, exercises the cross-project-rejection paths) green.

**Intentionally NOT migrated (different shapes — a uniform helper would change
behaviour):** `link_litho_to_geo` / `unlink_litho_from_geo` load a *contact* then
scope-check its *model*, but the error message references the contact id — the
load-helper would surface the model id instead; `materialize_wedge_tips_for_formation`
**warns + returns** an empty result on scope failure instead of raising (graceful
skip, not an error); the lens trio `create_perpendicular_companion` /
`delete_lens_metadata` / `lens_boundary` carry a second `model_id` scope dimension
(and two check an already-loaded row, not a fresh `session.get`). These keep their
inline guards; the common pattern is now single-source. Per-file commits on
develop 2026-05-29.

## 167. Litho-accept payload + created-rows-session-import duplicated 4× — RESOLVED 2026-05-29

Shipped `utils/lithoAccept.ts` (4 unit tests LA1–LA4):
`buildLithoAcceptBody({anchorKind, anchorId, sectionId, suggestions, viewState})`
+ `lithoAcceptTuningParams(viewState)` (one `readLithoSegmenterPrefs` call, not
two) + `recordCreatedRows(addToSessionImports, result)`. All four accept handlers
in `useGeologicalModel.ts` migrated: single-accept / accept-all / bulk-one build
their body via `buildLithoAcceptBody`; the bulk-all **batch** body (different
shape — `defer_inference` per-anchor, `run_inference` + tuning at the top level)
spreads `lithoAcceptTuningParams`; the #144 dirty-flag manifest block is now
`recordCreatedRows` in all four (the bulk-all aggregated arrays flow through it
too). `readLithoSegmenterPrefs` drops from 8 accept-path calls to 4 (one per
site). Resolves the payload half of #111 (the bypassed-`_updateGhostEntry` half
stays under #111). Full suite 1446 green; tsc clean. Per-file commits on develop
2026-05-29.

## 168. Section SVG geometry — RESOLVED 2026-05-29 (shared depth axis; rest declined after investigation)

Shipped the one genuine dedup: `depthAxisAtSurface(levelToScreen, surfaceElevationM)`
in `sections/utils.ts` → `{surfaceY, pxPerMetreDown, depthAtY, yAtDepth}`, sampling
the rate at the surface exactly as the old inline code did (byte-identical). Replaced
the duplicated `oneMetreDownPx` / `surfaceY` / `depthAtY` blocks in `BoreholeColumn`
+ `ContactPickBar`. Tests DA1–DA3; full suite green.

**The other two proposed pieces were investigated and declined (owner-confirmed
2026-05-29):**
- **`buildContactScreenMap` + `bandRectsFromContacts` relocation — not a real dedup.**
  `buildContactScreenMap` + `bandRect` already exist (exported from
  `CorrelationEdgesOverlay`), built for the correlation-ribbon anchoring, and have
  **no other consumer**. The other overlays don't open-code *the same* mapping —
  `LithoSuggestionGhostColumns` maps suggestion depth-ranges, `ContactsLayer` renders
  TIN slices + contact lines, `PinchOutGhostOverlay` doesn't use `levelToScreen` at
  all. Moving the helper to `utils.ts` would be pre-abstraction for a 2nd consumer
  that doesn't exist (against the repo's "wait for the second use" rule).
- **`SectionViewportContext` — behaviour-neutral churn.** `levelToScreen` is passed as
  a prop in ~dozens of unit-test sites (`BoreholeColumn`/`ColumnGlyph`/`ContactPickBar`/
  `ContactsLayer` tests). Moving it into a context forces rewriting all of them (+ TDZ
  risk on the 6-component rewire) for zero functional gain, and "no backwards-compat
  shims" rules out an optional-prop-with-context-fallback. The prop-drill is mild;
  not worth the cost.

## 169. Plaxis 2D/3D exporters share 4 byte-identical methods — RESOLVED 2026-06-01

Subsumed by #110 resolution. `_emit_imports_and_connect`, `_emit_materials`,
`_emit_global_layers`, `_material_variable_name`, and `_py_str` extracted to
`plaxis_script_helpers.py`. Both exporters import from it. No `PlaxisScriptBuilder`
mixin was needed — module-level functions behind a `_HasNameAndOrder` Protocol
are simpler and sufficient (the two formation types differ structurally, not
behaviourally).

## 170. Litho-geo coupling helper extractions — kill the #162/#134 drift risk (Tier E — backend, S each)

**What.** Several small but load-bearing blocks exist as verbatim twins, each a
behaviour-drift risk in the coupling logic: (a) `_load_geo_contacts_at_inv`
(`link_litho_to_geo.py:165-204`) ≡ `_load_geology_contacts_at_inv`
(`accept_litho_suggestions.py:909-946`) — same query verbatim; (b)
`_nearest_within_tolerance` (`link_litho_to_geo.py:243`) ≡ `_geo_contact_to_link`
(`accept_litho_suggestions.py`) — the coupling-decision heart of #162, twice; (c)
the `0.20 m` default repeated across 7 signatures under three names
(`straddle_min_piece_thickness_m` / `couple_tolerance_m` / `tolerance_m`) that are
*meant* to be one value (`accept_litho_suggestions.py:289,290,958`,
`batch_accept_litho_suggestions.py:118,119`, `link_litho_to_geo.py:65`); (d) the
`is_stale=True` surface flip implemented per-mutation-use-case with function-local
`from sqlalchemy import update`. **Why.** A tolerance/tie-break fix lands in one
path (auto-accept vs manual-link) → the exact #134/#162 drift class; one missed
is-stale flip silently breaks the on-click-build UX contract. **Fix.**
`litho_geo_helpers.py`: `load_contacts_at_investigation(...)` +
`nearest_contact_within_tolerance(...)`; `LITHO_GEO_DEFAULT_TOLERANCE_M = 0.20` in
a `litho_constants.py`; `GeologyRepository.mark_surface_stale(model_id,
formation_id)` for all mutators. **Effort.** S each.

## 171. Router-layer inline `HTTPException(404)` vs `get_in_project_or_404` inconsistency (Tier E — backend, S)

**What.** `api/routers/geology/formations.py:346,524` + `lenses.py:263,334,403`
raise `HTTPException(404)` inline while the sibling `contacts.py` uses
`get_in_project_or_404` 22×. **Why.** Inconsistent guard surface; a scope-rule
change misses the inline copies. **Fix.** Route through the helper. **Effort.** S.

## 172. Shared `<AdmixtureRowsEditor>` for the two litho composition editors (Tier E — frontend, M)

**What.** `LithoCompositionPickerDialog.tsx` (595 ln) + `LithoGhostCompositionEditor.tsx`
(350 ln) both render a main-soil + admixture-row editor; the ghost editor's header
(:5-15) calls itself a "simpler shape, no tabs" of the picker. Admixture-row
add/remove/edit is duplicated. **Fix.** Extract `<AdmixtureRowsEditor>` (the shared
list widget); the picker keeps its two-tab "existing units" chrome on top.
**Effort.** M.

## 173. Promote `NumberRow`/`CheckboxRow` out of SettingsDialog (Tier E — frontend, S)

**What.** `SettingsDialog.tsx:550` (`NumberRow`) + `:627` (`CheckboxRow`) are file-local
labelled-row wrappers (label+hint+control+bounds). `ui/NumericInput` exists but not
the labelled rows. **Why.** Next settings/inspector form re-hand-rolls them.
**Fix.** Move to `components/ui/` on second use (low urgency — one consumer today).
**Effort.** S.

## 174. Backend test gaps — mutation use cases + 3 exporters (Tier D — backend, M; extends #116)

**What.** C1 (`RebuildModelSurfaces`) and C2 (`SectionPdfReportExporter`) covered by #116 (2026-06-01). Zero-coverage remaining: **C3** `GeoStudioExporter` +
`DSheetExporter` (no tests, while Plaxis exporters are tested — exports are the
handoff); **C4** `SuggestLithoContacts` use-case wiring (owns a cross-project scope
guard + TAW conversion + observation-priority fallback — security-relevant,
untested); **C5** `BuildSectionSnapshot`/`BuildGroundModelSnapshot` only indirect
coverage (projection math feeds every exporter); **C6** lens/companion/wedge-tip
mutation use cases (`create_perpendicular_companion`, `name_lens_body`,
`delete_lens_metadata`, `upsert_formation_absence`, `materialize_wedge_tips_for_formation`
— the skip-and-count branches at :478/:633 untested). **Fix.** A test per item
(golden-output for exporters; integration for the guarded use cases). **Effort.** M.
(Domain services — TIN, pinch-out geometry, Robertson, age-order, lens inference —
are already well covered; this is the application/exporter layer.)

## 175. Frontend test gaps — the state-machine + geometry hot spots (Tier D — frontend, M/L)

**What.** **C7** `useGeologicalModel.ts` (5084 ln) has only narrow-slice tests; the
four accept handlers + drag-commit + the #134 litho-geo snap cascade are not
behaviourally pinned — this is where dogfeed #138/#149/#157/#159 live. **C8**
`SectionsCanvas.tsx` (1992 ln) wheel-zoom anchor math (the #137 bug) + pan +
drag-commit geometry untested — extract the transform math into a pure helper and
pin it (land the #137 fix with a regression test). **C9** `useSections.ts`
seed/draw/`applyUpdatedSection` path untested though the "nothing appears" bug has
recurred 3× (memory). **C10** several `shell/stages/*` canvas tests are render-only
("renders without crash") on interactive logic — audit each for ≥1 behavioural
assertion, rename pure mounts to explicit "smoke". **Effort.** M (C8/C9/C10), L (C7,
pairs with the #111/#175b split).

## 177. `_reorder_by_age` assigns youngest formation the LOWEST display_order — RESOLVED 2026-06-01

`_reorder_by_age` now reverses `infer_age_order`'s youngest-first output before
slot assignment, so the oldest contact-bearing formation gets the lowest free
slot and the youngest gets the highest, matching the CLAUDE.md "lower
`display_order` = older" convention. Orphan formations still append at the
end (high display_order / youngest slots), preserving the "manual drag-reorder
on an unplaced formation survives Build" property. RS5 in
`tests/integration/application/test_rebuild_model_surfaces.py` is no longer
`xfail` — it's a passing regression guard.

## 176. Logging cleanups — exporter instrumentation + renderer `log` wrapper (Tier E, S)

**What.** **L1** `SectionPdfReportExporter` has ~2 log calls in a multi-phase render
pipeline — add INFO entry (section id, investigation count) + per-phase DEBUG +
SUCCESS exit with byte size (DoD). **L2** `GeoStudioExporter`/`DSheetExporter` show
no entry/exit logging — confirm + add, mirroring `PlaxisExporter`. **L3** raw
`console.*` instead of the `[ui …]` `log` wrapper in `api/client.ts` (2),
`useGeologicalModel.ts` (3), `LithoCompositionPickerDialog.tsx` (3),
`utils/lithoLayerMerge.ts` (2 — pure util, should take a logger param or drop it
per helper-hygiene), `ContactsLayer.tsx` (5). **L4** `client.ts` (2551 ln) doesn't
import `log`; add one `log.error('api', method, url, status)` at the fetch-wrapper
error boundary (one seam) per DoD "external calls log URL + status". **Positive:**
backend use-case/parser logging is DoD-compliant (DOV importers log HTTP status +
per-row `[i/total]`; no silent `except: pass` anywhere in `application/`); no empty
`catch {}` in the renderer. **Effort.** S.

## 177. Playwright e2e is NOT wired for code review (Tier D — testing, M)

**Verdict from the audit:** Playwright IS installed (`@playwright/test ^1.60.0`),
configured to drive **Electron** via `_electron.launch` (`desktop/playwright.config.ts`,
`tests/e2e/helpers/electron_launch.ts`), with a solid 1060-line read-only pg
assertion toolkit (`db_helper.ts`, guarded to `_integration`/`_test` DBs). The
harness ran green on 2026-05-26. BUT it is not a review gate. Sub-findings: **(a)**
pre-commit smoke (`.githooks/pre-commit:70-88`) runs `test:e2e:smoke` only when
backend reachable on :8765 AND `out/main/index.js` exists — else it silently
no-ops; and it never exports `E2E_FIXTURE_PROJECT_ID`, so even when it runs it
SKIPS its own #129a /lenses-500 regression block. Reverting the #129a fix would not
turn a commit red. **(b)** No single-command bootstrap — the full suite needs 5
manual steps (build, backend, Postgres, fixture builder, env var); add
`scripts/run-e2e.ps1` mirroring `run-integration-tests.ps1`. **(c)** ~⅓ of "e2e"
specs drive the backend via `page.evaluate(fetch(...))` not UI gestures
(`flow_bulk_accept` explicitly bypasses the toolbar) — they'd stay green if the
React wiring broke; reclassify or promote the high-value ones to real UI paths.
**(d)** 4 specs are permanently `test.skip(true, '…fixture .gmproj not yet wired')`
— `flow_create_formation`, `flow_build_3d_model`, `flow_crossing_validator`,
`flow_drag_reorder_formations` (all v1.0-gate features) — the launch helper only
boots to the welcome screen; wire an "open project" path and un-stub. **Why.** Debt
#128/#130 claim a regression net that, in the only automated context, doesn't run.
**Effort.** M (bootstrap script + un-skip) — the rest is reclassification.

## 178. God-component / large-file splits (Tier D — both, L; extends #111/#114)

**What.** Files past readable size, confirmed by the audit: `useGeologicalModel.ts`
5084 ln (~50 handlers — split into `useGeologicalContacts` / `useLithoModelLifecycle`
/ `useLithoSuggestions` / `usePinchOut` behind a thin facade preserving
`UseGeologicalModelResult`; seams already marked by comment banners),
`ContactsLayer.tsx` 4198 ln (extract `ContactContextMenu` → #164, `useContactDrag`
hook, `ContactBands` child), `SectionPanel.tsx` 2696 ln / **69 props** (route stable
`geoModel`/`sections`/`coordinator` slices via `useShell()` in the leaf overlays
instead of prop-threading — pairs with #168), `LithoSuggestionGhostColumns.tsx`
2407 ln, `SectionsCanvas.tsx` 1992 ln, plus backend `accept_litho_suggestions.py`
1582, `contacts.py` router 1566, `auto_populate_contacts_from_stratigraphy.py` 1565,
`project_bundle.py` 1413. **Why.** Unreviewable, hard to test in isolation, every
consumer re-renders on any handler-identity change; these are where the dogfeed
bug cluster lives. **Fix.** Incremental extraction along the marked seams; do NOT
big-bang. **When to revisit.** Take one split per quiet period; #164 (ContextMenu)
+ #167 (accept body) are the cheap first cuts that shrink two of them. **Effort.** L.

## 179. No "Clear suggestions" — stale auto-correlation edges can't be removed/overwritten from the UI (Tier G — dogfeed 2026-05-29) — SHIPPED 2026-05-29

**SHIPPED.** Root cause was deeper than a missing button: the contact-level
bulk-delete endpoint never existed (the formation-level one was removed in #133
Phase 3), so the frontend's `deleteAutoCorrelations` 405'd and re-correlate's
"delete + regenerate" silently no-op'd. Fix: new `DELETE
/contact-correlations/auto` (removes `user_approved=false` only, keeps approved
manual; 3 integration tests) + a "Clear suggestions" toolbar button
(`handleClearSuggestions` → endpoint → #163c refetch nonce), gated on the model
only (not section contacts) so off-section/model-wide suggestions are clearable.
Original gap description retained below.


**What.** A litho model accumulates unapproved `source='auto'` correlation edges
(dogfeed 2026-05-29: model "qdfv" had **204** of them, none orphaned). The user
could neither delete nor overwrite them from the app and had to have them removed
directly from the DB. The removal paths that exist don't cover this:
- **Per-edge right-click delete (#163e)** only renders a hit-strip for edges whose
  contacts are seeded on the *current* section, and at 204 edges it's hopeless
  anyway.
- **Re-correlate (the only bulk path)** does `deleteAutoCorrelations` → then
  immediately re-runs auto-correlate, so the same suggestions regenerate — it
  *overwrites with the same set*, it doesn't *clear*.
There is no action that simply removes the unapproved suggestions and stops.
**Why it matters.** Stale suggestions clutter the section and block the litho
workflow; the only recovery was a manual `DELETE FROM litho_contact_correlation_edge
WHERE user_approved=false`. **Fix.** A "Clear suggestions" toolbar action wired to
the existing `deleteAutoCorrelations` endpoint (deletes auto/unapproved edges only,
keeps approved manual correlations) + a confirm + the #163c edge-refetch nonce so
the canvas updates without a reload. **Effort.** S. Likely also worth: a follow-up
to let per-edge delete reach off-section edges (or surface a model-wide suggestion
count so the user knows there are off-section suggestions to clear).

# ═══ Body-with-extent audit (2026-06-01) ═══

Four parallel agents (reuse / correctness / efficiency / security) reviewed
the ~50-commit body-with-extent refactor diff on `develop`. Goals 1+2 from
this pass were shipped immediately (C1 blocker fix, R2/R3 refactor, S1 scope
guard). Items below are the deferred findings — each one is real but not
blocking the geotech stage.

## 180. R1 — RESOLVED 2026-06-01. `pinch_out_halfway` and `extrapolated` switch arms
collapsed into a shared fall-through (`case 'pinch_out_halfway': case 'extrapolated':`)
in switch #1 (towardAlong derivation). Module-scope `halfwayFarPoint` helper extracted
(exported); three inline midpoint copies replaced. HFP1-HFP3 pin the helper contract.

## 181. C2 — RESOLVED 2026-06-01. `_doClaimExtent` helper extracted in `SectionsCanvas.tsx`.
`_doClaimExtent(bodyId, side, kind)` calls `api.geology.claimBodyExtent` directly
with no 409→dialog branch — it updates local state on success and rethrows all errors.
`handleClaimBodyExtent` delegates to `_doClaimExtent` and wraps with the
`ProvenanceViolationError → setProvenanceConflict` branch for first-time claims.
`onApply` now calls `_doClaimExtent` instead of `handleClaimBodyExtent`; if the retry
still hits 409 (concurrent DetectBodies sweep between clear and re-claim) it shows
`"Couldn't claim extent — try again."` toast without reopening the dialog.
BPR-1/BPR-2/BPR-3 in `SectionsCanvas.provenance.test.tsx` pin the three paths.

## 182. C3 — RESOLVED 2026-06-01. Bundle JSON keys renamed `litho_lens_shapes` → `body_boundary_shapes` and `litho_lens_boundary_nodes` → `body_boundary_nodes` in lockstep across Pydantic schema (`ProjectBundleRequest` / `ProjectBundleResponse`), repository build/restore paths, router kwarg forwarding, frontend `ProjectBundleResponse` type (`client.ts`), `ProjectFileV3` type + `buildProjectFile` / `parseProjectFile` / `isProjectFileV3` (`projectFile.ts`), `useProject.ts` revert path, and three integration test files. `rg` confirms zero stale occurrences across `src/`, `desktop/src/`, `tests/`. 1133 unit + 38 integration tests green.

## 184. E2 — RESOLVED 2026-06-01. Map builds (`bodyById`, `contactById`, `colByInv`,
`invByContact`, `depthByContact`, `edgePairs`, `neighboursByContact`) and the full
`resolved` array construction wrapped in a single `useMemo` with deps
`[bodies, contacts, placedColumns, contactEdges, boundariesByBodyId, screenXToAlong,
sectionStartScreenX, sectionEndScreenX]`. Drag-mousemove renders (which only change
`drag` state) now skip the O(bodies × contacts) pass entirely. `worldPtEdge` exposed
from the memo return for the ghost-candidate section. E2-RERENDER pins correctness
across re-renders.

## 185. E3 — `refetchLensData` fires N boundary GETs per body list update (Tier D — backend/frontend, M)

**What.** Every accept/correlate/detect triggers `refetchLensData`, which
calls `GET /bodies/{bid}/boundary` once per body in `lensList` — so N bodies
= N sequential GET requests.  This is the pre-existing lens pattern; the
body-with-extent refactor increased the exposure (more paths now call
`refetchLensData`).

**Fix.** Add a `GET /models/{mid}/bodies?include_boundaries=true` bulk
endpoint (bodies + their boundary nodes in one response).

**When to revisit.** When a section commonly has > 15 bodies and the
post-detect refetch latency is felt by the user.

## 186. E4 — `SuggestBodyPinchOuts` neighbour search is O(I²×C) (Tier D — backend, S)

**What.** `SuggestBodyPinchOuts._find_neighbours` iterates `all_invs` twice
per source pair (inner loop + corridor filter) without any spatial index or
pre-sort + bisect.  For typical 50-investigation corridors this is ~2,500
comparisons — fine; at 100 investigations it hits ~10,000.

**Fix.** Pre-sort `all_invs` by `along_m` once; use `bisect_left` to find
candidates within the depth-window band.

**When to revisit.** When typical projects exceed 100 investigations in a
corridor OR when the `suggest-pinch-outs` verb wall-clock crosses 200 ms.

## 188. S3 — `BodyBoundaryWriteRequest` nodes lists unbounded — RESOLVED 2026-06-01 (folded into #112)

`upper_nodes` and `lower_nodes` now carry `Annotated[list[…], Field(max_length=10_000)]`.
See #112 resolution above.

## 176. Logging cleanups — exporter instrumentation + renderer log wrapper — RESOLVED 2026-06-01

**L1 — `SectionPdfReportExporter` instrumentation:** Already DoD-compliant at review time.
INFO entry (section id, model id, investigation count, formation count) and SUCCESS exit
(byte size) were already present. No change needed.

**L2 — `GeoStudioExporter` / `DSheetExporter` audit:** Both are Phase-5 stubs that only
raise `NotImplementedError`. Nothing to instrument — skipped with note.

**L3 — Renderer `console.*` → `log.*` migration:** Migrated all raw `console.*` sites in the
four listed files to the `log.*` wrapper (`log.debug`, `log.warn`). Added `log` import to
`client.ts`, `LithoCompositionPickerDialog.tsx`, and `ContactsLayer.tsx` (already present in
`useGeologicalModel.ts`). Removed now-redundant `eslint-disable-next-line no-console`
suppressions in LithoCompositionPickerDialog. `lithoLayerMerge.ts` had zero console calls —
nothing to migrate. Sites: client.ts (2), useGeologicalModel.ts (3), LithoCompositionPickerDialog.tsx (3),
ContactsLayer.tsx (5).

**L4 — `api/client.ts` fetch error boundary:** Added `log.error('api', method, path, status)`
at every non-2xx branch in the five central fetch helpers (`get`, `del`, `patch`, `put`, `post`).
Single seam — every standard API call flows through one of these five.

## (end)

