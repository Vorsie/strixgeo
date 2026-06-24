# Geotechnical stage — Slice 1 design

**Date:** 2026-06-23
**Status:** approved in brainstorming; reviewed by system-architect / staff-engineer / ux-reviewer / product-strategy-advisor; ready for an implementation plan.
**Phase:** 4 — v1.0 commercial MVP gate, step 4 (geotechnical subdivision).

---

## 0. REVISION 2026-06-23 — BODY-CENTRIC subdivision (supersedes the per-test interaction below)

Owner directive during the Phase-D UI brainstorm: **subdivision operates on whole
litho BODIES, not test-by-test.** The litho stage already produces connected
bodies (correlated across tests via correlation edges + the resolver's
``body_id`` + partition-fill); geotech refines those, so the packing sub-units
inherit the body's connectivity automatically. This folds the
horizontal-correlation work (formerly "Slice 2") into the core flow.

- **Headline gesture: "Subdivide all bodies"** — one action over the whole model.
  Per-test suggest/accept ghosts are OUT (that was the fragmentation trap).
- **Cross-test packing-variation policy = option B:** where packing changes
  *with depth consistently across a body's tests* (loose-shallow → dense-deep),
  split the body into connected geotech sub-bodies at the interpolated
  packing-transition surface. Where variation is *lateral only* (different
  packing at the same depth across tests, no consistent vertical transition),
  assign ONE representative NAD class to the whole body (median/dominant across
  its tests). Full lateral interfingering (option C) stays Phase 5.
- **Manual depth/boundary adjustment of the result is DEFERRED** (owner: "worry
  about that later"). Slice 1 = the automatic body-centric subdivision + render.

**Impact on the already-built backend (Phases A–C, on develop):**
- **Reused as-is:** the NAD classifier (A1/A2, real NAD-NEN thresholds), the
  per-segment qc segmenter (A3), the geo-bounding skeleton build (C1), the
  find-or-create-by-full-triple + skeleton/orphan persistence machinery (C2b),
  the dual-ref FK migration (B), the API scaffolding (C3).
- **Reframed:** the per-investigation ``SuggestGeotechSubdivision`` (C2a) + the
  per-segment accept GESTURE become the *compute substrate* for a new
  **``SubdivideAllBodies``** use case that (1) groups the geo-bounded segments by
  litho ``body_id``, (2) classifies each test's qc per body, (3) applies policy B
  to decide split-surface vs representative-class, (4) persists connected geotech
  sub-bodies. The per-test "suggest → accept ghost" endpoints stay (useful for a
  future single-body re-classify) but are no longer the headline path.
- **Frontend (Phase D, not yet built):** D3/D4 are body-centric — a "Subdivide
  all bodies" toolbar verb + connected body-band rendering (reuse the litho
  partition-fill/band overlays), NAD packing-name labels + "CPT est." badge, the
  no-qc/manual band state, the build-then-subdivide gate. No per-test ghost-accept UI.

The B-policy aggregation is the key NEW algorithm — designed in §0.1.

## 0.1 B-policy algorithm — `SubdivideAllBodies`

**Grouping.** The unit of subdivision is a **`(litho body_id, geo_formation_id)`
group**: the set of C1 geo-bounded segments, across tests, that share the same
litho `body_id` (resolver connected-component, from `load_body_picks`) AND the
same geological formation. This is one connected, single-lithology, single-age
region — the thing the user thinks of as "a body". (A litho body straddling a geo
boundary yields two groups, one per geo band — correct, since they carry
different `source_geo_formation_id` identity.)

**Per group:**

1. **Per-CPT packing profile.** For each CPT member, run the A3 segmenter
   (`suggest_geotech_subdivision`) on that CPT's qc within the group's depth
   range → an ordered, min-thickness-merged list of packing **bands**
   (los/matig/dicht/zeer-dicht, or the fines bands) top-to-bottom, each with its
   transition depth + the precise NAD class. Borehole members contribute no
   profile (no qc).

