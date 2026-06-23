# Geotechnical stage — Slice 1 design

**Date:** 2026-06-23
**Status:** approved in brainstorming; reviewed by system-architect / staff-engineer / ux-reviewer / product-strategy-advisor; ready for an implementation plan.
**Phase:** 4 — v1.0 commercial MVP gate, step 4 (geotechnical subdivision).

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
