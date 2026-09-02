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

### ═══ Full-repo audit — 2026-06-13 (read + triage) ═══

* **Audit report:** [`DEBT.md`](../DEBT.md) (repo root) — a point-in-time
  13-reviewer read-only audit of `develop` tip `1f52db38`. 121 findings
  (0 Critical, 14 High, 42 Medium, 36 Low, 29 Info) across architecture,
  security, correctness, dead code, testing, performance, dependencies,
  maintainability, DRY, KISS, naming, observability, docs. **TODO: read
  it and fix where necessary** — the report is an unfiltered snapshot, so
  triage first (some findings are disputed / deliberate-design / false-
  positive-adjacent), then promote the accepted ones into this list in
  the Tier/What/Why/When format. Highest-signal clusters flagged there:
  the body-extent-retirement shrapnel (live "Open end"/"Pinch out"/"Name
  body" gestures 404 against a deleted endpoint), the `seeded_formation_
  contact_ids` lost-update race, the section-fill geometry recomputing
  every pan/zoom frame, and README/CLAUDE.md/api.md doc drift. **When to
  revisit:** before the coworker binary (the audit's "Phase 0" quick wins
  are the pre-distribution blockers).

### ═══ G. Before the Geotech stage — finish the litho stage ═══

The litho ghost-review workflow must be solid before geotech
subdivision is built on top of it. Priority order:

* **#120** — RESOLVED 2026-05-25 (band-rect clamp to investigation depth)
* **#121** — correlation polygon-ribbon rendering, lens-aware (design work — after #101)
* **#122** — correlation edge opacity fade + body-hover spike (polish — after #121)
* **#123** — clay→silt correlation suggestion bug (needs owner reproduction)
* **#99** — CLOSED-STALE 2026-06-23 (no longer reproducing across the post-May litho rework; code correct in the obvious reading + G34b pins it; re-open if it resurfaces in a live project)
* **#138** — CLOSED-STALE 2026-06-23 (intermittent, never captured a deterministic repro; DR1/DR2 cover the basic merged-layer-still-draggable path; re-open if it resurfaces in a live project)
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

* **#157** — RESOLVED 2026-06-04 (A2 removes straddle-split entirely; sliver mechanism gone)
* **#159** — RESOLVED 2026-05-29 (hit-strip overlap on the litho axis, not the clamp)
* **#207** — RESOLVED 2026-06-16 (rewired the lens-inspector "Name this body" save to PATCH `/bodies/{bodyId}` via `nameBody`; deleted the dead "Open end"/"Pinch out" gestures, `claimBodyExtent`, `ProvenanceViolationError`, and their prop chain through SectionPanel / ContactsLayer / context menu — all of which 404'd silently against the 2026-06-06-retired bodies POST)
* **#208** — RESOLVED 2026-06-16 (`pg_advisory_xact_lock(hashtext(section_id))` across the read-union-write of `seeded_formation_contact_ids` in `CrossSectionRepository`, mirroring `SaveBodyBoundary`; concurrent-accept integration test pins no ids lost)
* **#209** — RESOLVED 2026-06-16 (split `PartitionFillOverlay`'s single screenRegions memo into a data-keyed `computeSectionFill` memo + a cheap transform-keyed pixel-projection memo, so the LCS engine no longer re-runs on pan/zoom; TEST-04 call-count regression test written first, red→green)

* **2026-05-29 dogfeed batch — RESOLVED (section rendering + auto-correlate + lens cleanup).** A long dogfeed thread; all shipped to `develop` on 2026-05-29. (a) **Section surface through picks** — `surfaceThroughPicks` on ContactsLayer draws the active formation surface as a chord through the user's *placed* contacts, not a TIN slice along the section line (which sat ~1 m below for off-line investigations because the slice samples at the line, not at the borehole); SectionPanel passes it for the active surface on all three views (backdrop already did this via `referenceContacts`). (b) **Section-order auto-correlate adjacency** — `AutoCorrelateContactEdges` gains `section_id`; adjacency = consecutive in-corridor columns along the section, not the model-wide map-plane relative-neighbourhood graph (which crossed intervening columns for off-line tests → "spaghetti" on the section). Domain `auto_correlate_contact_edges(adjacency=…)` override; the toolbar passes the active section; no section → RNG fallback. (c) **Lithology-only correlation grouping** — the grouping key dropped from `(parent, above, below)` to `litho_main_soil_code` alone; same-lithology contacts correlate in depth order via adjacency + depth-window + MNN. The old triple blocked obvious correlations whenever a column had a boundary-edge parent mis-assignment or one extra interbed (different below-code). (d) **Full-band correlate hit target + void-clear** — the correlate hit-rect is sized to the whole band (click the band body, not just the thin boundary line); a click in the void clears the armed source (reuses SectionPanel's pan-safe background-click hook). (e) **Lens degeneracy guard** — `detect_lenses_from_graph(max_lens_thickness_m)` rejects a lens body thicker than the cap (a near-whole-column "lens" born from a loose correlation); `DetectLithoLenses` reads it from `view_state.litho_segmenter.max_lens_thickness_m` (0 = off, default 5 m) — Settings → Litho segmenter → "Lens max thickness (m)". Existing spurious lenses reconcile away on the next correlate. (f) **Delete-lens gesture** — right-click a wedge → confirm → dissolves the lens by deleting its two defining edges (above↔target, below↔target); the detector then reconciles the row away (the metadata-only DELETE endpoint would have left the body in the graph). (g) **Lens-candidate marking** — an *enclosed* contact correlating to neither neighbour gets an amber diamond in correlate mode (the "no-target middle layer" → pinch out, don't correlate). **Interim:** marking only; a one-click candidate→pinch-out conversion + two-sided lens geometry stay future work (the latter is the Phase-5 #101 / interfingering carve-out). **Watch item:** lithology-only grouping can pair same-lithology beds across a formation boundary when depth coincides — bounded by adjacency + depth-window + MNN; revisit if a wrong correlation surfaces.

### ═══ GEOTECH-STAGE GATE — everything below waits ═══

* **B. Commercial launch gates + pre-distribution hardening:** #2, #3, #4, #5, #6, #7, #47 *(#213 RESOLVED 2026-06-16 — react-leaflet/@react-leaflet/core [Hippocratic-2.1] replaced by first-party MIT `streaflet` over bare `leaflet` [BSD-2]; both packages dropped from package.json + lockfile; #214 RESOLVED 2026-06-16; #215 loopback-bind RESOLVED 2026-06-16, default-creds folded into #2; #219 mostly RESOLVED 2026-06-16 — SHA-pins / digest-pin / version caps / npm-audit done, only the electron-builder transitive `overrides` remain → #6)*
* **D. Phase-4 export step + post-launch / Phase 5:** #104 *(identifier half RESOLVED 2026-08-26; closed-polygon export remains)*, #105, #106, #107, #44, #52, #56, #11, #100b, #101, #70, #71, #79, #93, #220, #221, #223 *(#203 RESOLVED 2026-06-23 — always-on "Press F1" hint added to the CanvasHints pill; #224 RESOLVED 2026-07-13 — B1 dedup batch, see entry below)*

  * **#223 — Parameter-group / analytical geotech body (Slice 3).** What: the Parameters stage needs a user-curated `parameter_group` entity (+ membership table) that aggregates an arbitrary set of geotech spatial `body_id`s (possibly non-contiguous across the model) for per-lens parameters, p-q regressions on triaxial data grouped per body, and grain-size comparison within/between bodies — with merge/split gestures in the UI. It references the geotech `body_id` that `SubdivideAllBodies` (Slice 1) now persists; no rewrite needed between slices. Why deferred: triaxial and grain-size lab tests are not yet imported; designing the group + merge/split gesture blind to that data is premature (a read-only grouping without the gesture is not shippable). When to revisit: when lab-test import lands — design the `parameter_group` table + the merge/split gesture together at that point. (Two system-architect-consult conclusion; Slice 3.)

  * **#224 — Geotech formation find-or-create DRY pass — RESOLVED 2026-07-13 (B1 dedup batch).** Post-recount outcome: the heavy half resolved **by attrition** when the C1/C2 skeleton flow was deleted (#237.2) — `_find_or_create_classified`, `_find_or_create_skeleton`, and `_resolve_anchor_kinds` (GEOTECH-IMPORT-03) each survive as a SINGLE copy on the shared `GeotechBoreholeMaterialiser` base class, and the admixture-JSONB parse (GEOTECH-IMPORT-08) survives only in `subdivide_all_bodies._formation_admixtures`; single copies were NOT extracted. The still-multi copies were extracted: the nearest-geo-contact-within-tolerance loop ×2 + geo-contacts-at-investigation loader ×2 (GEOTECH-IMPORT-07) → `application/litho_geo_link_helpers.py` (shared by AcceptLithoSuggestions + LinkLithoToGeo); the view-state float-knob readers ×4 live sites (litho snap tolerance / geotech snap tolerance / min thickness / gradient window) → `application/view_state_helpers.py` (`read_view_state_float` + `load_project_view_state`). `_read_min_thickness_m` itself stays a 1-copy thin wrapper over the shared reader. Any future 2nd copy of the find-or-create pair belongs on the materialiser base class, not a new module.
* **E. Lower technical debt:** #16, #17, #27, #62, #65, #68, #82, #114, #155, #156, #229, #234, #235, #236, #269 *(#229–#237 filed 2026-07-12 from the redundancy audit — full evidence in DEBT.md's dated section; #230/#231 are Tier-G/pre-gate; #232/#233 RESOLVED 2026-07-13 in the B2 dedup batch; #234 RESOLVED 2026-07-13 in the B4 dedup batch; #237 is the owner-decision batch; #222 RESOLVED 2026-07-13 — B5 naming batch, columns renamed to companion_body_id / is_body_companion)* *(#202 RESOLVED 2026-06-23 — shared Modal Tab/Shift+Tab focus trap + focus-restore-on-close + M1–M4 vitest; #41 RESOLVED 2026-06-23 — Geology3DViewer shell mount smoke via inert cesiumMock harness)* *(#210, #212 RESOLVED 2026-06-16; #211 RESOLVED except its jobs-DELETE scope guard → folded into #4; #216, #217, #218, #126 RESOLVED 2026-06-21 — dead-code sweep + lens→body naming sweep + float-equality epsilons + body.name→TEXT; #222 spun off #217 for the persisted lens-named columns; #124 MOOT 2026-06-21 — create_litho_lens.py retired with the lens entity; #125 was already a dangling number)*

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

**BUILT 2026-08-27 — Fork A implemented; awaiting a clean-box pass.**
See [distribution-build.md](distribution-build.md) for the full
procedure and the decisions. In brief: `scripts/build-embedded-postgres.ps1`
stages PostgreSQL 16.10 + PostGIS 3.6.2 (309 MB after pruning pgAdmin
and the unused bundled extensions; PROJ grids kept so `ST_Transform`
works offline), `scripts/build-embedded-python.ps1` stages a relocated
python-build-standalone with the `uv export --no-dev` set plus the
backend as source, and `desktop/src/main/embedded/` boots the pair on a
dynamically-acquired port before the window opens. Python blast radius
was indeed zero, as the fork analysis predicted — `DATABASE_URL` is all
the backend needed. Two things the analysis did not foresee, both now
fixed: a packaged build sets `ENVIRONMENT=production`, under which the
backend hard-refuses the default `SECRET_KEY`, so the installer
generates one per install alongside the DB password; and
`migrations/env.py` drives an async engine, so `alembic upgrade` had to
move off the calling thread.

Verified end to end on this machine: `initdb` → server → `CREATE
EXTENSION postgis` → all 96 migrations to head in 4.2 s → `ST_Transform`
to Lambert72 → clean `pg_ctl` shutdown.

**When to revisit.** On the first install on a machine that is NOT the
development box — specifically one with no Docker, a non-ASCII/spaced
user profile, and an antivirus that has never seen these binaries. The
port-conflict and read-only-install failure modes are covered by unit
tests; the AV and locale ones can only be settled on real hardware.

## 3. Subscription activation system (medium → blocking before paid release) — re-scoped 2026-06-25 from "license keys"

**Re-scope 2026-06-25.** The commercial model pivoted from perpetual
license to annual subscription + 30-day trial (owner directive; see
CLAUDE.local.md → Commercial planning). When this item is picked up,
build a **subscription/activation check** (activation tied to Stripe
subscription state, offline grace window for on-site use) rather than
the perpetual license-token shape sketched below — the token
machinery below stays useful as the offline-verification layer, but
expiry follows the subscription, not a perpetual grant.
`docs/commercial-direction.md` framing updated in lockstep.

**Status 2026-08-27 — stage 1 (beta expiry) SHIPPED.** Build-stamped
expiry date, monotonic clock anchor (clock-rollback defeat), hard stop
with renewal dialog — see [design/beta-expiry.md](design/beta-expiry.md).
That is the "waterproof beta builds expire" half of the owner's MVP
ballot. The activation ARCHITECTURE (offline signed file vs server vs
hybrid) is an owner decision waiting in
[design/activation-decision-memo.md](design/activation-decision-memo.md)
— recommendation is Option C (server issues, signed 30-day file
authorises offline), with four questions listed at its end.

**Reviewable PROTOTYPE landed 2026-09-01, senior-review remediation
2026-09-02 (branch `onboarding-proto`, NOT merged).** REAL: the pure
state machine (trial/active/grace/expired/clock-rollback, 30-day
offline grace, clock-rollback guard reusing the beta anchor), the
`ActivationRepository` seam + in-memory mock issuer, 1-device binding
+ deactivate/transfer, trial-on-the-same-path, the local
`activation.json` store with a typed shape-check (a hand-edited
`tier:"gold"` is rejected), and the **packaged start-screen gate**
(owner ruling A — a blocked verdict shows the licence screen instead of
the workspace; dev/e2e never block). MOCKED: the strixgeo.com server,
Stripe, the **Ed25519 signature** (the local file is plain JSON — the
biggest remaining TODO), and the device fingerprint. Design note:
[design/onboarding-activation-updater-proto.md](design/onboarding-activation-updater-proto.md).

**Client half + contract + dev stub landed 2026-09-02** (branch
`activation-http-client`, NOT merged). The HTTP client
(`httpActivationRepository.ts`) implements the `ActivationRepository` seam over
`fetch` behind a single config point (`activationConfig.ts` — env
`STRIXGEO_ACTIVATION_URL` in dev, a packaged constant, `null` = the mock, which
stays the default so the dogfeed is unchanged); a hardware-derived stable device
id (`deviceIdentity.ts`) survives a reinstall; the written HTTP contract
([design/activation-api-contract.md](design/activation-api-contract.md)) is what
the strixgeo.com server implements; a dev-only in-memory FastAPI stub
(`scripts/dev/activation_stub_server.py`, `--mint` CLI) runs the contract
locally. Server implementation on the strixgeo.com hosting (MySQL) + the key
FORMAT / Ed25519 signing (§8) remain pending.

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

C11 pinned 2026-09-02: 8 by-id routes, 0 guards added (all already guarded).

**What remains.** The auth-threading step (``user_owns`` predicate
on project-level endpoints) still waits on debt #3.

**Why deferred.** No auth shipped.

**When to revisit.** Day-1 of debt #3 license-token work — auth
scaffolding must thread ``current_user`` through these routes
before any token-gated call ships.

## 5. Tamper / reverse-engineering hardening (low — pragmatic posture, residual)

**Re-scope 2026-06-25 (with #3).** Targets the subscription-activation
check, not perpetual license keys — see #3's re-scope note.

**Owner ruling 2026-08-31 (SUPERSEDES the "readable source is acceptable"
posture for the engine + parsers).** *"the underlying codebase should also be
protected and not leak at all times ... otherwise someone else could just
duplicate."* Native compilation of the Python engine + parsers is now a **gate
before ANY binary leaves this machine** — beta testers and the coworker handoff
included (rulings 5-7; this re-sequences `memory/project_coworker_distribution.md`,
which had assumed an internal handoff *before* hardening). **Implemented** (this
slice, working tree): `scripts/compile-backend-natives.ps1` +
`scripts/native_compile_manifest.py` compile 66 modules (voxel-litho builder,
NAD classifier, representative statistic, all GEF/DOV parsers) to native `.pyd`
in the staged tree, driven from `build-embedded-python.ps1`; two gates (smoke +
`verify-staged-natives.ps1`) EXECUTE the artifacts before the dist build
proceeds. Carve-outs: `greedy_mesh.py` (Numba), every `__init__.py`;
`geotech_band_reclassification.py` deferred pending decision C3. Full design:
[docs/distribution-build.md](distribution-build.md) "The compiled subset".

**Residual — the TypeScript engine is NOT protected (open owner decision).** A
large share of the interpretation engine lives in the renderer as TypeScript
(partition/fill, body resolver, section geometry under
`desktop/src/renderer/`), and Electron ships it as JavaScript in `app.asar`,
which `npx asar extract` unpacks trivially. The Python-side native compilation
does nothing for that surface, so the "cannot duplicate" goal is only
half-met. Options (bytenode/V8-snapshot, JS obfuscation, or accept-and-rely-on
activation) are an **owner call — not yet ruled**; do not pick one unprompted.
When it is ruled, it pairs with the activation work (#3) the same way this did.

**What's still open.** The malformed-input audit pass landed: every
DOV XML parser uses ``defusedxml`` (billion-laughs + external DTD
guards); ``project:read-file`` and ``fs:read-file`` apply size caps
before allocating Buffers; the API has its own body-size + GEF-upload
caps. What's left is the licensing-side hardening tied to debt #3:

* Defeat casual bypass (renamed exe, deleted license file).
* Token store + verification on each launch (already in #3's scope).
* No anti-debug, no obfuscation, no DRM theatre.
* **The flag-based debugger surface** (noted 2026-08-03, from the autosave
  review): #200 closed the *menu* and *programmatic* routes to DevTools in
  packaged builds, but `--remote-debugging-port` / `--inspect` on the command
  line still attach a debugger to a shipped binary. That is a tamper surface,
  not a DevTools one — the same class as a renamed exe — so it belongs here
  and is deliberately NOT fixed in code today: blocking it means filtering
  `process.argv` at startup, which is anti-debug of exactly the kind this item
  says no to unless the activation check makes it worth it. Revisit with the
  activation work.

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

**INSTALLER HALF DONE 2026-08-27.** `npm run dist` in `desktop/`
produces an unsigned NSIS `StrixGeo-Setup-<version>.exe` carrying the
bundled Postgres + Python (debt #2). Per-user install
(`perMachine: false`) so there is no UAC prompt for a coworker whose IT
withholds admin, and `deleteAppDataOnUninstall: false` so an uninstall
never destroys a `pgdata` holding projects that were never saved to a
`.strix`. Details in [distribution-build.md](distribution-build.md).

**What remains under this number:** code signing and auto-update only.
SmartScreen still warns ("Windows protected your PC" → More info → Run
anyway), which `memory/project_coworker_distribution` accepts for
trusted internal testers.

**AUTO-UPDATE SCAFFOLD landed as a reviewable PROTOTYPE 2026-09-01,
senior-review remediation 2026-09-02 (branch `onboarding-proto`, NOT
merged).** REAL: `electron-updater` wired (`updaterService.ts` +
`updaterPolicy.ts`), every auto path gated on `app.isPackaged`
(dev never checks), `autoDownload=false` (the renderer owns the
Download choice), the renderer notification UX, AND the real feed —
`package.json` `build.publish` names GitHub Releases on the public
releases-only repo `Vorsie/strixgeo-releases`, `releaseType: draft`;
electron-builder generates `app-update.yml` and **no token is ever
bundled** (a `GH_TOKEN` is a publish-time env var only). A local build
cannot publish by accident: `npm run package`/`dist` end in
`--publish=never`; releasing is a deliberate `npm run release`
(`--publish=always`) that creates a DRAFT a human must click Publish on.
Design note:
[design/onboarding-activation-updater-proto.md](design/onboarding-activation-updater-proto.md).
PENDING: a first PUBLISHED release, and code-signing (below).

**Code-signing status (owner ruling 2026-09-02): the closed beta ships
UNSIGNED.** An Azure Artifact Signing (renamed Trusted Signing) account
`strixgeo-signing` exists (~$10/mo), but individual-identity validation
is not offered for Belgium, and Organization validation needs a KBO
number the owner does not have yet. Path once the business is
registered: Organization validation → Public Trust certificate profile →
electron-builder Azure signing. Until then testers see the SmartScreen
"unknown publisher" prompt.

**One OWNER DECISION is pending** before the first real install, written up
in [distribution-build.md](distribution-build.md) → "Open decision": the
packaged app's `userData` resolves from `package.json`'s `name`, not from
`build.productName`, so an install shares `%APPDATA%\ground-model-desktop\`
with the dev session. Harmless today (dev never starts the embedded stack)
but worth settling while no install exists to strand — the packaged-only
`app.setPath` option costs nothing and touches no existing profile.

**Not yet done:** the install → boot → uninstall pass on a real machine.
The installer builds and the boot path is verified headlessly against the
real bundled binaries (`STRIX_EMBEDDED_INTEGRATION=1`), but no GUI launch
has been performed — see the same doc's "Verifying a change without
launching the app" for why, and for the two rules any such launch must
follow.

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

## 13. Geotechnical units invisible to the section editor — SUPERSEDED 2026-08-05

**What (historical).** Filed when ``geotechnical_unit`` rows only surfaced in
``InterpretationPane`` and the section editor had no way to show or anchor
them.

**Why superseded.** The Phase-4 geotech stage rebuilt this ground entirely:
geotech units are now real model rows (a sibling model with ``kind =
'geotechnical'``, NAD-stamped formations, per-column ``LithoLayer`` bands and
contacts) and the section editor renders them first-class on the geotech
axis (fraction-space refinement, packing ties, borehole ghost previews, the
four-step packing pipeline). The two concerns this entry raised live on in
their modern forms:

* per-unit *editing* in the section editor → **#227** (manual geotech edits);
* unit-level contacts reaching the exporters → **#104** (three-level export
  gap).

Nothing of the original framing ("no hook point for unit assignment")
remains actionable — the hook points exist and are populated.

## 16. Telemetry / crash reporting (low)

**What.** No Sentry-equivalent. Frontend ``log.*`` calls go to the
devtools console; user-side crashes are invisible to us.

**Status 2026-08-27 — the CAPTURE half is SHIPPED.** Local NDJSON
diagnostics store, field-whitelist + redaction, consent default-OFF,
crash-bundle ``.zip`` a tester can send by hand, renderer capture on
5xx/network failures — see [design/diagnostics-capture.md](design/diagnostics-capture.md).
The TRANSMIT half deliberately sends nowhere: the endpoint decision is
coupled to the activation-server choice (#3) — see
[design/activation-decision-memo.md](design/activation-decision-memo.md) Q4.

**When.** Endpoint + consent UI before any non-solo user; the owner's
activation ruling decides where reports go.

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

The Ic curve + SBT zone bands live in a dedicated component in the
Parameters stage. (Superseded 2026-08-03: the owner killed the squished
inline chart; ``CptIcSbtChart.tsx`` was deleted and its band palette moved
to ``shell/stages/parameters/icBands.ts``, drawn by
``CptSbtDepthPanels.tsx`` in the stage's right inspector. Clicking a CPT
row in ``PerTestTab.tsx`` now selects the CPT and plots it there.)

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

## 41. ~~`Geology3DViewer.tsx` component-level smoke still absent~~ — RESOLVED 2026-06-23

Part (a) (pure coordinate math → `cesiumGeometry.ts` + 13 vitest cases)
shipped 2026-05-17 (6c5389a). Part (b) (the component-shell mount smoke)
shipped 2026-06-23: `test/cesiumMock.ts` (an auto-vivifying inert Cesium
stub module — any symbol is callable/constructable/assignable/recursively
accessible, so `import * as Cesium` mounts under jsdom without WebGL) +
`Geology3DViewer.test.tsx` (G3D-1..5): mounts single+split with empty
data, asserts the `resetCameraRef` effect wiring + cleanup-nulls, invokes
the reset callback (proving the `flyToBounds`/`flyToCutFace` symbol
references resolve — the 585c714 ReferenceError bug class), and rebuilds
across mode/toggle prop changes. **Known gap (explicitly out of scope):**
the two-click split-line draw lives inline in a Cesium
`ScreenSpaceEventHandler` callback (not a separable pure reducer), so the
inert mock — whose `setInputAction` is a no-op — cannot drive it; it would
need a callback-capturing harness asserting against stub geometry, which
proves nothing real. Documented in the test file's header.

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

## 52. PDF report export (Tier D — Phase 5 reporting deliverable; slice 1 SUPERSEDED 2026-09-02)

**Slice 1 SUPERSEDED 2026-09-02 by the client-rendered cross-section PDF
sheet.** The owner ruled the matplotlib exporter could not be made faithful
(straight-chord contacts, depth-below-surface, no fill) and replaced it with an
A3-high landscape sheet the desktop app draws itself and prints through Chromium
(`sheet.html` / `SectionSheet` / `main/sheetPdf.ts`; live preview dialog with the
app's own exaggeration + spacing sliders). The old route, exporter trio, tests
and the `reportlab` dependency were deleted (`matplotlib` stays only as a
`d-geolib` transitive dep). Design:
`docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md`. **Slices B / C /
D (below) reuse this sheet as a page + its hidden-window print pipeline rather
than the backend exporter.**

**History — slice 1 (matplotlib), shipped 2026-05-21, now deleted.** Single-
section PDF report. Engine choice: ReportLab (layout + text) + matplotlib
(figures, Agg headless backend) — both deps added to pyproject.toml. The exporter
``infrastructure/exporters/section_pdf_report_exporter.py`` consumed a
``SectionSnapshot`` + a ``ReportMetadata`` bundle (title / author /
notes / date) and produced PDF bytes via ``SimpleDocTemplate``.

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

## 64. 3-D split viewport — RESOLVED 2026-06-01 (cut) + 2026-08-26 (compare)

Two different things are called "split" in the 3-D viewer, and the
entry covers both.

**CUT split — RESOLVED 2026-06-01.** One model, two viewports, each
showing one half of a user-drawn plane. `LithologyCanvas` wires
`splitMode` / `splitPlane` / `splitLine` state identically to
`GeologyCanvas`. The `Geology3DViewer` "Split model" button arms the
two-click draw interaction; the litho toolbar Reset button collapses
the split via `resetLithoSplitViewportCallback` (same pattern as
`resetSplitViewportCallback` in `GeologyCanvas`). `onExitSplit` is
wired so the "Single view" button inside the viewer also collapses.
No code added to `Geology3DViewer.tsx` — the wiring was purely in
`LithologyCanvas.tsx` + `LithologyStage.tsx`. C3 test pins the
exported callback. 53 vitest + tsc clean 2026-06-01.

**COMPARE split — RESOLVED 2026-08-26.** The owner ballot re-listed
"3-D split viewport (#64)" as an MVP item after the cut split had
shipped. The remaining, genuinely-unbuilt half is a MODEL comparison:
the litho model and the geotech subdivision derived from it, side by
side, whole, at one viewpoint. "Does the NAD subdivision respect the
litho units?" is the question the geotech stage exists to answer and
it cannot be answered by flipping between stages — the eye does not
hold a 3-D shape across a stage switch.

* `SplitMode` gained `'compare'` and moved to
  `shared/splitViewport.ts`, together with the three transitions
  (`splitAfterCutDrawn` / `splitAfterCompare` / `splitAfterExit`) and
  the `canCompare` predicate. The three loose `useState`s in
  `useBody3DViewState` collapsed into ONE `SplitViewportState` value:
  three independent setters over a three-mode machine is where
  "compare left a stale cut plane behind" lives, and a half model in
  each compare pane reads as a modelling gap.
* Entering compare DROPS any cut plane, and `Geology3DViewer` treats
  the MODE as the authority rather than trusting the plane prop — a
  component test caught the primary pane still clipping when both were
  passed.
* Cameras are LINKED in compare mode only (`useCameraLink`, mirroring
  in `postRender`, follower-never-writes-back). The cut split keeps
  independent cameras on purpose: each pane is half of one model.
* One "Single view" button closes either kind, so the user never has
  to know which is open.
* The Compare verb is offered only when the counterpart model would
  actually paint something — a button opening a blank pane reads as a
  broken viewer.

Known limit: the comparison pane offers SOLIDS only. Fence walls are
built per model from that model's own correlations, and each canvas
holds only its own fence, so captioning the other model's pane with
this model's walls would be a lie. Revisit if a user asks to compare
fences — it needs the counterpart's edge fetch, not just its rows.

Pins: `splitViewport.test.ts` (transitions + `canCompare`),
`Geology3DViewer.compare.test.tsx` CMP1–CMP10.

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

## 93. First-use tutorial + per-stage "next step" hinting (Tier D — onboarding)

**First-launch overlay landed as a reviewable PROTOTYPE 2026-09-01,
senior-review remediation 2026-09-02 (branch `onboarding-proto`, NOT
merged).** REAL: deliverable 1's skippable tour — a welcome → choose
(sample | scratch) → six-stage tour overlay, auto-opening once on first
launch (gated on a persisted "seen" flag AND `!launchFlags.e2e` so the
z-max modal never covers the e2e suite), re-openable from Help → Getting
started…, full EN+NL. e2e-pinned by `flow_onboarding_first_launch.spec.ts`.
Load sample project: the MECHANISM shipped 2026-09-02 (ruling A8) —
`resolveSampleProjectPath` + the `sample:available` / `sample:install`
main-process IPC copy a bundled `.strix` (shipped as an installer
`extraResources` at `resources/sample`) to a user-owned location and open it,
falling back to a toast + empty project when none is bundled. PENDING THE
OWNER: the worked-example `.strix` DATA itself — he builds it later and drops it
at `desktop/resources/sample/worked-example.strix` (tracking that file in git is
his call). NOT built:
deliverable 2 (per-stage "next step" hinting) and the coach-mark
walkthrough of deliverable 1. Design note:
[design/onboarding-activation-updater-proto.md](design/onboarding-activation-updater-proto.md).

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

## 99. ~~Litho drag-resize clamp does not pass through rejected layers~~ — CLOSED-STALE 2026-06-23 (no longer reproducing; re-open if seen in a live project)

**Closed stale.** Awaited an owner repro since 2026-05-22; never
reproduced across the large post-May litho rework (A2 decoupling,
partition-fill, body-extent retirement, voxel builder). The 2026-05-23
investigation found the code correct in the obvious reading and G34b
remains the regression net. Notes preserved below for re-modelling if
the symptom resurfaces.

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

**Partial slice landed 2026-08-03 (audit 2026-08-02).** The *routing* half is
done for the section exports: `SectionsToolbar`'s DXF / PDF handlers select the
model by axis (`isLitho ? litho : isGeotech ? geotech : geological`) instead of
falling through to the geological model on the geotech axis — which had made an
engineer on the NAD axis silently export Quartair/Boom/Diest surfaces and zero
geotech units. `hasModel` mirrors the same three-way selection, and both
tooltips now name the level being written. Pinned by
`SectionsToolbar.axisExport.test.tsx`.

**Identifier slice landed 2026-08-26.** The snapshot *content* gap is closed:
`SectionFormation` and `FormationDisplay` carry `nad_class` +
`litho_main_soil_code` (`FormationDisplay` also gains `formation_id`), both
build paths populate them, and every exporter reads them through one shared
scheme module — `infrastructure/exporters/unit_identifier.py` +
`unit_identifier_constants.py`. Contract and reasoning: **docs/exports.md §Unit
identifiers**. In brief: token `NAD-06_ZAND` (zero-padded so CAD sorts it in
class order, class-first so `NAD-06_*` wildcards); a unit's export NAME changes
only when it carries a `nad_class`, so litho + geological naming is
byte-identical (control-pinned); DXF gains the identifier in the layer name,
the class + soil in the layer description, and a model-space mapping table;
both PLAXIS exporters gain identifier-led material identifications, collision-
free variables + identifications, and a `UNIT MAPPING TABLE` header block; the
PDF legend leads with the token. Pins:
`tests/unit/infrastructure/exporters/test_unit_identifier.py` +
`test_export_unit_identifiers.py`.

**Still open here.** Closed polygons / hatched soil bodies — the exports still
carry contact polylines + per-column layer stacks, not filled units; the 2-D
partition fill lives in the renderer and has no backend equivalent to export.
*(The same-NAD thinning half of the ballot is #104b, RESOLVED 2026-08-26.)*

## 104b. Export-level thinning of adjacent same-NAD units — RESOLVED 2026-08-26

**Owner ruling, verbatim:** *"thin in dxf and pdf, keep plaxis exact,
shallower parent name wins."*

**Shipped.** `ThinExportUnits`
(`application/thin_export_units.py`) merges vertically adjacent units
that share a `unit_identifier()` (same NAD class + soil), applied in
`_build_export_snapshot` (`api/routers/cross_section.py`) by the DXF and
PDF handlers only — the helper's `thin_units` defaults to `False`, and
the Plaxis handler carries a comment saying why it must never pass it.
The shallower unit's name, colour and formation reference survive; the
merge is a deletion of the deeper unit's top contacts, so the survivor's
extent runs to whatever lay below without any recomputation. The
survivor records `absorbed_unit_names`, and the mapping table grows an
`Absorbed units` column *only* on a thinned artefact, so everything else
stays byte-identical. Default ON for DXF/PDF with `?thin_units=false` as
an opt-out, because the merge erases a litho/geo boundary the engineer
drew. Full rule + the "adjacent" definition: **docs/exports.md §Same-NAD
thinning**. Pins: `tests/unit/application/test_thin_export_units.py`
(11, red-first) + 4 routing pins in
`tests/integration/api/test_cross_section_export.py`.

Both design questions the original entry raised were answered by the
ruling: the Plaxis global-stack constraint is settled by "keep plaxis
exact", and "what a merge erases" by "shallower parent name wins" plus
the audit column. The original entry follows for the record.

**What.** Merge vertically adjacent units carrying IDENTICAL NAD
parameters into one export unit, so a report / DXF / Plaxis model does
not show two materials the engineer treats as one.

**Where it hooks.** ONE seam serves all three section artefacts:
`_build_export_snapshot` in `api/routers/cross_section.py:99` — the
shared loader behind the DXF (`:487`), PDF and Plaxis 2D (`:611`)
handlers. A new application-layer pass would take the assembled
`SectionSnapshot` and return a thinned one, behind an explicit opt-in
query param (thinning discards a distinction the user drew, so it must
never be the silent default). The grouping key already exists:
two units merge iff `unit_identifier()` returns the same token.

**Why it is NOT in the 2026-08-26 identifier slice.** The merge is not
well-defined without an owner ruling on two points:

1. **The Plaxis global-stack constraint.** Both Plaxis exporters emit a
   single globally ordered `soillayer` stack, indexed once and reused by
   every borehole. Merging two units that are *interleaved* — same NAD
   class above and below a different unit somewhere on the section —
   would need one global layer to appear twice in a column, which the
   Plaxis model cannot express. So the merge is only safe when no other
   unit interleaves between the two ANYWHERE on the section. Whether the
   thinning should then (a) refuse, (b) merge only where safe, or (c)
   merge in the DXF/PDF but not in Plaxis — leaving the artefacts
   disagreeing about unit identity — is a product call.
2. **What a merge erases.** Adjacent same-NAD units are almost always
   two different litho or geological parents (the geotech find-or-create
   keys on `(nad_class, source_litho_formation_id,
   source_geo_formation_id)`, so same-class bands *within* one litho
   parent already share a formation row). Merging therefore deletes a
   litho/geo boundary from the export. Which display name, colour and
   parent survive is the engineer's decision, not a default.

**When to revisit.** ~~With the owner, when the geotech stage's export
step is dogfed on a real report.~~ Answered by the 2026-08-26 ruling
above; this entry is closed.

## 106. Application layer is welded to the ORM (Tier D — clean-architecture leak)

**Partially resolved 2026-06-01.** The cheap first step (named in the
original debt entry) landed: `FormationContactResult` dataclass added at
`src/groundmodel/domain/value_objects/formation_contact_result.py`, and
five use cases now return it via `from_orm(...)` instead of raw
`FormationContactOrm` — `CreateFormationContact`,
`UpdateFormationContact`, `UpdateFormationContactsBatch`,
`LinkLithoToGeo`, `UnlinkLithoFromGeo`. The router consumes the
dataclass through Pydantic's `from_attributes`; the wire shape is
unchanged. `extrapolate_pinch_out` (the third use case originally
called out) was retired during the body-with-extent refactor — pinch-out
flows now live in `bodies/*` use cases.

**Still open:** ~17 other geology use cases (`accept_litho_suggestions.py`,
`rebuild_model_surfaces.py`, `recompute_formation_surface.py`,
`validate_model_crossings.py`, …) still import ORM classes and run
`select(...Orm)` queries inline. The internal-ORM usage doesn't leak
across the API boundary (these use cases return primitives or count
results), so the structural fix is a separate concern from the leak
fix. `GeologyRepository` covers ~30% of the query surface today.

**Why deferred (remaining).** Not a runtime bug — a structural
deviation. The API-boundary leak is now closed; the internal-ORM-use
pattern stays put until a real consumer (e.g. Phase 5 statistics) needs
the queries testable in isolation.

**When to revisit.** Before Phase-5 statistics work (which adds bulk
queries that must be testable in isolation).

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
- The `_validate_tin_payload` structural check shipped 2026-06-06
  (commit `a9ff0736`): the restore path now rejects malformed surface
  TIN payloads (wrong-arity tuples, non-finite / non-numeric coords,
  non-int or out-of-range triangle indices, a present non-list array)
  by blanking the geometry + forcing `is_stale`, mirroring the
  size-cap branch. The size cap and the structural check now both
  guard the restore, so a malformed triple no longer survives restore
  to crash the downstream TIN slice/export with an opaque
  IndexError/TypeError. Helper lives in
  `project_bundle/bundle_row_builders.py`, wired into the surface loop
  in `bundle_restore_litho.py`.
32 unit tests pin all surfaces in `test_security_hardening.py` (20
original + 12 for the structural check); one integration test
(`test_restore_drops_structurally_malformed_surface_tin`) mirrors the
proven oversized-blob sibling.

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

### Shell-open unblocker + first stage template (2026-06-02)

The structural gap blocking exhaustive per-pane/per-button coverage:
the harness could only reach the IPC + Welcome surface, because
``readProjectFile`` enforces path-authorisation so no spec could
drive a project *into the shell*. Resolved by
``tests/e2e/helpers/project_open.ts``:

* ``openFixtureProject(app, page, id)`` — writes a minimal valid
  ``.strix`` pointer for the seeded fixture project, registers it via
  ``addRecentProject`` (which re-authorises the path), reloads,
  clicks the recent entry, and waits for the workflow spine to mount.
* ``goToStage(page, spineLabel)`` — clicks a spine button by its
  stable visible ``spineLabel`` (the ``aria-label`` is a dynamic
  per-stage summary, so it's unreliable as a selector).
* ``cleanupFixtureFile(tmpPath)`` — removes the temp pointer.

First consumer + **template** for the fan-out:
``flow_sections_toolbar_ui.spec.ts`` opens the project, navigates to
the Sections stage, and asserts every toolbar control is reachable —
the model-axis toggle (Geology⇄Litho + the enabled Litho segment),
the geological-axis toolbar (New cross-section, Undo, Export dropdown
→ DXF/Plaxis3D/PDF), and the litho-axis toolbar (Suggest split +
caret, Correlate split + caret, Bodies dropdown → 4 verbs, Admixtures
dropdown → 4 verbs). The copy-pattern: ``launchApp`` →
``openFixtureProject`` → ``goToStage`` → open every dropdown/caret and
assert each item testid → exercise one reversible action.

**Fan-out shipped (2026-06-02) — all 7 stages now have UI coverage:**

* ``flow_data_stage_ui`` — Import dropdown (6 verbs: 3 live, 3 Phase-4).
* ``flow_sections_toolbar_ui`` — the template (axis toggle + geological &
  litho toolbars, every dropdown/caret + items).
* ``flow_geology_stage_ui`` — toolbar + inspector + FormationDialog
  open→assert-fields→cancel (first of the ~16 dialogs).
* ``flow_lithology_stage_ui`` — ModelKindPicker + canvas placeholder.
* ``flow_geotechnical_stage_ui`` — placeholder reachability (zero→covered).
* ``flow_parameters_stage_ui`` — three-tab scaffold (zero→covered).
* ``flow_export_stage_ui`` — both export cards + section-enable.
* ``flow_litho_pipeline_ui`` — first DYNAMIC flow: Suggest-all → bulk-confirm
  → Accept-all-bulk → committed ``contact-drag-strip``s. Button/text-driven,
  no pixel math. Doubles as the data setup the context-menu specs need.

**4 section context menus SHIPPED (2026-06-02) —
``flow_section_context_menus_ui``:** contact (``contact-drag-strip`` →
``contact-context-menu`` + "Delete contact"), body (``body-extent-fill-{key}``
→ ``body-context-menu`` — the "name body dead-end" the owner hit), litho-band
(``per-column-litho-band-{key}`` → ``litho-band-remove``), empty-space
(``per-column-rclick-capture-{id}`` → ``litho-band-add``). Every trigger has a
stable testid, so each right-click targets the LOCATOR directly (Playwright
dispatches contextmenu at the element box — no pixel hunting) with ``force``
to skip the transparent-fill actionability check. Menus 2–4 build contacts via
the Suggest→Accept pipeline; menu 4 additionally auto-correlates → accepts →
detects-lenses to materialise a body. **Two run-validated risks remain (tsc
can't catch them):** (a) menu 4 depends on auto-correlate closing ≥1 body on
the synthetic geometry — if none forms, give the fixture a guaranteed
pinch-out (a ``build_synthetic_fixture.py`` tweak, not a spec redesign);
(b) if a full-plot overlay ever steals the empty-space right-click, menu 1
needs a ``position`` near the column bottom instead of the box centre.

**Run caveat:** the 8 specs above are tsc-clean (``tsconfig.e2e.json``) but
were authored without a live stack in-session (pre-commit smoke self-skips
when :8765 is down). Selectors are source-verified; the first real run may
surface a timing/selector nit to fix. ``flow_litho_pipeline_ui`` MUTATES the
fixture litho model — re-run ``build_synthetic_fixture.py`` (idempotent +
self-cleaning) between full suites.

### ACTION-coverage convention — every menu action gets an e2e spec (2026-06-02)

Owner directive: UI-action e2e coverage is **first-class — just as important as
other automated testing**, and applies to every action we add from here on.
The pattern is now established + proven (``flow_auto_lens_ui``,
``flow_body_naming_ui``, ``flow_body_actions_ui`` all green against the live
stack).

**1. Scenario data lives in ``build_synthetic_fixture.py``, on disjoint
sections** (so ``auto-correlate``, which loads the whole model, can't
cross-contaminate). The fixture (8 CPTs, three rows / sections) provides:
* **Section A** (CPTs 0–2): EMPTY — build-from-scratch specs (suggest→accept,
  band / contact / empty-space context menus).
* **Section B** (CPTs 3–5): a committed bilateral **body** + its committed
  contacts — body actions (name / dissolve / claim-extent) + contact actions
  (delete / open-end / link-geology) + litho-band remove.
* **Section C** (CPTs 6–7): an interfingered **crossing** — auto-lens.
The seed is a direct-DB step (``_seed_action_scenarios_async``) — the body's
closure edges are cross-lithology, which the REST correlate rejects. Idempotent
via the existing pre-restore cleanup + ``formation_id`` ``ondelete=CASCADE``.

**2. The action-spec pattern.** ``launchApp`` → ``openFixtureProject`` →
``goToStage`` → select the scenario's section → right-click the **testid'd**
trigger (``dispatchEvent('contextmenu', {button:2,clientX,clientY})`` bypasses
SVG z-order; ``force:true`` for transparent fills) → click the menu item →
assert the effect.

**3. Order-independence is mandatory** (the suite re-seeds once per run, not
per spec):
* **Irreversible actions** (delete / remove / dissolve) — drive to the
  confirmation and **Cancel**, asserting the dialog fires. This exercises the
  gesture (the dead-end class) without mutating the shared fixture. The
  *commit* path is covered by integration tests at the use-case layer.
  Native ``window.confirm`` → ``page.on('dialog', d => d.dismiss())``.
* **Reversible / idempotent actions** (name / claim-extent / open-end) —
  exercise fully; the re-seed restores the baseline next run.
* **Submenus** (``body-ctx-side-left/right``) — open via
  ``dispatchEvent('click')``, NOT ``.click()``: a real click hovers first
  (``onMouseEnter`` opens) then toggles (``onClick`` closes), and the panel
  sits outside the parent's box so hovering to it closes it.

**4. Action coverage status (extend as actions ship).**
* Body — Name ✅ (``flow_body_naming_ui``), Dissolve ✅ + Claim-extent ✅
  (``flow_body_actions_ui``). Clear-extent, the other claim kinds
  (pinch_out_halfway / extrapolated), left-side — *open, same pattern*.
* Auto-lens crossing → diamond ✅ (``flow_auto_lens_ui``).
* Contact menu — Delete ✅ + Open-end ✅ (``flow_contact_band_actions_ui``) +
  Link-geology / Unlink ✅ (``flow_contact_geo_link_ui`` round-trip; the seed's
  ZAND-top-cap @2 m coincides with the geo Tertiary-Clay @2 m).
* Litho-band Remove ✅ (``flow_contact_band_actions_ui``). Empty-space Add →
  picker ✅ (``flow_contact_band_actions_ui``).
* Body Clear-extent ✅ (``flow_body_actions_ui``). The remaining claim KINDS
  (pinch_out_halfway / extrapolated) + left-side are trivial variants of the
  shipped Claim-extent test — add if a regression ever bites.

**Every current section menu action now has an e2e action spec.** New actions
follow the same pattern (seed scenario in the fixture if needed; drive to effect
or confirm-and-Cancel).
* Every NEW menu action ships its action spec in the same commit batch as the
  gesture (the #127 convention below, now extended to actions).

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
  without GPUs; the ``STRIXGEO_DISABLE_GPU`` path needs its own
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

## 131. ~~Ribbon: lens-aware variant + pinch-out terminus~~ — CLOSED-MOOT 2026-07-12 (unshipped halves structurally superseded)

**Closure 2026-07-12.** Verified nothing of #131 remains actionable:
* **#131-c** (lithology-coloured gradient seam ribbon) SHIPPED 2026-05-28
  and dogfeed-confirmed (see below).
* **#131-a** (lens-aware opacity/dash variant) required a `lens_id` FK on
  correlation edges backed by `LithoLensOrm` — the lens entity was retired
  2026-06-21 (#124 MOOT, #217 lens→body rename); bodies are now resolver
  connected-components and lens signalling is carried by the partition
  fill's LENS classification (docs/design/section-fill.md), not ribbon
  styling. The plumbing this half waited on no longer exists.
* **#131-b** (pinch-out terminus taper) required `litho_lens.wedge_tip_along_m`
  threaded into `CorrelationEdgesOverlay` — same retirement; the partition
  fill renders pinch-out wedges as first-class geometry now, so a ribbon
  taper would duplicate it.
Re-open only if a future design puts lens/pinch-out signalling back on the
ribbon layer instead of the partition fill.

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

## 134-C-bulk. Litho-geo snap check on bulk accept paths (Tier G — SHELVED 2026-06-22, placement under reconsideration)

**SHELVED 2026-06-22 (owner directive).** Do NOT build this. While
scoping the bulk-snap UX, the owner raised the deeper question: should
litho↔geo reconciliation happen at litho-EDIT time at all, or should
the lithostratigraphic and geological models stay independent during
editing and reconcile at the BUILD / geotech-subdivision boundary? A
system-architect pass (2026-06-22) concluded the build-time pass
``divide_picks_by_geology`` (``domain/services/litho_geo_bounding.py``,
run inside ``RecomputeLithoSolids`` before ``build_body_solids``)
already covers ~90% of the structural need (geology as hard bounds,
snap-or-divide at ``litho_snap_tolerance_m``) WITHOUT any 2D-contact
FK, and that the edit-time coupling (#134/#162) — especially the
bidirectional drag-propagation that silently moves a geological
surface — is the kind of invisible side effect the 2026-06-11
"geology bounds litho at BUILD time, not the 2D edit" directive was
reacting against. Leading direction: defer reconciliation to the
geotech inspector as a corridor-scale "Reconcile with geology" review
(snap-or-divide dry-run, writes ``parent_geo_contact_id`` as confirmed
provenance) rather than a per-accept popup. **Owner chose the
lowest-risk path: shelve #134-C-bulk, delete nothing, leave the
edit-time coupling as-is, revisit placement when the geotech inspector
is designed.** So this item builds nothing now; if the placement
reconsideration lands on "defer", #134-C-bulk is moot (close it) and
#162's edit-time enforcement + #157 re-scope too. See
[[project_litho_geo_reconciliation_placement]]. The original scoping
(below) is retained only as the spec for IF it is ever built at the
litho-edit stage.

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

## 138. ~~Drag-lock after litho merge — handle becomes immovable~~ — CLOSED-STALE 2026-06-23 (intermittent, never captured; re-open if seen in a live project)

**Closed stale.** Intermittent since 2026-05-26; a deterministic repro
was never captured, and it did not resurface across the large post-May
litho rework. DR1/DR2 cover the basic merged-layer-still-draggable path.
Candidate-path notes preserved below for re-modelling if it resurfaces.

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

## 149. Double SAND / SILT units after Accept-litho (Tier G — OPEN, A2-narrowed)

**A2 update 2026-06-04.** A2 removes straddle-split entirely (a crossing layer
stays one layer; see #157 RESOLVED + the A2 spec), so the
straddle-re-split-at-geo-boundary path — the strongly-suspected root cause per
the 2026-05-28 dogfeed — is gone. The residual hypothesis (admixture-sig drift
across investigations / auto-populate↔Suggest aggregation mismatch) is NOT
addressed by A2. Re-verify on a fresh post-A2 dogfeed: if doubling no longer
reproduces, close this; if it does, it's the admixture-drift path.

**Code re-verification 2026-06-22 (no repro yet — narrows the residual).**
Read `accept_litho_suggestions.py` end-to-end. Confirmed: (1) straddle-split is
fully gone — `AcceptLithoResult.straddle_split_count` is A2-deprecated/always-0
and the accept loop (≈l.439) no longer splits across geo boundaries. (2) The
find-or-create key is now the **2-tuple** `(litho_main_soil_code,
canonical_admixture_signature)` — geo-agnostic, NOT the old 3-tuple with
`parent_formation_id` quoted below (that line is stale). It is deterministic and
dedups, so two SAND units after accept ⟹ their `sig` genuinely differs. (3) The
ONLY residual drift vector is therefore the admixture signature.
`Admixture.canonical_key()` = `"<soil_code>:<amount>"` and
`_canonical_admixture_signature` sorts+joins those — `locally` is excluded (owner
decision) **but `amount` is kept**. So two layers the engineer reads as "the same
SAND" whose admixtures differ only in amount (`KL:Z` weak-clay vs `KL:M`
medium-clay) become two units BY DESIGN. (4) **The diagnostic is already wired** —
the find-or-create logs `Created/Found litho formation … sig='{sig}'` at DEBUG
(accept loop ≈l.458/471). Next dogfeed: enable DEBUG, accept, read the two SAND
rows' `sig=` values — that tells us immediately whether they differ on `amount`
(the policy lever) or on something unexpected. No instrumentation to add; no code
change is safe to make blind (would mean re-adding speculative reshape logic —
[[feedback-litho-accept-verbatim-copy]]). The narrowed question is a single owner
policy call: **should `amount` participate in the unit dedup bucket the way
`locally` already doesn't?**

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

## 157. Accepted litho slivers from straddle-split — RESOLVED 2026-06-04 (A2)

Straddle-split is removed entirely by the A2 litho/geo decoupling (owner
directive 2026-06-04): a layer crossing a geological boundary stays ONE layer,
so the sliver mechanism no longer exists. The whole `_compute_straddle_splits`
/ sliver-guard machinery + the "Sliver guard" Settings knob are retired. See
`docs/superpowers/specs/2026-06-04-a2-litho-geo-decoupling-design.md`.

## 158. Thin litho bands/slivers are hard to click — RESOLVED 2026-08-05

**What.** Owner dogfeed 2026-05-28: thin litho bands (incl. the #157
slivers) were tiny click targets for select/right-click. The trap fired
again 2026-08-04/05 (the CLAY-SF → SILT chase): the owner's correlate
clicks landed one band low twice in one week — the correlate-zone
midpoint split assigned the near-boundary half of a thin band to the
NEIGHBOUR's contact.

**Fix (commits `a9b7d1d36`..`4a9147f69`).** Two surfaces:

* **Correlate mode** (`CorrelationEdgesOverlay`): a band thinner than
  `2 × CONTACT_SELECT_NEAR_PX` with a deeper contact below arms its
  WHOLE height to its own top contact instead of midpoint-splitting —
  the click can no longer fall through to the neighbour (CE-THIN /
  CE-THIN-DEEPEST).
* **Band menu / add-suggestion** (`ContactsLayer`): a pure allocator
  (`utils/minHitAllocation.ts`, `MIN_BAND_HIT_PX = 12`) lets a thin band
  borrow invisible hit strips from fat neighbours' slack — each side
  donates at most `(height − 12)/2` so it never goes sub-minimum itself,
  thin-vs-thin boundaries stay put, stack edges are walls. Strips render
  after the visible stack with the band's own handlers (LB-THIN). The
  visual rects never move; #152's drag strips render later and keep
  priority.

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
— the skip-and-count branches at :478/:633 untested). **C11** (added 2026-06-04
audit) — the single-resource by-id endpoints (`GET`/`DELETE /cpt/{id}`,
`GET /cpt/{id}/plot`, `PATCH /cpt|borehole/{id}/elevation`, `GET /borehole/{id}`)
have no "foreign `project_id` → 404" integration test though the geology routers
do; the `get_in_project_or_404` guards are correct in code but the IDOR contract
isn't pinned for the most-enumerable endpoints. **C12** (added 2026-06-04) — the
`POST /projects/{id}/restore` route branches (version `not in
SUPPORTED_BUNDLE_VERSIONS` → 400, `BundleIntegrityError` → 422,
ValueError/KeyError/TypeError → 400) are covered only end-to-end via
`flow_bundle_roundtrip`, not at the route-handler level where they're most likely
to regress silently. **Fix.** A test per item
(golden-output for exporters; integration for the guarded use cases). **Effort.** M.
(Domain services — TIN, pinch-out geometry, Robertson, age-order, lens inference —
are already well covered; this is the application/exporter layer.)

C12 pinned 2026-09-02: 3 route branches (unsupported `format_version` → 400,
`BundleIntegrityError` → 422, ValueError/KeyError/TypeError → 400) covered at the
route-handler level in `tests/unit/api/test_restore_project_error_branches.py` (6
tests, incl. a 422-wins-over-400 ordering control) — all reachable at unit level
with the session mocked and `restore_project_bundle` patched.
C6 pinned 2026-09-02: skip branches unit-covered for `create_perpendicular_companion`
(single-companion idempotency → `already_existed`), `name_body` (renamed from
`name_lens_body` in the lens→body sweep; find-or-create `was_created=False`),
`upsert_formation_absence` (ON CONFLICT `was_created` flag — flag logic pinned at
unit level; the ON CONFLICT resolution itself stays DB-enforced), and
`materialize_wedge_tips_for_formation` (`absences_skipped_no_geometry` counted-skip,
the true skip-and-count at the re-located :478/:633). `delete_lens_metadata` no
longer exists — retired in the lens→body naming sweep (#216-#218), so nothing to pin.

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
assertion, rename pure mounts to explicit "smoke". **C11** (added 2026-06-04
audit) — load-bearing pure helpers have no `.test.ts`: `bodyAnchor.ts`
(`extremeMemberLayerId`, the #195 body-cap spatial source of truth),
`lithoLayerToContact.ts` (`lithoLayersToContacts`, the A3 read-switch projection
with accepted/pending/rejected filtering), `projectFile.ts` (.gmproj build/parse),
`lithoBoundaryHelpers.ts` — exactly the behaviour-shaped pure functions the
testing rule targets, while the rest of `utils/` is well covered. **Effort.**
M (C8/C9/C10/C11), L (C7, pairs with the #111/#175b split).

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

## Audit follow-up batch (2026-06-01)

Nine findings from the cumulative session audit on `develop`, all resolved:

**F1 — `BodyExtentOverlay` console.warn → log.warn** (commit 839d1c34).
`BodyExtentOverlay.tsx:467` was using `console.warn` for the dip-extrapolation degenerate
fallback — missed in the #176 sweep. Replaced with `log.warn('body-extent', …)` + added the
`log` import. 20 existing tests stayed green.

**F2 — shared `makeBody` in provenance test** (commit 4b441a46).
`SectionsCanvas.provenance.test.tsx` had a local `makeBodyListItem` factory duplicating the
`makeBody` fixture already in `components/sections/__tests__/bodyTestFixtures.ts`. Deleted the
local copy; updated the 2 call sites to `makeBody({ id: 'body-1' })`.

**F3 — `idx_formation_contact_model_cpt` in ORM `__table_args__`** (commit 45286908).
Migration `u5v6w7x8y9z0` created this index on `(model_id, cpt_id)` but the ORM declaration
was missing, so Alembic autogenerate would have emitted a spurious DROP. Added the matching
`Index(…)` entry mirroring the adjacent `idx_formation_contact_model_borehole` declaration.

**F4 — extract `_restore_flat_rows` in project_bundle.py** (commit e560bd87).
`_restore_formations`, `_restore_geotech_units`, and `_restore_cross_sections` shared an
identical 15-line pattern (query existing ids → skip → kwargs inject → session.add → count).
Extracted to `_restore_flat_rows(session, project_id, orm_cls, payload)` and collapsed each
caller to one `return await _restore_flat_rows(…)` line. All 16 bundle integration tests green.

**F5 — avoid mid-transaction autoflush in restore** (commit adc3848a).
The `valid_model_ids` computation after the model-insert phase issued a `SELECT
GeologicalModelOrm.id` that triggered SQLAlchemy autoflush (materialising all pending model
rows mid-transaction, defeating the single-flush pattern). Added `_build_valid_model_ids`
mirroring the existing `_build_valid_formation_ids` pattern: union of DB ids (queried before
any adds) + payload ids. 32 bundle integration tests green; pre-existing SAWarnings in 2 tests
are unrelated and unchanged.

**F6 — PerTestTab derived-stats cache** (commit fed2fd3b).
Every `setPlotMap(prev => new Map(prev).set(id, plot))` changed the Map reference, forcing
the `rows` useMemo to rerun `filter + reduce + sbtZoneFromIc` across ALL already-loaded CPTs.
Added a `derivedStatsCacheRef` (useRef) and a two-level `derivedStatsByCpt` useMemo that only
computes for CPT ids not yet in the cache; `rows` reads from the cache at O(1). New PT1/PT2/PT3
tests in `PerTestTab.test.tsx` pin the cache-stability invariant.

**F7 — strip query params from API error logs** (commit 7e496e02).
All five fetch wrappers in `api/client.ts` logged the full `path` (including any `?…` query
string) to `log.error`. Added `const stripQuery = (p: string) => p.split('?')[0]` and applied
it to the log call in each wrapper. The thrown Error messages retain the full path for developer
diagnostics. 35 vitest test files stayed green.

**F8 — bound `body_boundary_shapes/_nodes` per-item dict shape** (commits b9af67d4 + 73d0750d).
`ProjectBundleRequest.body_boundary_shapes` and `.body_boundary_nodes` were typed as
`list[dict[str, Any]]` with `max_length` list-length caps but no per-item value bounds —
a crafted bundle could ship a single item with a giant string value to bypass the
envelope-size middleware. Added `_validate_bounded_dict_list` helper (256-char key cap,
4 096-char string-value cap) and a `@field_validator("body_boundary_shapes",
"body_boundary_nodes")` on `ProjectBundleRequest` that calls it. Wire type stays
`list[dict[str, Any]]` — no cascade to the restore path. 32 bundle integration tests green.

**Sec1 — f-string SQL in `ecc4014879af`** — deferred. Pre-session migration; interpolates
closed-set enum values from Python constants that are never user-supplied. Not injectable;
stylistic only. Filed as a "watch: don't extend this pattern" note, not a blocking fix.

## 193. FC→LL trigger identity collision in v4 bundle restore (Tier E — backend, M)

**What.** `test_bundle_v4_litho_layers.py` triggers ~16 `SAWarning` lines during the
restore path: "New instance <LithoLayerOrm> with identity key ... conflicts with
persistent instance" + "Identity map already had an identity for ... replacing it
with newly flushed object". Same UUID, two Python instances — one staged from the
bundle's `litho_layers` payload, the other materialised by the FC→LL trigger when
the matching `FormationContactOrm` is inserted.

The existing guard at `project_bundle.py:1328` (`if lid in contact_ids_in_payload:
skipped_fc_trigger += 1; continue`) catches the cases where the layer payload's id
matches a contact payload's id. The remaining collisions occur when an accepted
layer in the bundle has the same UUID as a contact processed elsewhere in the
restore — e.g. orphan-formation contact skipped at line 1244 (the layer still
inserts) or a subtle flush ordering between Python-staged LithoLayer and the
contact-INSERT trigger.

**Why deferred.** Tests pass; behaviour is correct (the second instance overwrites
the first, no data loss). Diagnosing the exact path needs FC→LL trigger interaction
analysis + an integration test reproducing one collision in isolation. Not a runtime
bug — just warning noise.

**When to revisit.** When the FC→LL trigger gets another extension (e.g. a third
shape variant), OR when an actual restore bug surfaces that the warnings make harder
to diagnose. Until then the warning noise stays.


## 194. Cross-section / 3D-consistent lens naming algorithm (Tier D — lands with the 2D→3D step)

**What.** Lens auto-labels are currently computed **per 2D section**:
`{parent geological formation} {depth rank}` where the depth rank
(shallowest = 1) is ranked within the bodies visible on *that* section
(`computeDepthStacking` in `desktop/src/renderer/src/utils/lensLabel.ts`,
fed by `BodyExtentOverlay`). When the same physical body is correlated
across multiple sections — and especially once the user builds the 3D
model from several sections — the same lens can get a different number on
each section, because the ranking set differs. A 3D-consistent naming
algorithm must assign one stable identity/label per physical body across
all sections it appears on (and surface that label uniformly in 2D, the
inspector, exports, and 3D).

**Why deferred.** Owner directive 2026-06-01: "i'll first do the 3
sections and then we'll add a button that writes new sections to correlate
to go to 3D." The per-section dynamic label is correct + useful for the
2D editing workflow happening now; the cross-section identity problem only
bites once multiple sections share bodies. Doing it now would be designing
a layer we haven't needed yet. The auto-label is a pure presentation
computation (the body `name` column stays the explicit user name / keep
marker), so swapping the ranking source for a global one later is a
contained change — no stored data to migrate.

**When to revisit.** When the "write new sections to correlate → go to 3D"
button lands (the owner's next-but-one step). At that point: define the
global body-identity key (likely the resolver's connected-component /
`body_ordinal` lineage across sections), rank once globally, and feed the
same label map into every section overlay + the inspector + exports.

## 195. User-claimed body extents lost when a model-wide accept renumbers the instance (Tier G — backend, M)

**What.** The litho instance resolver (`ResolveLithoInstances._run_resolver`)
reconciles bodies keyed `(formation_id, body_ordinal)`. When a model-wide
operation (accept-all, auto-correlate) shifts a component's `body_ordinal`,
the resolver deletes the old body and creates a fresh one at the new ordinal
with all extent columns NULL. The orphan-delete carries a **preserve-named**
guard (`if body.name: continue`) but NOT a preserve-claimed guard — so a
**user-claimed extent** (`open` / `pinch_out_halfway` / `extrapolated`) on an
**unnamed** body whose ordinal shifted is silently lost. Detector `to_target`
extents are recoverable (re-run "Detect bodies", the explicit verb); a manual
pinch-out claim is not — the data is gone. The e2e helper
`desktop/src/renderer/src/.../helpers/project_open.ts` (`detectBodiesForFixture`,
~lines 190-199) documents the symptom for `to_target` and papers over it; there
is no equivalent recovery for user-claims.

**Why deferred.** Pre-ship, no paid users (backwards-compat suspended). Triggering
requires a specific sequence: accept a unit → claim an extent on it without
naming it → trigger a model-wide op that shifts that unit's ordinal. Not an
everyday path. The pre-feature behaviour was also lossy here (stale body kept its
old key and silently attached to the wrong instance), so this is a sharpening of
an existing edge, not a brand-new class of bug.

**When to revisit.** Before the first external/paid distribution (ties to debt #3).
Fix shape: in `_run_resolver`'s orphan-delete loop, before deleting an unnamed
body, check `is_user_claimed_extent_kind(extent_left_kind / extent_right_kind)`;
if claimed, either (a) carry the extent columns forward to the new same-formation
body for that component, or (b) broaden the preserve guard to
`if body.name or has_user_claimed_extent(body)` (keeps it as an orphan until no
layers reference it — simpler, but accumulates orphans until the next clean
resolve). File: `src/groundmodel/application/resolve_litho_instances_use_case.py`.

## 196. Cold-restore FK violation on companion sections — RESOLVED 2026-06-04

`restore_project_bundle` restored cross-sections (Phase 6) before bodies
(Phase 8), so a **cold** restore (wiped DB / fresh machine) of a project with a
`companion_lens_id` → `body.id` companion section INSERTed the section before
its body existed → `fk_cross_section_companion_lens_id` violation, project
failed to open. (The idempotent path was safe — existing sections are skipped —
which is why `flow_bundle_roundtrip` passed while logging the violation.)

Fixed by **deferring the FK**: `_restore_cross_sections` strips
`companion_lens_id` and returns a `{section_id: body_id}` map;
`_attach_companion_lens_links` re-attaches it after the bodies phase (dangling
links logged + left NULL). Mirrors the existing `litho_layer.body_id` deferral.
Integration test `test_cold_restore_reattaches_companion_lens_section_after_bodies`
pins it (RED confirmed the exact FK violation pre-fix). Commits 0a4afe13 /
52a4975c on develop. File:
`src/groundmodel/infrastructure/db/repositories/project_bundle.py`.


## 200. Electron pre-distribution hardening — file:// nav (Tier B — frontend, S)

**What.** The Electron security-audit findings (2026-06-04) are now closed.
F5 (DevTools backend-log leak) resolved — packaged builds route uvicorn
stdout/stderr to `<logs>/backend.log` via `app.isPackaged`, not the renderer
console — and:
* ~~**F6** — `isInAppNavigation` treats ALL `file://` URLs as in-app, so a
  compromised renderer issuing `window.location = 'file://C:/Windows/win.ini'`
  would render a local file.~~ **RESOLVED (audit #15).** `isInAppNavigation`
  (`desktop/src/main/security.ts`) now confines production navigation to the
  packaged renderer-directory `file://` prefix and normalises through the URL
  parser first, so a `..` traversal segment collapses BEFORE the prefix check;
  every other `file://`, the dev origin when packaged, and foreign
  `http(s)://` are denied and (in `index.ts`'s `will-navigate`) handed to the
  OS browser only when they look external. Pinned by the `isInAppNavigation`
  block in `security.test.ts` (own renderer file allowed; other `file://` +
  dotdot traversal denied; foreign `http://`/`https://` denied; dev origin
  allowed only when not packaged). The `navigationPolicy.ts` helper the
  hardening brief proposed was NOT created — `security.ts::isInAppNavigation`
  is that helper under an existing name, wired and tested; a duplicate would
  split the navigation policy across two files.

**Remaining scope (merged 2026-07-12 from the CLAUDE.md prune):** one
pre-distribution item rides under this number:
* **Electron pin** — ~~pinned at the first `42.x` patch via caret, EOL/support
  window unverified~~ **DONE 2026-09-02.** Pinned EXACTLY at `electron@42.11.1`
  (the latest 42.x patch that day; `desktop/package.json`), lock refreshed via
  `npm install --package-lock-only`. The only graph change is electron
  42.0.1→42.11.1 plus its self-contained dep churn — newer electron vendors
  `@electron-internal/extract-zip@1.0.5` and drops the external `extract-zip`
  subtree (`extract-zip`, `@types/yauzl`, `buffer-crc32`, `fd-slicer`, `pend`,
  `yauzl`); no unrelated dependency moved. **Support window (verified against
  releases.electronjs.org/schedule, 2026-09-02):** Electron supports the latest
  three stable majors; stable `latest` is 44, so the supported set today is
  44 / 43 / 42. Electron 42 is the OLDEST supported and falls out of support on
  **2026-10-20** — the scheduled stable date of Electron 45 (42.0.0 stable
  2026-05-05, EOL 2026-10-20). Move to 43+ before 2026-10-20.

~~**Menu roles** — DevTools + Reload roles live in the *packaged* View menu.~~
**RESOLVED 2026-08-03** (autosave design Q6, owner decision): the View submenu
is built conditionally — packaged builds get *only* Toggle Full Screen, so the
`reload` / `toggleDevTools` roles and their default accelerators (Ctrl+R / F12 /
Ctrl+Shift+I) are never registered — and `webPreferences.devTools` is now
`!app.isPackaged`, which closes the programmatic path (`openDevTools()`) too.
Pulled forward from Tier B because `View → Reload` is the single most likely
accidental destroyer of the renderer-only session state that crash recovery
exists to protect (ghost workspace, lumping map, metadata draft — none of it in
Postgres). Dev behaviour unchanged. `desktop/src/main/index.ts`.
*Not* closed by that change: `--remote-debugging-port` / `--inspect` still
attach a debugger to a packaged build. That is a tamper surface rather than a
DevTools one and is tracked under **Tier B #5**, deliberately unfixed for now.

**Folded in 2026-08-03 — opening a `.strix` handed over by a second instance.**
The single-instance lock (autosave design Q4) makes the first instance the only
one, and its `second-instance` handler focuses the window and **drops the
argv**, which is now logged rather than silently discarded
(`[main] second instance launched: …`). So "Open with… StrixGeo" on a `.strix`,
or a shell drag onto the icon while the app is running, focuses the existing
window and opens nothing. Making it open the file is a deep-link feature with
its own handshake to design (what happens when the open project is dirty? does
it replace or refuse?), so it waits for the same pre-distribution pass as F6.

**Q3 exposure cuts (owner ruling 2026-09-01) — verified/completed 2026-09-02.** Packaged `/docs`+`/redoc` already off (`ENVIRONMENT=production` in the backend spawn / `buildBackendEnv`; `/openapi.json` still on; `test_docs_disabled_in_production.py`); the `codelists/data/` prune list (`scripts/build-embedded-python.ps1`) extended to drop the DOV `.xsd` schema snapshot + the three `codetabel_*.csv` code tables alongside the README + `.xlsx` sources (only the 3 runtime `.json` catalogs ship); and `STRIXGEO_DOV_FIXTURE_MODE` now gated on `settings.environment` so a packaged build ignores it (`is_fixture_mode`, pinned in `test_dov_fixture_transport.py`).

**Why deferred.** Requires a renderer compromise — does not exist on the
single-machine dogfeed. Pre-distribution concern.

**When to revisit.** Day-1 of the first external/paid distribution (ties to Tier
B #5 tamper hardening). Fix F6: narrow the `file://` check to the renderer's
actual base URL (`win.webContents.getURL()` after `loadFile`).

## 201. God-component file-size split (Tier E — readability, L)

**Round 2026-08-28 — `SectionsToolbar.tsx` 2,917 → 902 lines (−69 %).**
Thirteen extractions into siblings, each under the 500-line advisory:
`SectionsAxisPill.tsx` (186) and `SectionsToolbarDialogs.tsx` (298) as
subcomponents; the item/menu specs as PURE builder functions with no hooks,
so there is zero hook-ordering risk — `sectionsLithoMenuItems.tsx` (350),
`sectionsLithoToolbarItems.tsx` (393), `sectionsGeotechMenuItems.tsx` (373),
`sectionsGeotechToolbarItems.tsx` (311), `sectionsTailToolbarItems.tsx`
(408); and five stateful clusters as hooks — `useGeotechStatistic.ts` (161),
`useLithoSuggestVerbs.ts` (273), `useSectionExportVerbs.ts` (187),
`useGeotechSubdivideVerbs.ts` (154), `useLithoCorrelateVerbs.ts` (223).
**Zero test files changed** — the component's public contract is unchanged,
so all 15 existing suites (201 assertions on the component alone) pass
untouched, which is the evidence the refactor preserved behaviour. Gates:
tsc web+node clean, 4,927 vitest green, hook-order check clean. One
non-verbatim edit: `selectedSection.name` → `selectedSection?.name` at two
sites in `sectionsTailToolbarItems.tsx` — TS aliased-const narrowing does not
cross a function boundary, and both sites sit inside the `hasSection` branch,
so the rendered output is identical.

**Counts update 2026-08-27 (F1–F12 audit fixes):** `CesiumViewport.tsx`
crossed 500 (516 — prop declarations; the new zoom logic went to
`useViewportZoomTuning.ts`); `SectionsCanvas.tsx` ~2,820 after the jump
handlers gained the body-authority resolution.

**What.** Five files dominate the codebase by size — extends resolved #114
(which fixed the function-level readability: `_restore_project_bundle_impl`
phase helpers + `computeSlabsAndPolylines`). The remaining problem is *file
size + mixed concerns in one module*: `useGeologicalModel.ts` (5,180 lines,
47 handlers / 23 `useState`), `ContactsLayer.tsx` (4,249),
`SectionPanel.tsx` (3,709), `api/client.ts` (3,201). ~~`project_bundle.py`
(2,682)~~ — **RESOLVED 2026-06-06 (Move 1):** split into a
`infrastructure/db/repositories/project_bundle/` package (6 files,
~400–900 lines each: `bundle_serialization.py`, `bundle_row_builders.py`,
`bundle_build.py`, `bundle_restore_litho.py`, `bundle_restore_core.py`,
`__init__.py` facade). All import paths unchanged; 1167 unit + 47 integration
tests green; ruff + pre-commit hook clean.
(Surfaced 2026-06-04 by owner question.)

**Why deferred.** The React splits carry TDZ / hook-ordering / dep-array
regression risk (own memory documents the bite classes) and must not land
under a live dogfeed. The client split is low-risk and bankable next.

**When to revisit.** After the current dogfeed pass. A full lowest-risk →
highest-risk decomposition plan (5 ordered moves, per-move verification bar,
constraints) lives in git history at
`docs/superpowers/plans/2026-06-04-god-component-decomposition.md` (purged
2026-07-12 — resolve via docs/superpowers/README.md). Move 1
(backend) done. Move 2 (`client.ts` per-domain split) **RESOLVED 2026-06-06:**
`api/client.ts` (was 3,201 lines) replaced by a 211-line barrel re-exporting
from 7 `api/clients/` domain modules (shared.ts, borehole.ts, codelist.ts,
cpt.ts, geology.ts, project.ts, section.ts — 189/315/143/190/1886/215/267 lines).
Zero caller import-path changes; tsc + 1,619 vitest tests green. Move 3
(`ContactsLayer.tsx` geometry + subcomponent split) **RESOLVED 2026-06-06:**
`contactsLayerGeometry.ts` (536 lines — pure geometry: `computeSlabsAndPolylines`
+ 5 helpers + 5 interfaces; zero React) + `ContactContextMenu.tsx` (160 lines —
portalled menu subcomponent) extracted; `ContactsLayer.tsx` 4,249 → 3,812 lines
(−493 total across both commits). `computeSlabsAndPolylines` re-exported from
`ContactsLayer.tsx` so all existing callers and test imports are unchanged.
tsc + 1,619/1,620 vitest (1 pre-existing skip) green. Move 4
(`SectionPanel.tsx`) **RESOLVED 2026-06-06:** three render-only / native-event
extractions out of the 3,709-line orchestrator — `CanvasHints.tsx` (57 lines,
gesture cheat pill), `useSectionCanvasGestures.ts` (418 lines, the
`useSectionWheelZoom` cursor-anchored wheel zoom + `useSectionKeyboardShortcuts`
Esc peel cascade — `{ passive: false }` attach + spacing-warp anchor reads
preserved verbatim), `SectionGrid.tsx` (110 lines, gridlines + axis ticks).
The stateful drag/overlay core stays in `SectionPanel.tsx` per the plan's
mutable-drag-state guard. `SectionPanel.tsx` 3,709 → 3,455 lines. TDZ verified
(both hook calls sit below every binding they consume, above the lone return);
tsc + 1,619 vitest green; senior-code-reviewer pass clean (no blockers). Move 5
(`useGeologicalModel.ts`, 5,180 lines → composer + sub-hooks) **RESOLVED
2026-06-06 — all 5 clusters done:** `useFormationCrud.ts`, `useContactCrud.ts`,
`useGeologicalModelOps.ts` (7 model-level ops; call site placed after
`lithoStaleTinSessionCount` useState to resolve the handleRebuildSurfaces TDZ
forward-ref; handleDeleteModel extracted from its non-contiguous position),
`useLithoModelOps.ts` (5 litho-model ops; call site after ghost-overlay useState;
refs passed as `MutableRefObject` params; B-1 ghost-clear useEffect co-located with
`clearLithoSuggestions` inside the sub-hook), `useLithoSuggestions.ts` (26 handlers
+ B-1 effect; `_updateGhostEntry` internal; `lithoSuggestionAnchorKind` typed as
`'cpt' | 'borehole' | null`; type-only circular import for `BulkAnchorGhost`; call
site after `bulkGhostsByAnchor` useMemo). All bodies moved verbatim; TDZ verified
per call site; tsc + 1,624 vitest + senior-code-reviewer pass clean on all clusters.
`useGeologicalModel.ts` 5,180 → 2,080 lines (−60%).

**Round 2 — 2026-07-13 (audit follow-up growth, owner-approved full-frontend
campaign, concern-based done bar).** Landed on develop (`76f1772f0..fb7d88f54`,
11 commits, all bodies moved verbatim; tsc + 2,128 vitest green per commit;
senior-code-reviewer pass on the full diff — 3 findings fixed, no blockers
introduced by the split):

* `api/clients/geology.ts` 1,629 → 727: type catalogue → `geology.types.ts`
  (913 lines), client re-exports everything (zero caller changes).
* `utils/partitionFill.ts` 5,628 → `partitionFill/` package (10 modules along
  its own banner seams: types / columnReduce / matcher / polygonBuilders /
  carve / emit / sectionResolve / disjoint / clip + index barrel).
  Directory-index resolution keeps every caller import unchanged; the one
  import cycle (disjoint↔sectionResolve) is type-only. CS1 gates pass EXCEPT
  `cs1sandbody` — **pre-existing red**: the untracked
  `scripts/throwaway_cs1_input.json` was regenerated by the spill-investigation
  extract without column `name`s (fails identically on pre-split code; the
  test needs a "B2"-named column — regenerate the fixture with
  `throwaway_cs1_partition_extract.py`).
* Overlay trio: `PartitionFillOverlay` 2,322 → 2,026 (+
  `partitionFillOverlayHelpers.ts`); `CorrelationEdgesOverlay` 1,923 → 1,417
  (+ `correlationEdgesHelpers.ts` + `CorrelationEdgesMenus.tsx`; helper names
  re-exported for the test file); `LithoSuggestionGhostColumns` 1,636 → 1,304
  (+ `LithoSuggestionLayer.tsx`). Geometry-check clean on all three.
* `Geology3DViewer.tsx` 2,697 → 584 (+ `geology3DPrimitives.ts` 1,676 pure
  Cesium builders, `CesiumViewport.tsx`, `BasemapPanel.tsx`; `SplitLine`
  re-exported for `useBody3DViewState`).
* `SectionsCanvas.tsx` 2,790 → 2,386 (+ `useGeotechPackingCorrelation.ts`,
  `useEdgeDragRetarget.ts` sub-hooks, June Move-5 playbook).

**Round 2 continuation — 2026-07-13 afternoon (owner dogfed the morning
batch clean, then green-lit the remainder; `206dd6e82..0d1059989`):**
* SectionsCanvas's last two clusters extracted after all — attended session:
  `useLithoGeoSnapDialog.ts` (snap prompt + P1b live preview + 5 handlers;
  call site above the accept-with-snap handler so `openLithoGeoSnapPrompt`
  stays in scope for #134-C) and `useManualLithoUnit.ts` (debt-#151 pair).
  **SectionsCanvas 2,790 → 2,034 across the four sub-hooks.**
* The `useEdgeDragRetarget` stale-closure latent FIXED (TDD: regression test
  seen RED first — mid-drag rerender reassigns the drop target to the
  anchor's investigation → drop rejected, no API calls; fix = fresh-read
  `lithoContactsRef`).
* Backend trio (#178) — two of three split:
  `auto_populate_contacts_from_stratigraphy.py` 1,573 → facade (837) +
  `stratigraphy_bridge.py` (569; observation helpers move WITH the bridge to
  avoid a bridge↔scan cycle) + `stratigraphy_scan.py` (244);
  `contacts.py` router 1,273 → CRUD (326) + `litho_ops.py` (985), route
  table verified byte-identical (60 routes). `accept_litho_suggestions.py`
  (1,057) assessed + declined: one class, helpers already methods,
  phase-bannered execute — further splitting = param-threading churn.
* **SectionPanel #168 rerouting — owner OVERTURNED the 2026-05-29 decline
  (2026-07-13) and chose the context rerouting. Phase A SHIPPED:**
  `SectionScopeContext.tsx` provided by SectionsCanvas; the 26 zero-test-use
  read-only data props moved (Props 69 → 43; SectionPanel 3,549 → 3,385).
  Provider value intentionally un-memoised (nothing below is `React.memo`;
  removes the stale-dep-array failure mode); context default = all-absent
  scope so providerless test mounts keep prop-omitted behaviour;
  viewport/transform props REMAIN props (that half of the #168 decline
  stands). ⚠ DOGFEED PENDING before Phase B.

**Still open (the remainder of #201/#178):**
* SectionScope **Phase B** (after the Phase-A dogfeed): move the test-used
  data props (`zEpsg`/`axisMode`/`contacts`/`cpts`/`boreholes`/`formations`/
  `activeLithoModelId`/`geotechNotReconciled` — needs a `renderPanel` test
  helper for the 29 SectionPanel.test.tsx sites), then the handler groups,
  then leaf overlays reading the scope directly instead of SectionPanel
  re-threading.
* `ContactsLayer.tsx` (3,415) drag core and the `useGeologicalModel`
  composer (2,410) are cohesive single concerns — no further split planned
  under the concern-based bar.

## 204. ~~Vestigial `is_lens_companion` / `companion_lens_id` fields still serialize in the bundle~~ — CLOSED 2026-06-23, MISFILED (not dead)

**CLOSED — the fields are LIVE, do NOT remove them.** Verified
2026-06-23: `cross_section.companion_lens_id` / `is_lens_companion` are
the perpendicular-companion linkage, which the body-extent /
partition-fill retirement explicitly KEPT ("Materialise companions").
`create_perpendicular_companion.py` writes them
(`companion.companion_lens_id = body_id; is_lens_companion = True`); the
"Materialise companions" router + `materialise_body_companions.py` query
on them; and the frontend renders the section-header companion badge
from them (`SectionHeader.tsx:173`, `section.ts` types). The 3 "empty"
objects in the 2026-06-07 re-exported `.strix` were sections with no
companion — not dead fields. The original filing mistook the historical
*name* (lens, not body) for deadness. The real outstanding work — the
lens→body rename of these exact persisted columns — is already tracked
as **#222** (migration-gated). Nothing to drop here.

## 205. Advanced litho-3D uncertainty visualisation (Tier D — Phase 5, frontend, M)

**What.** The litho 3D model (part b, spec `2026-06-09-litho-3d-model-design.md`
§11.2) ships with **distance-to-data shading reused from the geological model**
(`tinConfidence.ts` — per-vertex confidence from TIN edge-length / hull-edge
proxy → alpha fade, toggled by `showConfidenceFade`). The owner asked for richer
uncertainty views *later*: (a) a true **surface ± envelope** (a high/low "could be
anywhere in here" shell around each body surface, toggleable), and (b)
distance-to-nearest-**control-point** (the real depth-pick / freedraw node)
rather than the edge-length geometric proxy. These are more faithful uncertainty
metrics than the reused geology shading.

**Why deferred.** Underspecified and not needed for the MVP 3D view — the reused
distance-to-data shading is an honest "this is extrapolated" cue and costs
nothing (already built). The envelope needs a defined uncertainty source (fit
residual? a depth tolerance? per-investigation confidence?) and its own
brainstorm + render design; the control-point distance needs the builder to carry
control points into the response. Owner directive 2026-06-10: "we can add more
advanced toggles later, maybe add that to phase 5 debt."

**When to revisit.** Phase 5, once the litho 3D solids (Plan B2) are in the
owner's hands and there's a concrete need to communicate model confidence to
coworkers/clients — pair with the design-ready-parameter work, which has its own
statistical uncertainty story.

## 206. Customisable single-hole body markers — SUPERSEDED by the watertight loft (2026-06-13)

**Superseded.** The watertight loft builder (branch `feat-litho-3d-watertight-loft`,
spec `2026-06-12-watertight-loft-body-builder-design.md`) RETIRED disk-marker
geometry entirely: `litho_solid_builder.py` + `litho_solid_builder_constants.py`
(`MARKER_DISK_*`) are deleted. The loft gives every section-present body a real
watertight volume (real-data eval on `test.strix`: 134 meshes, 0 markers, was 32).
A body that the loft genuinely cannot build (model with <3 non-collinear tests, or
a body on no section) is now stored `is_flagged=True` with an EMPTY mesh — the
spec's "draw a section through these tests" actionable signal, NOT a cylinder
stub. There are no markers left to make customisable/lenticular, so this item is
moot. (If a future UX wants to surface the flagged-body "draw a section" message
in the 3D viewer, that is a NEW item, not this one.)

## Audit follow-up batch (2026-06-13)

Triage of the 13-reviewer full-repo audit ([`DEBT.md`](../DEBT.md), snapshot of
`develop` tip `1f52db38`; 121 findings). The audit is an unfiltered point-in-time
snapshot — this batch is the curated promotion into the tracked backlog. Each new
item below cites the originating reviewer IDs so the full detail (location, repro,
remediation) is recoverable from `DEBT.md`. Findings that fold into an existing
item, and those declined, are listed at the end of the batch.

Numbering continues from #206. New items: **#207–#219**.

## 207. Dead body-extent gestures 404 against a deleted endpoint (Tier G — frontend, S)

**RESOLVED 2026-06-16.** Rewired "Name this body" to `nameBody` → PATCH `/bodies/{bodyId}` (with a null-body guard); deleted `handleOpenEndLayer` / `handlePinchOutLayer` / `claimBodyExtent` / `ProvenanceViolationError` + their prop chain (SectionPanel / ContactsLayer / ContactContextMenu) and the stale test mock. tsc clean, 1733 vitest pass, zero dangling references.

*(audit: DEAD-01/02/03, ARCH-01 — High; coworker-binary blocker)*

**What.** The body-extent system was retired 2026-06-06, but three live frontend
paths still POST to the deleted `POST .../geology/models/{mid}/bodies` route and
404 silently (the error is swallowed as a `warn`, no user feedback):
(a) the right-click **"Open end"** gesture (`handleOpenEndLayer`,
`SectionsCanvas.tsx:745`); (b) the right-click **"Pinch out"** gesture
(`handlePinchOutLayer`, `:798`) — both via `claimBodyExtent` (`geology.ts:1666`);
(c) the lens-inspector **"Name this body"** save (`nameLensBody`, `geology.ts:1635`,
called from `InspectLensBodyPanel.tsx:347`) — which drops the `body_id` the correct
`PATCH .../bodies/{body_id}` route needs. `ProvenanceViolationError`
(`geology.ts:894`, caught at `SectionsCanvas.tsx:783,839`) can no longer be thrown.

**Why it matters.** Two named litho context-menu verbs and the body-name save are
non-functional with zero feedback — a coworker clicking them sees nothing happen.
This is the single highest-signal cluster in the audit and a pre-distribution blocker.

**When to revisit.** Now — before the coworker binary. Quick win: delete
`handleOpenEndLayer` / `handlePinchOutLayer` / `claimBodyExtent` /
`ProvenanceViolationError` + their prop chain (`SectionPanel.tsx:718,728,820–821,
2819–2831`; `ContactsLayer.tsx:168,177,661–662,3234,3738–3751`); rewire the
name-body save to `nameBody(projectId, modelId, bodyId, request)`
(`existingLensId` is already in scope) + fix the test mock. (Bundle with the #216
dead-code sweep if not done sooner.)

## 208. `seeded_formation_contact_ids` lost-update race on concurrent accept (Tier G — backend, M)

**RESOLVED 2026-06-16.** `CrossSectionRepository.union_seeded_contact_ids` now takes `pg_advisory_xact_lock(hashtext(str(section_id)))` before the read-union-write, serialising concurrent writers on the same section (releases at COMMIT/ROLLBACK; different sections never block; read paths untouched). Mirrors `SaveBodyBoundary`. New integration test (`test_seeded_contact_ids_race.py`) `asyncio.gather`s two accepts and asserts no ids lost — red→green confirmed against the live Docker DB.

*(audit: COR-02 — High)*

**What.** `CrossSectionRepository` (`cross_section_repository.py:177–180`) does a
Python-side read-union-write of `seeded_formation_contact_ids`: read the current
array, `existing | contact_ids`, write back, commit. Two concurrent accept requests
for the same section both read the same snapshot and the second commit clobbers the
first's additions. No `SELECT … FOR UPDATE`, no SQL `array_append`, no advisory lock
(unlike `SaveBodyBoundary`, which correctly uses `pg_advisory_xact_lock`). The bulk
accept flow fires concurrent requests, so this is reachable in normal use.

**Why it matters.** Dropped ids mean accepted contacts silently vanish from the
section (the explicit-content invariant: the seeded set drives formation visibility)
— the same "nothing appears after accept" symptom class the seed-must-apply work
chased before. Data-integrity-adjacent.

**When to revisit.** During the litho-finishing pass (Tier G). Fix: one atomic SQL
array-union `UPDATE`, or hold `pg_advisory_xact_lock(section_id)` across the
read-modify-write. Gate with a concurrent-accept integration test (the COR-02 /
TEST-05 pattern: two `asyncio.gather`'d accepts, assert no ids lost).

## 209. Section-fill geometry recomputes on every pan/zoom frame (Tier G — frontend, M)

**RESOLVED 2026-06-16.** Split `PartitionFillOverlay.screenRegions` into a data-keyed `sectionFillData` memo (calls `computeSectionFill`, depends on partition data only — not the screen transform) + a cheap transform-keyed `screenRegions` memo that projects the cached geometry to pixels. A pan/zoom that changes only `levelToScreen`/`plotTop`/`plotBottom` no longer re-runs the LCS engine. Rendered geometry unchanged and still warp-aware (geometry-check exit 0). TEST-04 call-count regression test written first (red→green).

*(audit: PERF-01 / ARCH-03 / TEST-04 — High)*

**What.** `PartitionFillOverlay.screenRegions` (`PartitionFillOverlay.tsx:621–942`)
keys its `useMemo` on `levelToScreen` / `alongToScreenX` / `plotTop` / `plotBottom`
— all recreated on every pan/zoom event. So `computeSectionFill` (the ~2,081-line
LCS + polygon engine in `partitionFill.ts`) re-runs on every scroll/zoom frame, not
only when contact/edge data changes. There is no regression test pinning "fill is
NOT recomputed when only the screen transform changes."

**Why it matters.** On a real section (30+ investigations, hundreds of contacts) a
single wheel tick blocks the main thread for tens of ms → visible jank. Primary
interactive-perf risk before distribution. STATIC analysis (no profile yet) — but
the recompute-per-frame is structural, not a micro-cost.

**When to revisit.** During the litho-finishing pass. Fix: split into a data-keyed
memo (`computeSectionFill(columns, edges, …)` — depends on data only) + a cheap
transform-keyed memo (project the cached geometry to pixels). **TDD note:** write
the call-count regression test (TEST-04) first, watch it fail, then split.

## 210. SSE progress sentinel can hang the import dialog forever (Tier E — backend, S)

**RESOLVED 2026-06-16.** `JobRegistry.start` attaches a done-callback that logs the exception and enqueues the `None` sentinel when the background task raises, so `stream()` always terminates instead of blocking on `queue.get()`. `import_cpt_dov._fire_pins`'s silent `except Exception: pass` replaced with a logged warning; `import_borehole_dov` verified clean. Remaining sibling swallow `shared/progress.py:83` (module-level `fire_progress`, needs a logger param) left for a follow-up. Unit test pins no-hang-on-raise.

*(audit: COR-01 — High; OBS-01/11 — Medium)*

**What.** `job_registry.py:98` calls `asyncio.create_task(coro)` with no
done-callback. If the background coroutine raises after scheduling, the per-job SSE
queue never receives its `None` sentinel and any consumer awaiting `queue.get()`
blocks indefinitely — frozen progress bar, no error. Compounding it,
`import_cpt_dov.py:_fire_pins` (`:35–52`) swallows every callback exception with
`except Exception: pass  # noqa: BLE001` (zero log), so the failure is invisible.
The borehole importer (`import_borehole_dov.py`) likely carries the copied pattern
(verify).

**Why it matters.** A closed SSE connection or a callback error mid-import → the
user sees a stalled bar with no way to tell success from silent failure, and the
operator gets no log line.

**When to revisit.** Quick win, any time: `add_done_callback` that enqueues the
sentinel on exception (or unconditional try/finally sentinel); replace the
`_fire_pins` `pass` with `self.warning(...)`; grep `application/` for sibling
`except Exception: pass` / `# noqa: BLE001` swallows.

## 211. Cross-project id acceptance + missing scope guards (Tier E — backend, S) — MOSTLY RESOLVED

**RESOLVED 2026-06-16 (a, c, silent-return).** (a) `BulkCreateLithoLayers` validates every `formation_id` against the project via `load_scoped_or_raise`, and the litho-layers router passes `project_id` so the guard is LIVE (not dormant). (c) `UpdateFormationContact._propagate_coupled_depth` gained the defence-in-depth `app_project_id` subquery filter. (silent-return) `MaterializeWedgeTipsForFormation` now raises on a found-but-foreign row; genuine not-found stays a warning+no-op for the test-mock path.

**STILL OPEN:** (b) the `DELETE /jobs/{job_id}` scope guard is **deferred to #4** (auth on by-id endpoints) — the endpoint is not client-reachable and import project-scoping is optional, so a guard here would be dormant; it belongs with the coherent network-auth pass.

**DRY-01 (d) — RESOLVED 2026-06-16.** Examined all 8 hand-rolled scope sites; exactly one (`create_perpendicular_companion.py` model guard) was a clean one-hop swap and was migrated to `load_scoped_or_raise` + given a raise-path unit test. The other 7 stay hand-rolled **by design**, not omission: `body_boundary.py` and `create_perpendicular_companion.py`'s lens check also assert `model_id` (a dimension the one-hop helper can't express); `link_litho_to_geo.py` / `unlink_litho_from_geo.py` are two-hop (contact → its model → project) with a deliberate `contact_id` message the helper can't reproduce; `build_ground_model_snapshot.py` / `build_section_snapshot.py` (×2) raise `ParseError` and load via eager-loading repositories (a bare `session.get` swap would risk `MissingGreenlet` on the bundle/export path); `delete_body.py` returns `False` instead of raising. Forcing any of these into the helper would be behavior-changing — the counterweight to the DRY rule.

*(audit: COR-03 — High; ARCH-09, COR-10, DRY-01 — Low/Medium)*

**What.** Three scope-hygiene gaps. (a) `BulkCreateLithoLayers`
(`bulk_create_litho_layers.py:80`) creates layers with the payload's `formation_id`
without checking the formation's `app_project_id` matches the target project — a
foreign-project formation id is accepted (cross-project contamination; FK enforces
existence, not ownership). (b) `DELETE /jobs/{job_id}` (`jobs.py:133–163`) has no
project scope — any job id cancels any project's job. (c) The geo→litho propagation
query (`update_formation_contact.py:391–394`) lacks the defence-in-depth
`app_project_id` filter every sibling query carries (FK saves it today).
(d) Related: ≥7 use cases still hand-roll the scope check that `load_scoped_or_raise`
was extracted for (DRY-01) — `#166` resolved the original sites; the audit found
new ones, and `materialize_wedge_tips_for_formation.py:180` *silently returns*
instead of raising on a scope miss.

**Why it matters.** Mitigated today by localhost binding + UUIDs, but these are the
exact IDOR-class gaps that become real the moment anything is network-reachable
(SaaS, Phase 5) — and the silent-return variant is a latent 404→empty-result bug now.

**When to revisit.** Bundle as one backend hygiene pass before any network-facing
deployment. Add the formation-ownership check (+ audit sibling bulk endpoints),
scope-guard the jobs DELETE, add the propagation scope filter, migrate the hand-rolled
checks to `load_scoped_or_raise`, and decide/document the silent-return site.

## 212. Per-item exception swallows commit partially-staged session state (Tier E — backend, M)

**RESOLVED 2026-06-16.** `RecomputeAllAbsencesForModel` runs each formation inside an `async with session.begin_nested()` savepoint, so a per-formation `(ValueError, LookupError)` rolls back only that formation's staged writes while successful formations accumulate for the final commit. `MaterialiseBodyCompanions` — whose inner `CreatePerpendicularCompanion` commits per body, making a savepoint conflict with its `refresh()` — instead `await session.rollback()`s on a per-body exception to discard pre-commit staged rows (already-committed companions are durable). Skip-counter logging preserved. Integration tests RA5/MC5 pin the rollback. *(Minor known nit: in recompute the summary counters increment inside the savepoint, so a formation that succeeds at inference but fails at wedge-tip materialisation over-counts in the log — logging accuracy only, not the data invariant.)*

*(audit: COR-04, COR-06 — Medium)*

**What.** `recompute_all_absences_for_model.py:270–294` catches
`(ValueError, LookupError)` per formation and continues; staged ORM writes from the
formation that raised mid-way ride the single final `commit()` with no savepoint.
Same shape in `materialise_body_companions.py:191` (broad `except Exception` per
companion). The absence table / companion set can hold a partial write the log says
was skipped.

**Why it matters.** Breaks the all-or-nothing invariant these recompute passes exist
to maintain; the partial state is invisible (only a counter is logged).

**When to revisit.** When either use case is next touched, or before distribution.
Fix: `async with session.begin_nested()` (savepoint) per item, rollback on exception.

## 213. `react-leaflet` Hippocratic-2.1 license risk (Tier B — commercial, M)

**RESOLVED 2026-06-16.** Replaced `react-leaflet@4.2.1` + `@react-leaflet/core@2.1.0` (Hippocratic-2.1) with **streaflet**, a first-party MIT React binding over bare `leaflet` (BSD-2), living at `desktop/src/renderer/src/lib/streaflet/`. Both Hippocratic packages are removed from `package.json` + the lockfile (`leaflet` BSD-2 is the only map dep left); a renderer-wide grep for `react-leaflet`/`@react-leaflet` is clean. Architecture: a tiny `core/` (a `MapContext` carrying `{map, layerContainer, parentLayer}`, five `create*Component` factories, and lifecycle/diff-bind-event hooks) solves the React↔Leaflet create-once / mutate-in-place / event-diff / ref-forward problem once; every component is a thin `createInstance`/`updateInstance` pair. Full general-purpose surface (22 components + 3 hooks: MapContainer; Pane/LayerGroup/FeatureGroup; TileLayer/WMSTileLayer/ImageOverlay; Polyline/Polygon/Rectangle/Circle/CircleMarker; Marker/Popup/Tooltip; GeoJSON; ZoomControl/ScaleControl/AttributionControl/LayersControl; useMap/useMapEvent/useMapEvents) with precise per-event handler props (`onClick`/`onContextMenu` typed to their Leaflet event), an `on={{}}` escape hatch, a `style` (PathOptions) prop replacing `pathOptions`, and a top-level `pane` prop. The 5 consumers (MapView, BboxDrawer, SectionLineDrawer, SectionOverlays, TieSuggestionOverlay) migrated as a pure behaviour-identical swap; map e2e flows (data/geology-stage map render, both DOV bbox imports via BboxDrawer, the TieSuggestionOverlay auto-tie) are green. 38 streaflet vitest + full 1787-test desktop suite + tsc clean. (Build note: the `@/` import alias is configured in tsc + vitest but NOT electron-vite, so consumers import streaflet via a relative path — the e2e production-build gate caught the alias gap. TDD also caught a `undefined`-option clobber class in Leaflet — `subdomains`/`icon`/`pane`/control `position` — fixed with conditional-spread.) The Cesium-vs-Leaflet question raised in "When to revisit" is moot: the owner chose to keep Leaflet; streaflet is the permanent binding.

*(audit: DEP-02 — High)*

**What.** `react-leaflet@4.2.1` and `@react-leaflet/core@2.1.0` are published under
the **Hippocratic License 2.1** — non-OSI-approved, with activity-based use
restrictions and incompatibility with most corporate OSS policies. `leaflet` itself
is BSD-2-Clause (permissive).

**Why it matters.** Strix is a commercial closed-source product targeting BE/NL
consultancies (some serving public-works / infrastructure clients). The license is a
procurement/legal ambiguity that could block enterprise sign-off (the #3 enterprise
tier) — weak as a literal claim, real as a friction point.

**When to revisit.** Before the first paid/enterprise customer (Tier B horizon).
Replace with a thin MIT wrapper over bare `leaflet` (consumers: `MapView.tsx`,
`BboxDrawer`, the section/section-line drawers), or evaluate whether the Cesium 3D
pane can absorb the map role and drop Leaflet entirely.

## 214. Distribution robustness — crash visibility + log hygiene (Tier B — both, M)

**RESOLVED 2026-06-16.** (a) Top-level React `ErrorBoundary` wraps `<App/>` (fallback shows the error + log path + Reload) plus `window.onerror` / `unhandledrejection` handlers in `main.tsx` that log and forward to the main log via IPC. (b) `process.on('uncaughtException')` (logs + `dialog.showErrorBox` + exit 1) and `unhandledRejection` (logs, non-fatal) in `main/index.ts`. (c) Size-based `backend.log` rotation (5 MB × 3) via a pure, unit-tested `logRotation.ts` helper — checked at startup before opening the stream (bounds across-session growth; a single long session can still exceed 5 MB until next launch). (d) New `app:backend-failed` IPC (sent from the `apiProcess` exit handler when the backend exits before `api:ready` succeeds) → `BackendFailedModal`; plus a Help → "Show log file…" menu item (`shell.openPath`). Defence-in-depth: the existing `apiError`→`AppBootError` path also renders the modal. tsc clean; 16 new vitest + full desktop suite green. **Follow-up (e2e-caught):** the exit-handler initially false-positived when an external backend owns :8765 (dev session / e2e harness) — the app's spawned child losing the port race tripped the modal and blocked the welcome screen. Fixed to fetch `/openapi.json` before signalling and suppress if the API answers; e2e `flow_new_project` + `flow_lithology_stage_ui` back to green, 0 modal occurrences.

*(audit: OBS-02/03/04 — High; SEC-09 — Medium)*

**What.** Four gaps that make a coworker-binary failure undiagnosable from afar.
(a) No React **ErrorBoundary** and no `window.onerror` / `unhandledrejection` in the
renderer — a render exception in the geometry-heavy overlays blanks the app with zero
trace in packaged builds (`render-process-gone` does not fire for React errors).
(b) No `process.on('uncaughtException'/'unhandledRejection')` in Electron main — a
main-process crash leaves no log line (Crashpad minidumps exist but upload is off, #16).
(c) `backend.log` is append-only with no rotation (`main/index.ts`,
`createWriteStream(... {flags:'a'})`) → unbounded growth across sessions.
(d) When the backend exits before ready, the renderer spins forever — the
`apiProcess` exit handler logs but sends no `app:backend-failed` IPC (SEC-09).

**Why it matters.** The coworker's machine is the "production" you must debug from
afar; today a failure there is a blank screen or an infinite spinner with no
attachable artifact (the log path isn't even surfaced — see #214 remediation).

**When to revisit.** Pre-distribution (Tier B), alongside #200. Fixes: top-level
ErrorBoundary + global rejection handler + a render-error test; the two main-process
handlers; a rotating `backend.log` (5 MB × 3); an `app:backend-failed` IPC → modal;
and a Help → "Show log file" item so users can find/attach it.

## 215. Postgres bound to 0.0.0.0 with default credentials (Tier B — pre-distribution, S)

**RESOLVED 2026-06-16 (loopback bind).** `docker-compose.yml` now binds `127.0.0.1:5433:5432` so a shared office/lab machine no longer exposes Postgres to the LAN. The default-credentials half (random per-install password) intentionally folds into the bundled-Postgres plan (#2) and stays open there. Takes effect on the next `docker compose up -d`.

*(audit: SEC-05 — Medium)*

**What.** `docker-compose.yml` binds Postgres `5433:5432` (→ `0.0.0.0`) and
`config.py:39` ships the default DSN with `groundmodel:groundmodel`. On a shared
office/lab machine, anyone on the LAN can connect and read all project data.

**Why it matters.** Low risk for a single-user dev box; a real exposure in a
shared-office coworker deployment.

**When to revisit.** Quick win now: bind `127.0.0.1:5433:5432` (loopback-only).
Longer term, fold into the bundled-Postgres plan (#2) — generate a random password
at first run.

## 222. Rename companion_lens_id / is_lens_companion DB columns — RESOLVED 2026-07-13

*(spun off the #217 lens→body sweep, 2026-06-21; landed in the B5 naming batch
while backwards-compat was suspended)*

**RESOLVED 2026-07-13.** Migration `w7x8y9z0a1b2` renames
`cross_section.companion_lens_id` → `companion_body_id` and
`is_lens_companion` → `is_body_companion` (plain RENAME COLUMN — data + FK
preserved; downgrade reverses). ORM, API schema, use cases, FE `section.ts` /
`SectionHeader.tsx`, and the e2e SQL all follow. The bundle now writes the new
keys; old `.strix` files keep restoring via the read-side alias map
`_RESTORE_KEY_ALIASES` in `bundle_serialization.py` (old key → new column, new
key wins on collision), pinned by unit tests in
`tests/unit/api/test_bundle_json_helpers.py`.

## 219. Dependency + supply-chain hygiene for distribution (Tier B — both, S) — MOSTLY RESOLVED

**RESOLVED 2026-06-16 (most items).** GitHub Actions SHA-pinned (checkout/setup-uv/setup-python/setup-node → full commit SHAs with `# vN` comments); `postgis/postgis:16-3.4` digest-pinned in `docker-compose.yml`; wide upper bounds added on polars/scipy/sqlalchemy (`<2`/`<2`/`<3`) so `uv lock --upgrade` can't pull a breaking major; a non-blocking `npm audit --audit-level=high` CI step added. **Verify-items closed:** `python-multipart>=0.0.27` is the CVE-fixed floor (fine); the flagged `lodash@4.18.1` is **legitimate** — verified against the npm registry it's a real new release by `jdalton` (the lodash author) with `dist-tags.latest`, not a typosquat (lodash's first publish since 4.17.21 in 2021, which is why the audit flagged it as "not in known history").

**STILL OPEN (deferred):** the deprecated electron-builder transitives (`glob@7`/`rimraf@2`/`inflight@1`) — forcing `overrides` on a build tool's deps can break packaging and can't be verified without a full `electron-builder` run, so deferred to the installer work (#6) where a real package build validates it. The CI `pip-audit` + lockfile-drift check also deferred (needs a tooling decision: pip-audit isn't bundled with uv) and the future installer's `uv sync --no-group dev` is an #6 concern.

*(audit: DEP-03/04/06/10/12, DEP-05/11 — Low/verify)*

**What.** Pre-distribution dependency hardening, none individually large:
deprecated build-toolchain transitives (`glob@7`, `rimraf@2`, `inflight@1` via
electron-builder — `overrides` or a builder bump); the `postgis/postgis:16-3.4`
docker image pinned to a floating tag, not a digest; GitHub Actions pinned to
floating major tags (`@v4`) — SHA-pin before signing keys / license secrets land in
CI (#3/#6); Python runtime deps lower-bound-only (add wide upper bounds on
polars/scipy/sqlalchemy so a careless `uv lock --upgrade` can't pull a breaking
major); ensure the future installer (#6) runs `uv sync --no-group dev` so openpyxl's
XML surface doesn't ship. Two verify-items: `python-multipart` lower bound and the
transitive `lodash@4.18.1` (a version not in the known release history — confirm
integrity on the registry).

**Why it matters.** CI supply-chain exposure is acute once signing/license secrets
exist; the floating pins make builds non-deterministic right when reproducibility
starts to matter.

**When to revisit.** Pre-distribution (Tier B), as a single hygiene pass. Add a CI
`pip-audit`/`npm audit` step and a lockfile-drift check at the same time.

### Folded into existing items (no new number)

* **#200** (Electron pre-distribution hardening) — extend with: ~~DevTools + Reload
  roles (and the F12 accelerator) live in the *packaged* View menu (SEC-01/07 — gate
  on `!app.isPackaged`)~~ **DONE 2026-08-03, see #200**; Electron pinned at the first
  `42.x` patch via caret, EOL/support-window unverified (ARCH-02/SEC-04/DEP-01 —
  bump to latest 42.x, pin exact, verify the window).
* **#106** (application welded to the ORM) — the audit confirms it's growing
  (ARCH-04) and adds the transaction-ownership split (ARCH-06: use cases flush,
  boundary commits) + ORM-rows-in-result / unconstrained-`setattr` in
  `batch_update_litho_layers` (ARCH-07) as concrete sub-symptoms.
* **#108** (documentation refresh) — specifics the audit measured: README frozen at
  Phase 2 with wrong Node version + stale HTTP/2 claim (DOC-01, its own quick win);
  `api.md` documents a phantom `/lenses/detect` + misses ~17 live routes (DOC-03);
  `architecture.md` lists 3 of 19 routers / 6 of 73 use cases (DOC-02); CLAUDE.md is
  59% inline debt history with 3 dangling file refs (DOC-04 — prune the resolved
  history into debt.md); ~~DOC-05~~ **RESOLVED 2026-07-13** (all 106 current
  endpoints carry full numpy docstrings with body-read Raises; the real gap
  was 56 endpoints with summary-only docstrings — the 113/117 count had
  drifted); ~~DOC-06~~ **RESOLVED 2026-07-13** (example shows on-disk v3 + the v3/v4 decoupling note). Plus the one-class-per-file rule is
  violated 50× by co-located result dataclasses (DOC-07/MAINT-05 — recommend
  *amending the rule* to sanction co-located I/O dataclasses rather than splitting).
  * DOC-01/02/03 refreshed 2026-09-02: api.md 140 routes across 22 routers; architecture.md 75 use cases; README at Phase 4.
* **#110 / #169** (Plaxis exporter dup) — ~~DRY-02/03~~ **CLOSED 2026-07-13,
  audit premise stale:** re-diffed — `_emit_boreholes` and `_emit_header` are
  NOT duplicates. The shared building blocks (`emit_borehole_layer_levels`
  inherit-cascade keyed via TypeVar; `emit_header` skeleton) were already
  extracted by #169; the residual per-exporter methods differ substantively
  (3D: coord-tuple keys, name-keyed cascade, nullable surface-z with
  skip-accounting and a test-pinned `(lines, skipped)` return; 2D: projection
  inputs, UUID-keyed cascade, pre-filtered non-null, list return, dynamic
  notes). Merging = over-abstraction of 2 subtly-varying instances
  (CLAUDE.md counterweight). 53 exporter unit tests green on the baseline.
* **#116 / #174 / #175** (test gaps) — add: `computeSectionFill` whole-section path
  has 1 test (TEST-01); ~~TEST-02~~ **RESOLVED 2026-07-13**
  (`projectFile.test.ts`, 32 cases; also fixed the array-shaped-project-block
  gatekeeper gap it surfaced); ~~TEST-05~~ **RESOLVED 2026-07-13**
  (`test_save_body_boundary_contention.py`: same-body interleave forbidden +
  per-body-key control; verified RED with the lock disabled);
  ~~TEST-08~~ **RE-SCOPED + RESOLVED 2026-07-13:** the head→base→head
  roundtrip is impossible BY POLICY (8a334dc40024 + d8868bb27884 raise
  NotImplementedError under the pre-ship compat suspension; several data
  migrations are intentionally forward-only) — the honest gate shipped
  instead: `test_migration_upgrade_from_empty.py` (scratch DB → upgrade
  head → compare_metadata vs Base.metadata must show zero structural
  diffs), which immediately caught + fixed 4 real body_boundary_shape
  drifts (migration z0a1b2c3d4e5). Revisit downgrades only if compat
  re-arms; a few impl-shaped / over-precise partition-fill assertions
  (TEST-06/11); 5 permanently-skipped e2e specs untracked (TEST-07); sleep-based
  Playwright waits (TEST-09); ~~DRY-04~~ **CLOSED 2026-07-13, audit premise
  stale:** there is NO Py↔TS dip-extrapolation mirror — Python
  `compute_lens_pinch_tip` (metric dip gradient + ray↔polyline intersection →
  synthetic DB contacts, backend-only) and the TS fraction-space
  pinch/lens/onlap polygon builders share no contract, coordinate space, or
  math; a cross-language fixture has nothing to assert. ~~DRY-05~~
  **RESOLVED 2026-07-13** (`lithoConstants.parity.test.ts` reads the Python
  palette from the repo and asserts token + hex parity both ways).
* **#178 / #201** (god-component splits) — the audit confirms growth beyond the
  original four: `partitionFill.ts` (2,081 lines, classifier+geometry+coordinator),
  the three 1,600+-line section overlays (PartitionFillOverlay / CorrelationEdgesOverlay
  / LithoSuggestionGhostColumns), `geology.ts` (1,904 = types+client — split into
  `.types`/`.client`), and two 700-/390-line `execute()` methods (MAINT-02/03/04/07/11).
* **#16** (telemetry/crash reporting) — the renderer's structured-logging gaps
  (OBS-05/06/09: zero logs in the partition-fill path; error-only API logging;
  `log.debug` in catch blocks that "see console" toasts point at but production
  suppresses) and the missing request-ID correlation (OBS-08) belong with the
  observability work.

### Declined (logged, not promoted)

* **Dutch lithology token values** (NAME-11) — the reviewer flags `BaseLithology =
  Literal["GRIND","ZAND",…]` etc. as English-only-rule violations. *Declined:* these
  are token **values**, not identifiers, and the data-integrity rule explicitly says
  store raw upstream tokens + translate at the presentation boundary — the current
  state is sanctioned. An English canonical enum is a legitimate *deliberate* choice
  for later, not automatic debt.
* **Migration f-string SQL** (SEC-03/COR-05/DRY-08) — reaffirms the existing
  "Sec1 — deferred" watch note (2026-06-01 batch): compile-time constants only, not
  injectable; keep as a "don't extend this pattern" note, no fix.
* **Domain `scipy.spatial.Delaunay` import** (ARCH-10), **abbreviation glossary**
  (NAME-13), **`create_formation_only` boolean→enum** (NAME-12), **`display_color`
  regex** (SEC-02) — Informational / cosmetic; record in the audit report, act only
  if the area is touched for another reason.
* **`recomputeAllAbsences` UI-unreachable use case** (KISS-08) — needs a *product*
  decision (wire a visible verb vs delete 481 lines), not a code fix; raise with the
  owner before acting.

## 220. Smooth (non-blocky) litho 3D model from the voxel model (Tier D — Phase 5 visual quality)

**What.** The voxel litho builder is faithful + watertight by construction but
**blocky**: body boundaries are axis-aligned voxel cell faces, so on a section the
contacts read as a staircase and sit up to ±½·(vertical voxel) off the true contact
depth (median 0.13 m at 0.5 m, tighter at 0.25 m). Add a **smoothing pass** that
turns the blocky voxel boundaries into smooth surfaces/planes while keeping the
voxel labelling as the watertight, interfingering-capable ground truth.

**Owner's approach (2026-06-16):** start from the built voxel model; for each body
boundary take the **midpoints between the two contacts a voxel face separates** —
both the **horizontal** faces (top/base of a body, the vertical-direction contact)
and the **vertical** faces (lateral body-to-body seams, the horizontal-direction
contact) — and **fit/draw planes (or a smooth surface) through those midpoints**
instead of the stepped cell faces. A face's midpoint is the best single estimate of
where the real contact sits between the two labelled cells, so a surface through the
midpoints removes the quantisation staircase without moving the contact off its
~½-voxel-accurate estimate. Must stay watertight (shared midpoint surface between
abutting bodies, like the voxel weld shares cell faces) and must not reintroduce the
layer-cake / no-interfingering failure of the retired implicit field — the voxel
labelling still decides WHICH body fills space; smoothing only refines the boundary
GEOMETRY. Both the 3D solids and the 2D section fill (which samples/slices the
solids) inherit the smoothing for free.

**Why deferred.** The current blocky model is faithful and dogfeed-accepted; finer
vertical voxel size already tightens the contacts enough for v1.0. Smoothing is a
visual-quality polish, not a correctness gate, and the marching-cubes-style
midpoint-surface extraction + watertight shared-surface weld is non-trivial
geometry work. Out of scope for the Phase-4 MVP.

## 221. Automatic deepest-first lithology fill — correlation-free fill mode (Tier D — Phase 5, optional)

**What.** An alternative litho-fill model that needs **only lithos, no
correlations**: anchor on the deepest test, extrapolate each unit **flat outward**
to the next test; if a test has no litho at that depth (too shallow / data void)
keep going until one that reaches it; a shallower test's lens "pushes back" (it
wins locally). Where the current model derives band/onlap/lens from the
geologist's drawn correlations ("correlations are base truth"), this derives
continuity **geometrically** from the lithology stacks alone. Ship it as an
**opt-in fill mode** alongside the correlation-driven default, not a replacement.

**Why deferred.** The owner's directive is correlation-driven ("lithos and
correlations are the base truth; 0 correlations = a lens"), and the bottom-tie
feature (`docs/superpowers/specs/2026-06-17-bottom-tie-correlation-design.md`)
gives explicit continuity control within that model — which is the v1.0 path. A
geometric deepest-first model is a **fundamental second fill paradigm**: it
re-opens the whole 2D→voxel chain and partly contradicts the correlation-as-truth
principle, so it's a large, risky rewrite that earns its keep only as a
zero-correlation convenience mode. Runtime is NOT the concern (sections are
~tens of columns); the cost is scope + paradigm conflict.

**When to revisit.** Phase 5, or when a user wants a usable model with **no
correlation effort at all** (e.g. a quick first-pass on a dense survey). Build it
as a mode switch next to the correlation-driven partition; reuse the existing
`computeSectionFill` → voxel payload contract so the voxel builder is unchanged.

**When to revisit.** Phase 5, alongside the other 3D-model-quality work — OR sooner
if a coworker/customer demo flags the staircase as distracting. Profile the
midpoint-surface extraction before adopting (it runs per-build, on the same
on-click Build path the voxel extraction already pays for). Pairs with the voxel
builder ([[project_voxel_litho_builder]]) and the model-from-solids fill
([[project_litho_model_from_solids]]).

## 225. Save must never silently write a 0-edge bundle when the model has edges (Tier B — data-loss guard, S)

**What.** `useProject.saveProject` does a fresh `GET /bundle` then writes the file.
If that bundle comes back with `litho_contact_correlation_edges: []` (or any other
normally-populated array empty) while the DB/model actually has rows, the save
silently overwrites the `.strix` with empty data — a data-loss shape. Observed
2026-06-25: a `test.strix` saved at 18:07 had **0 correlation edges** while the DB
held **481** (the export query is correct and returns 707 when re-run, so the 18:07
fetch hit a transient bad state). Add a guard: before `writeProjectFile`, if the
freshly-fetched bundle has 0 edges (or 0 layers, etc.) but the in-memory
model/section state says there should be edges, **abort the write + surface an
error toast** ("Save aborted — the bundle came back empty; your data is safe in
the app, retry") rather than writing the empty file. Belt-and-suspenders: keep the
PREVIOUS good file as a `.bak` until the new write is validated (count-sanity:
new-file edge count ≥ a small fraction of the prior, or ≥ what the section view
shows).

**Why deferred.** Not reproducible from the current DB (the export now returns all
707), so it's a transient-state guard, not a live bug; and it sits in the save path
which wasn't otherwise being touched. But it is the difference between "transient
glitch, no harm" and "silent overwrite of the user's saved work", so it should land
before any external distribution.

**When to revisit.** Before the coworker binary / first external distribution
(pairs with the backwards-compat re-arm + #47). Implement as a pre-write invariant
check in `saveProject` + an atomic `.bak` keep-last-good. Relates to
[[project_two_stage_save_model]], [[project_decisions_in_bundle]].

## 226. Make `.strix` non-trivially editable (opaque/binary encoding) (Tier B — distribution, S)

**What.** `.strix` is pretty-printed JSON (`JSON.stringify(payload, null, 2)`), so a
user can open it in Notepad and hand-edit (or corrupt) it. Owner directive
2026-06-25: make the file harder to open/edit casually — e.g. gzip the JSON (the
bundle is already MBs, so this also shrinks it), or a length-prefixed binary
container / base64 wrapper, ideally with a magic-byte header + a checksum so a
tampered/truncated file is detected on open. NOT encryption (own-your-data ethos
stays — the goal is "don't accidentally edit it in a text editor", not DRM; see the
`.strix` file-passing stance in CLAUDE.local "Commercial planning"). Must stay
backwards-compatible: the loader detects plaintext-JSON `format_version 3` vs the
new container and reads both (old `.strix` files keep opening), per the
backwards-compat contract.

**Why deferred.** Cosmetic/robustness, not blocking; touches the save+open+restore
round-trip + the format-version detection, so it wants doing alongside the #225
save-guard and the format-version work, not piecemeal.

**When to revisit.** Alongside #225 / before external distribution. Add a magic
header + gzip + checksum; keep the plaintext-JSON reader for old files. Relates to
[[project_strix_file_format_version_decoupled]], #47.

## 227. Geotech-stage manual edits inside a litho body — merge/split/drag/delete sub-bands + small-lens merge suggestion (Tier G-geotech — owner directive 2026-07-06)

**OWNER RULINGS 2026-08-01 — the spec for this entry.** Given while working through the
geotech stage; recorded here because they are what "the same gesture surface" actually
means, and several of them are not guessable from the litho side.

1. **The stage is litho subdivided by packing, nothing more.** The owner's framing:
   *"the geotech stage is literally the same as the litho stage but then each litho body is
   subdivided by packing"*, and *"the 3d takes the partition and builds the model"*. Read
   that as the target for every axis below.
2. **The LITHO body is a HARD BOUND.** A packing boundary moves freely inside its litho
   body and clamps at the edge. It can never move or cross a litho contact — *"litho should
   be a hard bound"*. The hierarchy constrains downward; the owner overrules the CLASS,
   never the hierarchy.

   ⚠ **The GEOLOGICAL half of this ruling is SUPERSEDED (owner, 2026-08-26).** It read
   *"geology too, because it is both combined"*, and the machine enforced it in two places:
   `divide_picks_by_geology` cut every litho pick at the geological surfaces before any
   packing was derived, and the band-edit planners refused a gesture spanning a live
   geological contact. The owner dropped both: *"just drop the wall everywhere, user wil
   have to manually do it"*. Five clays in his project were cut by it, GEO-05/040-S3's clay
   0.05–1.48 m being cut at 0.57 m into NAD 21 over NAD 21 — twin halves of one band. The
   Tertiary case he does want divided (GEO-10/171-B9, Kortrijk top at 18.00 m) is now a hand
   split. The geological model still LABELS each band (`source_geo_formation_id`, by
   thickness-weighted majority per the A2 precedent) and its lines still render on the axis;
   it structures nothing. See `docs/design/geotech-stage.md` → ruling 2 for the current
   state. **NO migration.** Existing twin halves heal on the next press: step 1 "Subdivide
   CPTs" sends `skip_existing=false` (the default), so every CPT column is re-planned and
   S3's clay comes back as one band; step 4 "Divide boreholes" sends `skip_existing=true`,
   which keys on hand evidence (`source='manual'`), so a machine-placed borehole is
   re-planned and a hand-touched one keeps the engineer's work. A band the engineer already
   merged by hand therefore stays merged, and one the machine split comes back whole.
3. **The class is DERIVED, not carried.** After a drag, split or merge, the NAD class of the
   resulting interval is recomputed from the CPT qc over the new depth range —
   *"you recalculate after drag merge, the qc"*. Editing changes the extent; the data
   re-classifies what was made.
4. **Recalculation is LOCAL.** Only the edited column re-derives; other columns keep what
   they had, and a connection breaks if the new class no longer matches. Editing and
   correlating stay separate, exactly as on litho.
5. **Manual override ALWAYS wins.** *"the user needs to be able to manually overrule
   everything"*. Any refusal on qc grounds is a defect; refusal on hierarchy grounds
   (ruling 2) is correct. A blocking dialog with no way through fails this ruling.
6. **The warning is advisory and must not lie.** *"if the qc is lower or higher then it gets
   a warning that it will pull down or up the avg qc of the layer it is in"* — say which way
   the representative qc moves and what class results, then let the edit through. It MUST be
   computed with the same statistic the classifier reads, or it predicts a reclassification
   that does not happen.
7. **The representative statistic is SELECTABLE, per geotech model.** Median (today's, chosen
   as spike-robust), arithmetic, harmonic, geometric. They are ordered
   harmonic ≤ geometric ≤ arithmetic for the same series, so the choice systematically
   shifts classes — harmonic is the conservative one, weighted toward the low values that
   govern bearing and settlement. Per geotech model rather than per project, so the choice is
   part of that model's provenance.
8. **Changing the statistic MARKS THE MODEL STALE**, exactly as a litho rebuild does — it
   does not silently re-derive all 525 bands. Same drift guard the owner chose for the
   geotech 3-D build on the same day.

Related ruling recorded under #256: a body reaches from its drawn apex until something
contradicts it. Related measurement under the geotech-agreement work: the 2-D render and the
3-D build currently disagree over 55.2 % of the section plane, because they are two engines
over two input sets — which ruling 1 says should not exist.

**What.** The geotech stage needs the same manual gesture surface the litho stage
has, scoped INSIDE a litho body (the geotech partition is a refinement of the
litho partition — owner design lock 2026-07-06, brainstorm on real CS1): drag
packing-surface boundaries with clamping barriers at the litho envelope (a packing
surface can never cross a litho boundary), delete/merge/split sub-bands, and a
**"merge small lens into encompassing body" suggestion** (owner idea, same
brainstorm): tiny enclosed class lenses (e.g. the thin greener lens under a
shallow n21 on CS1) get an inspector affordance suggesting the merge, mirroring
the litho stage's assisted-manual philosophy.

**SHIPPED 2026-08-08 (owner dogfeed pending).** Split/merge landed 2026-08-01;
the 2026-08-07 interview decisions (drag is the missing primary gesture;
drag-merge absorbs like litho at `max(0.1 m, 15 %)`; broken accepted ties are
FLAGGED `class_changed`, never dropped — retroactive on split/merge; scope =
delete verb + undo + statistic selector + lens suggestion) all built overnight
2026-08-07→08. Current state is `docs/design/geotech-stage.md` §4: six verbs
(split / merge / drag with squeeze-to-absorb / remove-band via pair merge /
lens absorb via N-run merge / move endpoint), per-verb undo on the section
stack, `representative_statistic` per geotech model (rulings 7+8; derived
staleness, "re-run under <statistic>" tag), flag-not-drop with tie transfer on
absorbed rows, GB1–GB16 integration coverage, and the two invalidation fixes
(band edits amber the 3-D Build via `useLithoSolids` `refreshOn`; same-model
geotech refetch no longer blinks the NAD fill).

**SHIPPED 2026-08-09 — the successor slice: snapping a litho contact to a
packing boundary.** The 2026-08-09 dogfeed hit the same wall twice in ten
minutes ("i tried merging a litho, but it was in separate geo bands"; "sometimes
after merging, i can't grab the contact handles anymore"). Neither was a defect:
on CPT `019e932e-7c4a`, 14 of 17 internal boundaries ARE litho contacts, which
ruling 2 correctly refuses to drag as packing boundaries — but they render
identically to the 3 that are draggable, so a correct refusal read as a broken
app. The answer the owner ruled for is to make the CONTACT draggable from this
axis, snapped onto that column's packing boundaries. Design:
`docs/superpowers/specs/2026-08-09-snap-litho-contact-to-packing-boundary-design.md`
(APPROVED); current state: `docs/design/geotech-stage.md` §4c. One boundary per
drag over a half-open `(from, to]` interval, direction decides which layer
swallows which, derived-not-stored staleness surfaced as a tag on Subdivide,
heavy-vs-dashed line weight with a rest grip and a hover padlock.

Verified end to end 2026-08-09: `flow_geotech_snap_contact` drives the real
gesture and passes, in a **fully green suite — 121 passed / 0 failed / 5
skipped**. That is the new baseline: any red is now a real regression, not an
expected one. Getting there retired the `flow_per_instance_body` red that had
been filed against the partition engine since 2026-08-03 (two stacked defects —
the fixture writing `max_depth_m = 0.0`, which COALESCE takes as a value and so
collapsed every series-less column's deepest litho layer to 1 mm, and a
`.first()` comparison the first defect had been masking).

Two harness defects were found getting there and fixed alongside, both older than
this work. (1) The suite left the fixture's crash-recovery snapshot behind when a
spec was torn down dirty, so the next launch opened on the "Restore unsaved work?"
modal and its backdrop failed **19 unrelated specs** on intercepted clicks (run
8 → 23 min). (2) The suite's userData location was UNDECLARED: `out/main/index.js`
has no adjacent package.json, so `app.getName()` fell back to Electron's default
and it wrote to `<APPDATA>/Electron`, while dev and packaged builds both use
`ground-model-desktop` (`productName` lives inside the electron-builder `build`
block, where `getName()` never reads it). The isolation that gave the suite is
worth keeping — it is why a hundred-plus launches of fixture chrome never landed
in a real store — so it is now passed explicitly via `--user-data-dir` rather than
inherited from where a file happens to sit. Both fixed; suite verified green after.

**Remainder (this entry stays open for):**
* **Owner dogfeed** — drag feel, absorb hint legibility, remove-band menu,
  statistic selector + stale tag, lens badge. **Both recorded questions were
  ANSWERED and built 2026-08-10:** a flagged tie no longer holds its body union
  (he found a body spanning NAD 8 and NAD 7 on his own model and ruled "split"),
  and class-consistent transferred ties now carry their own `band_absorbed`
  token.
* **Owner dogfeed of the snap gesture (§4c) — round 2 done 2026-08-09, four
  findings closed, the rest still open.** Answered and shipped: the two boundary
  kinds were NOT distinguishable by dash and width alone (both near-black, 1 px
  vs 1.75 px) — the packing boundary is now mid-slate as well; the hover padlock
  never appeared because it armed itself from an invisible glyph (a real defect,
  and three unit tests passed throughout by hovering the one thing a user cannot
  hover); the next boundary was demoted from a magnet to a WALL so a contact can
  be nudged freely short of it; and landing on the boundary now merges rather
  than 422s. The consequence prompt the owner asked for twice is built and names
  the geological contact when the row carries one. **Still open:** whether the
  interim overhang should be tinted as provisional rather than drawn plain (a
  rendering question the design left open), and whether the geotech axis should
  get the amber "snap on release" telegraph the litho axis has — it needs a
  per-frame drag plan, so it is a small build rather than a tweak.
* **Audit fix wave, 2026-08-11 — 17 of the overnight audit's 26 confirmed
  findings FIXED on develop** (report: `.superpowers/audit-geotech-2026-08-10.md`,
  STATUS annex at the top). Both merge directions work and are guarded on both
  hierarchy walls; the contact move is undoable, reports its tie consequences
  honestly, ambers Divide boreholes, and refuses ambiguity beside 1 mm layers;
  the coverage gate counts edge runs and runs per interval in build AND edit;
  the sliver gaps are gone; a re-subdivide clears the undo stack it invalidated;
  the contact move finally has DB-level coverage including the geological arm,
  and the build's statistic thread is sabotage-pinned. Owner rulings still open:
  F05 (conservative-merge vs re-derive), F06 (raw-qc disclosure), F08-mode
  (persist donor provenance), F20 (sheet's '>' vs '≥'), F30 (verify thresholds
  against the xlsx), F32 (stretch over unread ground), F33 (flank-donor rules),
  F34 (coinciding-but-unlinked geo contact + 2-row repair).
* **Round 3, 2026-08-10 — three more shipped, one accepted as-is.** The
  solid-on-solid 500 he hit is fixed at both ends (the line stops short of a
  contact wall, and the planner refuses that landing independently); the drag
  telegraphs its consequence, which the owner asked for to match the litho axis;
  and every hand edit that flags accepted ties now asks whether to delete them
  instead of leaving a violet badge to be found later. He accepted the
  overlapping boundary hit strips as they are — *"i can't actually click all
  boundaries by aiming correctly, i think it is fine like this"* — so the #158
  allocator stays off this surface until it bites.
* **Litho-level thin-interbed merge suggestion** — the CS1 zoom showed much of
  the "mess" at GEO-22/115-S10 is thin LITHO interbeds; the shipped suggestion
  covers only geotech class lenses. Separate slice against litho ghosts.
* **Known accepted infidelities** (documented in code): undo of a split leaves
  `source='manual'` on the restored band (hand-edit count may over-report by
  ≤1); ties FK-cascaded with an absorbed row do not resurrect on undo.
* **Undo commands re-anchor per command, not across the stack.** Each command
  closes over its own row ids and re-anchors them across its own redo cycles,
  but a LATER hand edit that deletes a row an EARLIER command still names
  leaves that earlier command stale — e.g. split a band, hand-merge the halves
  back, then Ctrl+Z twice: the second revert names a row the merge deleted.
  `useUndoStack` fails safe (it clears history and names the action in the
  toast), so nothing corrupts, but the earlier edits stop being undoable.
  Fixing it properly means id-independent commands (address rows by column +
  depth, not by id) — a rework of the shared stack's contract, not of #227.

**Inherited risk, noted 2026-08-09 (not introduced by the snap work).** The parentage
probe shared by `canMergeBands` and the new contact-drag rule reads `lithoLayers`, which is
the unfiltered API list and therefore includes `status=pending` suggestion ghosts;
`columnBands` does not filter by status either. A pending ghost overlapping an accepted body
can influence the parentage verdict — identically for both callers, which is the correct
consequence of sharing one probe rather than a second bug. Pre-dates the snap feature. Worth
a status filter when either is next touched.

**Adversarial review 2026-08-08 (5 dimensions over the ~70-commit build).** Six
defects found and fixed RED-first before the dogfeed: a tie's identity ignored
its `top`/`base` surfaces, so an absorb could drop an accepted base-to-base tie
as a "duplicate" of an unrelated top-to-top one; a PENDING proposal on the
survivor could evict an ACCEPTED tie (now the reverse — the proposal is
withdrawn); an `ambiguous_band` flag could be overwritten into `class_changed`
and then self-heal away a review the engineer never gave; the drag's absorb
prediction had no direction, so a band already thinner than the 10 cm floor
merged on any nudge, even one growing it; a failed post-commit refetch reported
a landed edit as a failure and skipped its undo push; and the drag release
called the preview from inside a `setState` updater (two previews per release
under StrictMode). An emptied geotech model also kept a stale
`classified_with_statistic`, advertising a re-run over bands that no longer
exist. Two review dimensions (wiring-ux, test-honesty) never ran — the run hit
a credit ceiling — so those angles are UNREVIEWED and worth a second pass.

**Review round 2, 2026-08-08 (four reviewers over the same bounded diff:
staff, UX, test-honesty, silent-failure — plus the owner's own `/code-review`).**
Three reviewers converged independently on the same top defects, which is what
made them credible. Fixed, each RED-first:

* **A tie's identity was missing its SECTION.** The uniqueness constraint is
  `(model, section, both endpoints, both surfaces)`; the transfer's duplicate
  test omitted the section, so absorbing a band could delete an accepted tie
  drawn on a DIFFERENT cross-section as a false duplicate — and a genuine
  cross-section collision could raise an IntegrityError, surfacing as a 500.
  Found independently by two reviewers. `tie_key` now mirrors the constraint.
* **The toast called deleted ACCEPTED ties "pending".** An absorb may legally
  delete an accepted tie (self-loop, true duplicate), but reporting it as a
  withdrawn machine proposal inverts the meaning. The response now carries
  `deleted_accepted_edge_ids` (additive) and the toast names the two apart.
* **The drag preview was invisible in dark mode** — slate-900 on the slate-800
  plot, ~1.2:1, on the theme the app ships as its hero. The "release to merge"
  warning text was among the unreadable parts. Now themed through
  `--section-edit-*`, the mechanism that already fixed this for ColumnGlyph.
* **The band menu ignored Escape and survived zooming** — the litho sibling
  handles both, the wheel case specifically because the owner reported a
  stranded menu there.
* **The "re-run under <statistic>" tag could never clear.** A local cache of
  the pre-change `classified_with` shadowed the refreshed model row forever, so
  the tag stayed after the re-subdivide that resolved it — inviting repeated
  presses of a verb that wipes and rebuilds every band. The local answer is now
  a bridge that expires when the server row agrees.
* **The post-commit "view could not refresh" warning was dead code.** The
  packing-edge refetch catches its own failures, so it never rejected and the
  branch only fired against a mock — mock drift in a fix made the same day. The
  refetch now reports success, and a stale section is said out loud.
* **Coverage holes closed:** `swap_sides` had zero tests (a wrong result stores
  a base-to-base tie as top-to-top), and **the BUILD arm of ruling 7 was
  unpinned** — hard-coding `median` in the build while still stamping
  `harmonic` left every suite green. ST-SUB3 pins it and was negative-controlled
  (sabotage the build → RED; restore → green).

Not fixed, recorded: the reviewers also flagged that four one-line prop
deletions would each silently disable a shipped feature (the lens badge and the
solids-refresh have no test at any level), and that the boundary hit-strips do
not use `allocateMinHitExpansions`, so two boundaries closer than 10 px overlap
and the deeper one wins the press (the debt #158 collision class, on a gesture
that now commits a re-derivation rather than opening a menu).

**When to revisit.** Close after owner dogfeed answers the two questions and
the litho-interbed slice gets its own entry or a kill.

## 228. Litho fill-bands partition sliver overlaps — RESOLVED 2026-07-07

**What (was).** `computeSectionFill`'s RAW region polygons overlapped by hairline
slivers on dense interbedded stacks — proven on the real CS1: non-lens overlaps
in gaps 16/18/22 (≤ 8e-3 fraction·m, sub-pixel). Invisible on the litho axis but
a broken partition for the 3D voxel labelling that consumes `computeSectionFill`.

**Root cause (proven, not guessed — instrumented on the frozen CS1 slice).** A
single geological contact drawn as TWO slightly-different lines by two independent
emit paths: (a) GAP-18 — a matched-band base (clay flooding the shallow void,
sloping to the deep-left floor) vs. the floor-walk pinch directly beneath it
(sloping to its own apex); both clip at the shallow-TD cap at different fractions,
leaving a thin double-covered wedge above the cap. (b) GAP-16 + GAP-22 —
`carveOverlays` inserting a DEGENERATE lens/onlap notch whose clipped chain rides
the matrix's own boundary edge, producing a self-intersecting / self-touching ring
whose winding fold reads as a phantom overlap with a sibling.

**Fix.** New always-run `makeGapRegionsDisjoint` pass at the end of
`computeSectionFill` (partitionFill.ts):
1. **Repair** every self-intersecting / degenerate non-lens ring
   (`simplifyRing`) — keeps the nonzero-winding filled area (identical render)
   but re-emits it as a SIMPLE polygon, dissolving the degenerate self-touch that
   was the GAP-16/GAP-22 phantom slivers.
2. **Subtract** the later-in-array (drawn-on-top) region from the earlier one for
   each remaining hairline overlap (`subtractPolygon`) — so the rendered pixels
   are unchanged (later already won the z-order) while the polygons become a true
   partition. Subtraction outputs clean minimal boundary rings (directed-edge
   cancellation → no internal edges → no same-colour hairlines), honours a
   self-intersecting subtrahend by nonzero winding, and only touches overlaps up
   to a hairline area cap `SLIVER_MAX_AREA` (a gross overlap is a distinct defect
   left for the gate to surface, not silently papered over).

**Verification.**
- New exact pairwise-overlap invariant (`partitionOverlapCheck.ts` — ear-clip +
  triangle-clip exact area, sampled fallback for non-simple rings) wired into
  BOTH the always-on frozen-CS1 gate (`partitionFill.cs1frozen.test.ts`) and the
  live CS1 gate (`partitionFill.cs1void.test.ts`, `CS1_GATE=1`). Went RED on the
  old engine (gaps 16/18/22), GREEN after the fix.
- Zero rendered-pixel change proven on real CS1 at ~5.5M samples/gap
  (top-visible-formation identical with the pass on vs off).
- Geometry pinned in `partitionDisjoint.test.ts` + `partitionOverlapCheck.test.ts`.
- Full desktop vitest suite green (2143 passed); tsc clean.

**Left as-is (documented, render-only — NOT a partition defect).** The
`computeUnderColumnSubstrate` below-TD fills are drawn per-column in COLUMN-STRIP
screen space (not part of the `computeSectionFill` gap partition, and per
CLAUDE.md 2D-render-only — NOT carried to the 3D voxel labelling). At coincident
cluster columns (closer than a strip width) adjacent strips can overlap; observed
cases are same-colour (invisible). Fix if ever visible (different-formation
cluster): clip each strip's `leftX/rightX` to the midpoints toward its neighbours
in `PartitionFillOverlay.underColumnFills` (the recipe already prototyped in the
geotech-brainstorm `carvePanel` substrate render). Deferred here to avoid editing
the shared overlay component while the parallel geotech session renders through it.

## 229. ~~Execute the 2026-07-12 audit delete table~~ — EXECUTED 2026-07-12 (all 58 rows)

**Execution record (same day, batches A–D + Stage-2).** All 58 delete rows
landed or were deliberately routed to #237:
* **Batch A (backend, 16 commits `a0a7cb76..9fb0ce14`):** section_partition.py
  + goldens, domain/models/geology pkg, pinch_out_geometry, dip_extrapolation
  (Py), lens_pinch_out deads, models/base + models/monitoring, strat_field
  iso_surface.py + **scikit-image dependency removed**, strat_field preview.py,
  _materialise_borehole_bands, _load_total_depths, queue/import_progress shims,
  DovClient legacy path, PostGISService, body-extent bundle scaffolding.
* **Batch B (API/cross-stack, 12 commits `5cb07476..08a836df`):** jobs
  import-cpt + 501 stub, 3 litho-geo link/unlink endpoints + FE wrappers,
  per-body absence recompute + FE pair, always-zero accept fields end-to-end,
  GeotechnicalUnit CRUD surface (ORM kept → #237.4, since decided: drop),
  create_formation_only, seed-from-parent FE plumbing, non-streaming DOV FE
  wrappers + cpt.delete, dead project/review/geotech-ghost/misc client methods.
* **Batch C (frontend, 14 commits `5c37fd95..cbe77590`, ≈−1,300 lines):**
  ContactsLayer TIN-slice subsystem, LithoSuggestionLayer unreachable states,
  no-op "Remove all correlations" item, dead exports/shrapnel, orphaned hook
  imports/params, dipExtrapolationFrontend.ts, lensLabel + test-only utils,
  REWRITE_A block, ~307-line TEMP-DEVTOOLS block.
* **Batch D (tooling, 5 commits):** 3 strat one-shot scripts,
  diag_section_fill_modea.py, electron-smoke.cjs, 5 dead e2e db_helper
  exports, showLogsFolder IPC pair.
* **Stage-2 (#237.5, `7f34247b`):** legacy substrate fill path, −1,636 lines.

**Verification:** desktop tsc clean; full vitest 2,129 green; backend unit
1,532 green; ruff/mypy at-or-below baseline; **full integration suite 707
passed / 4 failed / 3 skipped in 7m55s — all 4 failures reproduce identically
on the pre-batch commit `9c43655e` (pre-existing reds, filed as #238; zero
regressions from the campaign).** The suite's earlier 2h43m/hung runs were the
IPv6-loopback connect stall, fixed by the 127.0.0.1 pin (`cdf5b0ad`/`a726ceb5`).

Follow-up candidates left deliberately: `handleUnreject*` hook exports (last
UI consumer deleted with FE-SECTIONS-02) — next audit pass.

**What (was).**

**What.** The 2026-07-12 redundancy audit (DEBT.md, dated section) produced a
58-row "delete outright" table, every row adversarially verified as
zero-production-caller (independent re-grep incl. dynamic dispatch). Headliners:
`section_partition.py` (2,449-line dead Python port of partitionFill.ts) + its
goldens harness, the `domain/models/geology` dataclass package (458 lines, false
docstrings), the dead `pinch_out_geometry`/`dip_extrapolation` orphans (Py+TS
mirror both test-only), ContactsLayer's TIN-slice subsystem (~180 lines,
`surfaceThroughPicks` hardwired true), ~25 dead FE client methods + types regrown
since #207, dead endpoints (litho-geo link/unlink ×3, per-body absence recompute,
jobs import-cpt + 501 stub), the CPT DovClient legacy download path, the
`queue.py`/`import_progress.py` re-export shims, and the ~307-line TEMP-DEVTOOLS
block in PartitionFillOverlay. Excluded from the mechanical batch: the five
owner-decision items tracked in #237.

**Why deferred.** A few focused hours of deletion + test-file migration; the
audit landed at the end of a long housekeeping session and each deletion should
run the affected test suites individually (one file per commit).

**When to revisit.** Next cleanup window between geotech dogfeed rounds — or
opportunistically: whenever a session touches a file on the table, delete the
dead code in the same commit. Work the table top-down; strike rows in DEBT.md is
NOT allowed (append-only) — track completion here instead.

## 230. ~~Vitest fill-gate inversion~~ — RESOLVED 2026-07-12

**Resolution.** rewriteB now defaults ON everywhere including vitest
(`partitionFill.ts` + both test mirrors flipped in one commit, `ce76e885`); the
retired legacy substrate path runs only under an explicit `REWRITE_B_LEGACY=1`.
Verified both ways: default full suite 2,172 passed / 13 skipped; legacy run
100/100 on the mirrored files (skipIf gates invert correctly). Stale
`REWRITE_B=1` run-comments dropped from the CS1 gate specs (`9950b218`).

**What (was).** `partitionFill.ts:4215` sets `rewriteB = (env REWRITE_B) || !inVitest`:
production always runs rewriteB, but under vitest the flag is FALSE unless a
human exports `REWRITE_B=1`. The default suite (and the pre-commit gate) test
the retired legacy path — `partitionFill.test.ts` even asserts DIFFERENT
expected outputs per path (`expect(...).toEqual(rewriteB ? [] : ['CLAY'])`),
and `cs1frozen` skips gates when rewriteB is on. Green checks currently pin
behaviour the app never executes — the same class of hazard as the CM1
test-shaped-by-impl lesson.

**Why deferred.** Filed from the 2026-07-12 audit (FE-PARTITION-FILL-02);
flipping the default requires migrating/splitting the legacy expectations
behind an explicit `LEGACY=1` run and re-baselining the CS1 gates on the
rewriteB path.

**When to revisit.** BEFORE any further partitionFill.ts change and before the
full-band pivot brainstorm — this is the first artifact of that work, not an
afterthought. Pairs with #237's rewriteB Stage-2 decision.

## 231. ~~Wedge-tip stale-delete is not section-scoped~~ — RESOLVED 2026-07-13

**Resolution (`d59aa3098`).** Stale-delete + seeded-array prune hoisted above
the per-section loop: delete once for the (model, formation), prune EVERY
section's `seeded_formation_contact_ids`. WT1 integration test
(`tests/integration/application/test_materialize_wedge_tips.py`) written
first, RED on the old loop (section-2 dangling seeded ids), GREEN after.

**What (was).** `materialize_wedge_tips_for_formation.py`: step 7a calls
`_find_existing_synthetic_ids(model_id, formation_id)` INSIDE the per-section
loop (line ~391), but the SELECT (line ~538) has no section filter. New tips
are inserted + flushed per section, so section k+1's pass deletes section k's
fresh tips, and `_remove_from_seeded_ids` prunes only the CURRENT section's
seeded array — earlier sections keep dangling seeded UUIDs. Net: only the LAST
section's tips survive. Single-section projects (the common dogfeed case) are
unaffected, which is why it went unnoticed. Orchestrator-verified 2026-07-12.

**Why deferred.** Bug-adjacent redundancy found by the audit; the fix (hoist
the stale-delete + prune above the section loop, or section-scope the
synthetic contacts) needs a 2-section integration fixture to pin RED first.

**When to revisit.** Next litho backend touch, or before dogfeeding wedge tips
on any project with 2+ sections.

## 232. ~~Post-accept pipeline ×4 in useLithoSuggestions — extract the shared tail~~ — RESOLVED 2026-07-13

**Was.** Prior-audit DRY-07 grown: four accept handlers repeated the same
post-accept tail, already drifted; `contactIdsByAcceptedIdx` doc claimed three
populating handlers while only one did (audit 2026-07-12, FE-HOOKS-04).

**Resolution (`f6bfc81eb` + `fb8e2af74`, B2 batch).** One `commitAcceptTail`
useCallback owns the tail (recordCreatedRows → updated_section forward →
ghost accepted-mark → refetches → pushAcceptLithoUndo) across all four
handlers; `handleAcceptBulkLitho` (the second one-layer path) now populates
`contactIdsByAcceptedIdx` by identity like the focused single accept; the
multi-layer paths deliberately keep the documented `useBoundaryDrag`
depth-tolerance fallback (idx→contact association needs a backend ordering
contract — owner decision still pending); the stale `BulkAnchorGhost` doc now
describes the real state. Note: the audit's parent-summary-toast + stale-TIN
steps had already been removed by `b77be9871` — the live tail is 5 steps.
Same batch (`22e114f31`, FE-HOOKS-06): the focused reject/unreject/edit
handlers folded into thin wrappers over their bulk siblings.

## 233. ~~Geotech/Litho/Geology canvas triplication — extract the shared 3D-view plumbing~~ — RESOLVED 2026-07-13

**Was.** `GeotechnicalCanvas` was a ~350-line admitted-verbatim copy of
`LithologyCanvas`; `GeologyCanvas` carried a third copy of the split-state +
ground-surface blocks; the per-section approved-edge fetch was duplicated
twice WITHIN each canvas (audit 2026-07-12, FE-SHELL-CLIENTS-10 + -11).

**Resolution (`6c5823a3c`…`a15ea3205`, B2 batch).** New
`shell/stages/shared/`: `useBody3DViewState` (view mode + wireframe + split
state + ground-surface fetch + lazy fence-edge fetch + fence memos +
voxel-ref unmount-null; Geology passes `fenceActive: false` so the fence
machinery stays inert), `BodyViewModePills` (Solid/Fence/Wireframe pills +
empty-fence hint, testid-prefix parameterised), `makeVoxelRequestBuilder`
(the ~45-line async voxel callback) and `fetchApprovedEdgesBySection` (the
4-copy fan-out). All three canvases wired; testids, hint copy, module refs
and effect semantics unchanged (behaviour-preserving; full vitest green).

## 234. ~~DHMVII dual WCS client — route the section line-profile through the provider stack~~ — RESOLVED 2026-07-13

**Was.** Two parallel httpx/WCS stacks hit the same DHMVII endpoint:
`DhmviiSampler` (line profile, `api/routers/dem.py`) vs
`WcsDemProvider`/`DhmviiDemProvider` (grid); the sampler bypassed
`DemTileCache` so every section elevation-profile re-downloaded its strip.

**Resolution (B4 dedup batch, per the verifier-corrected
BE-INFRASTRUCTURE-15 plan).** `WcsDemProvider` gained
`sample_along_line` (declared on the `DemProvider` ABC): one shared
`_fetch_tile_tiff` (cache-first + GetCoverage + `_extract_tiff` +
write-through) now backs both `fetch_grid` and the line profile; the
profile bilinear-samples the PIL image directly via the pure
`sample_geotiff_along_line` helper (now `is_nodata`-parameterised) —
no full `DemZGrid` materialisation for a line. `api/routers/dem.py`
selects the provider via `build_dem_provider`, so NL/AHN4 (EPSG:28992)
line profiles work for free and profiles ride the disk tile cache.
`DhmviiSampler`'s second HTTP stack was deleted;
`dhmvii_sampler.py` keeps only the pure helpers + `parse_wcs_multipart`.
The live benchmark (`DEM_LIVE_BENCH=1`) drives `DhmviiDemProvider`.

## 235. ~~Extraction backsliding — orphaned extracted utils~~ — RESOLVED 2026-07-13

**Resolution (quick-wins batch + B3 + B6).** isTypingTarget 4th copy deleted;
newTestFilter wired (inspector drop-in; toolbar export reshaped to pre-built
anchors); formatNadClass wired; assembleSectionPartitionInput wired into
PartitionFillOverlay (B6); useSyncExternalStore boilerplate → createBooleanStore
(5 stores); the 27-copy non-2xx error block → one shared `request` core (23→10,
9 justified bypasses documented in-code). The buildProjectFence alongM
divergence found under FE-UTILS-09 is NOT resolved — split to #240 (owner
decision).

**What (was).**

**What.** Audit 2026-07-12 found the "extract on second copy" rule applied and
then bypassed: a 4th byte-identical `isTypingTarget` accreted AFTER the
extraction that killed copies 1–3 (FE-UTILS-06); `newTestFilter.ts` exports are
test-only while the toolbar/inspector re-inline the same bodies — and the
toolbar variant must NOT be blindly substituted (the util lacks the
corridor/exclusion/elevation scoping; wire the inspector one, reshape or delete
the toolbar one, FE-UTILS-02 verifier note); `formatNadClass` and
`assembleSectionPartitionInput` same pattern (FE-UTILS-01/-08); 5 copies of the
useSyncExternalStore boolean-store boilerplate (FE-UTILS-04); 27 copies of the
non-2xx error block across API clients (FE-SHELL-CLIENTS-08).

**Why deferred.** Individually trivial; batched they're an afternoon.

**When to revisit.** Fold into #229's cleanup campaign, or per-file on touch.

## 236. ~~Decouple the live voxel path from the dormant strat_field package~~ — RESOLVED 2026-07-12

**Was.** The LIVE voxel builder imported the PRIVATE `_digest_surfaces` from
`assemble_strat_inputs` and `SurfaceBound` from `strat_field/strat_types`
(build_voxel_litho_model, load_geo_surfaces, label_voxels, geo_bands).

**Resolution (`788a789a3`).** `SurfaceBound` moved to
`domain/services/surface_bound.py`; `_digest_surfaces` promoted to the public
`digest_surfaces` in `load_geo_surfaces.py` (pure moves, behaviour
byte-identical; unit suite green). The router's dead `litho_snap_tolerance_m`
read died with the rebuild endpoint itself in #237.1 (`4523edb18`) rather
than as a separate step.

## 237. 2026-07-12 owner-decision batch — DECIDED 2026-07-12, ALL FIVE EXECUTED 2026-07-13

**Owner decisions (2026-07-12, all five):**
1. ~~strat_field → DELETE after #236~~ → **DONE 2026-07-12** (`788a789a3` +
   `4523edb18` + `acae1010d`): #236 extraction first (SurfaceBound →
   `surface_bound.py`, `_digest_surfaces` → public `digest_surfaces` in
   `load_geo_surfaces.py`), then deleted `strat_field/` (12 modules),
   `AssembleStratInputs`, `RecomputeLithoSolids`, the `POST
   .../litho-solids/rebuild` endpoint (+ dead `litho_snap_tolerance_m` read),
   strat unit/integration tests + benchmarks + `eval_strat_builder.py` /
   `profile_strat_build.py`, and the FE `rebuildLithoSolids` client fn
   (−17k lines). `strat_invariants.py` (load-bearing voxel gate) relocated to
   `tests/unit/domain/services/voxel_litho/`; `test_litho_solids.py` +
   `test_project_bundle_litho_solids.py` reseeded via direct ORM rows.
   Owner note recorded: fill-bands are the ground truth and the voxel builder
   itself may need revisiting later (post-pivot) — deletion of the implicit
   builder does not pre-empt that.
2. ~~C1/C2a/C2b skeleton flow~~ → **DONE 2026-07-13** (`59dad12a1` +
   `6e45ced0d`): the five live-path helpers (`_ensure_geotech_model`,
   `_load_geo_surfaces_with_formation`, `_make_boundary_sampler`,
   `_make_lowest_boundary_sampler`, `_geo_formation_at_midpoint` +
   `_GeoSurface`/`_evaluate`) moved verbatim from C1 into
   `GeotechBoreholeMaterialiser` first (GEOTECH-IMPORT-06), then the 3
   endpoints, 10 schema modules, 3 use cases, their integration tests and
   the eval script's C1 step were deleted (−5.5k lines). SAB endpoint tests
   now obtain the geotech model from subdivide-all-bodies itself; the Bug-2
   C1-interplay regression died with C1. `_read_min_thickness_m` copy count
   2 → 1 (#224 shrinks).
3. ~~Import cancel~~ → **DONE 2026-07-13** (`6b6464049` + `5e20d5770`):
   cancel-on-disconnect in `JobRegistry.stream()`'s finally-block, gated on
   task-not-done so closing right after the final "done" event never cancels
   a completed task (TDD: disconnect test RED first). The emptied /jobs
   router + the now-caller-less `JobRegistry.cancel()` deleted.
4. ~~GeotechnicalUnitOrm~~ → **DONE 2026-07-13** (`5bd5cfbb7` + `407716ef3` +
   `6a09d8f3b`): ORM + formation relationship + bundle build/restore
   round-trip (`_restore_geotech_units` + payload plumbing + schema fields +
   IDOR/bundle/cascade tests) dropped; migration `v6w7x8y9z0a1` drops the
   table (downgrade recreates the `f4b2c91e5a78` shape); FE `.strix`
   round-trip key removed end-to-end (backwards-compat SUSPENDED — no
   format bump). Debt #13 uses the model-kind path.
5. ~~rewriteB Stage-2~~ → **DONE 2026-07-12** (`7f34247b`): flag +
   REWRITE_B_LEGACY + SUBSTRATE_CONTINUITY + bridge pass +
   computeBracketSubstrate cluster + legacy-only tests deleted (−1,636 lines
   net; partitionFill.ts 6,926 → 5,625). Shared clip helpers kept. tsc clean,
   full vitest 2,129 green, legacy escape hatch gone by design.

Original context below; strike items here as they land.

**What (was).** Five verified findings need an owner call (full evidence in DEBT.md
§4, 2026-07-12 section):
1. **strat_field dormant package** (~290 KB + 4 integration-test files per
   pre-push + the scikit-image dep via dead `iso_surface.py`): keep dormant or
   delete; `eval_strat_builder.py` + `profile_strat_build.py` ride along.
2. **C1/C2a/C2b geotech skeleton flow** (3 endpoints, ~9 schemas, 3 use cases,
   3 FE fns, zero FE callers) — delete if body-centric is final.
3. **DELETE /jobs/{job_id}** — the only server-side import cancel; FE's SSE
   abort leaves cold-cache imports running to completion. Wire into
   `useDovImportStream` cancel or delete deliberately.
4. **GeotechnicalUnit ORM + migration** — endpoints/client deletable now (#229);
   confirm debt #13 uses the model-kind path before dropping the table.
5. **rewriteB Stage-2** — conflicting in-code comments (07-09 "Stage 2 deletes
   this" vs 07-10 "kept for A/B"); recommended: #230 first, then fold the
   flag+bridge+substrate deletion into the full-band pivot.

**Why deferred.** Each either reverses a recorded owner decision or deletes the
only instance of a capability.

**When to revisit.** Closed — all five executed (items 1/5 on 2026-07-12,
items 2/3/4 on 2026-07-13). Kept for the decision record.

## 238. ~~Four pre-existing RED integration tests~~ — RESOLVED 2026-07-13 (all four were stale tests, not bugs)

**Resolution.** Diagnosed same-session; the full integration suite is now
fully green:
1. DB1-2 → pinned the pre-`bec4e53ed` (07-07) skip-the-resolver contract;
   updated to assert the Phase-8.5 re-resolve stamps body_id (`7802a1d23`).
2. strat-rebuild red → died with the #237.1 strat_field deletion.
3. SA-5 → same 07-07 root cause: borehole bands are now first-class
   body-graph members, so the clay sample anchors to the borehole KLEI body;
   provenance-checked assertion mirrors SA-8 (`95cbaf7a6`).
4. bundle absences → NOT data loss: the restore IDOR guard (`101676ca8`,
   07-01) correctly drops dangling investigation anchors; the 05-24 fixture
   used random UUIDs (the attack case by accident). Fixture now anchors at
   the project's real CPT/borehole (`5c339e87e`).

**Lesson.** Behaviour-changing commits (07-01 guard, 07-07 re-resolve)
shipped without updating the integration tests that pinned the old
behaviour, and the suite ran nowhere for weeks — the visibility gap, not the
code, was the bug.

**What (was).** The 2026-07-12 delete campaign's verification run was the first
clean full integration pass in a long time (the pre-push gate only fires on
push; develop is ~280 commits unpushed). It surfaced 4 deterministic reds,
each verified to fail identically on pre-campaign code (`9c43655e`):
1. `test_divide_boreholes.py::test_db1_sab_then_divide_boreholes` — DB1-2:
   DivideBoreholes assigns `body_id` to a BH layer; the test pins that it
   must not. Either the invariant changed with the litho-confined
   materialiser or this is a real regression from that work.
2. ~~`test_litho_solids.py::test_rebuild_produces_solid_with_geometry`~~ —
   GONE 2026-07-12: deleted with the strat_field path in #237.1
   (`4523edb18`). Three reds remain (#1/#3/#4).
3. `test_sample_geotech_assignment.py` — SA-5: a clay sample gets a
   `geotech_body_id` where the conservative-fallback rule expects None (no
   CPT-backed KLEI body in the fixture).
4. `test_project_bundle.py::test_bundle_carries_formation_absences` —
   **restore loses formation absences (0 of 2 restored)** — data-loss-class
   for the .strix round-trip; highest priority of the four.

**Why deferred.** Filed at the end of the cleanup session; each needs its
own investigation (are the tests pinning stale invariants, or is the code
wrong?). #4 first.

**When to revisit.** #4 (bundle absences) before the next .strix save/open
dogfeed; #1/#3 at the next geotech backend touch; #2 never — dies with
#237.1.

## 239. ~~Two deterministic RED e2e specs, pre-existing~~ — RESOLVED 2026-07-13

**RESOLVED** (`4cda3ce53`): both were pure spec drift, no app change.
`flow_bottom_tie_correlate` asserted the base tie via
`line[stroke-dasharray]`, but interpretive ties render as `<polyline>`
(`tie-line-*` / `ribbon-seam-*`); the only dashed `<line>` is the transient
drag ghost outside the overlay group — selector switched to `polyline`.
`flow_geotech_subdivide_all_bodies` still sent the retired section-scoped
body; the endpoint requires `litho_model_id` (model-wide op) — body swapped,
dead section resolution removed. Full Playwright verification run:
**116 passed / 5 skipped / 0 failed** (4.7 min, offline slate) — including
both formerly-flaky specs (`flow_auto_tie` ×2, `flow_body_actions_ui`)
green that run. Original description in git history.

## 240. buildProjectFence ignores real alongM — 3D fence panels use uniform spacing (owner decision, S)

**What.** B6 (FE-UTILS-09) unified the Pass-1 assembly of `buildProjectFence`
and `buildVoxelRequest` and found they diverge on the `computeSectionFill`
alongM argument: the overlay render AND the voxel build pass real along-section
positions; the 3D FENCE build does not (uniform fallback). Memory
(`project_partition_one_gesture_2_1_0`) records that alongM-less output does
NOT match the app render. A `⚠ KNOWN DIVERGENCE` comment with the one-line fix
sits at the fence's computeSectionFill call.

**Why deferred.** Changing it visibly changes the rendered 3D fence panels —
a visual owner call, not a mechanical fix.

**When to revisit.** Next 3D-fence dogfeed: decide whether fence panels should
match the section render (likely yes), flip the one-liner, dogfeed.

## 241. Two investigations inside one voxel — RESOLVED 2026-07-27

**What.** `label_voxels` honors at most ONE investigation per `(i, j)` grid
column (`honored_by_cell`). Two investigations closer than the horizontal voxel
contend for one column, and the loser's own log is replaced by its neighbour's
AT THE LOSER'S OWN MAP POSITION — the model asserts investigation A's
stratigraphy where investigation B was actually drilled. The winner is currently
the lexicographically smallest `investigation_id`, which on time-ordered UUIDv7
means **whichever was imported first** — arbitrary, and grid-phase dependent (a
pair collides or not depending on where the grid origin lands, so the defect set
moved when the footprint fix landed).

Measured on the dev model at 2 m horizontal (2026-07-27), after the footprint
fix (commits `d3b6c1fd0`..`99c6e023f`) — seven pairs sit inside one voxel:

| pair | separation | logs | today's winner |
|---|---|---|---|
| BH GEO-10/117-B5 / CPT GEO-05/040-S5 | 0.28 m | identical | CPT |
| BH GEO-10/117-B1 / CPT GEO-05/040-S1 | 0.40 m | identical | CPT |
| BH GEO-10/117-B4 / CPT GEO-05/040-S4 | 0.49 m | **differ** | CPT |
| CPT GEO-23/125-S5 / CPT GEO-23/125-S5A | 1.13 m | **differ** | S5 |
| CPT GEO-23/125-S7 / CPT GEO-23/125-S7A | 1.17 m | differ | S7 (deeper) |
| BH GEO-10/171-B6 / BH 1411-GEO-23/126-B4 | 1.66 m | differ | B6 (deeper) |
| BH GEO-10/171-B9 / CPT GEO-10/170-S9 | 1.91 m | **differ** | CPT |

Grid refinement cannot resolve this: the closest pair is 0.28 m apart, so
separating every pair needs a sub-0.25 m horizontal voxel (~64x the voxels).

**THE RULE (owner decision, 2026-07-27).** At a shared voxel column the model
honors ONE investigation, chosen in this order:

1. **A CPT beats a borehole.**
2. **Same kind → the one that reached deeper** (lower base elevation).
3. **Still tied → the lower `investigation_id`** (reproducibility only; not
   reached on real data).

The three keys form a TOTAL order, so a cell holding three or more contenders
(the S5 / S5A / S5B cluster is three tests) resolves to the same winner whatever
order they are folded in — the selection stays a simple running comparison.
"Deeper" is the lowest base ELEVATION over the investigation's intervals, not
depth below its own collar: paired collars differ by centimetres, so the two
readings agree here, but elevation is the one that stays right when they do not.
Only `cpt` and `borehole` anchor a litho layer today; a future investigation kind
(DMT, pressuremeter) MUST be given an explicit place in the order rather than
falling through to the id tie-break.

*Why CPT over borehole* — measured on the four BH/CPT pairs, not assumed:

* The driller's descriptions are logged on a **0.5 m grid** (13–19 of every ~20
  `field_log_interval` boundaries land exactly on a 0.5 m multiple; commonest
  interval thickness 0.5 m), so a borehole contact depth is only known to the
  nearest half metre. The CPT registers depth continuously.
* The CPT resolves **3–4x more litho contacts** at every one of these stations
  (31 vs 8 at B4/S4; 25 vs 8, 20 vs 7, 13 vs 4).
* The collars agree to **2–6 cm**, so this is not a levelling/datum problem and
  there is no whole-log shift available as a correction.
* A "borehole's materials + CPT's depths" merge was considered and rejected: it
  needs both logs to describe the same layers. Where the sequences match (B5/S5,
  B1/S1) the materials are already identical, so the merge collapses to "use the
  CPT"; where it would matter (B4/S4, B9/S9) the sequences differ, so there is no
  correspondence to merge along.

The owner's earlier instinct ("borehole should always win") was reversed on this
evidence; the borehole stays the better source for WHAT the soil is, but its
contact GEOMETRY is the least reliable in the pair.

**Effect on the dev model:** exactly ONE outcome changes — `GEO-23/125-S5A`
takes the column from `S5` (both CPTs, S5A reached 5 cm deeper). The other six
pairs already resolve the way the rule says. The value is not the flip; it is
that the choice stops depending on import order (import boreholes first in the
next project and the borehole silently wins every pair today).

**Implementation (not yet done).** The domain cannot currently tell a CPT from a
borehole — neither `InvestigationColumn` nor `BodyLayerPick` carries the kind:

* `BodyLayerPick` gains `kind` (`"cpt"` / `"borehole"`); `load_body_picks`
  already branches on `borehole_id is not None` to resolve the anchor, so it is
  one line inside an existing branch.
* `InvestigationColumn` gains `kind`, set in `_investigation_columns_from_picks`.
* `label_voxels` replaces `inv.investigation_id < existing.investigation_id`
  with the precedence key. "Deepest" comes from `intervals` — no new data.
* `_partition_checksum` folds `kind` in, so a re-typed anchor rebuilds.

Labelling, meshing, the footprint and the 2-D partition are untouched. TDD, with
each case proven RED first; then the real-data A/B (`covered 58/58, exact 49`
must hold with the S5/S5A flip as the only difference) and the watertight +
zero-overlap gates.

**Deliberately NOT changed: the acceptance gate's headline numbers.**
`eval_strat_fidelity` scores the model against all 58 logs, so a paired station
is unscoreable by construction — one column, two logs, the loser always counts
"wrong". It cannot exceed 56/58 while those pairs exist. Adjusting the gate for
that would be indistinguishable from moving the goalposts, so the paired
stations get a listed note and the headline count stays as-is.

**RESOLVED.** The rule ships as
`domain/services/voxel_litho/honor_precedence.py` (`honor_rank`), applied by
`label_voxels`' `honored_by_cell` selection; the kind tokens live in
`domain/services/investigation_kind_constants.py` and reach the domain via
`BodyLayerPick.kind` → `InvestigationColumn.kind`. Commits `3ea43f734`..`b021e2982`.

Verified on the dev model (2 m / 0.25 m, widened footprint):

* **Exactly one outcome moved**, the predicted one — `GEO-23/125-S5A` took the
  column from `S5` (both cones; S5A reached 0.05 m deeper). The two BH-loses-to-CPT
  lines were already resolving the way the rule says and are unchanged.
* Gate held at **covered 58/58, exact 49**; the `wrong` count stayed 9 BY DESIGN
  (a paired station is unscoreable — one column, two logs, the loser always
  counts wrong, so the gate cannot exceed 56/58 while those pairs exist).
* Contact-depth error IMPROVED even though the verdicts did not: p90
  **0.463 → 0.420 m**, worst **20.705 → 15.695 m** — the deeper, finer log now
  describes the contested column.
* Watertight + zero-overlap integration gates unchanged (6 passed); 1472 unit
  tests green.

An added value beyond the flip: on this project the CPTs happened to be imported
before the boreholes, so the old id-order rule coincidentally agreed with the new
one at three of the four pairs. Import boreholes first in the next project and
the old rule would silently have handed every one of those columns to the coarser
log.

**Related threads, deliberately out of scope here.**

* *False precision on borehole contacts* — accepted borehole litho contacts sit
  at 0.481 / 1.532 / 3.747 where the driller's log says 0.5 / 1.5 / 3.8. Most
  kept contacts are like this. Something downstream of a 0.5 m log is placing
  contacts to the millimetre. Not the 3-D builder; needs its own look.
* *Stacking the pair* — honor the borehole to its own TD, then let the deeper CPT
  carry on below it. The most truthful option, and the one that uses all the
  measured data at a station; deferred because it changes what a honored column
  IS (a column fed by two tests) and needs a seam rule of its own.

**When to revisit.** Implementation next; reproduce the contention list with
`uv run python scripts/diag_voxel_newly_covered.py` and the A/B with
`scripts/diag_voxel_fidelity_delta.py`.

## 242. The 3-D model floor is shallower than the deepest investigations — RESOLVED 2026-08-31 (S)

**What.** `label_voxels` frames the grid's vertical range from the 2-D section
partition polygons alone (`zmin` = the lowest region-polygon elevation). On the
dev model that floor is **-13.190 mTAW**, but three investigations drill below
it:

| investigation | drilled base | below the model floor by |
|---|---|---|
| CPT GEO-05/040-S2 (`7c2e`) | -16.470 | **3.28 m** |
| CPT GEO-05/040-S3 (`7c2f`) | -16.400 | **3.21 m** |
| CPT GEO-10/170-S11 (`7c36`) | -13.370 | 0.18 m |

So the deepest ~3.3 m of two CPTs is not represented in the 3-D model at all.
Found 2026-07-27 while tracing the largest remaining contact error: `7c2e`
reports a 3.155 m error whose whole cause is that the model's basal KLEI stops
at -13.315 where the CPT logged it to -16.470.

This is the VERTICAL twin of the footprint bug fixed the same day (commits
`d3b6c1fd0`..`99c6e023f`): there, the footprint was framed from the section
columns' projected feet while the builder honored investigations at their true
positions; here, the grid is framed from the partition's depth while the builder
honors logs that reach deeper.

**Measured 2026-08-01 against the reach ruling (#256) — it did NOT move, and the
prediction that it would was wrong.** Floor shortfall per investigation, identical in
both arms of `scripts/diag_reach_ab.py`: 9 of 58 investigations, median **-0.27 → -0.49 m**
(negative = the model reaches BELOW the log), p90 +0.08 m, worst **+0.11 m**.

Two things that measurement does and does not say:

* It compares the model floor against the deepest **accepted litho layer**, not the
  **drilled base** this entry is about. Where the picks stop short of total depth — which
  is exactly the `7c2e` / `7c2f` case above — it cannot see the gap at all. So it does not
  refute the entry; it measures a different floor.
* It does confirm the ruling is not the fix. The shortfall is bit-identical before and
  after, which stands to reason: #256 changes thickness WITHIN the grid, while this entry
  is about where the grid's vertical range is framed. Conflating the two was the error in
  the prediction.

What the ruling did do vertically: 61,530 m3 of previously void cells became labelled, all
of it inside the existing grid, and **0 m3 of it was a hole inside the old model** — every
newly filled cell lay outside the top-to-bottom span of its own column. The watertight
invariant was never in question; the model simply occupies more of its own grid.

**RESOLVED 2026-08-31.** Owner ruling: *"down to the deepest investigation"* —
the grid's vertical extent now reads the honored investigation intervals as
well as the section regions (``label_voxels``). The modelling question below
answered itself through the gapless rulings: only the honored columns label the
new depth (their own measured ground), every other column keeps its stack, and
the under-floor space beside a deep column is plain sub-floor void — invisible
to the interior-void clause, which reads stacks, never the grid frame. The
``logs_below_grid_floor`` tripwire (this entry's detector) stays as a backstop
and its test now pins the cure. Note the original 7c2e/7c2f numbers above were
about honored-log truncation, not drilled-base-beyond-picks: an investigation's
DRILLED depth below its deepest accepted pick is still not in the payload and
still not modelled — that is unmeasured-by-interpretation ground, not measured
ground, and stays out by design.

**The original deferral reasoning (kept for the record) — it is NOT a one-line fix.** Extending the grid below the 2-D
partition creates voxels with no partition data to label from. Only the honored
log could fill them, so each deep investigation would grow an isolated column
hanging below the model floor with nothing beside it — almost certainly worse
than the current clean truncation. The real question is whether the 2-D
partition should reach the deepest pick in the first place (a `computeSectionFill`
question, frontend) or whether the voxel builder should extrapolate the deepest
band downward to the deepest log. That is a modelling decision, not a mechanical
one.

**When to revisit.** With the owner, when the deep part of the model matters —
e.g. before an export that has to represent full investigation depth, or if a
project appears whose deepest tests sit well below its section partitions.
Reproduce by comparing the partition elevation range against the deepest
`load_body_picks` base; the numbers above came from a six-line check.

## 243. The enclosed-lens body merge has no caller — WIRING REVERTED 2026-07-28 (M)

**Status 2026-07-28 — the Build-time wiring is REVERTED, and the approach is
rejected.** It ran once on the dev model and created **62 correlation edges**.
**14 of them joined two units with no vertical overlap at all** (gaps up to
5.18 m), i.e. correlation lines that jump across the lithologies in between —
visible on the section and, worse, each one merges two bodies that should have
stayed apart. Ten of the fourteen were KLEI, which is exactly the "climbing and
dropping clay" the owner reported. All 19 such ties in the planner's output come
from ONE branch: when no neighbour host FULLY SPANS the lens band, it falls back
to any host that merely *overlaps* it — contradicting the planner's own
documented rule ("the host lithology runs **continuously across** the lens
depth"). Removing that fallback drops the planned set 108 → 76 and the
non-overlapping ties 19 → 0.

**Owner directive (2026-07-28), which supersedes the 2026-07-27 one:** *"there
should be no auto ties that are generated, you just keep the ties and merge the
bodies on lithological adjacency, like the renderer does"* — so that "something
rendered as one body is one body in the data". Unifying bodies by fabricating
`manual`/`user_approved` correlation edges is rejected outright: those are the
owner's own interpretive artifacts and must not be invented, whatever the tie
quality. See #244 for what replaced it.

**Reverted cleanly.** `scripts/audit_merge_edges.py` (+ the captured
`merge_edges_2026_07_28.json`) resolves every edge that Build created, reports
its vertical overlap, and with `--apply-revert` deletes them and re-resolves.
Applied to the dev DB: manual edges 248 → 186, S4's lower sand split from
GEO-10/117-B4 again, 87 distinct bodies. A full `pg_dump` was taken first
(`.backups/`). One wrinkle worth knowing: the first delete matched on the layer
pair without scoping to the section and removed 5 pre-existing rows the owner had
drawn on OTHER sections; those were restored verbatim from the backup and the
model re-resolved. The 3-D solids are gone (the project restore dropped them) —
they come back on the next Build.

**The use case + endpoint are untouched and once again have no caller.** They
stay in the tree; if the enclosed-lens case ever needs an explicit verb it should
be user-invoked, and the loose-fallback branch should be removed first.

**What (original).** `MergeEnclosedLensBodies` + `plan_enclosed_lens_merges` are finished,
unit-tested and reachable at `POST .../bodies/merge-enclosed-lenses`. **Nothing
invokes the endpoint** — not the desktop app, not the integration suite, not e2e.
Verified 2026-07-27: the string `merge-enclosed-lenses` occurs only in the router
and its response schema; `enclosed` occurs nowhere in `desktop/src` outside
comments. Consequently the merge has never run on any model, and every
enclosed-lens host on the dev model is still two bodies.

The use case's docstring claimed it was "the top of the Fill-bands request".
There is no such request: **Fill bands is a client-side view toggle**
(`bandFillStore.toggleBandFill`) that flips whether `PartitionFillOverlay`
renders and makes no network call. Corrected in the docstring 2026-07-27 — that
wording is what made two separate investigations assume the merge had run.

**Why it matters (owner-visible).** Body identity is the CONNECTED COMPONENTS of
the user-approved correlation-edge graph unioned with the persisted
`body_geometry_fact` rows (`ResolveLithoInstances`; facts added 2026-08-12 —
see body-model.md); body SHAPE is the partition fill. They are separate pipelines, so a sand that Fill bands draws
as one continuous body around a carved-out lens can carry two `body_id`s. On the
dev model, CPT GEO-05/040-S4's sand is `417604` above the silt lens and `6ceedf`
below it, while the neighbouring BH GEO-10/117-B4 (0.49 m away) logs one
continuous sand. The planner handles this correctly — run against those two real
stacks it returns BOTH host halves tied to B4's continuous sand — it is simply
never asked. Only the upper tie exists in the DB, hand-drawn by the owner.

**Owner decision (2026-07-27): fire it on BUILD, with a report.**

**The ordering is not negotiable.** The merge re-stamps `body_id` in the DB,
while the voxel build takes body identity from the FRONTEND payload
(`build_voxel_litho_model`: "the frontend is the single source of body identity
here"). A caller MUST:

1. merge (per section — the use case is section-scoped),
2. RELOAD the litho layers into the frontend,
3. recompute the partition (regions carry `body_id`),
4. POST the build.

Calling the merge from inside the build endpoint instead would leave the
payload's split ids disagreeing with the re-stamped picks, and the mesher would
emit a merged island inside two unmerged hosts — strictly worse than not merging.

**Why deferred.** The wiring crosses `useLithoSolids` → `useGeologicalModel` and
must WAIT for the refetch rather than predict the post-merge state
(`memory/feedback_defer_until_loaded_not_predict`). It lands in the frontend,
where vitest + tsc do not catch this class of bug, so it needs an owner dogfeed.

**When to revisit.** Next session — it is the first task of the overnight blend
handoff. Reproduce with the S4/B4 pair: run `plan_enclosed_lens_merges` on their
stacks and confirm 2 edges, then check `litho_contact_correlation_edge` for the
lower-host tie (absent today).

## 244. The 3-D blend pinches same-lithology bodies apart — ROOT CAUSE FOUND + FIXED 2026-07-28 (L)

**Root cause (measured, not inferred).** `label_voxels._blend_stacks` matches the
two nearest sections' stacks by `body_id`; an unmatched body is treated as a
one-sided lens and scaled by `max(0, 2w - 1)` — near ZERO at roughly equal
distance. The ids did not match because
**`partitionFillV2/mergeTouchingBodies` is stage 1 only — per-section** — and
picks its component representative per section. Its own docstring records the
gap: *"Stages 2-3 (cross-section, 3D) stay the backend's job — recorded, not
here."* That stage was never built.

Measured on the dev model's build payload: **23 cases** where ONE column carries
the SAME lithology over OVERLAPPING elevations under two different body ids on
two different sections — including all three units at `GEO-23/125-S9`:

| column | litho | elevation | id on one section | id on another |
|---|---|---|---|---|
| GEO-23/125-S9 | KLEI | 4.84..3.80 | `019ea170-5ce6` | `019ea3e1-9b50` |
| GEO-23/125-S9 | SILT | 11.73..4.84 | `019ea170-5cf3` | `019ea170-5cec` |
| GEO-23/125-S13 | ZAND | 3.68..-1.79 | `019ea42e-1b84` | `019ea3e1-9be2` |

So at a point between two sections both showing the same sand, BOTH copies pinch
to nothing, the void is back-filled, and whatever IS matched keeps full thickness
and slides into the vacated space. That is the invented lithology AND the
climbing/dropping lens — one mechanism, not two.

**Fixed — `desktop/.../utils/mergeBodiesAcrossSections.ts` (stage 2).** Two
regions are the same body when they meet at a SHARED COLUMN with the SAME
formation over OVERLAPPING elevation — the renderer's own "across a gap boundary"
rule, generalised from gaps to sections. It runs in `buildVoxelRequest` just
before the payload is emitted. It **relabels `body_id` and nothing else**: no
correlation edge is created, nothing is written to the database, no vertex,
formation or gap index moves, so it cannot introduce a hole or an overlap.
Strict overlap (> 1 mm), not mere contact, so two same-formation units *stacked*
at a column are never welded. `null` bodies are left alone.

Real-data result on the dev payload: divergent cases **23 → 0**, distinct region
body ids 65 → 61, and the invented silt disappears at every sampled position
along the `GEO-23/125-S9 → -S8` leg:

```
frac 0.5  BEFORE: ZAND 3.13/2.80 · SILT 2.80/0.18 · ZAND 0.16/-4.59
frac 0.5  AFTER : ZAND 3.13/-4.58
```

**Remaining.** Owner dogfeed of the 3-D model after a Build. The two follow-ups
CLOSED 2026-08-12 (owner ruling "every same litho that is connected should get
the same body id"): (a) the stored identity is now persisted — `RecomputeBodies`
writes `body_geometry_fact` rows and the resolver stamps the merged `body_id`
into the DB (stage 3 of this entry's staged model; see
docs/design/body-model.md); (b) follows from (a) — `buildProjectFence` reads
region body ids off the DB layers, which now carry the merged identity, so
fence panels converge without running the pass themselves. One deliberate
asymmetry remains, recorded in body-model.md: the build's alias pass still
unions through fallback-painted regions for blending; the persisted identity
never does (owner: "there should be no fallbacks in a properly built model").

## 245. Litho 3-D build is too slow (M — owner-raised 2026-07-28, partially addressed)

**What.** A full "Build model" takes ~62 s of pure compute on the dev model
(58 investigations, 16 sections) at 2.0 m horizontal / 0.25 m vertical, plus DB
load and persist. The owner's words: *"litho model build is too slow for my
taste (we need to do it faster but without losing accuracy, let's first get it
100 % right)"* — so correctness work takes precedence; this is the queue behind
it.

**Measured** (`docs/benchmarks-journal.md`, 2026-07-28):

| horizontal | vertical | label | extract | total |
|---|---|---|---|---|
| 2.0 m | 0.25 m | 32.6 s | 29.7 s | 62.3 s |
| 2.0 m | 0.5 m | 33.8 s | 17.6 s | 51.3 s |
| 3.0 m | 0.5 m | 15.2 s | 9.5 s | 24.7 s |

**The load-bearing fact: `label_voxels` scales with the number of map-plane
COLUMNS, not with voxel count.** Halving the vertical spacing left labelling
untouched and only halved extraction; widening horizontal 2 → 3 m halved both.
Fine Z is therefore nearly free on the labelling side — the opposite of the
intuition that it is the expensive axis.

Profiled hotspots, in payoff order:

1. `extract_body_solids._split_pinched_edges_by_midpoint` — **12.9 s tottime in
   112 calls**, the single largest item in the whole build and never optimised.
2. `label_voxels._project_to_section_fence` — 7.5 s cumulative over 528 k calls:
   every in-footprint column projects onto EVERY section. An exact bounding-box
   lower bound would let a column skip sections that cannot be in its nearest
   two — no approximation, just early rejection.
3. Numba on the labelling loop (the long-standing candidate; `greedy_mesh` is
   already JIT'd and no longer dominant).

Free win already banked: the cross-section body merge (#244) cut triangles
997,986 → 814,098 (-18 %) because merged bodies no longer carry internal
boundary surfaces between their halves.

**Progress 2026-07-29 — 62.3 s -> 53.8 s at 2.0 m / 0.25 m, output byte-identical
throughout** (mesh SHA-256 `1f80171f...` before and after every change):

| change | effect |
|---|---|
| cross-section body merge (#244) | tris 997,986 -> 776,686; most of the extract gain |
| int-tuple edge keys in `_split_pinched_edges_by_midpoint` | extract 26.0 -> 24.4 s (~6 %) |
| exact bbox prune in `_project_to_section_fence` | label 32.6 -> 31.9 s (~2 %) |

Both code changes are exact — same meshes, verified by checksum — but both came in
FAR below what cProfile implied. The lesson worth keeping: cProfile inflates
C-call-heavy inner loops badly, so a profile-derived ranking needs a wall-clock A/B
before anyone invests in it.

**Where the time actually is, measured.** `_split_pinched_edges_by_midpoint`
resolves **11,768 pinches across 101 bodies** (~116 per body), and each pass
rebuilds the whole edge->triangle map over every triangle of the body. The cost is
that repeated full rebuild, not the key type. Making it incremental (maintain the
map across passes, touching only the triangles a split changed) is the real win
left in extraction, and it is a correctness-sensitive rewrite of a
watertightness-critical routine — not a quick change.

Labelling is now the larger half (31.9 s of 53.8 s) and is dominated by the
per-column, per-section work rather than any single hotspot. Numba on the labelling
loop remains the candidate.

**Why the rest is deferred.** Correctness first, by owner directive. Optimising the
labeller while its output is still being corrected risks locking in current
behaviour.

**When to revisit.** Once the observed-column fidelity gate is green — then take
(1) and (2), which are contained and do not change output.

## 246. Opening a cross-section on the litho axis is slow (S — owner-raised 2026-07-28)

**What.** Owner: *"clicking open a CS on litho view is kinda slow."* Not yet
measured — no profile exists for this path.

**Where to look first.** Opening a section on the litho axis triggers, in the
same tick: the per-section approved-edge fetch, `computeSectionFillActive` (the
v2 partition engine) for that section, the model-fill slice
(`sectionFromSolids` slices every persisted body solid leg by leg — 101 solids ×
~24 legs on CS1), and `resolveModelFillPolys`. The slice/resolve pair is the
prime suspect: it is O(bodies × legs) and now also runs a polygonize per body
per leg (#244 / the buffer(0) fix). None of it is memoised across opens.

**Why deferred.** Same reason as #245 — correctness first. Also worth measuring
before optimising: the cost may be dominated by one of the four stages, and
guessing which has already been wrong once on this subsystem.

**When to revisit.** With #245. Instrument first (`performance.mark` around the
four stages), then optimise what the numbers name.

## 247. The 3-D blend ranked sections in PROJECTED-FOOT space — FIXED 2026-07-29 (L)

**What.** `label_voxels._project_to_section_fence` ranks sections by perpendicular
distance to a polyline through each section's column `world_x/world_y`, and its
docstring states those are "the columns' **true** (world_x, world_y) positions
(the canonical fence)". They are not. The frontend's
`computeCanonicalColumnWorldPositions` sets each column to *"the **projected**
position on the DENSEST section that contains it"* — deliberately, so a test drawn
on two sections lands in one consistent place.

Measured over the 83 payload columns of the dev model: payload position vs true DB
location differs by a **median of 11.08 m, max 64.91 m**, and **77 of 83 are off by
more than 1 m**.

Meanwhile the voxel grid, the honored investigation columns
(`InvestigationColumn.world_x/y`, straight from the picks) and — since the July
footprint fix — the domain footprint all live in TRUE world space. So the labeller
decides *which sections are nearest this voxel* in one coordinate space and places
the material in another, ~11 m apart.

**This is the exact twin of the footprint bug fixed in commits `d3b6c1fd0`..
`99c6e023f`** (the footprint was framed from projected feet while the builder
honored logs at true positions). The footprint consumer was fixed; the blend
consumer was not.

**Worked example — the owner's S12 report** ("the bottom of the silt is labelled
clay, way thicker than one voxel"). At S12's own column the model matches the log
exactly. **2 m away — one horizontal voxel — 1.75 m of the silt base becomes clay.**
At that point:

| section | distance the blend uses | weight |
|---|---|---|
| a 2-column tie, `GEO-23/125-S22 -> S12` | **2.52 m** | **0.829** |
| Cross-section 1 (whose own leg the point sits on) | 12.25 m | 0.171 |

CS1's own partition on that leg carries `SILT 11.95..5.21` across the whole gap —
no clay at all. The tie carries `KLEI 8.166/6.326`. The tie wins 5:1 on CS1's own
leg because CS1's fence is made of feet displaced from where S12 actually is.

**FIXED (owner ruling 2026-07-29: "rank by true positions").**
`domain/services/voxel_litho/true_column_positions.py` re-seats every section
column onto its investigation's true map location before labelling, so the
section ranking AND the gap-local fraction are both measured where the ground
actually is. It re-measures rather than re-draws: `along_m`, the section line
endpoints and every region polygon are untouched, so the validated 2-D partition
is unchanged. A column whose investigation has no honored entry keeps the
coordinate it arrived with. Commits `677113b96`, `5c1dc2fb9`, `4cf1f3525`.

The footprint deliberately still uses the columns AS DRAWN plus the true
positions, so the hull is the union of both and can only be larger — shrinking it
would re-open the uncovered-column bug the July footprint fix closed.

**Real-data result** (83 columns re-seated, max shift 64.9 m). Two metres from
`GEO-23/125-S12` — one horizontal voxel:

```
before: SILT 11.94->8.19 | KLEI 8.19->6.44 | ZAND 6.44->5.94 | KLEI 5.94->3.44
after : SILT 11.94->6.44 | ZAND 6.44->5.69 | KLEI 5.69->3.44
log   : SILT 11.84->6.44 | ZAND 6.44->5.73 | KLEI 5.73->3.55
```

The invented clay is gone and the stack one voxel from the column now reproduces
the log.

**The column gate moved from exact 49 / wrong 9 to exact 48 / wrong 10, and that
is recorded rather than explained away.** The single flip is
`1411-GEO-23/126-B3`: its drilled interval is still reproduced EXACTLY (the first
8 units are identical), with two extra units appended BELOW its total depth — the
by-design deep-band fill that already accounted for 7 of the original 9. So the
tally is now 8 below-TD fill + 2 paired-station voxel collisions, and nothing
regressed inside drilled ground. The gate cannot currently tell those apart; that
is a gate weakness (see the fidelity-gate work in Codex's workstream B), not a
model regression.

**Still open at S12:** the model surface one voxel from the column rises to 13.44
where S12's own logged top is 11.94 — a ~1.5 m step in the ground surface beside
the column, unchanged by this fix. Separate from #247.

**Original analysis, kept for the record.**

**Why deferred — it is an architectural call, not a mechanical fix.** Two
defensible answers and the owner has to pick:
1. Rank sections by distance to the columns' TRUE positions (consistent with the
   grid, the footprint and the honored columns), accepting that the 2-D partition
   geometry was drawn between projected feet.
2. Keep foot-space ranking but place the material in foot-space too — which would
   contradict the footprint fix and the honor rule.

Whichever wins, the two spaces must stop being mixed.

**When to revisit.** Next, before any further voxel-fidelity work — every blend
weight in the model is currently computed in the wrong space, so tuning anything
downstream of it is building on sand. Reproduce with
`scripts/diag_blend_mechanism_at_point.py --between GEO-23/125-S12 GEO-23/125-S13
--fraction 0.0204`.

## 248. `_blend_stacks` pairs re-entrant body occurrences by array RANK (M)

**What.** When a body appears more than once in a section's stack (a clay that
occurs twice in the column), `label_voxels._blend_stacks` pairs the two sections'
occurrences by **elevation rank** — `left[k]` with `right[k]` — and blends their
thicknesses. Rank is an artifact of sort order, not geology, so a shallow
occurrence can be paired with a deep one and their thicknesses averaged into a
position neither section has.

Seen at the S12 point above (band 2), after the #244 alias map made the ids match:

* the tie has TWO `019ea170-5ce6` (KLEI) entries: `8.166/6.326` and `5.844/3.622`
* CS1 has ONE: `5.719/3.552`
* rank 0 pairs the tie's **upper** clay with CS1's **only** clay — 2.4 m apart —
  and blends them, putting ~1.9 m of clay at ~8 m where CS1 has silt
* rank 1 leaves the tie's lower clay unpaired, so it pinches

**Note the interaction with #244:** unifying body ids across sections is correct
and necessary, but it creates MORE re-entrant pairs, so it makes this latent flaw
bite more often. Both need fixing; neither is a reason to undo the other.

**Why deferred.** The replacement rule is a geological decision the owner owns:
pair by elevation overlap? by midpoint proximity? require overlap and otherwise
treat the occurrence as a lens that pinches? Each gives different geology.

**When to revisit.** With #247 — they show up at the same points and the fix for
one changes the evidence for the other.

## 249. Honor paints one voxel column — WIDENED to a radius 2026-07-29 (S)

**What.** Owner: *"shouldn't we paint the whole width of a column with one voxel?
what if a test falls right on the bound of 2 voxels"*.

`label_voxels` honors an investigation at its NEAREST grid column — a single
`(i, j)` cell, chosen by `argmin |gx - world_x|`. Two consequences:

* a test sitting near a cell boundary can be honored up to half a voxel
  (1 m at 2 m spacing) from where it actually is, and which side it lands on
  depends on the grid phase, which moves when the footprint changes;
* the column the engineer sees drawn on a section is wider than one voxel, so the
  cells either side of the honored one carry blended material — the log is
  faithful only in the middle of the drawn column.

**Why it matters.** It is the residual of the same family as #247: the model is
right AT the investigation and drifts immediately beside it. Widening the honored
footprint to the drawn column width would make the log authoritative across the
whole visible column, at the cost of overriding the blend in a wider corridor —
which is a modelling decision, not a mechanical one.

**Done (owner ruling: "widen honor to the drawn column width").** The drawn width
is screen-space (`BARE_COLUMN_WIDTH_PX = 14`, scaled by zoom), so there is no
metre value to copy; `label_voxels` now honors every grid cell whose centre lies
within `honor_radius_m`, read from
`view_state.litho_segmenter.voxel_honor_radius_m` and defaulting to ONE horizontal
voxel. The nearest cell is always included, so a small radius can never leave a
log unhonored. A radius of one spacing reaches the four orthogonal neighbours but
not the diagonals — a plus, not a 3x3 block.

Measured on the real model. The per-column gate is the wrong instrument here (it
samples AT the investigation, which was already honored); the metric that matches
the intent is whether the model beside a column still reproduces that column's log:

| radius | at-column gate | 1 m beside a column reproduces its log |
|---|---|---|
| 0 m (before) | 55 / 1 / 2 | 201/232 (86 %) |
| **2 m = one voxel** | 55 / 1 / 2 | **216/232 (93 %)** |
| 4 m = two voxels | 47 / 2 / 9 ✗ | — |

Two voxels is actively harmful: corridors from neighbouring investigations start
overriding each other and the blend. One voxel is the default; the setting is
there for tuning.

**It does NOT fix the paired stations.** Two tests 0.49 m apart still map into the
same cell, so widening cannot separate them — `honor_rank` still picks one. That
remains the only drilled-ground gate failure and needs finer spacing or a stacked
paired-station column.

## 250. The fidelity gate now decides on drilled ground — and names 3 paired-station failures (S)

**Done 2026-07-29.** `scripts/eval_strat_fidelity.py` gained a second sequence
block restricted to `[base, top]` of each investigation's own log, plus a
`--gate` flag that exits non-zero on a disagreement there. The headline block is
untouched — it is the long-standing baseline and it stays.

Why it was needed: the headline scores the deep-band fill BELOW total depth as a
mismatch. That is correct geology, so a real defect and a by-design continuation
were indistinguishable, and the number twice made a change look like a regression
it was not.

On the dev model the two views differ sharply:

| | headline | within drilled ground |
|---|---|---|
| exact | 48 | **55** |
| subsequence | 0 | 1 |
| wrong | 10 | **2** |

**All three drilled-ground failures are paired stations sharing one voxel
column** — `GEO-23/125-S5` + `S5A` (1.13 m apart) and `GEO-10/117-B4` (0.49 m
from `GEO-05/040-S4`). So on this model there is currently NO investigation whose
own log the builder contradicts for any reason other than two tests competing for
one grid cell (#249).

**A trap worth remembering.** The first version applied the below-TD margin to
every interval, including ones lying fully inside the drilled range, which
discarded thin-but-real units and reported *worse* fidelity than the headline —
impossible, since clipping only removes material below total depth. The
impossible direction is what exposed it. The margin now applies only to intervals
that also extend outside the range.

**When to revisit.** Wire `--gate` into the pre-push hook once the paired-station
question (#249) is settled, so it can be green.

## 251. The 3-D model reproduces Fill bands at 97.8 % — 2 % genuine divergence left (M)

**Owner, 2026-07-29:** *"the voxel should almost be the same as the zones in the
fill bands tool no? Can't you check that (only a bit more blocky)"*. It should —
the 2-D partition is the source the labeller works from — and
`scripts/diag_partition_vs_voxel.py` now measures it.

It samples every gap of every section in (fraction, elevation), asks the 2-D
partition and the 3-D model what is there, and buckets each point. Current state:

| bucket | points | share |
|---|---|---|
| agree | 26,709 | 95.6 % |
| blocky (within half a voxel of a 2-D contact) | 608 | 2.2 % |
| **disagree** | **545** | **2.0 %** |
| model void where the partition fills | 66 | 0.2 % |

**97.8 % reproduced.** The residual 2.0 % is concentrated on Cross-section 1
(3.9 %, 331 of 8,592 samples); the two-column tie sections #7 and #3 are worse in
share (4.9 %, 4.3 %) but tiny in absolute terms.

**Why this instrument matters more than the per-column gate.** The gate scores 58
investigation columns and says nothing about the area between them — which is
where every defect this campaign chased actually lived (the invented silt, the
climbing clay, the S12 clay wedge). This one covers the whole section area and
localises the remainder.

**When to revisit.** Next correctness pass: pull the 545 disagreeing samples,
cluster them, and see whether they share a cause. Do NOT chase the percentage —
find the mechanism, as with #244 and #247.

## 252. Build provenance — a 3-D build is reproducible from the database, VERIFIED (M)

**Done 2026-07-29**, owner-approved. A `litho_body_solid` row said WHAT was
built; nothing said HOW or from what. The payload lived only in the frontend, the
settings only in the project view-state at the instant the build ran, and the
derived body identity only in memory.

That cost real time twice in this campaign. Every real-data check ran against a
section payload captured by hand into a throwaway file, and when the owner's live
build used 14 sections while the capture had 16, every number computed from the
file was quietly about a different model. Separately, a successful build's meshes
carried an earlier build's timestamp because nothing recorded when a generation
happened.

**`litho_build_generation`** — one row per build, carrying:

* the exact section payload POSTed, plus its checksum;
* every setting that changes the output — horizontal / vertical spacing, honor
  radius, snap tolerance;
* the grid geometry INCLUDING THE ORIGIN (grid phase decides which cell an
  investigation lands in, and the phase moves when the footprint changes — two
  builds with the same spacing and different origins are not the same build);
* the parent geo-surface digest;
* `body_aliases`: the cross-section merge's `source body -> derived component`
  map, so "which user-authored bodies make up this mesh?" is answerable;
* outcome counts and duration.

`litho_body_solid.generation_id` (nullable, `ON DELETE SET NULL`) names the build
behind every mesh. History is pruned to the last 10 per model — each row holds
the full payload.

**The alias map is DERIVED build data with provenance and must never be read back
as a user correlation.** It records a geometric merge, not user intent; the
owner's ties remain exactly the owner's ties.
*(Scope narrowed 2026-08-12: the GENERATION row's stored alias map stays
provenance-only, and no correlation edge is ever minted from geometry — but the
geometric merge itself now persists as first-class `body_geometry_fact` rows via
`POST .../bodies/recompute`, owner ruling: "every same litho that is connected
should get the same body id". Facts are resolver input, never correlations, and
never touch the fill. See docs/design/body-model.md.)*

**VERIFIED on the real model 2026-07-29.** Rebuilding generation
`019fae07-b05d-7143` from the database alone returns grid 311x326x107, 81 bodies
and 790,910 triangles — identical to what that build recorded — with mesh
SHA-256 `2c3bda49b6e9…`. All 81 solid rows carry its `generation_id`.

**The check found two of its own bugs before it found anything else**, which is
the argument for having built it:

1. `generation_id` was absent from the upsert's `ON CONFLICT DO UPDATE` set, so
   the first build after shipping provenance wrote 81 meshes pointing at no
   generation. Same failure mode as the `updated_at` bug days earlier, so the
   update set is now DERIVED from the row's own keys rather than hand-listed
   (`_upsert_update_columns`), and six tests pin it.
2. The payload was stored AFTER the true-position re-seat, so a reproduction came
   back 311x**305**x107 and 731,242 triangles — the footprint hull unions the
   columns as-drawn with the true positions, and the projected feet had been
   thrown away. The payload is now stored AS RECEIVED; the alias map and the
   re-seat are re-derived from it.

`scripts/diag_build_generations.py --reproduce` re-runs the labeller and mesher on
a stored generation and compares bodies, triangles and a mesh checksum against
what that build recorded. A divergence means the builder no longer reproduces its
own output — which is precisely what a provenance record exists to detect.

**Migration written by hand.** `alembic revision --autogenerate` proposed 66
operations: the two wanted ones plus a dozen `dov_permkey` index drops and other
pre-existing model-vs-database drift. Applying it would have silently destroyed
indexes the DOV import relies on. Only the two intended operations shipped; the
drift is left for a deliberate, separate migration and is still open.

**Not done, deliberately.** Bundle round-trip: generations do not travel in
`.gmproj`. They are reproducible build metadata for the machine that built the
model, and adding them to the bundle needs a format-version decision. Revisit
when the backwards-compat contract is re-armed (#47).

## 253. Snap-before-fill — SUPERSEDED, never shipped (S)

**What.** `_stack_at_band` back-filled a geological band's voids BEFORE snapping the
band's outermost contacts to the surfaces, so a few-centimetre sliver between a
section's own stack and the band floor was filled from a distant section and then
stretched to the surface by the snap. Traced on the dev model: six invented ZAND
voxels at exactly +3.50, one centimetre above band 2's floor at 3.49, sourced from
a tie section 26.8 m away while the nearest section had weight 1.000 and its own
stack ended at 3.709.

**Why it never shipped.** A snap-first reordering was written and TDD-green, but
model-wide it was neutral (402 → 394 disagreeing samples: the six named voxels
disappeared and six appeared at other band edges). It also left the premise intact
— that a geological band may extend lithology at all — which is exactly what #254
removes. Committing it would have fossilised a policy being retired, and while it
sat uncommitted in the working tree it made every build unreproducible against its
own provenance record (`--reproduce` reported DIVERGED, 790,910 recorded against
801,266 rebuilt).

**Status.** Reverted 2026-07-30, superseded by #254. The diff and its five tests
are recoverable from the session scratchpad; the mechanism they describe no longer
exists.

## 254. The geological model no longer bounds the litho 3-D build — SHIPPED 2026-07-30 (L)

**What.** The voxel builder loaded the parent geological model's surfaces and used
them as hard bands: an interval crossing a surface was cut at it
(`_clip_stack_to_band`), contacts within a tolerance were snapped to it
(`snap_edges`), a section that did not reach a band was dropped from that band's
vote (`section_reaches_band_from_elevs`), and any band left empty was back-filled
from any section that did reach it, **at any distance** (`_fill_band_voids`). It no
longer loads them at all.

**Owner ruling 2026-07-30**, verbatim: *"the voids below td are always filled
through correlations from other tests the left or right (as in fill bands) if that
is not the case then you leave it unkown."*

**Why the rule was already law elsewhere.** The 2-D engine implements exactly it —
correlate-or-gap, uncapped `emitGap`, no substrate since the 2026-07-10 revert
(`sectionResolve.ts:783-789`, debt #237.5). The same ruling is recorded as the
partition-engine-v2 §8 Q3 answer (2026-07-13). And geology-over-litho had already
been reversed twice: A2 geo-decoupling (`docs/domain-model.md:89-108`) and
`litho_geo_bounding.py:7-12` (2026-06-25). The 3-D builder was the last place that
contradicted it. The original justification — capping extrapolation beneath a
shallow test — describes a builder that no longer exists.

**Evidence.** Measured read-only on generation `019fae07-b05d-7143`, then A/B'd with
identical inputs and identical code, only `geo_surfaces` differing. Of the gap-sides
whose two columns differ in depth by ≥ 1 m, **9 reach below the shallow TD** (a tie
crosses, so the band follows it) and **44 stop at it to the millimetre**. Yet 39 of
those 44 carried 3-D material below the TD — mean 3.58 m, worst 6.70 m, almost all
KLEI — imported from a section a **median 35 m away, max 238 m**, while the section
that authored *unknown* sat at perpendicular distance **0.0 m**.

| | with bands | after |
|---|---|---|
| invented sub-TD gap-sides | 39 / 44 | **6 / 44** |
| worst invented depth | 6.70 m | 2.96 m |
| median import distance | 35.3 m | 0.2 m |
| `invented` samples (model-wide) | 3,232 | **171** |
| `disagree` | 402 | **318** |
| `model void` | 33 | 303 |
| `agree + blocky` | 99.7 % | 99.5 % |
| triangles | 790,910 | 757,706 |
| bodies | 81 | 81 |

**The instrument had to be built first.** `diag_partition_vs_voxel` bucketed every
sample with no 2-D region as `outside` *without reading the model there*, so it was
structurally incapable of seeing invented material — the 0.3 % `disagree` the
campaign had been optimising was eight times smaller than the 3,232 invented
samples nobody was counting. `scripts/diag_subtd_invention.py` is the sub-TD gate.

**One regression, found by the owner on the first build and fixed.** He reported
*"bottom clay is not being made 3d even though it has a top tie and a base tie"*.
Not the decoupling: `_stack_at` treated an EMPTY neighbour stack as an
interpretation of "no material here" rather than "no information here", so every
body in the informed column became one-sided and was pinched by `max(0, 2w - 1)`;
`_layout` then accumulated the shortfall into the depths. At
`GEO-77/002-A..GEO-05/040-S3` the neighbour projected to `f=1.000` with an empty
stack, the column went 19.99 m → 17.45 m, and a clay tied top AND base landed at
-4.086/-5.072 instead of -6.481/-7.610. Fixed by deferring to the section that
knows (`_stack_at`); deepest-region samples present 917/960 → 949/960, model voids
40 → 8. **The +29 % triangle cost the decoupling appeared to carry was this bug** —
the mesh is now smaller than the geology-bounded build.

**Deliberately staged.** The geo branch inside `label_voxels` (`_stack_at_band`,
`_clip_stack_to_band`, `_fill_band_voids`, `_column_stack_geo`) is unreachable but
still present, with all ~40 of its tests green, so a revert is one command while the
change is dogfed. `geo_bands.py`, `load_geo_surfaces.py` and `surface_bound.py`
have no production caller left. Deleting them, and `scripts/eval_voxel_geo_bands.py`
— which asserts the OPPOSITE of the ruling ("sideways fill ≥ 1.5× un-bounded",
"NEVER relax the assertion") — waits on owner acceptance.

**Open residual, not from this change.** `model void` rose 33 → 303 (0.2 % of
samples) and 5 gaps still have a partly-missing deepest region (8 samples, 4 of them
on CS1). And the one-sided lens pinch still tapers to the **equidistance midline**
(`max(0, 2w - 1)`), which spans half the perpendicular distance between sections —
up to 119 m on this model, against the tens of metres a 2-D intra-gap lens spans.
**Owner question queued:** a deep unit seen on only one section — does it taper out
halfway to its neighbour, stop at the neighbour's TD, or die within a fixed
distance? Answering it is a separate, separately-measured commit; it lives inside
`_blend_stacks` / `_layout` alongside #248 and the vertical-migration question.

**When to revisit.** The deletions after the owner accepts the dogfeed; the lens-
reach question when he answers it.

**Cache.** The partition checksum no longer folds the geo digest, so every project
rebuilds once. `_BUILDER_VERSION` is `voxel-2026.07.30`; generations stamped earlier
reproduce differently by design, and `--reproduce` does not yet say so (it compares
grid, bodies and triangles but not the builder version — a cheap improvement worth
making).

## 255. The build threw away which contact a correlation edge joins — FIXED 2026-07-30 (L)

**What.** A `LithoContactCorrelationEdge` records `layer_a_side` / `layer_b_side` —
whether each end joins that layer's TOP or its BASE. The section overlay threads
them into the partition engine and states why in its own comment
(`PartitionFillOverlay.tsx:996-998`): the engine splits bottom ties (`base<->base`)
from top-keyed edges "letting the deepest unit band without a base-tie polluting the
topCorr signal". The BUILD path dropped them, in two independent lossy maps:

* `shell/stages/shared/fetchApprovedEdgesBySection.ts:69` — `.map(e => ({ a, b }))`,
  type `ApprovedEdgePair { a, b }`;
* `utils/assembleLithoSectionInputs.ts:136` — `.map(e => ({ a: e.a, b: e.b }))`,
  type `ApprovedEdge { a, b }`.

Fixing one alone is useless; the other re-strips.

**Why it was silent.** `CorrelationEdge.aSide/bSide` are OPTIONAL and documented as
"Omitted ⇒ `'top'`" (`utils/partitionFill/types.ts:63-68`), so both maps type-check
and every `base<->base` tie arrives at the builder as a DUPLICATE `top<->top` tie.
No base tie then exists anywhere in the section: the deepest unit gets a top bound
and no bottom bound.

**The symptom, and how long it hid.** The owner reported a clay that both
GEO-23/125-S6 and GEO-10/170-S11 bottom out in — tied `top<->top` AND `base<->base`,
four gaps apart over three shallow tests — drawn correctly by Fill bands and absent
from the 3-D model. It hid because every input the two paths share was verifiably
identical: same columns, same units, same 111 edges, same `alongM` to the
centimetre. Only the SIDES differed, and neither the type system nor the build's own
region log could see it (that log counts distinct tied layer IDs, which a top+base
pair on one layer pair cannot move).

**Evidence.** Same engine, same real CS1 input, sides present vs stripped:

| | regions | basal clay, gaps 19-22 |
|---|---|---|
| with sides | 248 | all `0.000..1.000` |
| stripped | 206 | all NONE |

and on the owner's builds, before → after the fix:

| | before | after |
|---|---|---|
| CS1 payload regions | 193 | 230 |
| basal clay gaps 19-22 | 0.000..0.500, NONE, NONE, NONE | all 0.000..1.000 |
| model under S5A / S5 / S5B below TD | VOID | `KLEI -11.59..-6.59` |
| gap-sides reaching below a shallow TD | 9 | 53 |
| gap-sides stopping AT the TD | 44 | 0 |
| invented sub-TD sites | 6 | 0 |
| drilled-column gate | 55 exact / 1 subseq / 2 wrong | unchanged |
| contact-error p90 (drilled ground) | — | 0.119 m (median 0.065, max 4.805) |
| triangles | 757,568 | 764,026 |

Nothing user-authored moved: 418 litho layers, 480 correlation edges, 92 distinct
body ids, all unchanged.

**It also corrects an earlier conclusion in this file.** #254 reported "44 gap-sides
where the partition stops at the shallow TD, uncorrelated, correctly left unknown".
That number was measured from a payload whose base ties had already been stripped.
With the sides preserved, 53 gap-sides reach below the TD and none stop at it — the
ties were there all along, which is what the owner said twice before it was believed.

**Blast radius.** `buildProjectFence` consumes the same two producers, so the 3-D
fence walls carried the identical defect and are fixed by the same change.

**Still open, found alongside it.** `buildVoxelRequest.ts:209-213` claims the build's
override gap-extents are equivalent to the overlay's; they are not. The build uses
column CENTRES in along-metres under an identity transform, the overlay uses column
FACES in warped screen pixels, so `NODE_OWN_EPS = 0.5` means metres in one and
pixels in the other. An override can only move an existing tip, so it is a separate
and smaller bug — but the claim in that comment is false and should not be trusted.

**When to revisit.** The override gap-extent mismatch: when apex overrides are next
touched.

## (end)

## 256. The build throws away the band / onlap / lens classification the 2-D engine computed (L)

**What.** `computeSectionFillActive` classifies every region it emits — that is the
2/1/0 gesture semantics the whole litho stage is built on. `buildVoxelRequest.ts`
then sends four fields per region and drops the rest, so the 3-D builder never sees
the classification and re-derives it, badly, from geometry alone.

Verified against the owner's last stored build: 756 regions across 14 sections, each
carrying exactly `body_id`, `formation_id`, `gap_index`, `polygon`.

| produced by the 2-D engine (`PartitionRegion`) | reaches the builder |
|---|---|
| `formationId` / `bodyId` / `polygon` | yes |
| `kind: 'quad' \| 'pinch' \| 'lens'` | **no** |
| `overlayTier: 'onlap' \| 'lens'` | **no** |
| `tiedBandBase` | **no** |
| `tieClipped` | **no** |

**Why it matters.** `_stack_at` says so itself, in the BEYOND branch: *"we have no
band/onlap/lens kind to ramp, so we extend faithfully"*. It has no kind because the
kind was dropped three layers up. The consequences are the defects already measured
in this file:

* One-sided bodies are pinched by `max(0, 2w - 1)`, an invented rule that kills a
  body at the equidistance midline. A band tied on both sides, an onlap tied on one,
  and an untied lens all get the same treatment, because the builder cannot tell them
  apart. Deepest-base drift from this: median +0.369 m, p90 +3.165 m, max +7.863 m,
  always upward, on 65 % of between-section columns (#242's likely mechanism).
* `tiedBandBase` encodes the owner directive of 2026-07-08 — a user correlation is
  absolute and the shallow-TD cap must not chop it flat. The builder cannot honour a
  directive whose evidence it never receives.
* `tieClipped` marks a region deliberately kept only above its tie; without it the
  builder may re-merge across a tie the 2-D pass split on purpose.

**Same failure family as #255**, at the same boundary, found the same way: the
frontend computes correct semantics, the payload flattens them, the builder guesses.
#255 was the sides of a correlation edge; this is the kind of the region. Worth
auditing the whole `buildVoxelRequest` mapping once rather than field by field.

**Why deferred.** Found 2026-07-31 while looking for a footprint rule for lenses. It
reframes that search: the questions being asked of the owner — default lens width,
flooding rule, termination grouping — were reconstructions of information the model
already holds. Thread the classification through first, then re-measure; some of
those questions may not survive.

**Status — the wire is threaded 2026-07-31, the builder does not read it yet.**
`kind`, `overlay_tier`, `tied_band_base` and `tie_clipped` now travel
`buildVoxelRequest.ts` → `RegionInputSchema` → `RegionInput`. All four are optional,
so a generation or bundle written before this still loads and still builds. Labelling
behaviour is deliberately unchanged: the wire lands first so the classification can be
proved to arrive before anything acts on it.

Two production defects surfaced while threading it, both fixed here, both found by a
test written first:

* `apply_body_aliases` rebuilt each region field by field, so every re-identified
  region lost the classification the moment it existed — the same silent drop as the
  payload boundary, one layer in. Now `dataclasses.replace`, which cannot be outgrown
  by a later field.
* `_partition_checksum` did not cover the classification, so a band, an onlap and an
  enclosed lens sharing an outline shared a digest. Folded in and verified on the
  owner's stored payload: attaching a kind moves the digest `2a4142e2…` → `61c24a8e…`,
  so a classified build can never reuse an unclassified one. Busts every pre-#256
  cache once, correctly.

Green: 1528 python unit tests, 2549 desktop tests, mypy and tsc clean on the changed
files.

**The construction the classification enables — owner rulings 2026-07-31.** A body on
one cross-section and absent from the next terminates on every tie that carries it,
and the 2-D partition already places each of those terminations. Joining them gives
the pinch-out EDGE, measured rather than assumed. On the dev model, 39 such cases:
the assumed equidistance midline is off by a median of 4.5 m, p90 30.9 m, worst
53.6 m, and only 21 of 39 land within 5 m. The ties classify 24 of the terminating
bodies as BAND and 11 as LENS, so the assumption is wrong most often on bodies the
model says are tied.

Four of the 27 body/cross-section-pair groups are recorded by more than one tie, and
their terminations line up rather than scatter — VEEN between Cross-section 2 and
Cross-section 1 is recorded by seven ties over 607 m. So:

* between ties, interpolate along the edge;
* past the outermost tie the edge ENDS, carrying on only in the direction it was
  already heading, and the matrix floods past it;
* a tie that does NOT carry the body is evidence of ABSENCE — never carry the edge
  across one. The owner caught this on a SILT edge whose extrapolation ran over six
  ties that lack the body (5 of 11 ties carry it); on the VEEN, where all 11 carry
  it, the same extrapolation was harmless. Measured by
  `scripts/dump_tie_pinch_vs_midline.py`, drawn by `blend_viewer/tiepinch.html`.

**Why the shipped `pinch_factor` is unearned — diagnosed 2026-07-31, do not tune it.**
It stays opt-in (`measured_pinch=False`) because switching it on made contact error
WORSE, p90 +24 %, and that was left unexplained. It is now explained: **the
implementation predates the rulings above and satisfies none of them.** It takes the
nearest termination on any other section and thins radially toward it. There is no edge,
so nothing to interpolate along; no outermost-tie stop, so it never lets the matrix flood
past; and — the one that bites — no notion of absence, so nothing can stop it reaching
across a tie that says the body is not there.

How much that last one matters, measured on the dev model
(`scripts/diag_absence_ties.py`):

| | |
|---|---|
| tie-sections | 11 |
| bodies terminating on at least one | 22 |
| **of those, having at least one ABSENCE tie** | **21 (95 %)** |
| carrying tie-occurrences across all of them | 50 |
| **absence tie-occurrences across all of them** | **192** |
| bodies carried by exactly one tie of the eleven | 13 |

So absence is not the exception the SILT case made it look like — it is the norm, by
roughly four to one. Most of these bodies are anchored by a single tie with absence
evidence on every side, which is precisely the geometry a nearest-apex radial rule gets
wrong: it thins toward an apex through ground the model states the body does not occupy.

**The rulings do NOT cover the real geometry — one question outstanding.** Building the
edge needs the carrying ties to be contiguous, and on the dev model four bodies, all
SILT, are carried by ties with absence ties lying BETWEEN them:

| body | carried by | absent on, between them |
|---|---|---|
| `019ea170-5ceb` | 4 ties | 2 |
| `019ea170-5cef` | 5 ties | 1 |
| `019ea170-5cf0` | 2 ties | 2 |
| `019ea3e1-9bb5` | 5 ties | 3 |

"Interpolate between carrying ties" and "never cross an absence tie" give opposite
answers here, so the construction cannot be built until the owner rules on it. Measured
by `scripts/diag_absence_ties.py`. The three candidate readings — the middle tie simply
failed to record a thin body, or absence is absolute and this is two bodies the resolver
merged, or the body pinches to nothing at the middle tie and returns — differ in what
they claim about ground nobody sampled, and the second one would mean changing body
identity, which is out of bounds without a directive.

**OWNER RULING 2026-07-31 — reach is "as far as the data permits", and the three
earlier rulings are superseded by it.** Looking at the bodies in 3-D
(`blend_viewer/sandwich3d.html`) settled it more cheaply than the edge construction would
have.

What the model already holds, verified on the stored payload rather than assumed:

* **The pinch-out along a section is already drawn.** Every terminating region tapers to
  ZERO thickness at its open end — checked at each terminus of `019ea3e1-9bb5`, all
  "TAPERS to 0" — and what it tapers into is the neighbouring formations carrying on in
  the next gap, some of them lenses. The `kind: 'quad'` on those regions is the GESTURE
  classification (tied both sides), not a statement that the region fails to taper.
  Reading the tag instead of the polygon is what made this look harder than it is.
* So the apex is known in 2-D. **The only thing 3-D was ever missing is how far the body
  reaches AWAY from the section.**

**The rule: a body extends from its drawn apex until something contradicts it** — a
station, or a crossing section, that does not carry it. Nothing else sets the distance.

Why this is the right shape, and what it retires:

* It puts no number in the ground that nobody measured. The midline `max(0, 2w - 1)`
  invented one; the 15 % collinear-lens width invents a smaller one; "as far as the data
  permits" invents none.
* **It dissolves the absence-tie question entirely.** A tie that lacks the body is simply
  a stop, wherever it is — there is no need to interpolate between carrying ties, no need
  to refuse to cross an absence tie, and no need for the unruled present-absent-present
  case above. Tie-section 7 becomes the stop for `019ea3e1-9bb5` and stops being a
  contradiction.
* It also explains why 7 of the 8 absence ties measured "clear of the footprint": they
  are past a stop already, so they were never going to matter.

**BUILT AND MEASURED 2026-07-31 — the ruling costs nothing and closes 52,602 m3 of
void.** `_blend_stacks(..., reach_to_evidence=True)` makes a one-sided body's survival
factor its own section's weight: whole where that section stands, gone where the section
that lacks it stands. TDD, red first — halfway across, the old `max(0, 2w - 1)` has
already killed the body and the test asks for half its thickness.

A/B on the owner's generation `019fb809`, both arms in one process on the same payload,
grid, honour radius and aliases, so only the rule differs (`scripts/diag_reach_ab.py`):

⚠ **The first run of this A/B was void and its numbers are superseded.** It framed the
domain from the SEATED sections; production frames it from the sections AS DRAWN. Neither
arm reproduced any real build, and it went unnoticed because the generation it ran against
had no persisted solids to compare with. Caught 2026-08-01 when the owner's rebuild
matched neither number. `diag_reach_ab.py` now prints the persisted body and triangle
count up front with "an arm must MATCH this or the run is void" — the guard that should
have been there from the start, and the same failure this campaign already hit three
times.

Corrected, with the AFTER arm reproducing the owner's rebuild exactly at 540,958
triangles:

| | midline | reach | |
|---|---|---|---|
| exact / subsequence / wrong | 54 / 0 / 0 | **54 / 0 / 0** | unchanged |
| paired (unscoreable) / uncovered | 4 / 0 | 4 / 0 | unchanged |
| contact err median | 0.065 m | 0.065 m | unchanged |
| contact err p90 | 0.122 m | **0.123 m** | +1 mm |
| contact err max | 3.145 m | 3.145 m | unchanged |
| bodies | 81 | 81 | unchanged |
| triangles | 586,590 | **540,958** | **-7.8 %** |

Ground that changed hands: **61,530 m3 void → filled, 0 m3 filled → void**, 205,675 m3
(5.78 % of labelled volume) changed body.

Every conclusion survived the correction — the gate is unchanged, nothing was lost
anywhere, the mesh got cheaper — but the magnitudes moved, so the void run's figures must
not be quoted.

The direction is the finding. Nothing was lost anywhere — not one cell went from filled
to void — so the rule only ever adds ground the old one was withholding, and it does so
while getting CHEAPER to mesh, because a body that tapers smoothly to a section has a
simpler surface than one truncated flat at the midline. The 2 mm on the p90 is the whole
price.

**DEFAULT since 2026-08-01**, on the owner's word. Was: `reach_to_evidence` in `label_voxels`, now
defaulting to ``True``; pass ``False`` to rebuild the old behaviour. Two unit fixtures
that pinned the midline were rewritten to the ruling — one asserted the lens reaches zero
at the midline, the other asserted a SAND band at an elevation it has since left, and that
move is itself the ruling working (see #242 below).

**The owner must click Build** for the persisted solids to pick this up: the partition
checksum covers the payload, not the builder's rules, so a code change alone does not
bust the cache.

**Consequence for the next session: rewrite, do not tune.** No choice of radius,
weighting or falloff makes a radial rule respect an absence tie — the information is not
in the inputs it reads. `pinch_factor` needs the three-ruling construction (interpolate
between carrying ties, end at the outermost one, never cross an absence tie), and until
it has it the flag must stay off. Re-measure the p90 against the same A/B afterwards; if
it does not go BELOW the midline baseline, the construction is wrong and the honest move
is to delete the module rather than ship a second unearned rule.

**Elevation at the edge is measured, not a rule.** Read off each region's own
polygon: **all 48 lens regions taper to <= 1 cm** at their thin end (median 0.000 m
against a 0.790 m thick end), and 289 of 707 bands reach zero at one end too. So a
pinching body is a wedge, exactly as the fill band draws it, and the builder only has
to honour the polygon. (Measuring instead by summing a BODY's thickness near where it
vanishes reported 61 % "wall" — wrong, because a body with several layers in one
column looks full-thickness until its last layer ends. Measure the region.)

**The closed construction — owner rulings 2026-07-31.**

1. A body present on one cross-section and absent from the next terminates on every
   tie that carries it, and the 2-D partition already places each termination.
2. Two or more ties: join them into the pinch-out EDGE and interpolate along it.
3. One tie: close the boundary locally around that point with the 15 % ellipse —
   long axis the body's run along that tie, width 15 % of it.
4. Never carry the edge across a tie that does NOT carry the body; that tie is
   evidence of absence.
5. No dangling end may be left inside the model footprint.
6. Vertically the body tapers to nothing at the edge, per the measurement above.

**Coverage of each rule on the dev model.** Only 4 of the 27 body/cross-section-pair
groups are recorded by more than one tie, so rule 2 governs 4 cases and rule 3 the
other 23. All 31 edge tips sit deeper than 25 m inside the footprint and none within
5 m of it, so rule 5 bites everywhere — which is why "end it and let the matrix
flood" could not stand alone and rule 3 replaced it.

**Two residues, flagged rather than resolved.** Of the 23 single-tie runs only 8 have
both ends measured; the other 15 have one open end, so their length — and therefore
their 15 % width — is set by where the section's coverage stops rather than by
geology. And the 4 multi-tie edges have tips inside the hull too; applying the same
local closure at each tip is a reading of rule 3, not something the owner ruled.

**What remains.** Make the builder read it — chiefly `_stack_at` / `_blend_stacks`,
where `max(0, 2w - 1)` currently kills a band, an onlap and a lens alike at the
equidistance midline. That is a behaviour change and needs its own measurement against
the drilled gate, the contact-error p90 and the partition-vs-voxel scoreboard.

**When to revisit.** Next, and before any further 3-D geometry rules are designed.
Necessary but not assumed sufficient — `_stack_at` also consults only the two nearest
sections, and whether that still costs anything once the kinds arrive is a
measurement, not an assumption.

## 257. The blend deletes material BOTH sections carry — FIXED 2026-07-30

**What.** `_section_stack_at` emits one `_Entry` per sliced REGION and never merges
contiguous slices of the same body. `_pair_occurrences` then matches occurrences
one-to-one by nearest mid-elevation, and `_blend_stacks` sends the SURPLUS into the
one-sided branch — where `max(0, 2w - 1)` annihilates it at the midline. The body is on
BOTH sections. It is not one-sided. It is deleted because the 2-D engine happened to cut
it into a different NUMBER of polygons on each section.

`_layout` then stacks cumulatively downward from a blended top, so every deleted metre
comes off the bottom: the column thins, the units above sink, and the model floor rises.

**Counter-example, verified against the persisted build.** At Lambert-72
`(88 082.3, 164 463.3)`, between Tie-section 8 (perp 31.04 m) and Cross-section 1
(perp 31.32 m), midline factor 0.0046, no honour override (nearest investigation 36.5 m):

| | |
|---|---|
| both sections author their floor at | **-9.69 m** |
| the model's floor | **-0.845 m** — 8.85 m too shallow |
| model puts ZAND at | +10.41 .. +6.66 (3.75 m) |
| Tie-section 8 authors there | KLEI (with a 0.15 m VEEN) |
| Cross-section 1 authors there | SILT |
| neither section has ANY sand above | +5.59 m |

The mechanism at that point, measured: KLEI `019ea170-5ce6` is 5 contiguous slices on
one section and 1 on the other (4 surplus, up to 5.81 m deleted); ZAND `019ea3e1-9be2`
is 1 versus 5 (4 surplus, up to 5.16 m). Weighted deletion ~5.49 m from bodies both
sections carry, plus the genuinely one-sided SILT and VEEN — 8.94 m in total, exactly
the shortfall.

The slices are CONTIGUOUS: base of one equals top of the next to 1e-6. They are one
interval the 2-D engine cut into pieces, not a re-entrant body.

**Model-wide.** 57.6 % of all deleted thickness comes from surplus occurrences of bodies
BOTH sections carry — mean 0.684 m per column against 0.504 m for genuinely one-sided
bodies, p90 2.18 m, max 5.67 m, with 12.6 % of blended columns losing more than 2 m to
this alone. Floor shortfall over 37,503 columns: p50 +0.01 m, p90 +1.77 m, p99 +5.35 m,
max +8.85 m.

**Why it stayed hidden.** `scripts/diag_partition_vs_voxel.py` samples ON the section
lines, where the weight is 1 and nothing is deleted. This happens 31 m away at the
midline, which nothing sampled. The drilled-column gate is likewise anchored at
investigations, which sit on sections.

**This is almost certainly #242.** "The model floor is shallower than the deepest
investigations" is this, and it is also the 3-D consequence of the 2-D sliver problem
(#228 / #149): in 2-D a hairline sliver is cosmetic, in 3-D its thickness is deleted and
the floor rises by it.

**Why deferred.** Found 2026-07-31 by an adversarial counter-example hunt, verified
against both the in-memory rebuild and the persisted `litho_body_solid` meshes.

**FIXED** in `label_voxels`, two changes. `_section_stack_at` now merges contiguous
same-body slices (`_merge_contiguous`), so a body the 2-D engine happened to cut into a
different number of polygons on each section presents as one occurrence. And the surplus
of a MATCHED body now blends by weight instead of falling into the one-sided branch —
`# SURPLUS of a body BOTH sections carry — blend it, do not pinch it (#257)`.

Measured after: the counter-example floor went -0.845 → -6.567 m, model-wide floor
shortfall p90 1.77 → 0.60 m, zero columns more than 5 m shallow. Note the one-sided branch
it used to leak into has since changed rule again (#256), which only reinforces this: a
matched body must never reach it.

**Original when-to-revisit.** Before any further 3-D geometry work, and before #256's measured
pinch earns its default — this is a larger error than the midline assumption #256
replaces, and it is in the same function. The obvious fix is to merge CONTIGUOUS
same-body intervals before pairing, which is correct by construction: two slices that
touch exactly are one interval. It will not fix the cases where a 3-6 mm sliver of
another body sits between two slices of the same one — that is #228 itself, and it needs
the sliver gone rather than papered over.

## 258. Paired stations named — RESOLVED 2026-07-31, and the 2 failures were the gate's own

**What.** The fidelity gate scored a paired station's loser against its own log, which
no build can satisfy: a borehole and its CPT 0.28 m / 0.40 m apart cannot both own a
cell, `honor_rank` picks one, and the other's ground carries its partner's log.
`paired_stations.paired_station_losers` now replays the builder's own honour assignment
on the grid the stored generation recorded, and the gate reports those columns
separately. Drilled ground: **55 exact / 1 subsequence / 2 wrong → 53 / 1 / 2 / 2
paired**.

**It corrects the finding that prompted it.** An adversarial specialist claimed "both
residual fidelity failures are honour losers". They are not — the two paired losers were
scoring EXACT. The 2 `wrong` columns are a separate defect and remain unexplained.

**Why it matters that the rule is ownership, not proximity.** A first attempt flagged any
log within 2.0 m of another, transitively grouped: 7 investigations on this model, five
of them perfectly scoreable. Only a log left with NO cell is unscoreable.

**RESOLVED — the 2 `wrong` columns were a bug in the SCORER, not the model.**
`_clip_to_drilled` applied its `_SUBSTRATE_MARGIN_M` guard at the TOP of a column as well
as the bottom, and the guard's own docstring says it exists for deep-band material poking
up past the drilled BOTTOM. A voxel-aligned mesh always overshoots the log's top contact
by up to half a voxel, so the shallowest unit is never "fully inside", and if it is
thinner than the margin the guard deleted it. The scorer was throwing away a unit the
model had labelled, meshed and hit with the ray-cast.

Made downward-only, with `tests/unit/scripts/test_clip_to_drilled.py` pinning both halves
— the log's own top unit survives its mesh overshooting, and substrate below total depth
is still discarded. Drilled ground is now **54 exact / 0 subsequence / 0 wrong / 4 paired
/ 0 uncovered**, confirmed again 2026-08-01 against the owner's rebuild.

So all three of this campaign's "drilled gate failures" turned out to be faults in the
gate: the footprint hull, the paired stations, and this. Worth remembering the next time
the gate reports a model defect.

## 259. `_section_stack_at` returns nothing at the edges of half the gaps — RESOLVED 2026-07-31 (ghost recurred 2026-08-26, re-refuted)

**2026-08-26 note.** The same ruler error (fraction shortfall × SECTION length
instead of × GAP width) resurfaced in the gapless-map sweep as "H14: 2/69
geotech gaps emit 25 mm short of the edge". Re-measured mechanically with both
rulers: 0/69 unsafe on both arms, worst true shortfall 0.7 mm vs the 2 mm
margin. No fix shipped (edge-forcing is the lens-dragging invention this entry
already rejected); instead `geotechHierarchicalFill/edgeReach.ts` now trips —
cover-stated, so a genuinely pinching lens is followed, never "corrected" —
and `GEOTECH_EDGE_REACH=1` prints BOTH rulers side by side so the denominator
substitution can never be made silently again.

**What.** The query fraction is clamped to `1 - _FRAC_EPS`, and in **33 of 69 gaps** the
region polygons do not reach that far, so the section reports an EMPTY column. 15 of 69
do the same at fraction 0. Verified directly: all 69 gaps are non-empty at fraction 0.5.

A voxel column projecting near a gap's far edge therefore gets no stack from that
section. It is partly masked by the empty-neighbour deferral added 2026-07-30 — when one
stack is empty `_stack_at` defers to the section that does know — so instead of a void
the build silently drops one section's contribution and extrudes the other.

**RESOLVED.** The query is inset by two snap cells expressed in the gap's OWN fraction
space (`_SNAP_MARGIN_CELLS * _SNAP_GRID_M / width_m`), because 1 mm of ground is a
different fraction on a 0.47 m gap than on a 104 m one. Re-verified on the owner's
payload 2026-07-31, through the real domain objects:

| | before | after |
|---|---|---|
| gaps empty at fraction 0.0 | 15 of 69 | **0** |
| gaps empty at fraction 1.0 | 33 of 69 | **0** |
| gaps whose edge stack differs from the near-edge stack | — | **0** |

**The follow-up item this entry carried — "5 mm / 25 mm still short on section 2 gaps 0
and 3" — does not exist.** It came from a bad fraction→metres conversion in the original
finding (section length used in place of gap length, which the adversarial verifier also
caught). Measured per gap with that gap's own width
(`scripts/diag_gap_fraction_envelope.py`), the worst shortfall in all 69 gaps is
**1.059 mm** — section 12 gap 0 — so the 2 mm inset clears every one of them with room
to spare. No gap needs 5 mm, let alone 25 mm.

**The recommended fix was rejected, deliberately.** Clamping the query into whatever
fraction envelope the polygons happen to reach would drag a region that *genuinely* ends
mid-gap — a lens pinching out — all the way to the column. That is inventing geology to
fix a rounding artefact. `test_a_region_that_genuinely_stops_short_is_not_dragged_to_the_edge`
pins the distinction: a region ending at fraction 0.45 must still read empty at 1.0.

## 260. The between/beyond switch steps the ground — CORRECTED 2026-08-01, the 12 m was my own measurement error (M)

**What.** Reproduced independently 2026-07-31, and the wall is more than twice as tall
as reported.

`_stack_at` blends the two nearest sections when the point lies BETWEEN them and
extrudes the nearest one ALONE otherwise. The weight is therefore discontinuous at the
boundary: inside it is `d2 / (d1 + d2)`, outside it is 1. The column changes in a single
step.

| | |
|---|---|
| adjacent 2 m column pairs compared | 23,469 |
| worst jump in a shared body's top across ONE step | **12.15 m** (reported: 5.32 m) |
| where | (88 316.3, 164 879.1), mode flipping `beyond` → `between` |
| steps where the mode or the section pair changes | 1,112 (4.7 %) |

**The second half of the reported finding does not hold as stated.** "The beyond rule
extrudes a terminal column up to 53.4 m past the end of that section" — measured
properly, only **147 of 23,715 sampled columns (0.6 %)** project onto a terminal column
at all, and they are carried a median of 36.4 m, p90 61.1 m, max **70.1 m**. So the
distance is real and larger than reported, but it applies to well under one percent of
the model rather than being a general property of the beyond path (23.2 % of columns).

A first attempt at this measurement asked how far each beyond-path point sat from the
nearest END COLUMN and got a median of 236 m — meaningless, because a point can be far
from both ends while sitting beside the middle of a long section. Discarded, not
reported.

**⚠ CORRECTED 2026-08-01 — the 12.15 m headline above is WRONG, and it was a measurement
artefact of my own making.** At the named hotspot the two columns share EVERY body they
carry, and the worst shared body's roof moves **0.030 m** across the step. The 12 m appears
only when the two stacks are lined up by RANK: the `between` column emits 11 intervals
against the `beyond` column's 8 — three of them hairline slivers of 5 mm, 2 mm and 1 mm —
so from the fourth entry down, the nth interval of one column is a different body from the
nth of the other. Lined up that way the same step measures 12.140 m, reproducing the
reported 12.15 m to the centimetre. **This is the #248 rank-pairing error one level up, in
the measurement rather than in the blend.**

Verified two independent ways before being accepted: a recorder wrapped around the real
`_section_stack_at` / `_blend_stacks` and driven through the shipped `_stack_at` over all
37,706 columns reported **0 mode mismatches, 0 pair mismatches, 0 top mismatches**, and the
0.030 m was reproduced from the raw stacks.

The corrected picture (`scripts/dump_between_beyond_wall.py`, which writes the shared-body
number and prints all three matchings so the gap stays visible):

| | reported | measured |
|---|---|---|
| worst step in a shared body's roof | 12.15 m | **7.70 m** |
| where, and what changes there | mode flip `beyond → between` | **(88 500.3, 164 925.3) — a PAIR CHANGE, both columns `between`** |
| the named hotspot | 12.15 m | **0.030 m** |
| share of columns on the beyond path | 23.2 % | **12.9 %** |
| adjacent pairs changing mode or pair | 1,112 of 23,469 (4.7 %) | 5,530 of 74,775 4-neighbour pairs (7.4 %) |
| adjacent pairs sharing NO body | — | **0 of 74,775** |

**The premise of the ruling this entry asked for does not survive.** The question was
framed as "what should happen past the end of a section", because the between/beyond switch
looked like it caused a 12 m wall. It does not. The largest real discontinuity is a **pair
change** — which two sections are nearest — occurring entirely inside `between` mode, and
no ruling about the beyond path would touch it. Whatever gets decided here, it is a
different question from the one written below, and the numbers to reason about are 7.70 m
and a pair change.

**The companion does not yet show it as a step.** `blend_viewer/wall.html` draws the
shallowest entry per column, which is a nearly flat lid (median adjacent jump 0.009 m over
the whole 650 m model), while the steps are measured on a shared body's roof that sits a
median 4.55 m below it. The walls therefore hang as curtains under a smooth sheet — visible
as objects, not as risers between two treads. Fixing that means emitting the stepped body's
roof per column so the surface itself steps.

**Why it needs an owner ruling.** Removing the discontinuity means deciding what happens
past the end of a section: keep extruding the terminal column unchanged (today), let the
second section's influence decay continuously, or stop the model there. Each is a claim
about ground nobody sampled. A parameter-free option exists — decay the second section's
weight over the distance between the two projection feet, which needs no invented
constant — but it changes geometry wherever the beyond path applies.

**THE FADE WAS BUILT AND MEASURED 2026-08-01 — it works, and it is not worth it.**
`label_voxels(..., fade_sections=True)` gives every section a normalised inverse-distance
weight instead of hard-picking two, so the selection step is never created. One rule
replaces three branches — a body's thickness is `sum_i w_i * th_i`, zero where absent —
which collapses to the reach ruling at two sections, so #256 survives the generalisation.
No length constant: the power is a shape, and scaling every distance leaves the weights
unchanged.

**It fixes the wall it was aimed at.** At the #260 hotspot (88500.3, 164925.3) the worst
step goes **7.70 → 0.58 m**. The mechanism is real and the fix is real.

**It does not fix the model.** On the LABELLED grid, which is what the user receives, steps
≥ 0.5 m go **7.11 % → 11.16 %** and the worst goes **8.25 → 8.75 m**. More half-metre
steps, not fewer. The headline step did not vanish, it MOVED to (88164.3, 164791.3).

Two corrections to the first report of this, both from the adversarial pass:

* Its blend-field regression (worst 7.70 → 11.99 m, 6.5 % → 18.9 %) is largely a
  sub-cell-sliver artefact of measuring with no thickness filter. Filtered at the grid's
  own 0.25 m vertical resolution the two are **identical** (worst 7.21 → 7.63 m, ≥ 0.5 m
  5.4 % → 5.4 %); filtered at 1.0 m the fade is BETTER (worst 7.01 → 6.84 m, 5.2 → 4.4 %).
  So the fade is not as bad as its own author reported.
* The two-section anchor is exact in SUBSTANCE — 72,000 randomised trials matched the
  multiset of (body, formation, thickness) every time — but not element for element: 18 of
  72,000 tie in the sort key `(-ref, str(body))` and the stable sort resolves it by
  insertion order, swapping two intervals of one body, 2.00 m in the minimal case. A real
  if small defect in the new path.

**What it costs, which is why it stays off:**

| | |
|---|---|
| labelled ground changing hands | **7.20 %**, 95.5 % of it a LITHOLOGY change (248,806 cells) |
| net ground | **lost** — 49,018 cells filled→void against 34,544 the other way |
| triangles | 540,958 → **917,622 (+69.6 %)** |
| label + extract | 22.9 → **55.5 s (2.4×)** |
| drift from the NEAREST section's own drawn column, within 2.7 m of it | p90 **0.533 → 5.743 m** |
| weight handed to sections past the nearest two | median 14.6 %, p90 44.9 %, max 66.2 % |

That last row is the one that settles it. Standing beside a section the owner drew, the
model drifts up to 5.7 m from what he drew, because eleven other sections are voting. The
drilled gate held throughout (54 exact / 0 wrong, contact error median and max unchanged),
so honour is intact — but honour only pins the logs, and everything between them moved.

**THE REAL FINDING, and it redirects this entry.** Removing the section-selection
discontinuity ENTIRELY did not remove the model's steps. So the steps were never mostly
caused by which sections get picked. The remaining candidate is `_layout`, which orders
specs by reference elevation so that two specs crossing swaps two units vertically — and
that is **#261 verbatim**. #260's fix attempt is the evidence that #261 is the more likely
cause, and #261 should be answered first.

**DELETED 2026-08-01 on the owner's word** (reverts of `39127f5a8`, `0c38886d5`,
`e7261117a`). Shipping it would have traded a discontinuity the owner can see for a
lithology change across 7 % of the model that he cannot, and leaving a switch nobody should
flip is worse than leaving nothing. The implementation, its 18 tests and the A/B harness are
in git history at those three commits if the question ever reopens; the numbers above are
the reason it will not.

Verified after the revert: 1,582 unit tests green, and the model rebuilds to 81 bodies /
540,958 triangles — the persisted generation exactly, so `reach_to_evidence` (#256) came
through untouched.

**When to revisit.** With #261, which is the same shape of question: both are about what
the builder should do where the sections stop agreeing. Not a patch.

## 261. The blend carries one section's fragmentation — RESOLVED 2026-08-01, never a model defect

**What.** Reproduced independently 2026-07-31, and the mechanism is NOT the reported
one. Matched bodies cannot invert under interpolation — if A is above B on both sections
then `w1*a1 + w2*a2 > w1*b1 + w2*b2` identically — so "an order neither section has"
was the wrong description.

What actually happens: `_layout` sorts every spec by its reference elevation, and a
ONE-SIDED body's reference is its own mid. When that mid falls inside the span of a
MATCHED body from the other section, the one-sided unit is laid out in the MIDDLE of it,
splitting the matched body into pieces.

**Measured at (88 022, 164 359).** Section B carries ONE SILT interval, 12.838 → 9.743.
The blend emits it as FOUR, interleaved with one-sided units from section A:

| | |
|---|---|
| section A entries | ~8 |
| section B entries | 8 |
| blended entries | **16** |
| SILT `019ea170-5cef` on section B | 1 interval |
| the same body in the blend | 4 intervals |

Detected on 33 of 4,591 sampled between-section columns (0.7 %) by a first-occurrence
order check — that check is a proxy and over-reports, so 33 is an upper bound on this
shape, not a count of it.

**⚠ MEASURED 2026-08-01 — the title claim is IMPOSSIBLE, and the count was under-reported
by two orders of magnitude.** Both corrections point the same way: this is bigger than the
entry says, and it is not the blend inventing anything.

**The blend can never fragment a body neither section fragments.** A matched body
contributes `max(runs_A, runs_B)` specs to `_layout`, and `_layout` never splits a spec.
Measured across all 32,722 blended columns: **0**. Every emitted case has
`inBlend == max(runs_A, runs_B)` exactly. What actually happens is that the blend carries
ONE section's fragmentation into a column where the facing section draws a single thick
unit.

At the entry's own named position, section B carries SILT `019ea170-5cef` as 1 interval
(12.838 → 9.743, the entry's numbers to the millimetre) and the blend emits 4 — **and
section A already draws it as 4**, split by three of its own lens bodies. The entry recorded
one half of that and drew the wrong conclusion from it.

**The real counts**, full sweep at stride 1, reproduced exactly by independently written
counting code:

| | |
|---|---|
| in-footprint columns swept | 37,707 |
| columns that take a blend at all | 32,722 |
| columns where a body ends up in more pieces than one section draws | **15,923 (48.7 %)** |
| of those, carrying the entry's exact mechanism (a one-sided unit laid out inside a host) | 13,480 (41.2 %) |
| **of those, showing an arrangement NEITHER section draws** | **4,221 (12.9 %)** |
| resolvable at the generation's 0.25 m voxel | 8,564 (26.2 %) |
| columns showing more pieces than EITHER section shows | **0** |
| distinct bodies ever involved | **4** |
| worst split | 1 interval → 4 |

The entry's "33 of 4,591 (0.7 %), an upper bound" was a first-occurrence proxy. Counting
maximal runs instead — what the grid and the eye see as one interval — it was not an over-
report but a miss by roughly two orders of magnitude. The 4,221 row is the honest headline:
the rest is one section's own interbedding, faithfully carried.

Two further corrections worth having before ruling. The phrase "carrying the NEARER
section's fragmentation" is the minority case — 10,563 body-instances against 12,708 where
only the FARTHER section carries it. And the named point (88 022, 164 359) **sits outside
the built footprint**, so the model labels no ground there at all; the same 1→4 split on the
same body occurs in-footprint 8 m away at (88 030, 164 363).

**The candidates, and what each costs** — computed in the diagnostic, never in production,
both restricted to one-sided intruders and both handed to the production `_layout` with the
same blended top, so top and total thickness are preserved by construction and measured at
0.0 error across all 9 cases:

* **THIN erases units a section actually draws.** At the named point it removes 6 one-sided
  units (KLEI, SILT, ZAND) 11.5 m from the section that draws them, collapsing 17 entries to
  8. Worst case removes 7.
* **OUTSIDE changes the top lithology** — it puts ZAND at the ground surface where both
  sections start with SILT — and displaces units vertically by up to **9.01 m**, typically
  1.3–3.5 m.
* **Neither fully un-splits.** Where a host is also interrupted by a body BOTH sections
  carry, it stays split under both rules. That is interpolation between two agreed bodies,
  which neither rule speaks to.

Shown side by side in `blend_viewer/fragment.html`
(`scripts/dump_fragmentation_cases.py` writes it): the two drawn sections at the outside,
TODAY / THIN / OUTSIDE between them, coloured by formation at true elevation.

**RESOLVED 2026-08-01 — no ruling was needed, and the owner is the one who saw why.**
Looking at the five columns he read them correctly: *"they don't disagree, those sand
lenses just don't reach section B"*. That is exactly right, and it dissolves the question.
The cross-section draws lenses inside a silt; the tie draws the silt whole; the lenses
simply pinch out before reaching the tie, which under the reach ruling (#256) is what
should happen. Neither THIN nor OUTSIDE was ever needed — both answered a disagreement
that does not exist.

Testing that reading found one real defect behind it. Reading a SINGLE section merges
touching slices of one body (`_merge_contiguous`, #257); blending two did not. The split
survives because a section can record a lens sliced exactly at its own apex —
`2.650 -> 2.650` at (88 296.3, 164 767.3) — which has no thickness but sits BETWEEN two
pieces of the host in the list, so the section-level merge cannot join them: they are not
adjacent. Measured before the fix: **715 of 4,110 sampled blended columns (17.4 %)** held
touching pieces of one body, **880 joins**, with **0** leftover zero-thickness slivers.

Fixed by merging the blend output too (`d1272ea40`), TDD from the real column because an
invented fixture passed.

**And it changes nothing in the delivered model** — 81 bodies, 540,958 triangles, drilled
gate 54 exact / 0 subsequence / 0 wrong / 4 paired / 0 uncovered, every number identical
before and after. The reason is worth recording: `label_voxels` assigns each cell a body
id, so a body arriving as four touching intervals labels exactly the cells it would have
labelled as one. **The fragmentation was real in the STACK and invisible in the MODEL.**
The five-column companion draws the stack, which is why it looked alarming.

So this entry was never a defect in what the owner receives. What survives is a
representation fix worth having — diagnostics stop reporting phantom fragmentation, and
any future consumer that reads the stack directly gets the truth — plus the corrected
counts above for anyone who reopens the question.

**Superseded — kept only for the record.** Section A genuinely has
thin units where section B has one thick SILT, so SOMETHING has to happen between them.
Interleaving produces an alternation neither section shows; the alternatives — thinning
the one-sided units to nothing inside the matched body, or placing them wholly above or
below it — are each a geological claim about how a thin unit dies into a thick one. That
is a domain ruling, not a defect to patch.

**When to revisit.** After the owner rules on where a one-sided body sits relative to a
matched body whose span contains it. Same family as #257 (surplus handling) — that one
was deletion, this is fragmentation.

## 262. The safe-default repair loop doubles the engine cost on 4 of 14 sections (S)

**What.** `classifyOverrideOutcome`'s repair loop re-runs the whole fill when
`detectFloodedUnits` finds a drilled unit flooded by a foreign litho. On 4 of the
owner's 14 sections it fires and silently doubles the pass. Correct behaviour, twice the
cost.

**Measured 2026-07-31, after the perf work landed.** The count is confirmed — 4 of 14
sections fire it — but the cost is now second-order and concentrated:

| section | pass (median of 3, JIT warmed) | repair fires |
|---|---|---|
| s13 | 45 ms | yes |
| s11 | 20 ms | yes |
| s12 | 16 ms | no |
| s4 / s8 | 3 ms / 2 ms | yes |
| the other nine | 1-3 ms each | no |

All 14 sections cost **96 ms** per full pass. The repair accounts for roughly 36 ms of
that, almost all of it in s13 and s11.

**Verdict: do not optimise this next.** It is correctness work — it re-emits a drilled
unit that a foreign litho would otherwise flood — so the options are making it cheaper,
not skipping it, and 36 ms is no longer the thing anyone feels. The honest next step is
measuring the open time in the running app, which the vitest numbers cannot stand in
for: the 2.7-3.9 s baseline that started this was measured in vitest too.

**When to revisit.** Only if a real in-app measurement still shows the open as slow after
the five fixes that landed (splitSegments sweep, base-pass memo, ghostBase key,
sectionFillData engine key, deadline-driven slice).

## 263. `node_modules/vite` is bit-corrupted on this machine (S)

**What.** A specialist could not start vitest at all until it repaired the install. This
is the same disk that corrupted a git pack on 2026-07-12 (`memory/project_git_gc_disabled_after_corruption.md`).

**State 2026-07-31.** The install is repaired and the toolchain is currently sound —
verified rather than assumed: `npm test` runs **2,552 passed / 62 skipped across 321
files**, and `tsc --noEmit -p tsconfig.web.json` exits clean. So no local result taken
today is standing on a corrupted vite.

**What is still open is the disk, not the package.** This is the same volume that
corrupted a git pack on 2026-07-12, and a reinstall treats the symptom. Two bit-level
faults on one disk inside three weeks is a pattern.

**When to revisit.** Owner action, and only the owner can take it: run `chkdsk /f` on the
volume (needs a reboot to schedule) and check the drive's SMART reallocated-sector count.
Until that comes back clean, treat any single inexplicable local failure — a test that
fails once and passes on re-run, a package that will not load — as possible disk error
before spending time on it as a code bug.

## 264. v2 renders a contact-freedraw handle that does nothing (M)

**What.** With the v2 engine now the default, a multi-node contact freedraw only bends the
polygon at **node 0**. Node 1's handle still renders and is still draggable, and dragging
it changes nothing. Confirmed by rendering the real fixture on v2: both
`partition-boundary-handle-sand-clay-0` and `-1` appear, and the resulting sand path
`M 20,0 L 20,50 L 40,55 L 80,60 L 80,0` carries one inserted vertex, at node 0 only.

The cause is explicit rather than accidental —
`desktop/src/renderer/src/components/sections/contactOverrideWiring.ts:229` gates on
`drag.nodeIndex === 0`, reads `nodes[0]` at `:241-242`, and the comment at `:237` says
"multi-node contact freedraw stays on the existing per-node handles for now".

**Why it matters now.** It was tolerable while v2 was opt-in and only the owner saw it. As
the default it ships, and a control that responds to the mouse while doing nothing is the
kind of thing a beta tester reports as "the drag is broken" rather than "this node is not
implemented yet".

**Why deferred.** Found 2026-08-01 by the adversarial review of the v2-default cutover,
which also established that no test covers it: the test that named this mechanism is
pinned to v1, because the v1 behaviour it asserts was deliberately retired on v2.

**When to revisit.** Before the beta goes out, and it is an OWNER CALL which way: either
wire node 1 (and any further node) so every handle bends the polygon it belongs to, or
render only the handle that works so nothing invites a drag that cannot land. The second
is a smaller change and honest; the first is what the gesture implies.

## 265. The always-on CS1 frozen gate fails intermittently (S)

**What.** `desktop/src/renderer/src/utils/partitionFill.cs1frozen.test.ts` — "has no
cross-formation overlap in any gap (one lithology per point)" — failed once in three
consecutive full-suite runs on 2026-08-01 and passed in isolation and on re-run. The other
two full runs were green at 283 files / 2,553 tests.

**It is not the v2 cutover.** This file imports `computeSectionFill` directly rather than
through `computeSectionFillActive`, so neither the default flip nor an engine pin in a
sibling file can reach it. Ruled out by reading the imports, not by assuming.

**Why it matters more than one red.** This is an ALWAYS-ON real-data correctness gate on
the shipped partition. A gate that fails once in three runs teaches everyone to re-run it,
which is exactly how a real overlap gets waved through later.

**Why deferred.** Out of scope of the cutover it surfaced during, and one observation is
not a diagnosis.

**DIAGNOSED 2026-08-01 — environmental, not the partition.** The decisive measurement is
that the computation cannot vary: running `computeSectionFill` over the frozen fixture and
`findNonLensOverlaps` over the result **150 times in one process yields 1 distinct
partition and an overlap count of 0 every time**. A deterministic pure function over a
fixed on-disk fixture, in an isolated module registry, cannot spontaneously report an
overlap, so the algorithm is not capable of producing the failure that was observed.

Everything else was ruled out by evidence rather than assumption:

| candidate | ruled out by |
|---|---|
| the v2 cutover | the file imports `computeSectionFill` directly, never the selector |
| shared module state in v1 | no module-level mutables and no caches anywhere in `partitionFill/`; its only `process.env` read is the `GAP_PROBE` logging gate |
| a corrupted or rewritten fixture | `cs1_partition_frozen.json` unchanged since 2026-07-12, tracked, 35,067 bytes, parses clean |
| a real intermittent overlap | the determinism probe above |

**What is left.** The failure appeared on the first full run after source edits, repeated
once, and has not recurred in 11+ consecutive green full runs (2,553 tests each). Vitest
4.1.5 keeps a persistent transform cache at `node_modules/.vite/{deps,vitest}`, and per
**#263** this machine has TWO confirmed bit-level disk faults — one of which corrupted
`node_modules/vite` itself during this same campaign. A torn or stale cache entry serving
different code for one run fits every observation; nothing else does.

**The reason this is not certain: the assertion text was never captured.** The failure was
seen through a grep that printed the FAIL line and not the error body, and it did not
recur. Capturing the error is the first thing to do if it ever comes back, before any
theorising — the theorising above cost far more than reading one message would have.

**When to revisit.** Only if it recurs. Then: capture the FULL failure output first, and
compare the reported overlap against the determinism probe's zero. If it is a timeout
rather than an assertion, that is a different bug and the margin is large — the test runs
in ~209 ms against a 5,000 ms default. Independently, #263's `chkdsk` is now doubly
warranted.

## 266. A geotech model does not notice when the litho model under it moves (M) — RESOLVED 2026-08-26 (integration verification still owed)

**Resolution.** The dependency link is a **per-column digest of the litho stack**, stamped
at press time and compared on read.

* `domain/services/litho_column_digest.py` — pure: `litho_column_digest(intervals)` reduces
  one column's accepted `(depth_top, depth_base, formation_id)` set to a `v1:<blake2b>` tag
  at millimetre resolution; `stale_column_ids(stamps, current)` names the disagreements;
  `next_stamp_map(...)` folds a press's results into the stored map.
* `geological_model.derived_from_litho_digests` (JSONB, nullable, migration `e7f8a9b0c1d2`)
  holds `{column_id: digest}` on the GEOTECH model, beside `classified_with_statistic` —
  the other "what the last build used" stamp, whose own migration already named this "the
  #266 compare-on-load pattern".
* Stamped by both presses through one shared method,
  `GeotechBoreholeMaterialiser._stamp_litho_provenance` — `SubdivideAllBodies` re-stamps the
  CPT columns it materialised, `DivideBoreholes` the boreholes it planned, each leaving the
  other's columns and any `skip_existing`-protected column with the provenance they had.
  `ClearGeotechColumn` drops the stamp with the bands.
* Read by `application/geotech_litho_staleness.py` →
  `GET .../geotech/litho-staleness`, and rendered as an amber per-column mark on the geotech
  axis (`components/sections/StaleColumnMarkers.tsx`) plus a toolbar count chip
  (`geotech-stale-litho-chip`).

**Why a digest and not a counter each litho verb bumps.** Because #266 IS a missed
dependency link, and a counter reproduces the bug class on the next verb someone writes.
Over forty verbs mutate litho and several cannot name the columns they touched
(`UpdateFormationContact` holds only a contact id, `BatchUpdateLithoLayers` only layer ids,
`PropagateLithoAdmixtures` walks a correlation graph) — and six of them stale nothing at all
today (`bulk_create_litho_layers`, `clear_litho_model`, `correlate_litho_contacts`,
`propagate_litho_admixtures`, `delete_body`, `SaveBodyBoundary`). Worse, litho writes are
mirrored by triggers in BOTH directions and the contiguity trigger rewrites a NEIGHBOUR's
`depth_base_m` without touching its `updated_at` — the trap this entry documents. A digest
computed from the rows as they stand cannot be bypassed by a verb that did not know geotech
existed, nor by a trigger firing behind one.

**No backfill, deliberately.** Existing bands carry no record of what they were built from.
Backfilling today's litho would assert "every existing column is current", which is FALSE
precisely for `GEO-23/125-S17` and `GEO-23/125-S9` — the two columns this entry was written
about. Missing stamp reads as NOT stale (no false alarm on any existing project) and the
signal starts telling the truth from the next press. The count of unstamped banded columns
is reported separately so a caller can tell "verified current" from "cannot say".

**Presentation unifies two signals.** `utils/geotechParentFit.columnsNeedingRederive`
already existed: a renderer-side geometric check that a band overhangs its litho parent. It
is CPT-only and can only see a unit that SHRANK. The new provenance answer covers boreholes
and the changes fit cannot see (a unit that grew, was re-classified, or was deleted).
Neither subsumes the other, so `utils/staleGeotechColumns.unionStaleGeotechColumns` merges
them into one marker per column and one chip count — two amber warnings about the same
column would be the alarm fatigue the signal exists to avoid.

**The export-completeness seam.** The coming export guard reads `GeotechLithoStaleness`
directly (application layer, session + model id, no request context) and gates on
`len(stale_columns)` and `unstamped_column_count`. What it DOES about a non-zero value —
refuse, warn, or annotate — is deliberately not decided here.

**Scope stated honestly.** This answers "has this column's own litho stack moved since its
bands were made". It does NOT flag a column because a body-wide aggregate shifted when a
DIFFERENT column in the same body was edited; body regrouping and correlation edits change
lateral grouping, not a column's intervals, and flagging every column of a body on every
edit anywhere is the alarm-fatigue failure again.

**Verification.** 2231 unit, from 2208. The 17 domain pins in
`tests/unit/domain/test_litho_column_digest.py` were written FIRST and seen RED (the module
did not exist); the 6 use-case pins in `tests/unit/application/test_geotech_litho_staleness.py`
were written after the use case and are test-after — read them with that in mind. On the
renderer, 4359 vitest pass / 84 skipped across 531 files, from 4330 / 84 across 527 — +29
tests (7 hook + 8 union/wording + 6 marker + 5 sections-chip + 3 geotech-stage-chip); four of
those were mutation-checked (anchor `nudgedX`→`trueX`, drop the stale filter, always-render
the chip — each went RED). tsc clean, ruff clean on every touched file (582 project-wide,
from 583), mypy at baseline (161 errors / 61 files, unchanged).

**A trap this change walked into, worth knowing before the next bus field.** Adding a field
to the `useGeologicalModel` result breaks every hand-written `ShellContextValue` double —
and only SOME of them are caught by `tsc`. Doubles built as an object literal fail the
typecheck immediately (17 files); doubles cast `as unknown as ShellContextValue` (4 files)
typecheck fine and fail at RUNTIME, as a TypeError thrown inside a `useMemo` that takes the
whole toolbar down with it. Both classes had to be patched, and the second class is only
visible by running the full suite. The same applies to `api.geology` doubles: 11 test files
hand-list the client's methods, and a hook that calls a new endpoint crashes in a passive
effect on every one of them.
**Integration was NOT run** (another agent held the wrapper lock). Owed before this is
called done: `tests/integration/db/test_subdivide_all_bodies.py` and
`.../test_divide_boreholes.py` should gain a pin that the press writes
`derived_from_litho_digests` for the columns it built and leaves the others alone;
`tests/integration/api/test_geotech_*.py` a `GET .../geotech/litho-staleness` round-trip
(clean → move a `formation_contact` → the column is named → re-press → clean); and
`tests/integration/db/test_project_bundle*.py` a round-trip pin that the map survives a
`.strix` save/restore (it rides the auto-enumerated column path, so this is a regression
guard, not new plumbing). Expected delta: assertions only, no fixture reshape.

**What (original).** `litho_layer` and the geotech bands derived from it have no dependency link. Drag
one litho contact and every geotech band inside that column is silently describing a
lithology stack that no longer exists. Nothing marks the geotech model stale, nothing warns,
and the UI keeps rendering the old bands as though they were current. The litho→3-D direction
already has this guard (`hasStaleGeotechSolid` / `hasStaleSolid`); the litho→geotech-bands
direction does not.

**How it surfaced.** Measuring tie re-anchor (#227) on the dev model: 204 of 217 accepted
ties survived a re-subdivide and 13 did not, all `interval_moved`, all on two columns
(`GEO-23/125-S17`, `GEO-23/125-S9`). The owner's objection was exactly right — the ties
should only break when an interval is edited, and none had been edited recently.

**The diagnosis, proven rather than inferred.** Feeding today's code the geo-bounded segment
windows that the STORED bands imply reproduces every stored band exactly, on both columns
(`scripts/diag_geotech_implied_litho_segments.py`). Same algorithm, earlier input. The
alternatives are dead, not merely unlikely:

| candidate | ruled out by |
|---|---|
| segmenter non-determinism | 44 columns / 338 segments reproduced bit-identically across separate processes under `PYTHONHASHSEED` 0 and 999983; no RNG, cache or global state in the segmenter |
| `.strix` bundle loss | all 943 litho-layer depths bit-exact through a round-trip, 0 drifted, 0 missing |
| older code / a different entry point | today's code reproduces the stored bands byte-for-byte given the old windows |
| geological surfaces moving the segment bounds | every moved contact is 1.8–5.1 m from the nearest geo surface |

**The provenance test that separates a hand edit from segmenter output.** Old boundaries sit
exactly on CPT sample depths (delta 0.0000 mm); the ones that replaced them are off-grid by
2.093 / 1.628 / 4.173 mm. Two single-column `formation_contact` writes on S17 at
`18:43:57.292444` and `18:44:02.738104` widened a peat from 0.36 m to 1.85 m — 90 minutes
after the restore that wrote the bands.

**A trap worth writing down: `created_at` here dates the RESTORE, not the work.** Every
project row shares one microsecond (`2026-07-28 17:13:46.210117`) because the project was
replace-restored from a `.strix`. "No litho layer touched since 07-28" was true and
completely vacuous, and it cost a full round of wrong theorising. Worse, `litho_layer.
depth_base_m` is DERIVED — the FC→LL trigger rebuilds it as `LEAD(depth_top_m)` and writes
the row's OWN contact timestamp, so moving a NEIGHBOUR's contact rewrites this row's base
and leaves its `updated_at` untouched (demonstrated in a rolled-back transaction on the
integration DB). **`updated_at` on `litho_layer` is not a depth-change signal.** Use
`formation_contact` timestamps. This is why S9's history could not be attributed either way.

**The 13 lost ties are correct behaviour.** Re-anchor did its job; those two columns' litho
stacks genuinely moved, so the intervals genuinely no longer match. The defect is that the
owner was never told the litho stack had moved out from under the geotech model.

**When to revisit (original).** Before the geotech stage is dogfed — an owner correlating
packing bands by hand needs to know when the ground under them has shifted. Cheapest shape
that matches the existing pattern: stamp the geotech model with the parent litho model's
revision at subdivide time and compare on load, reusing the `mark-stale` machinery rather
than inventing a second one. *(Followed, with the granularity moved from per-MODEL to per
COLUMN: CPT and borehole bands come from two different presses that each honour
`skip_existing`, so a model legitimately holds columns built from different litho revisions
and a single model-level stamp would let a borehole press clear the flag on a moved CPT
column — and "S17's litho changed after its bands were made" is the only form of the
message the engineer can act on.)*

## 267. Save As copies the lumping map into the file but not into the new DB slots — RESOLVED 2026-08-02

**Resolution.** `ProjectRepository.duplicate()` now carries
`stratigraphy_lumping_staged` / `_saved` / `_revision` **and** `view_state` onto the new
project (deep-copied, so the clone and its source never share a JSONB dict through the
identity map). Landed in the same change that wires the renderer to seed its lumping slots
from `ProjectResponse`, which is the moment the divergence would have become user-visible.
Pinned by `test_duplicate_carries_lumping_slots_and_view_state` in
`tests/integration/db/test_project_repository.py` (seen RED before the fix).

**What (original).** `ProjectRepository.duplicate()` (`project_repository.py:148`) clones the metadata
scalars + the CPT/borehole trees, but not `stratigraphy_lumping_staged` / `_saved` /
`_revision` (nor `view_state`, which pre-dates this entry and silently resets to `{}` via its
server default). Meanwhile the desktop's Save-As path writes the new `.gmproj` with the
in-memory lumping map injected. Result: the duplicated project's FILE carries the map while
its DB slots are NULL — exactly the split the two-slot design exists to prevent. On next
open the renderer seeds its slots from `ProjectResponse`, sees NULL, and shows no lumping
until the user re-applies; the recovery-reconciliation revision compare is also meaningless
for that project until the first fresh stage.

**Why deferred.** Found during review of the autosave/lumping-column work (2026-08-02); the
renderer half that seeds from `ProjectResponse` is not wired yet, so today nothing reads the
slots and the divergence is latent. Fixing it is a three-line copy in `duplicate()` plus a
decision on whether `view_state` should ride along (probably yes — a Save-As losing the
user's view toggles is the same class of surprise).

**When to revisit.** In the same change that wires the renderer to seed lumping from
`ProjectResponse` — that is the moment the divergence becomes user-visible.

## 268. Blending two section stacks cannot represent "unknown" — a void between them is closed up (RE-MEASURED 2026-08-26: mm-scale, reported on every build; the metre-scale numbers below were a broken ruler)

**Correction (2026-08-26, two independent re-measurements + a labeller-side
census).** The "4 interior voids, worst 2.420 m" this entry reports came from
`diag_section_stack_voids.py` walking stack entries pairwise across
zero-thickness seam slivers AND sampling 21 fixed fractions per gap that no
voxel column projects onto — both since fixed. Overlap-aware, column-true
measurement: the old payload had 0 real interior voids; the current geotech
payload has 6 distinct (section, gap) sites where `_layout` closes a void,
ALL millimetre-scale, worst **13.9 mm** at `GEO-10/117-B1 → GEO-05/040-S1`
(2,979 column-instances). Since 2026-08-26 the build REPORTS these on every
press (`LabelReport.layout_closed_voids`, WARNING) instead of hiding them.
The mechanism below is still real and the ruling on what an inter-section
void should look like is still open — but at today's magnitudes it is a
tripwired cosmetic, not a metre-scale defect.

**What.** `label_voxels._blend_stacks` matches the two nearest sections' bodies and hands the
result to `_layout`, which lays every entry out cumulatively (`base = cur - thickness;
cur = base`). A void is not an entry, so it contributes nothing and everything below it
shifts UP by the gap height. The two SIBLING paths now preserve voids — the beyond /
deferral path since 2026-08-03 (`_column_labels` labels an interval no entry covers `-1`
instead of extruding the body above it down through it), and the geology-band path via
`_column_labels_gapped`. The between-two-sections blend is the one place left where an
interval the 2-D partition deliberately left UNKNOWN comes back as material.

**Why deferred.** The fix needs a geological ruling, not a code decision. The owner's rule
(2026-07-30, quoted at `build_voxel_litho_model.py`) is *"the voids below td are always
filled through correlations from other tests the left or right (as in fill bands) if that is
not the case then you leave it unkown"* — which says what a SINGLE section means, not what
two sections mean when one says "clay here" and the other says "unknown here". The
candidate answers are all defensible and all different: (a) treat unknown as a body-less
interval that blends by thickness like any other, so the void narrows toward the section
that fills it; (b) let the known side win outright, i.e. the current behaviour but stated
on purpose; (c) let the unknown side win, so anything either section leaves unknown is
unknown between them; (d) hold the void at its own absolute elevations and blend only
around it. **Do not pick one without asking.**

**How big it is today.** It fires TODAY, on the geotech axis. Measured with
`scripts/diag_section_stack_voids.py` (slice every gap at 21 fractions, read the stack
`label_voxels._section_stack_at` itself reads):

| payload | sections | non-empty stacks | interior voids |
|---|---|---|---|
| `scripts/throwaway_v2_voxel_payload.json` (litho) | 14 | 1449 | **0** |
| `scripts/throwaway_geotech_voxel_payload.json` (geotech) | 12 | 1071 | **4** |

The four geotech voids are 2.420 / 2.318 / 2.216 m (section index 2, gap 3, fractions
0.55–0.65) and 0.345 m (section 2, gap 4). The first measurement of this item only swept
the litho payload, which is why it read "does not fire on the current model" — it does, and
the worst case shifts a geotech 3-D column up by **2.42 m**.

None of the four reaches `_column_labels`: instrumenting a full offline label of the geotech
payload counted 30 802 labelled columns, **0** with a gap over a millimetre. `_layout` closed
every one of them upstream — which is this item, observed directly rather than predicted. (8
columns carried a SUB-millimetre gap; those are the 2-D engine's snap rounding, and
`_column_labels` deliberately does not open a void for them.) The label grids are
byte-identical (SHA-256) across all three void-threshold variants, so the collapse is not a
build-output *change* — it is a build output that has been silently wrong on the geotech axis
all along.

**When to revisit.** Now, as a live wrong-geometry defect rather than a deferred design
question — but the ASK is unchanged: the four candidate rulings still need the owner. Ask
them one at a time, with a section screenshot of section 2 gap 3, before writing any code.

## 269. The borehole packing preview covers the first divide, not the re-divide (S)

**What.** `GeotechBoreholePreviewGhosts` drops all ghosts for a borehole column the moment
that column carries committed geotech bands, so the preview only ever helps BEFORE the
first `Divide boreholes`. Pressing the verb a second time is exactly as blind as it was
before the feature existed: `boreholesStale` turns the button amber to say the bands are
out of date, but nothing says what they would become — and the verb deletes and rebuilds
every borehole band when it runs.

That is a gap in the feature's own justification, which is quoted throughout the diff as
*"an idempotent-but-destructive rebuild the engineer has to press blind"*. The re-divide is
the destructive half.

**Why deferred.** Scope, not capability. The backend already plans an already-divided model
correctly and the parity gate proves it —
`test_db7_preview_between_two_divides_equals_the_second_divide` asserts the preview equals
what the second divide commits, and mutates none of the first divide's rows. What is
missing is a RENDER decision: a plan drawn over the committed rows it would REPLACE has to
read as a diff (outline-only against the existing bands, or a two-colour before/after),
because drawing it the way the first-divide ghosts are drawn would paint a solid hatched
band straight over the real one and be worse than showing nothing. Choosing that render is
a design question, and the ghost overlay is not the place to guess at it.

Stated explicitly in `docs/design/geotech-stage.md` §6 and in the component docstring, so
the limit is documented rather than discovered.

**When to revisit.** When the owner dogfeeds a re-divide on the real model and wants to
know what will change — most likely as soon as accepted packing ties start being redrawn
after a Subdivide. Design the diff render first (one owner question: outline-only over the
committed bands, or side-by-side), then wire it; no backend work is needed.

## 270. Delete the retired fraction-space refinement modules (S)

**RESOLVED 2026-08-14** (owner un-gated the deletion pre-dogfeed: "fix that
before i dogfeed"). The deletion campaign removed the four refinement modules
(`refineLithoPartition.ts`, `.overlap.ts`, `carveOverlayLenses.ts`,
`geotechPackingTies.ts`) + their 8 test files, and the superseded agreement
machinery (`geotechEngineAgreement.diag` + frozen baseline,
`geotechAgreementFreeze.{diag.ts,test.ts}`, `geotechVoidMechanism`,
`geotechInteriorVoid`, `geotechDefectTaxonomy`, `geotechFallbackCause`,
`geotechQ2Visual`, `geotechAgreementRefute`, `geotechEndStrip`,
`geotechDiscrAblation`, `geotechRenderArmRefute`) — 25 files. The
`geotechFillGap` diag keeps only its direct/fixed/litho variants;
`geotechVoxelPayload.diag` + `geotechFillFallback.ts` docstrings updated
(the fallback's 2 cm slop constant now cites the deleted refinement via git
history). The handoff doc was already gone. Git history is the fallback if
the dogfeed misbehaves. tsc clean; full desktop suite green minus the 2
pre-existing partitionFillV2 reds.

## 271. The v2 arrangement loses long shallow-angle proper crossings (M)

**RESOLVED 2026-08-14** (owner: "fix that before i dogfeed"). The tolerant
crossing-cut registration landed KIND-SCOPED: `intersect.ts` accepts a proper
crossing's snapped point as a cut when it lies within 1 grid unit of the
segment with its projection in range (`pointOnOrNearSegment`) — but ONLY when
neither party is a synthesized `closing` curve (flank/apex/substrate-bridge).
The unscoped version — the one reverted at ~05:00 — was retried first and
regressed 8 PartitionFillOverlay tests: a termination flank whose cut the
exact test used to eat (then stripped as a spur) suddenly engaged and split a
MATCHED tied boundary in two. Closing-curve engagement stays exact-only until
the two-sided-terminations cut-over, which owns that tolerance question.
Under the scoped fix the GAP-21 micro-void from the morning attempt does NOT
appear (it was a closing-curve artifact — no gate exclusion, and the
micro-face absorption question dissolved), the cs1 gates pass 8/8 unmodified,
holes/overlaps 0/0 on all 14 sections, and the consistency baseline moved by
exactly +0.01 pp on one section (Tie-section 14, re-frozen). Pinned by the
exact repro + the closing-scope negative in `arrangement.test.ts`.

## 272. The litho-consistency ratchet is inert — baseline frozen on stale model ids (S)

**RESOLVED 2026-08-18 late night** — baseline re-frozen on the live model
(96.67–100 % per section, CS1 98.77) right after the corner-sampler fix; the
ratchet enforces again. The id-keying residual (a future model wipe orphans
the baseline again) stays a known property: the gate SAYS "NOT COMPARABLE"
loudly rather than passing silently, which is how it was caught.

**What.** `geotechLithoConsistency.diag.test.ts` compares its frozen baseline by
model id, and the owner has since wiped and rebuilt the geotech model, so the
gate reports "NOT COMPARABLE — the baseline was frozen on different model ids;
enforcing nothing" and passes vacuously. Found 2026-08-18 by the F1 clean-onlap
agent, which had to measure consistency by hand instead (clipped: identical on
all 14 sections; raw: CS1 95.6 % → 96.9 % after the fix).

**Why deferred.** The fix is a re-freeze against the CURRENT model — a
deliberate act the ratchet exists to make deliberate — and today's dogfeed
round is mid-flight: freezing now would bake in a state the owner is still
correcting by hand.

**When to revisit.** The next session that touches `partitionFillV2` or the
geotech derivation: re-freeze the baseline first (or key the baseline on the
section NAMES instead of model ids so a model wipe cannot orphan it), and only
then trust the gate again.

## 273. Cross-family packing ties dropped silently (M) — RESOLVED 2026-08-21

**What.** Resolved in two halves, both on owner rulings. NEAR half
(tied-contact ruling, "two ties is two tied contacts"): a tie counts at
its in-family contact whatever family the far end belongs to
(`boundingEdges` + `resolveRunTies`). FAR half (mass-identity ruling,
*"yes one mass one body"*): the one remaining case — `Cross-section 1
col19 gap19 band 7.03..6.62`, pinned identically in three gates — turned
out to be the duplicate-formation-row defect, not a frame conflict: the
band's two ties land on another ZAND-5 sitting on a DIFFERENT formation
row (the subdivide keeps one row per (class, litho parent, GEOLOGICAL
parent)), and mass identity compared ROWS. With identity by CLASS
(`packingClassOf` in the fill + `packing_nad_class` in the DB resolver)
the pair welds, spans, and paints ZAND-5 beside col19's own log. All three
gate exceptions re-armed to zero the same round (210 all-zero ×14,
law-oracle 0 ×14, own-edge 0/1120). The same fix dissolved 8 mid-gap
vertical seams splitting same-class masses on CS1 (his "bug with vertical
lines" report) and un-split every body tied across a geological boundary.

## 274. Seam strokes double on same-class edges — the pale helper lines (S)

**What.** Owner dogfeed 2026-08-18 (B4|S13 screenshots): thin PALE lines
inside merged same-class masses on the geotech axis. The black litho
outlines got the soil-level dissolve (`lithoOutlineEdges.ts`); the
self-colour seam-stroke pass still strokes both sides of an edge shared by
two same-class regions, and the doubled 0.62-opacity stroke reads as a
line. Same treatment needed: classify shared same-class edges and stroke
them once (or not at all), keeping the hairline-closing behaviour on true
boundaries.

**Why deferred.** The hierarchical-fill harvest changed the region
inventory the same night; re-check which pale lines survive it before
touching the stroke pass.

**When to revisit.** First dogfeed after the hierarchical harvest — if the
pale lines survive on his screen, this is the next contained renderer fix.

**PARTLY RESOLVED 2026-08-21 (late night).** One family of pale line was
NOT a doubled stroke: the merged ring walked out to a wedge apex and back
along nearly the same path, and the stroke pass — finding no neighbour for
those two coincident edges — drew the detour as a hairline ending in
mid-region ("a boundary at the bottom but not at the top", his words).
Fixed in GEOMETRY, not in the stroke pass: `dropNeedleSpurs.ts` removes
out-and-back detours and whole sliver regions thinner than the snap grid
(four model-wide, 0.0016 m² between them). A geometric hole audit
(`geotechHoles.diag`, GEOTECH_HOLES=1, negative-controlled) confirms the
fill leaves ZERO unpainted ground, so any pale line that survives is a
stroke question and belongs to the remainder of this item.

## 275. Codebase-wide simplification / deletion campaign (L)

**What.** Owner directive 2026-08-21, during the constructive-fill round:
*"you are making a huge mess of the codebase by just adding code on top and
on top that is unnecessary"* → *"maybe we should run that pass on the whole
codebase in another session."* A dedicated session that sweeps the WHOLE
repo (backend Python + desktop TS) for accreted, superseded, and decorated
code — not a bug hunt, a deletion hunt. Known-suspect areas to seed the
sweep: leftovers of the geotech patch-layer era (any surviving refinement /
clip / matrix helpers outside `constructive/`), superseded engines still on
disk (the watertight loft builder parts), diag suites whose gate was
retired, one-caller helpers that restate their caller, and the #201
god-component remainder. Shape: parallel review agents per area
(reuse / dead-code / altitude), deletion lists verified against the full
battery (unit + integration via the wrapper + desktop + e2e), one file per
commit, net-negative lines as the success measure.

**Why deferred.** The constructive-fill round is mid-flight and already
carries its own scoped deletion mandate for `geotechHierarchicalFill/`;
overlapping a repo-wide sweep with an active build round would churn the
same files twice.

**When to revisit.** A fresh session after the constructive-fill round is
harvested and dogfed green — the owner fires it explicitly ("run the
simplification campaign").

## 276. Canvas module-refs are never nulled on unmount — stale-closure hazard — RESOLVED 2026-08-28

**What.** The canvas ⟷ toolbar bridges are module-level mutable refs
(`lithoVoxelRequestCallback`, `geotechVoxelRequestCallback`,
`resetLithoCameraCallback`, `resetGeotechCameraCallback`, and their split
siblings — see `GeotechnicalCanvas.tsx`'s module header). They are assigned
every render while the canvas is mounted, but most were **never nulled on
unmount** — so after a stage switch the ref still held a closure over the
LAST render's props. A toolbar click that fires before the next canvas mount
ran against a destroyed view's state. Proven a real hazard during the
D-Series toolbar wiring (B3, 2026-08-27): the fence-export ref got an
explicit null-on-unmount `useEffect` for exactly this reason — the pattern
the others still lacked.

**Fix (landed 2026-08-28).** Every bridge ref is now nulled on the owning
component's unmount, GUARDED against the mount-order race. The guard is the
load-bearing part: React can mount a replacement canvas before it runs the
previous one's cleanup (and both stages can be alive at once in the split
viewport), so a naive `ref.current = null` on unmount would wipe a ref the
newer instance already claimed. Each cleanup instead compares against a
per-instance `useRef` of the value THIS instance last wrote and nulls only on
identity match. The fence-export precedent (and the hook's async voxel null)
were unguarded — both were upgraded, not copied. Per-ref outcome:

* **fence / voxel** (`lithoFenceExportCallback` / `geotechFenceExportCallback`,
  `lithoVoxelRequestCallback` / `geotechVoxelRequestCallback`): guarded null in
  the canvas that writes them (`LithologyCanvas.tsx` / `GeotechnicalCanvas.tsx`).
  The voxel ref's unmount null moved OUT of `useBody3DViewState` — the shared
  hook could not guard a value it does not write, so the whole voxel-ref
  lifecycle now lives in the canvas and the `voxelRequestRef` param was removed
  from the hook.
* **split-viewport** (`resetLithoSplitViewportCallback` /
  `resetGeotechSplitViewportCallback`): guarded null in the canvas via the
  `exitSplit` value the hook writes and returns (kept out of the shared hook so
  the Geology / Parameters consumers are untouched).
* **recompute / divide** (`sectionsBodyRecomputeCallback` /
  `sectionsDividePartitionCallback`): guarded null in `useProjectBodyRecompute`.
* **camera** (`resetLithoCameraCallback` / `resetGeotechCameraCallback`): already
  nulled on unmount by `CesiumViewport` (co-located with its assignment); left
  as-is. Geology's own `resetCameraCallback` / `resetSplitViewportCallback` and
  the two `shell/stages/sections/` reveal bridges are the same class of ref but
  out of this fix's scope — a follow-up if a cross-stage stale click surfaces.

Red-first pins: `LithologyCanvas.test.tsx` U1/U3, `GeotechnicalCanvas.test.tsx`
GU1/GU3, `useProjectBodyRecompute.test.ts` R1/R2 (split-never-nulled and the
mount-order wipe, both watched RED on the old code); U2/U4/GU2 are guards.

## 277. The litho and geotech engines snap-round independently (M)

**What.** The two engines each perform their own snap-rounding pass onto a
1 mm grid — the litho partition in `partitionFillV2` (`snap.ts`: one pass,
every input vertex AND every computed intersection, so the arrangement walk
downstream is exact integer arithmetic), the geotech fill in its own
`frameClipGeometry` arrangement. Wherever the geotech subdivides a SLOPING
litho contact it must state where its cut lands on that contact, and that
elevation is generally not on the grid. Rounding it produces a polyline that
bows up to half a millimetre off the straight line the litho drew between the
same two columns, and the area between the two descriptions is a hairline
sliver.

Measured on the owner's real model 2026-08-31 (`__GEOFILL_SAVE()` dumps of
CS1/CS2/CS3, replayed offline):

| Section | unpainted | painted outside | widest patch |
|---|---|---|---|
| CS1 (24 col) | 0.1315 m² | 0.0543 m² | 0.5 mm across |
| CS2 (24 col) | 0.0404 m² | 0.0280 m² | 0.5 mm across |
| CS3 (10 col) | 0.0220 m² | 0.0134 m² | 0.2 mm across |

The canonical case is CS1 gap 3: the contact runs +7.509 m to +5.21 m, the
geotech cuts at mid-gap, and (7.509 + 5.21) / 2 = **6.3595** — exactly on a
half-millimetre, so it can only be written 6.359 or 6.360. What is left is a
real grid-aligned triangle 90 m long and 0.5 mm thick. Gaps whose contacts are
horizontal, or whose cut lands on a grid value, read EXACTLY zero — which is
what proves the mechanism is rounding and not a modelling defect.

Neither model is internally wrong: every geotech region shares full edges with
its neighbours, and so does every litho region. The sliver exists only when one
model's boundary is laid over the other's.

**Two structural cures, both real engine work:**

* **B — the geotech copies the litho's own segment** wherever it borders it,
  instead of re-deriving where its cut lands.
* **C — one snapping pass for both engines**, so a shared point is computed
  once. Kills the class permanently; the larger change.

**What was tried and does NOT work** (do not re-attempt without new tooling —
all three threw on the owner's real data):

* `GeometrySnapper` to give both covers each other's vertices →
  `TopologyException: side location conflict`.
* A millimetre `PrecisionModel` on the overlay → does not collapse the sliver
  at all (its corners are already grid-aligned), and throws on CS1 gap 19.
* Inserting the shared vertex structurally, moving nothing →
  `IndexOutOfBoundsException` in `OverlayOp.replaceCollapsedEdges`.

The root obstacle is that this jsts build ships only the legacy `OverlayOp`;
JTS's robust replacement (`OverlayNG`) is absent. Landing B or C may well want
a jsts upgrade first.

**Why deferred.** Sub-millimetre. The voxel model is built at 0.25 m cells, so
the worst patch is 500× smaller than one voxel, and 0.13 m² against CS1's
~18,200 m² of cover is 0.0007 %. Nothing downstream — 3-D build, exports,
statistics — can see it. Both cures touch the shared fill engine, putting the
CS1 golden master and the 33 loop scenes in the blast radius, for no visible
gain. Owner directive 2026-08-31: *"write it down for after mvp that we can
have a crack at resolving this."*

Clause 1 of the gapless gate no longer cries wolf about it: it asks whether any
difference has real WIDTH rather than comparing areas (`clauses2d.ts`,
`realGroundM2`), so a hairline is silent while a real hole is reported at full
size. That makes this a latent representation issue, not a reporting one.

**When to revisit.** After v1.0 ships. Bring it forward if ANY of these fire:

* A cross-section is built whose gaps exceed ~100 m. Clause 1's threshold is a
  fixed half-cell (0.5 mm) because a width-scaled one grows without bound; it
  covers the x grid only while `SNAP_GRID_M / FRACTION_SCALE / 2 * width` stays
  under 0.5 mm, i.e. width ≤ 100 m. The widest gap in today's model is 98 m,
  so this margin is nearly spent.
* `SNAP_GRID_M` or `FRACTION_SCALE` changes in either engine.
* Any downstream consumer starts working below the millimetre.

**Tooling.** `desktop/src/renderer/src/utils/coverDiffShape.diag.test.ts`
(dormant unless `COVER_DIFF=1`, reads `scripts/geofill_live_dump.json`)
decomposes every clause-1 difference into its pieces and reports each one's
size, shape, side and true width. It is what produced the table above and is
the acceptance instrument for B or C.

## 278. Body identity is decided by the machine, from the wrong picture (L)

**STATUS 2026-09-01 — LARGELY LANDED (overnight slice, ~115 commits on
develop).** Built and gated green: R6 (geotech recompute identity from the
litho-framed hierarchical fill — `framedGeotechFill.ts`, frame plumbing in
`buildBodyRecomputePayload`/`makeBodyRecomputeBuilder`/`useProjectBodyRecompute`);
R7 (`_spans_at_fraction` true-interval reach, degenerate-safe); R1 (find-or-create
keys drop the geo term; backend cross-section planners class-keyed via
`packing_class_key.py` — this was ALSO the 3-D `_blend_stacks` invented-lithology
mechanism); D1 `body.parent_litho_body_id` stored self-FK, resolver-maintained
(geotech resolve stamps shallowest-member; litho resolve re-stamps siblings under
BOTH partition locks); R2 (bodies list every crossed geo formation — additive
API, menu header, units-pane subtitle, optional export Geo column); R5 Separate
verb (constrained union-find with cannot-link `body_separation` rows —
layer-id space, re-anchored across re-subdivide, bundled + .strix-whitelisted;
litho-axis arm gesture + Rejoin); fence one-panel-per-connected-body-per-section
(`mergeFencePanels.ts`); #279 item 1 (nonce-stamped body-menu arming gate,
`useRosterLoadedGate.ts`).

**2026-09-02 — the machine tie path now carries the litho-frame WARNING.**
`AutoCorrelateGeotechEdges` restates a direct top-to-top litho tie onto the
packing bands regardless of class (2026-08-13), so a cross-soil litho surface
tie silently proposed the cross-soil packing tie the hand path would flag. It
now runs the SAME shared resolver as the hand path
(`application/litho_frame_conformance_resolver.py`, extracted from
`correlate_litho_contacts.py`) after the crossing/off-section sweeps and stamps
`review_reason='frame_mismatch'` on this run's non-conforming NEW ties — WARNS,
never refuses (a restatement is legitimate; no `shares_litho_body` refusal is
added to the machine path). Logs the flagged count (`frame_flagged` in the run
+ the `AutoCorrelateGeotechResponse`). Integration `test_auto_tie_frame_warning.py`
(AT1 cross-soil restatement lands flagged, AT2 conforming run flags nothing);
design note geotech-stage.md §4b-i.

**Still open on this entry:**
* ~~R3 twins migration~~ — **EXECUTED against the dev DB 2026-09-01 with the
  owner at the keyboard** (dry-run previewed, pg_dump taken to
  `.backups/groundmodel-pre-twins-2026-09-01.dump`, branch merged, `alembic
  upgrade head` run). Verified after: 0 twin groups remain, 56 losers deleted,
  604+604 layers/contacts + 164 solids re-pointed, 170 bodies renumbered
  dense, 234/234 unique body keys hold. The sync-script guard is removed.
* **Geotech-axis body menu** (Separate on the geotech axis) — needs an owner
  ruling: the axis is view-only by several rulings; menu-body resolution +
  stats routing are undesigned. The arm plumbing is already axis-agnostic.
* **Visual mark for a standing separation** (ux flag, owner dogfeed call) and
  a Rejoin-list overflow bound (menu height) — deferred to dogfeed.
* **crossFamilyWeld × merged-panel formationId**: a cross-family-welded body's
  fence panel now carries ONE member's formationId across the whole wall —
  cutout filter / legend "walled" mark / DXF layer credit only that formation.
  Enriches the standing EYEBALL-ONLY item; change nothing until seen on screen.

Original rulings (2026-08-31) kept below for the record.

**What.** Seven rulings taken 2026-08-31 that only make sense together, because
each one is about the same question: what IS one body?

1. **Collapse the geo label from geotech unit identity.** One connected body =
   ONE row, with an FK to its litho parent. `BodyOrm` is already
   one-row-per-connected-body (234 rows) and the litho link exists at BAND level
   (`parent_litho_layer_id`), so the gap is roughly one additive column
   (`parent_litho_body_id`). MEASURED cost of not doing it: **775 of 898**
   visible fence seams are geo-label twins — same soil, same NAD class, split
   only by the formation row — and 32 unit rows collapse to 15.
2. **A body crossing two formations LISTS them both**, not a majority stamp.
   Variable-length labels in the units pane and exports are accepted. The
   derived midpoint/majority stamp (GP1-GP7) stays as the per-BAND attribution;
   this is about what the unit ROW says.
3. **A one-time Alembic migration merges the existing twins** on upgrade —
   explicitly NOT heal-on-next-press. It rewrites rows the owner did not touch
   and he accepted that.
4. ~~A point contact does not weld.~~ **RETRACTED 2026-08-31, same day.** It
   contradicted ruling 8l (2026-07-17), which `mergeTouchingBodies.ts` states
   verbatim: two facing onlaps meeting at the 0.5 apex share that vertex and
   MUST weld — one band thinning to nothing, not two bodies. Shown the clash the
   owner ruled *"8l wins — leave welding as it is"*. **The weld rule does not
   change.**
   The sand #19 over-fusion (three stacked NAD-6 sheets, split by NAD-7 partings,
   amalgamating only 25-35 m away) is STILL OPEN and wants a different fix. His
   hint: *"for example by only welding within the same soil layer"* — scope the
   weld, do not delete it. Investigate before building; do not invent the scoping
   rule.
5. **Build a "Separate" verb** — the counterpart to Dissolve, so he can state
   "these two are NOT the same body" and have the resolver honour it
   permanently. His standing ruling has two halves (*"a body is only a body if
   it is geometrically connected, or if the user says this body is the same as
   that body"*) and only Dissolve exists, so today the machine can overrule him.
6. **Geotech body identity is computed from the LITHO fill.**
   `makeBodyRecomputeBuilder` serves BOTH kinds ("litho / geotech"), and both go
   through `buildBodyRecomputePayload`, which calls
   `computeSectionFillActiveWithIdentity` — the litho v2 engine. So for a GEOTECH
   model, which masses count as one body is decided from the litho picture,
   while the 2-D screen, the 3-D build and the fence all show
   `computeHierarchicalGeotechFill`.
   ⚠ Wording correction (2026-08-31): an earlier version of this entry called it
   "the older direct-v2 engine". That is wrong and would send someone hunting a
   version difference. `buildBodyRecomputePayload`'s own header is explicit that
   it deliberately shares the voxel build's frames "so the identity geometry can
   never drift from the built geometry — the engine CALL is what differs", and
   the identity entry point exists for real reasons: it returns the weld's merge
   GROUPS in layer-id space (body ids oscillated in production, 2026-08-12) and
   it excludes fallback paint. Any fix must preserve BOTH of those.
7. Also in scope: the `_span_at_fraction` envelope over-union in
   `merge_bodies_across_sections.py:80-111`.

**Why it is one slice.** 5 and 6 change which masses resolve to one body (4 was
retracted, but its subject — the sand #19 over-fusion — still wants a scoping
rule, and 5 is the only way to undo a weld until it exists); 1, 2 and 3 all change how that body is named and stored. Landing them
separately means re-deriving bodies several times and re-migrating rows, and
each intermediate state is one the owner would have to dogfeed and judge.

**Fence follow-on.** With 1 landed, also emit one panel per connected body per
section — the remaining 123 vertical seams are the per-gap panel split, a
separate fix in the fence builder. Identifier-keyed DXF layer naming already
shipped and does NOT help here: twins share a layer but are still two panels.

**Why deferred.** Not deferred by preference — it is the next substantial slice
after the geotech stage settles. It is recorded here because it is large,
cross-cutting (desktop resolver + backend merge + an Alembic migration + a new
verb + its UI) and because the seven rulings would otherwise live only in
`CLAUDE.local.md`.

**When to revisit.** Next, once the constructive-fill round is harvested. Do NOT
start it piecemeal: the migration in 3 is only safe once 4 and 6 have settled
what a body is, or it will merge rows the new rules would have kept apart.

## 279. Two menus share one cursor, so you cannot tell which you will get (S)

**What.** `PartitionFillOverlay` answers right-click on a fill region with EITHER
the body menu (Dissolve / Name / colour) or the unit-statistics menu, and gives
both `cursor: context-menu`:

```
interactive     = Boolean(onBodyContextMenu && bodyById.get(region.bodyId)) && !viewOnly
statsInteractive = unitStatsHandlerForAxis !== undefined && !interactive
style            = interactive || statsInteractive ? { cursor: 'context-menu' } : …
```

So which menu a region gives depends on whether the BODY LIST (`bodies={lenses}`,
`SectionPanel.tsx:3543`) has arrived, and nothing on screen distinguishes the two
states. Before it lands, right-click silently yields the statistics menu.

**How it surfaced, and the correction that matters.** This made
`flow_body_actions_ui > Dissolve body` red. The spec had been immunised against
the ORIGINAL body-list race in `c9f6313b2` by waiting for a region with
`cursor: context-menu` — which used to prove the list had loaded. When the
unit-statistics jump landed (R2/S7b, 2026-08-27) and started setting that same
cursor, the guard stopped proving anything and the old race came straight back,
merely disguised. FIXED 2026-08-31 in the spec: it now retries the right-click
until the BODY menu opens, which is the only question that actually matters.

⚠ An earlier version of this entry blamed the two branches resolving the body
differently (`bodyById.get(region.bodyId)` vs `resolveRegionBodyId(layerIds, …)`)
and proposed making them match. That was TESTED and is REFUTED — it changed
nothing, because `bodyById` is empty while the list is in flight, so no
resolution path can find a body. The asymmetry is real and still worth knowing
(`regionBodyId.ts`'s own doc calls `region.bodyId` a label the recompute
rewrites), but it is NOT what caused this.

**What is still open.**

1. **The shared cursor is a genuine UX wart.** ~~A user cannot predict which menu a
   right-click gives, and during load they get the wrong one with no explanation.~~
   **ADDRESSED 2026-09-01 with #278:** `useRosterLoadedGate.ts` stamps the
   recompute nonce the roster loaded at, so the body menu arms only once the
   list is in — covering BOTH the cold-start race and the post-recompute window
   (the gate goes false synchronously on a nonce bump; the stats menu is the
   deliberate answer in that window). The owner's original in-flight repro is
   still wanted as confirmation on real data.
2. **The menu's items fail Playwright's actionability check** — the item is
   visible (the whole menu is in the failure screenshot) but a real `.click()`
   times out; the spec now dispatches instead. Most likely an SVG-portal
   hit-testing artefact (`ContextMenu portal="svg"`) rather than a user-facing
   defect, since the owner uses Dissolve daily — but that is an inference, not a
   measurement. Verify before trusting it.

**When to revisit.** Item 1 with the body-identity slice (#278), which may change
when the list is available anyway. Item 2 the next time anyone touches
`ContextMenu`'s SVG portal.

## 280. Archive the v1 partition engine — RESOLVED 2026-08-31 (M)

**Owner ruling 2026-08-31:** *"archive the first faulty engine. the new one is
de standard."* Four sub-rulings taken the same day: full separation (move the
shared types out, delete v1 outright), delete v1's own tests with it, retire the
A/B tooling, and strip the `STRIX_PARTITION_V2` env flag.

Context already in the code: `partitionEngineSelect.ts` quotes him from
2026-08-27 — *"dit is niet meer experimenteel maar de main engine"* — and v2 has
been the measured default since 2026-08-01 (drilled gate identical at 54 exact /
0 wrong; p90 contact error 0.125 → 0.123 m; worst 5.335 → 3.145 m; mesh 1.5 %
smaller).

**MEASURED SURFACE — this is a refactor, not a delete.**

* Every one of ~228 import sites goes through the BARREL (`./partitionFill`,
  `../partitionFill`, …). Nothing outside reaches into v1's internals, so the
  specifier change is mechanical.
* `computeSectionFill` — the v1 engine itself — has NO live callers. Only the
  selector's fallback branches and the three A/B diagnostics being retired.
* BUT the barrel mixes the dead engine with live code. Five functions and the
  whole type vocabulary survive and are embedded in v1's largest files:

  | Survivor | Lives in | Used by |
  |---|---|---|
  | the type vocabulary (`SectionRegion`, `PartitionColumn`, `CorrelationEdge`, `PartitionPoint`, `PartitionRegion`, `PartitionUnit`, `LensApexOverride`) | `types.ts` (+ `SectionRegion` in `sectionResolve.ts`) | ~190 uses app-wide |
  | `matchColumns`, `classifyTermination` | `matcher.ts` | v2 `emitBands` / `emitIntervals`, `ColumnFindBar` |
  | `collapseAdjacentSameFormation`, `computeBottomTieLine` | `columnReduce.ts` (39 KB) | v2 `sectionGeom`, `emitCurves` |
  | `computeUnderColumnSubstrate` | `sectionResolve.ts` (79 KB) | `PartitionFillOverlay` |
  | `regionArea` | `regionArea.ts` | the gapless gate, others |

  `computeUnderColumnSubstrate` is 120 lines and needs only
  `slicePolygonAtFraction` + `stackAtEdge`, so extraction is tractable.

**PLAN — three independently verifiable steps, in order.**

1. **Make v2 unconditional.** Delete `isPartitionEngineV2Active`,
   `setPartitionEngineV2`, `usePartitionEngineV2`, the env parse, the
   localStorage pref and the subscriber set; the three `computeSectionFillActive*`
   entry points call v2 directly. Drop the `engineV2` return flag and the
   `engineV2` parameter threaded through `usePartitionGhostHandles`. Remove the
   Settings toggle (`SettingsDialog.tsx:484`) and its two i18n keys. Clean the
   test harnesses that call `setPartitionEngineV2` (many sites in
   `PartitionFillOverlay.test.tsx`, `PartitionFillOverlay.conflictKeys.test.tsx`)
   — ⚠ check whether any of those deliberately assert V1 rendering rather than
   merely resetting a default that has since flipped.
2. **Delete v1's tests and the A/B tooling.** The 13 `partitionFill.*.test.ts`
   files (including the CS1 gates and goldens — superseded by the CS1 golden
   master), plus `partitionFillV2.parity.diag.test.ts`,
   `partitionFillV2.parityCoverage.ts`, the v1 arms of
   `shapeaudit.diag` / `zerocorr.classify.diag`, and
   `scripts/diag_engine_fidelity_ab.py`.
3. **Extract the survivors, then delete `partitionFill/`.** New
   `utils/sectionPartition/` holding the types, the five functions and
   `regionArea`, with a barrel exporting the same names; rewrite the ~228
   specifiers; delete the old directory (`carve.ts`, `clip.ts`, `emit.ts`,
   `polygonBuilders.ts`, `disjoint.ts`, and the dead bulk of `sectionResolve.ts`
   / `columnReduce.ts`).

**RESOLVED 2026-08-31, same day, all three steps.** v2 unconditional (selector
flag machinery, Settings toggle, env override, engineV2 plumbing and the two
v1-only off-engine overlay passes deleted; the overlay lost ~240 lines);
v1's 13 suites + the A/B tooling deleted; the survivors extracted to
``utils/sectionPartition/`` (types, matcher, closeColumnGaps +
collapseAdjacentSameFormation + computeBottomTieLine, SectionRegion +
slicePolygonAtFraction, regionArea) and ``partitionFill/`` deleted — ~200
import sites rewritten mechanically. Gates at every step: tsc web+node clean,
full desktop suite green (finally 4901 passed / 0 failed, CS1 golden master
included). Two notes that outlive the work: (a) ``parityCoverage`` STAYS
despite its name — the conformance classifier, CS1 gates and f1gate import
it; (b) FD1's deletion records a REAL v2 capability gap — the two-node
contact bend only v1 performed (v2's contact free-draw is single-node by
design); owner call if multi-node contact freedraw is ever wanted. The
``overlay_tier`` wire field is now written by nothing (v1's vocabulary) —
drop it from the payload/backend at the next voxel-contract touch.

## 281. Faulting + overturned folds (post-MVP geological modelling) (L)

Owner asked 2026-09-01 to record the scope of adding structural discontinuities.
They are TWO problems of very different difficulty, and the target geology sets
different triggers for each.

**Faults — bounded, reuses the existing surface machinery.**

* **What.** A fault is a discontinuity that OFFSETS the formation surfaces across
  it. Model it as a fault SURFACE (not a single strike/dip — a fault curves in
  map view and its dip varies): pick its trace on the cross-sections where a
  contact jumps, correlate the picks into a fault surface, project the trace to
  the map, let dip vary along it. The voxel builder treats it as a hard break
  between fault blocks, each block carrying its own surfaces. It lives at the
  GEOLOGICAL level (faults offset formations; litho/geotech inherit the bands).
* **Why deferred.** Not a v1.0 gate item (v1.0 is the litho→geotech→export
  pipeline). At site scale a fault crossing the footprint is uncommon, and the
  current per-formation-domain model can often approximate it.
* **When to revisit.** When a customer hits a faulted footprint, OR as a
  deliberate Phase-5 differentiator. Real market anchor: the published
  known-faults map of Flanders. Effort: weeks (bounded — every piece reuses
  surfaces / cross-sections / map that already exist).

**Overturned folds — a different engine; do NOT build for Flanders.**

* **What.** An overturned fold makes a surface MULTI-VALUED — a vertical
  borehole pierces the same contact twice. That breaks the single foundational
  assumption of the whole current stack: `z = f(x,y)` single-valued top surfaces
  (TIN), voxel-COLUMN labelling (one stack per x,y), and the borehole
  depth-series model (a log would repeat a formation top-to-bottom). Supporting
  it needs a true implicit 3-D engine (signed-distance / radial-basis, the
  Leapfrog approach) — a re-architecture of the surface + build layers.
* **Why deferred.** Flanders has no overturning folds (owner, a geotechnical
  engineer, confirms), so zero target-market need for the current market.
* **When to revisit.** ⚠ NOT "never." **The concrete trigger is expansion to
  southern Belgium / the Ardennes** — Variscan-folded Paleozoic terrain where
  overturned folds are real. Owner (2026-09-01) calls the Ardennes a "logical
  expansion" and expects to "need the overturned folding sooner than later" once
  that expansion happens. Effort: months + a new implicit modelling engine —
  scope it the moment the Ardennes market is on the roadmap, not after.

**2026-09-02 — the electron-vite config was dormant.** `desktop/electron-vite.config.ts`
(hyphen) was never loaded: electron-vite 3.x resolves `electron.vite.config.*` (dot).
Every dev run, e2e build and installer so far ran on the defaults, and worked, because
`src/renderer/src/main.tsx` sets `window.CESIUM_BASE_URL` and `scripts/copy-cesium.mjs`
ships the assets. Replaced by a MINIMAL dot-named config carrying only the second
renderer entry (`sheet.html`). The old file's Cesium define/intro, the React plugin and
the Cesium dev-server plugin were never in effect; activating them would be a deliberate,
verified change (git history has the file). Folded into #200.