2. **Consensus test.** Compare the CPTs' ordered band sequences:
   - **Consistent** ⟺ the CPTs share the same ordered band sequence (a CPT that
     bottoms out early — fewer bands — is allowed to match a *prefix* of the
     longer sequence, the too-shallow case). → split into connected sub-bodies,
     one per band position.
   - **Not consistent** (different band orders, or a band appears/vanishes
     mid-sequence — lateral-only variation) → ONE representative class for the
     whole group, no internal split.
   - A group with exactly ONE CPT: that CPT's own profile IS the split (no
     cross-test consensus needed). A group with ZERO CPTs (borehole-only): one
     carry-through unit, `nad_class=None` (manual later).
   - v1 consensus is on the coarse packing **band** sequence (not the exact NAD
     number), after A3's min-thickness merge, so qc noise / ±1-class jitter
     doesn't break consensus. *(Open refinement: a fuzzier "±1 band" tolerance —
     v1 is exact-band-sequence; revisit if real data is too strict.)*

3. **Split surfaces (consistent case).** Sub-body *k* spans band position *k*
   across all the group's tests. The boundary between sub-body *k* and *k+1* is a
   **correlated geotech contact surface**: one contact per contributing CPT at
   that CPT's *k→k+1* transition depth; boreholes and too-shallow CPTs get a
   contact interpolated from the neighbouring CPTs (reuse the litho
   TIN/contact-correlation machinery). The sub-bodies are thus connected across
   the group's tests by construction.

4. **Representative NAD class.** Each sub-body (or the whole group in the
   one-class case) gets the **thickness-weighted dominant** NAD class across its
   contributing CPTs over its depth range (mode by summed thickness; tie → the
   denser class). *(Open: dominant-vs-median — v1 = thickness-weighted dominant.)*

5. **Persist + connect.** Write the geotech contacts at the split surfaces +
   find-or-create the classified `geological_formation` by the full triple
   `(nad_class, source_litho_formation_id, source_geo_formation_id)` (reuse C2b's
   machinery), then run the resolver on the geotech model so the sub-bodies get
   their own geotech `body_id` (connected). Single transaction; idempotent
   re-run (delete+rewrite the model's geotech contacts, like C1).

**Reuses:** A3 (per-CPT packing profile), the NAD classifier (A1/A2), C1's
geo-bounding + body_id stamping, C2b's find-or-create-by-triple + skeleton/orphan
persistence, the litho TIN/contact-correlation + resolver. **New:** the consensus
test (§0.1 step 2), the representative-class aggregation (step 4), the
split-surface interpolation across a group's tests (step 3).

**Open design questions to confirm at build time:** (a) consensus tolerance
(exact band sequence vs ±1-band fuzzy); (b) representative metric (dominant vs
median); (c) how aggressively too-shallow / single-CPT groups should still split
vs fall to one class. v1 defaults are stated above; they're the safe starting
point and the real-data eval (run on `test.strix` against the owner's manual
NAD marks, à la `strix-suggestion-eval`) is the arbiter.

### AS BUILT — 2026-06-24 (Option A, on `develop` unpushed)

**Option A shipped:** geotech bodies are materialised via the litho machinery
applied to the geotech model — geotech `litho_layer` rows (`status='accepted'`)
+ `litho_contact_correlation_edge` rows + `ResolveLithoInstances` → `body_id` +
`BodyOrm`. Step 5 ("run the resolver on the geotech model") is exactly what
shipped.

**The single most important correctness constraint confirmed at build:** geotech
correlation edges are derived **same-band-position-only** (loose↔loose,
dense↔dense). The resolver's one-lithology invariant groups connected components
by `litho_main_soil_code`, which is identical for loose vs dense sand. Without
the same-position restriction the resolver over-merges different packing classes
into one body. SAB-7 pins this in the integration tests.

**Build-time design questions resolved:**
- (a) Consensus = **exact band-class sequence** after A3's min-thickness merge;
  shorter sequences may prefix-match a longer one (the too-shallow case). Validated
  healthy on `test.strix` (14 sections, 273 body groups: 20 % consistent-split /
  73 % one-class / 7 % borehole-only; 20 % split rate among 250 CPT-bearing
  groups, no ±1-band relaxation needed).
- (b) Representative class = **thickness-weighted dominant**, tie → **denser**
  (higher NAD number). Shipped.
- (c) Too-shallow CPTs prefix-match; single-CPT groups use their own profile as
  the split; zero-CPT groups carry through as `nad_class=None`.

**Two real-data-only bugs found by E5 eval + fixed:**
1. Duplicate geotech edges on geo-band-straddling investigations (a group where
   one investigation straddles a geo boundary was counted twice in the edge
   derivation → `UNIQUE` violation). Fixed by deduplicating edges before INSERT.
2. C1-direct `FormationContact` rows conflicting with the idempotent reset
   (the reset deleted geotech layers but left behind the C1-derived skeleton
   contacts, causing FK violations on re-run). Fixed by also purging C1 FC rows
   in the reset step before rewriting. Both bugs are pinned by regression tests.

---

## 1. Context & goal

Take the finished **lithostratigraphic** units and subdivide them by **packing
density / consistency** into Belgian **NAD classes (1–31)**, producing the third
model level. *(Flanders/Belgian NAD is the focus now; extending to other national
class systems is a later concern.)* Each geotech unit carries a `(geological formation, lithology, NAD
class)` identity — because the same lithology gets different parameters by
geological age (Paleogene Boom Klei vs Quaternary clay must be separable for
later parameterisation).

This is an **assisted-manual** stage mirroring the litho Suggest flow: the tool
suggests, the engineer stays king (accept / reject / drag depths).

Owner constraints carried in from brainstorming:
- **Automatic split suggestions**, but **anti-oversplit** — the goal is *large
  coherent horizontal layers, not fragmented bodies*.
- Packing density is **non-monotonic** (dense-shallow → looser-deeper is real);
  no monotone assumption.
- **All 31 NAD classes** are assignable; the *cut* is on the coarse packing band
  (large layers) but each sub-unit carries its precise 1–31 number.
- **Heavy qc smoothing is an in-memory split helper only** — never shown, never
  stored.

## 2. Scope

### In scope (Slice 1)
1. The `kind='geotechnical'` sibling model (parent = the litho model).
2. **Automatic geo-bounding on build**: a litho unit is divided at geological
   boundaries (geology = hard bound), snap-or-divide at `litho_snap_tolerance_m`,
   sliver guard. No interactive "Reconcile" gesture (owner directive 2026-06-23).
3. **NAD subdivision suggester**: per geo-bounded, lithology-known segment,
   `(soil type, admixture, qc) → NAD class`, on heavily-smoothed-in-memory qc,
   coarse packing-band cuts, min-thickness merge, tunable knobs in Settings.
   Emits ghost split contacts pre-assigned their NAD 1–31.
4. **Ghost accept / reject / drag** → committed geotech units.
5. 2D section rendering + a geotech inspector roster. Bundle round-trip.

### Out of scope (later slices / deferred)
- **3D build of the geotech model** — undefined; the active litho 3D path is the
  voxel builder, which labels from `computeSectionFill` and has no NAD-class input.
  Needs its own brainstorm. *(architect finding 7)*
- **Displayed Ic / Dr / γ indicators** — last slice (owner directive). The NAD
  *class* is computed/assigned structurally in S1; only the indicator *panel*
  waits.
- **Horizontal correlation → large geotech bodies** — Slice 2.
- **Cross-CPT NAD disagreement aggregation** (one unit, CPTs disagree on class) —
  Slice 2 policy; S1 keeps the suggestion per-investigation/segment. *(product +
  architect finding 6)*
- **Group same-(geo, NAD) bodies → one parameter set → Parameters stage** — Slice 3.
- **Per-contact "un-snap" adjustability** — the owner flagged a future need to
  override a geo-bounding snap the engineer didn't want. Explicit S1-out; backlog.
- **Fines classification edge cases** — the core table is ported in S1; odd cases
  get extended later (owner).

## 3. Model & data

### Hierarchy (mostly already wired — verified 2026-06-23)
- `ModelKind = Literal["geological","lithostratigraphic","geotechnical"]` and
  `REQUIRED_PARENT_KIND["geotechnical"]="lithostratigraphic"` already exist
  (`model_kind.py`). `POST /models` already validates the parent-kind rule.
  Bundle restore already deletes in `(geotechnical, lithostratigraphic,
  geological)` order. The formation-codelist endpoint already has a
  `kind=="geotechnical"` branch returning `NAD_CLASSES`.
- `geological_formation` already carries `nad_class: int | None`,
  `litho_main_soil_code`, `litho_admixtures`, and `parent_formation_id` (self-FK).
- `formation_contact.parent_geo_contact_id` (self-FK, SET NULL) already exists.
- All 31 NAD class **labels** are codified in `NAD_CLASSES`
  (`shared/constants/litho_constants.py`), incl. admixture variants
  ("ZAND, silt-/kleihoudend, …") and fines consistency bands (weinig-vast→vast).

### Carrier decision (resolves architect finding 1, staff risk 1)
**Geotech units are `geological_formation` rows under a `kind='geotechnical'`
model; geotech contacts are `FormationContact` rows with the geotech `model_id`
+ `parent_geo_contact_id` provenance.** This reuses the whole contact / build /
section / bundle pipeline. The separate `GeotechnicalUnitOrm` label table is
**not** the contact carrier.

### Migration (the only schema add)
Add explicit dual-reference FKs to `geological_formation` so the (geo, litho, NAD)
triple is a first-class stored tuple (owner chose explicit over transitive):
- `source_litho_formation_id` UUID FK → `geological_formation.id`, SET NULL, nullable.
- `source_geo_formation_id` UUID FK → `geological_formation.id`, SET NULL, nullable.

Backwards-compat is suspended pre-ship; the bundle restore's unknown-key filter
covers older bundles. The bundle `geological_formations` array carries the new
fields (null on legacy bundles).

## 4. Build & flow

Per section corridor:

**Step A — automatic geo-bounding (new use case `BuildGeotechModelFromLitho`).**
The snap-or-divide geometry logic lives in `domain/services/litho_geo_bounding.py`
(`divide_picks_by_geology`, `mark_and_truncate_shallow_tests`) — **pure functions
over `BodyLayerPick`, no persistence, and currently called from nowhere in prod**
(pulled from the live build path 2026-06-13). So this is **NOT a wholesale reuse**:
the new use case (a) loads section-scoped litho picks (a new section-scoped
variant of `LithoLayerRepository.load_body_picks`, filtered to in-corridor
investigations — pattern from `AssembleStratInputs.assemble_with_geo`), (b) calls
the pure geometry logic to decide division positions, (c) persists those as
geotech `FormationContact` rows + `parent_geo_contact_id` provenance. Geology
prevails as a hard bound. *(architect finding 2, staff risk 3)*

**Step B — NAD subdivision suggester (new domain service).** Per geo-bounded,
lithology-known segment: smooth qc in-memory (a heavier window than the litho
segmenter — a split helper, never stored), classify each smoothed run via
`(soil type, admixture, qc) → NAD class`, RLE + greedy min-thickness merge, emit
ghost split contacts pre-assigned their NAD class (via the §5 qc-band lookup — no
Dr). Reuses the module-level smoothing/segmentation helpers already in
`litho_segmentation.py` (`_rolling_median_zones`, `_run_length_encode`,
`_greedy_merge`) as imports, not re-implementations. The Robertson/Dr core is NOT
used by the classifier. *(staff Q2)*

**Step C — accept / reject / drag.** New `AcceptGeotechSuggestions` use case (the
litho accept is heavily litho-coupled: its find-or-create key is `(litho_main_soil_code,
admixture_sig)` and it fires litho-only downstream triggers). The geotech accept
find-or-create key is `(nad_class, parent_litho_formation_id)`; no litho downstream
triggers. *(staff Q3)*

## 5. NAD classification rule

The rule is **`(soil type, admixture, qc-band) → NAD class 1–31`** — a qc-band
lookup. **No Dr** (owner directive 2026-06-23): the existing `litho_segmentation`
Dr → class path (`_dr_to_nad_class`, `_SAND_NAD_BY_DR`) is **not** reused here;
sand is classified on qc bands like every other soil. The default classification
input is **raw qc** (no σ′v / no normalisation); a Qtn option exists (see below).

- **Labels** for all 31 classes: already in `NAD_CLASSES`. ✓
- **qc input:** raw `qc_mpa` by default, with a **Settings toggle to use Qtn**
  (normalised cone resistance, the depth-independent packing measure) when the
  engineer prefers it. Default raw. **Dependency:** the NAD-NEN Excel thresholds
  are *raw-qc bands*, so the Qtn path needs its own **Qtn-banded threshold set**
  (owner to supply, or the Qtn toggle is a follow-up). Qtn re-introduces σ′v
  (water table + unit weights) on that path only — and Qtn is already computed in
  the Robertson pipeline (`qtn_f_ic_series`), so the computation is reused, not new.
  The raw-qc default needs no σ′v.
- **Thresholds** for all classes (gravel 1–4, sand 5–12, silt 13–20, clay 21–28,
  peat 29–31): in the owner's Excel (`Correlaties uit S en NAD_NEN_v2.xlsx`, sheet
  `laagnr NAD-NEN`). **Prerequisite task T0: add that Excel to
  `src/groundmodel/infrastructure/codelists/data/` and port it into a
  `*_constants.py` `(base_lithology, admixture, qc-band) → nad_class` lookup**
  (mirrors the existing codelist-from-xlsx pattern). Not yet in the repo — owner
  to supply.

**Admixture matching is EXACT against the variants the table actually defines:**
sand has only silt-/clay admixture variants (silt-/kleihoudend → 9–12), NOT a
gravelly-sand variant; silt and clay have only the sandy variant (zandhoudend →
17–20 / 25–28). A litho admixture with no NAD variant for that soil (e.g. gravelly
sand) falls to the **clean** variant of that soil. No fuzzy matching.

The lithology + admixture come from the source litho unit (so the classifier picks
the right threshold column); qc comes from the intersecting CPT.

**Edge — qc outside the defined bands:** default to the **nearest** NAD class
*within the unit's soil + admixture column*. The **lithology is hard truth** — qc
never reclassifies the soil type, only the packing/consistency band within it.

**Scope:** Belgian (Flanders) NAD only for now; extending to other national class
systems is a later concern.

## 6. Components

**New (backend):** the NAD classification lookup (T0 port), the NAD subdivision
domain service, `BuildGeotechFromLitho` (geo-bounding + persist) use case, the
section-scoped pick loader, `AcceptGeotechSuggestions` use case, geotech-model
create/ensure wiring, suggest/accept endpoints (geotech variants).

**New (frontend):** `GeotechnicalCanvas` (replace the EmptyState placeholder;
reuse SectionPanel / overlays), `GeotechSuggestionGhostColumns` (near-copy of the
litho ghost component with NAD-label rendering + an NAD-class colour map), an
`axisMode:'geotechnical'` branch (`ContactsLayer`, `CanvasHints`, toolbar), a
geotech inspector roster, Settings knobs (min-thickness, smoothing window, and a
**raw-qc / Qtn toggle** — mirror the litho segmenter rows).

**Reused:** the contact/build/section/bundle pipeline, the Robertson core +
segmenter helpers, the litho_geo_bounding geometry, the sibling-model create
pattern.

**`kind`-guard sites to extend (~7, staff Q3):** `contacts.py` (suggest/bulk-accept),
`auto_correlate_contact_edges.py`, `update_formation_contact.py`,
`suggest_litho_contacts.py`, `seed_litho_from_geological_model.py`,
`propagate_litho_admixtures.py`; `rebuild_model_surfaces.py` already handles
`geotechnical` as non-stratigraphic.

## 7. UX (ux-reviewer findings)

- **No "Suggest" before the model is built/bounded** — gate the suggest verb until
  the geotech model has been built for the section, surfaced via a `CanvasHints`
  hint line (the #139 pattern). Prevents silently classifying across a geo
  boundary (a data-correctness bug).
- **NAD numbers are opaque** — every band/ghost shows the **packing-class name**
  ("NAD 12 — ZAND, silt-/kleihoudend, zeer dicht gp"), with the raw number as the
  `title` tooltip. A "CPT est." badge marks CPT-derived classifications.
- **Colour:** any "adjusted-to-geo" / preview affordance uses a **blue accent**,
  **never amber** (amber = the unsaved-state invariant, `project_dirty_amber_color`).
- **Borehole / no-qc bands** (no CPT in corridor → not packing-classifiable) render
  with a **distinct, named** state ("No qc data — manual class"), not an empty band.
  The manual-assign path is backlog, but the state must be visually unambiguous in S1.

## 8. Edge cases
- **Borehole-only column (no qc):** the litho unit carries through as a single
  geotech unit, class unset. Splits fire only where CPT qc exists.
- **Cross-CPT NAD disagreement within a unit:** out of S1; the suggester is
  per-investigation. Aggregation policy is Slice 2.
- **Future un-snap adjustability:** geo-bounding is automatic in S1; per-contact
  override is backlog.
- **qc outside the defined bands:** default to the nearest NAD class within the
  unit's soil + admixture column; lithology is hard truth (see §5).

## 9. Testing
- Domain: the NAD classification lookup at band/threshold boundaries per
  (soil, admixture); the subdivision service (smoothing kills spikes,
  min-thickness merge, cuts on band not point, non-monotonic profile).
- Use case: `BuildGeotechFromLitho` snap-vs-divide + sliver cases (reuse the
  litho_geo_bounding pure-function tests as the geometry oracle);
  `AcceptGeotechSuggestions` find-or-create + idempotent re-accept.
- Integration: build a geotech model end-to-end; bundle round-trip incl. the new
  dual-ref FKs.
- Frontend: the ghost accept/reject/drag flow on the geotech axis; the suggest gate
  + hint; NAD packing-name labels; the no-qc band state.
- e2e fixture

## 10. Decomposition & debt impact
- **S2** — horizontal correlation → large geotech bodies + cross-CPT aggregation policy.
- **S3** — group by (geo formation, NAD class) → one parameter set → Parameters stage.
- **S4 (last)** — displayed per-unit Ic / Dr / γ indicators ("CPT-derived estimate").
- Then: DXF / Plaxis export with geotech identifiers (debt #104) — product-strategy
  flags this as the next priority after the stage, a paying-customer gate.
- **Debt:** building the automatic geo-bounding resolves the litho↔geo
  reconciliation *placement* (`project_litho_geo_reconciliation_placement`):
  #134-C-bulk stays moot, #157 covered, edit-time coupling (#162) demoted to
  optional annotation — left as-is in S1, not extended or removed.

## 11. Open inputs (must resolve before T0)
- The NAD-NEN Excel (`Correlaties uit S en NAD_NEN_v2.xlsx`) must be added to the
  repo so the raw-`(soil, admixture, qc-band) → NAD class` table can be ported.
  Owner to supply.
- The **Qtn-banded threshold set** (for the optional Qtn classification path) — if
  the Excel doesn't carry Qtn bands, the raw-qc path ships first and the Qtn toggle
  becomes a follow-up. Owner to confirm.
