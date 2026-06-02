# Ground Model Platform — CLAUDE.md

## Project Overview

Commercial **ground model platform** — builds and manages the unified subsurface dataset for a project. Ingests CPT, borehole, lab, monitoring, DMT, pressuremeter, and geophysical data; derives parameters and statistics; exports to design tools (Plaxis, D-Stability, D-Sheet, GeoStudio, ...). Built for solo development; targets Electron + React desktop first, SaaS later.

---

## Scope

This platform's job is to deliver a clean, validated **ground model + derived parameters + statistics**. Design checks happen elsewhere using this output as input.

**In scope:**
- Data ingestion (CPT, borehole, lab, monitoring, DMT, pressuremeter, geophysical)
- Storage, search, spatial queries
- Visualization (depth-series charts, 2D map, eventually 3D model)
- Derived parameters and statistics (e.g. statistical aggregates from CPT/lab series, soil profile interpretation)
- Exports to design tools

**Out of scope (forever):**
- Geotechnical design calculations: bearing capacity, ULS/SLS verifications, settlement, slope stability, pile capacity, retaining-wall design
- Anything that produces a value used directly in a design check — those calculations belong in the downstream design tool (Plaxis, D-Stability, D-Sheet, GeoStudio, ...)
- EC7 / Eurocode design rule application (we do not target EC7 design conformance)

**Deferred to the final phase (preview implementations may exist earlier):**
- Robertson Ic / Soil Behaviour Type classification — **as a fully
  automated produced parameter.** Carve-out extended (owner directive
  2026-05-18): Robertson SBT zone is now committed as a **per-unit
  summary** in the MVP (Ic zone label, relative density Dr for sand
  units, NAD packing class 1–31, γ-estimate from SBT lookup) — these
  are characterisation outputs, not design inputs. The boundary: any
  value used directly in a design calculation (φ′, c′, cu, E50, OCR,
  Vs, G0, M) stays Phase 5. The full Robertson/Mayne parameter port
  and the NAD-NEN xlsx table (38×313) stay Phase 5. See
  `memory/project_litho_geotech_three_level_model.md`.
- Auto soil profiling (merging Ic into layers) — as an *automatic*
  model. The litho segmenter's assisted-manual suggestion flow
  (user-accepted ghost nodes, not auto-correlation) is Phase 4 per
  the original carve-out; unchanged.
- Per-layer design parameters from Robertson correlation (φ′, c′, cu,
  E50, OCR, Vs, G0, M) — Phase 5. Dr and NAD class are MVP (above);
  the design-ready values derived from them are not.
- Per-CPT validation that requires geotech judgement (RF range checks, qc spike detection, hybrid-method detection)

---

## Core Philosophy

- **Data correctness first** — clean ingestion + storage before any interpretation
- **Clean architecture** — dependencies flow one way: API → Application → Domain ← Infrastructure
- **Queue-ready, not queue-first** — abstract the queue from day one, add a broker when needed
- **No premature optimisation** — Python + Polars first; Rust only where profiling proves it is needed
- **Never design a layer you haven't needed yet** — build, feel the pain, then abstract
- **Engineering interpretation is a characterisation output, not a design output** — soil behaviour type, layer detection, and packing-class indicators (Ic zone, Dr, NAD class, γ-estimate) are MVP outputs. Design-ready parameters (φ′, c′, cu, E50, OCR, Vs) that feed directly into ULS/SLS calculations are Phase 5. The boundary is: anything the engineer pastes into a design check without intermediate judgement stays out of the MVP. *(Carve-out history: Robertson SBT was segmentation-only in Phase 4 as of 2026-05-17; extended to committed per-unit characterisation indicators on 2026-05-18 by owner directive. See Scope.)*
- **Backwards compatibility, always** — see the dedicated section below; the short version is: a .gmproj file written by yesterday's build must open in tomorrow's build, forever.

---

## Commercial Direction

This is a **commercial product**, not just an internal tool. Engineering
decisions in this repo are calibrated for a paid release to BE/NL
geotechnical consultancies — initially 5–50 person firms who already
feel the pain of legacy tools (gINT, D-Series, GeoStudio).

### Distribution model

* **Local-first desktop app.** Each user runs their own copy with
  their own local Postgres + PostGIS. **No central cloud service.**
  Reasoning: offline-capable on site, data-privacy-friendly (geotech
  projects are frequently NDA / defense-adjacent), zero ongoing infra
  cost, sub-ms query latency.
* **`.gmproj` v2 = the portable artefact.** Sharing a project means
  emailing the file. The bundle format already supports this — open
  on a wiped DB and the data rehydrates.
* **One DB per user.** Today: developer Docker Compose on
  ``localhost:5433``. v1.0 distribution likely bundles
  Postgres + PostGIS inside the installer so end users don't install
  anything themselves (Plaxis pattern). SQLite + SpatiaLite is a
  fall-back if the bundled-Postgres path proves too fragile, but it's
  a non-trivial refactor (PostgreSQL ``ARRAY`` columns, PostGIS-
  specific geometry features) so we don't pre-optimise for it.
* **SaaS is a Phase 5+ direction**, not a v1.0 concern. If/when it
  ships, the .gmproj file becomes the bridge format between the
  desktop client and any future cloud sync.

### Modelling hierarchy (load-bearing for the v1.0 design)

The data model has **three distinct levels** (revised 2026-05-17 —
owner directive; was two. The geological→geotechnical split is
unchanged, a lithostratigraphic level is inserted between them
because formation-only is too coarse for geotechnical deliverables).
Realised as **sibling `GeologicalModel` rows discriminated by a
`kind` column**, NOT a schema fork — the whole contact → on-click
build → TIN → section-slice → DXF/Plaxis-export → `.gmproj` pipeline
is reused at every level. See
`memory/project_litho_geotech_three_level_model.md`:

1. **Geological model** (`kind='geological'`) — formations are the
   substrate entities (Boom Klei, Diest Zand, Quaternary deposits,
   ...). Each carries a surface defined at known points
   (borehole/CPT contacts) and interpolated between them. Initially
   manual; in Flanders the public G3Dv3 model can seed the default
   formation set + baseline surfaces (post-v1.0 import, big
   differentiator at launch). The regional/chrono backbone.
2. **Lithostratigraphic model** (`kind='lithostratigraphic'`) —
   refines a geological model into lithology + admixture units
   (ZAND / KLEI / SILT / GRIND / VEEN, silt-/kleihoudend). Sourced
   from borehole `ObservationLayer` descriptions + an assisted-manual
   CPT Robertson-SBT segmenter (user-accepted ghost nodes, never
   auto-correlation). `parent_geological_model_id` is mandatory
   (enforced at creation — a litho model cannot exist without its
   geological parent; the column is DB-nullable only because
   geological models share it and have no parent). The
   geotechnically-actionable detail level.
3. **Geotechnical model** (`kind='geotechnical'`) — derived from the
   lithostratigraphic model. A lithology is subdivided by **packing
   density / consistency** into a Belgian **NAD** class (1–31:
   los/matig/dicht/zeer dicht for sand, weinig-vast→vast for fines),
   driven by CPT qc/Dr.
   *(Owner directive 2026-05-25, supersedes 2026-05-20):* The litho
   segmenter merges adjacent same-lithology segments by default.
   Settings → "Merge same-lithology layers" (default ON) toggles the
   behaviour. The packing-density signal that the merge would discard
   returns at the right architectural layer: the Geotech stage's
   "Suggest packing split" gesture (future work) will re-introduce
   Dr-driven subdivisions within a litho unit, with smoothing and
   horizontal-layer awareness so spurious lateral packing-lens noise
   doesn't survive across nearby tests. The merged segment's NAD class
   tooltip shows a range ("NAD 1–3") when sources differ, a singleton
   when they share. The 2026-05-20 over-split-by-design directive is
   retired — it was a placeholder bet that the geotech stage's split
   machinery would arrive sooner. **MVP scope (owner directive 2026-05-18):**
   subdivision structure + the following CPT-derived indicators per
   unit are v1.0: Robertson Ic SBT zone (committed summary), relative
   density Dr (sand units, `Dr = 100·(0.268·ln(qc/0.1 /
   (σ′v/100)^0.5) − 0.675)`), NAD packing class label, and γ-estimate
   from SBT-zone lookup. All are labelled "CPT-derived estimate" at
   the presentation boundary. **Design-ready parameter values**
   (φ′/c′/cu/E50/OCR/Vs/G0/M, the full NAD-NEN xlsx port) stay Phase
   5. Example: weathered crust of Boom Klei vs undisturbed clay below.

**Cross-sections are the editing surface, not the data primitive.**
Pick a slice through the project, see the investigations projected
on it, draw/edit formation tops between them — the edits commit to
the geological model, not to the section. The section is a view.

**Explicit-content invariant (owner directive 2026-05-17): nothing
appears on a section without the user clicking a button on that
section.** A freshly-drawn section shows investigations only — zero
formation contacts. Formation content appears only where the user
has explicitly seeded or drawn it; the ids of those contacts are
stored in ``cross_section.seeded_formation_contact_ids`` (PostgreSQL
UUID array, empty on create). ``SectionsCanvas`` filters
``axisContacts`` to ``seeded_formation_contact_ids`` at the prop
boundary before passing to ``SectionPanel`` — the Build/TIN path is
unaffected (it still consumes all model contacts for Delaunay). The
filtering is stale-id-tolerant: a contact deleted from the model
after being seeded is simply absent from ``axisContacts`` — filter
by id-membership skips it silently.

**Stratigraphic order — `display_order` is the age axis.** Lower
`display_order` = older formation (deeper in the stratigraphic
column). Section views and any other layered **renderer** iterate
formations ASCENDING by `display_order` so older paints first and
younger formations render visually on top — the geological
superposition rule. **The GeologyInspector formation LIST is the
one exception: it presents formations YOUNGEST-first (descending
`display_order`), because an engineer reads it like a borehole log /
stratigraphic column — surface/youngest at the top, oldest at
depth. This is a presentation-only reversal; `display_order`
semantics and every renderer's ascending paint order are unchanged.
The drag-reorder runs in that displayed (reversed) space and maps
the displayed index back to `display_order = (N-1 - i)`.** Reorder
lives in GeologyInspector via drag-and-drop (the old InterpretationPane
was deleted in the G3 sidebar overhaul); the drag-end commit
renumbers every visible formation 0..N-1 (compact) and PATCHes only
the rows whose index actually changed. **The drag-end PATCH also sets
``pinned_order=True`` on every reordered formation (debt #35): Build's
``_reorder_by_age`` keeps pinned formations at their exact
``display_order`` and flows only the non-pinned ones into the free
slots by inferred age. This makes Build safe for unusual stratigraphy
(pinch-outs, unconformities, inversion) where the data-driven
inference is wrong — a manual reorder is no longer silently reverted.
Undo restores the pre-drag pin state per formation; "Fill from
boreholes" / seeded formations stay unpinned so they still benefit
from the inference.** The crossing validator
(``GET /geology/models/{mid}/validate/crossings``) consumes this
ordering: it samples each pair of cached TIN surfaces and flags any
(x, y) where the younger formation dips below the older. Results
surface as an amber "N surface crossings detected" banner; refetched
on every contact mutation.

**On-click build — the user controls when surfaces compute.** Per-
contact mutations (Create / Update / Delete / Batch update) DO NOT
auto-run Delaunay; they flip ``formation_surface.is_stale = True``
on the affected (model, formation) row. Only ``POST /geology/models/
{mid}/surfaces/rebuild`` (the "Build 3D model" toolbar button)
clears the flag by re-running the recompute. File → Save does NOT
auto-fire a rebuild. The section view renders stale TINs at opacity
0.35 + dashed ``6 3`` so the engineer sees "this is your last build,
refresh to update." Distinct from the connect-the-dots fallback
(dashed ``4 3``, opacity 0.55) and from fresh TIN (solid 0.7).
Dedupe's auto-recompute is retained (it is a build-shaped intent,
not an iterative edit). The ``method`` query param scaffolds for
kriging / RBF / GemPy in Phase 5; v1 enforces ``method=tin`` via
regex.

**Geology stage owns model definition. Formations are created/curated/
deleted and seeded from borehole stratigraphy ("Fill from boreholes")
in the Geology stage — the substrate-definition step. The cross-section's
"Seed from stratigraphy" is NOT a model-definition action: it is a
downstream, gated operation that (a) is disabled until the active
geological model has formations, (b) places formation CONTACTS only —
for the formations the user has kept — at each in-corridor investigation,
AND records each created contact id into ``cross_section.
seeded_formation_contact_ids`` (union pattern — idempotent re-runs add
only genuinely-new ids), (c) contacts NOT in that set are invisible on
this section (the explicit-content invariant — see paragraph above),
(d) renders them as the dashed connect-the-dots fallback, never solid TIN
bands, (e) never creates formations and never triggers a Delaunay/TIN
build. Surface build remains a separate explicit action ("Build model" /
the Geology stage). This supersedes the earlier rule that listed
"Auto-populate from boreholes" on the section as a build-shaped intent
with retained auto-recompute. Dedupe's behaviour is unchanged.**

### v1.0 commercial MVP gate

The product is "sellable" the moment a geotech engineer can do this
end-to-end on a real project:

1. Import CPTs + boreholes (DOV bbox + GEF files — done).
2. Define a **geological model** (formations + surfaces) for the project (done).
3. Build a **lithostratigraphic model**: refine geological formations into
   lithology + admixture units via borehole ObservationLayer descriptions
   and the CPT Robertson-SBT segmenter. View and edit on cross-sections.
4. **Geotechnical subdivision**: assign NAD packing class (1–31) to each
   lithostratigraphic unit. Display Robertson Ic SBT zone, relative
   density Dr (sand), NAD packing class, and γ-estimate per unit in the
   inspector. Parameter VALUES (φ′/c′/cu/E50) stay blank — the engineer
   fills those in their downstream design tool.
5. **Export** the three-level model geometry to DXF and/or Plaxis, with
   unit identifiers so the downstream tool can map unit names to material
   definitions.

Design-ready parameter values (φ′, c′, cu, E50, OCR, Vs, G0, M), full
NAD-NEN xlsx table, per-layer statistics, and PDF reports are Phase 5
(post-v1.0). The geometry + packing-class interpretation is the
integration unit downstream design tools actually consume at handoff.
G3Dv3 import lands alongside or just after v1.0 — high-impact for the
Flanders launch demo but not a gate.

### Open commercial concerns (tracked as debt, not blocking the MVP)

* **License key / activation system** — none today; needed before any
  paid distribution. Likely shape: signed offline license tokens
  (machine-bound or floating per-user), no phone-home dependency for
  daily use. See debt section.
* **Code-signing the installer** — Windows SmartScreen will reject
  unsigned installers and signal "untrusted" to users. EV
  certificate required (~€200–400/year).
* **Hardening against tampering / reverse engineering** — modest
  posture, not paranoid. Geotech isn't a target-rich threat
  environment; goals are mostly to prevent casual license-key
  bypass and keep our user data import paths safe from malformed
  files. NOT trying to defeat dedicated reverse engineers — that's a
  losing arms race for a solo dev.
* **Auto-update channel** — Squirrel.Windows / electron-updater
  pattern. Needed because v1.0 saves write today's bundle format;
  future format upgrades depend on every user reaching at least the
  build that introduced the upgrade path.
* **Marketing site + demo video + market-facing name** — codename
  here stays "Strix" / "groundmodel" but the public name + domain +
  trademark search is a separate deliverable. The 90-second demo
  video showing DOV bbox → borelog → save/open round-trip is the
  primary marketing artefact; everything else is supporting copy.

These don't shape the v1.0 MVP feature gate, but every one has to
land before a paid public release. They're listed individually in
"Known Architectural Debt" so each gets a trigger condition.

---

## Backwards Compatibility — non-negotiable from now on

> **⚠ SUSPENDED during pre-ship development (owner directive 2026-05-16).**
> The product has no external/paid users yet (internal/coworker handoff
> only — see ``memory/project_coworker_distribution.md``). While
> pre-ship, schema / API / ``.gmproj`` shapes may change cleanly: no
> optional/null compatibility shims, no ``format_version`` upgrade
> chain, no additive-only tax. This is an extension of the original
> "v1/v2 were dev-only, removed under a one-time amnesty" stance to the
> whole current dev window.
>
> **Re-arm trigger (the most important field):** the first time a build
> is handed to anyone outside this dev machine *as a thing they will
> save real projects with* — i.e. day-1 of the first external/paid
> distribution (ties to debt #3 license keys + the coworker-binary
> path). At that moment: restore this section in full, set the
> ``format_version`` floor to whatever the shipped build emits, and
> every rule below becomes non-negotiable again from that floor
> forward. Until then, do not spend effort on compat shims — but also
> do not gratuitously churn stable internal/API names just because you
> can (rename only when there is a user-visible reason; e.g. the
> Stratigraphy/3D-model relabel stays presentation-only).

The rules below are the contract **once the trigger above fires.** They
are retained verbatim so re-arming is a revert, not a redesign.

User-owned artefacts have to keep working across upgrades. "Forever"
isn't rhetorical — the user paid the cost of saving the file once and
should never lose access to that data because we changed our minds.

### Floor: format_version = 4

v1 (metadata-only) and v2 (CPTs + boreholes + geology + sections) were
dev-only and have been removed pre-shipping (one-time amnesty). v3
carried every per-project decision in the boundary-centric shape
(``contacts`` array on each geological model). **v4 (current, A4 of
the unified litho boundary model) makes the litho axis Shape A
native: each geological model carries a nested ``litho_layers``
array; on litho models the ``contacts`` array is emitted empty —
``litho_layer`` rows are the source of truth.** Both v3 and v4 stay
parseable on this build (``SUPPORTED_BUNDLE_VERSIONS == {3, 4}``);
v3 restores via the LL→FC trigger materialising layers from contacts.
Bumping the version requires the upgrade-chain steps below.

**v4 + bodies (2026-05-31, pre-ship amnesty):** the body-with-extent
refactor landed without a version bump (pre-ship amnesty, no external
users). v4 format now also carries a top-level ``bodies`` array per
model alongside ``litho_layers[]`` and ``contacts[]``. When the
backwards-compat trigger fires (first external/paid distribution), v4
with bodies becomes the floor: ``format_version`` stays at 4 but
``bodies`` is a required-or-normalised-to-[]  field that any v4
reader must tolerate. Old v4 bundles without ``bodies`` restore
cleanly (normalised to ``[]`` on parse — see ``parseProjectFile``).
The next version bump will be v5 and applies only if the shape breaks
in a way that requires an explicit upgrade path.

### Scope

The rule applies to anything the user persists or relies on outside
the running app:

| Artefact | Rule |
|---|---|
| ``.gmproj`` file format | v3+ must always parse. Bump ``format_version`` for breaking changes and add an explicit upgrade path; never silently drop fields. The upgrade-chain rules below are the template. |
| Bundle wire format (``ProjectBundleRequest`` / ``Response``) | Same as .gmproj — the file embeds this verbatim. Adding fields is fine; removing or repurposing a field name requires a version bump + parse-path branching. |
| REST API contracts | Additive changes only. New fields default to optional / null. Removing or repurposing existing fields needs a deprecation cycle (ship the new one alongside, migrate clients, drop the old after one or two releases). |
| Recent-projects list (``userData/recent-projects.json``) | Tolerate unknown fields on read, version it if the shape changes. |
| URL / query / config conventions documented in CLAUDE.md | Don't yank without a deprecation note. |

### Doesn't apply to

* Internal Python / TypeScript types — they're internal, refactor freely.
* DB schema (we own Alembic; ``alembic upgrade head`` is the contract,
  not the column list).
* Test fixtures, fixtures-on-disk, dev seeds.
* DOV cache file layout (we control it end-to-end; cache wipe is fine).

### How to bump a versioned format

1. Bump the integer ``format_version`` field.
2. Keep the old version's reader / parser intact; never delete it.
3. Add an explicit ``upgrade_vN_to_vN+1`` function that mirrors the
   shape. The parser tries the newest version first, falls back to
   older versions, and runs the upgrade chain to materialise into the
   current in-memory shape.
4. Write a test that opens a fixture from the previous version and
   asserts it still reaches today's runtime shape.
5. New saves always emit the latest version.

If you find yourself wanting to "just break it, no one's using the old
format yet" — that's the moment the rule matters most. Today's "no
one" is tomorrow's "every user who downloaded the v0.3 build."

---

## Architecture

```
┌─────────────────────────────────────┐
│           API Layer (FastAPI)       │  ← HTTP, validation, routing
├─────────────────────────────────────┤
│        Application Layer            │  ← use cases, orchestration
├─────────────────────────────────────┤
│          Domain Layer               │  ← pure geotechnical logic, no frameworks
├─────────────────────────────────────┤
│       Infrastructure Layer          │  ← DB, parsers, exporters, GIS, Rust
└─────────────────────────────────────┘
```

The domain layer has zero knowledge of FastAPI, PostgreSQL, or Polars.

---

## Domain Model

```
Project                      ← app-level container; everything else
                               carries app_project_id pointing at this
                               row. Soft-deleted via archived_at.

InSituTest (abstract base)
├── PushedInTest
│   ├── CPT   ← GEF / AGS / LAS
│   └── DMT   ← flat dilatometer, also pushed
└── BoreholeTest
    ├── Pressuremeter (PMT)
    ├── SPT
    └── VST

Borehole                     ← a physical hole, not a test
├── BoreholeTests[]
├── Samples[]
└── Observations[]           ← visual log, soil description

LabTest                      ← performed on a Sample, NOT on a Borehole
├── GrainSize          (typed: cumulative size-distribution curve)
├── AtterbergLimits    (typed: liquid-limit + plastic-limit)
├── CaCO3Content       (typed: % calcium carbonate by mass)
├── OrganicContent     (typed: organic carbon %)
├── WaterContent       (typed: w%)
└── ScalarLabTest      (catch-all: any (parameter, value, unit) tuple)

Monitoring: Piezometer, Inclinometer
Geophysical: MASW, Seismic CPT
```

**Key rules:**
- `LabTest` is associated with a `Sample`, not a `Borehole`
- `DMT` is a pushed test; `Pressuremeter` is a borehole test
- Shared location ≠ inheritance — use composition
- **Catch-all vs typed family rule:** ScalarLabTest is the default home for new
  scalar test parameters. Promote to a typed family ONLY when (a) the test
  needs structural columns the catch-all can't express (e.g. Atterberg's
  LL+PL aggregation, GrainSize's curve), or (b) the parameter is
  validated against a domain rule that needs first-class type safety.
  Adding a new test to the catch-all is one tuple in
  `DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS` — no migration, no schema change.

**Interpretation primitives by model kind (post-A4 Shape A):**
- Geological models: ``FormationContact`` rows are the boundary-centric
  primitive (one row per contact at depth_top_m on an investigation).
- Lithostratigraphic models: ``LithoLayer`` rows are the layer-centric
  primitive (one row per [depth_top_m, depth_base_m] interval at an
  investigation; status ∈ {pending, accepted, rejected}). The LL row is
  the source of truth; a defensive FC↔LL trigger pair keeps a
  formation_contact mirror in sync for legacy /contacts readers
  (bundle export of geological models, external API callers). All
  internal BE + FE litho writers hit /layers/* endpoints natively.
  Exception: synthetic pinch-out contacts (anchor-less, debt #118
  litho-axis pinch-out wiring) stay on formation_contact — Shape A's
  anchor XOR doesn't fit.
- Correlation edges (``litho_contact_correlation_edge.contact_a_id /
  contact_b_id``) FK ``litho_layer.id`` post-A4 (UUIDs preserved
  end-to-end since the A2.5 backfill).
- **Bodies** (``BodyOrm``) are the per-side lateral-extent primitive
  introduced by the body-with-extent refactor (2026-05-31, ~50 commits
  on develop). A body row represents a detected or user-claimed lateral
  body between a source investigation and a neighbour, with independently
  addressable left + right extents. Four extent kinds: ``to_target``
  (detector-set bilateral closure), ``pinch_out_halfway``, ``extrapolated``,
  ``open`` (user-claimed). Provenance rule: the detector never overwrites
  a user-claimed extent; the user must call ``ClearBodyExtent`` first.
  Bodies replace the former ``LithoLensOrm`` entity as the closure
  primitive — the unilateral lens rule (one primary target) is superseded
  by per-side bilateral closure detection. See spec at
  ``docs/superpowers/specs/2026-05-31-body-with-extent-design.md``.

---

## Project Structure

`src` layout — package lives under `src/groundmodel/`.

```
Strix/
├── src/groundmodel/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── base/          insitu_test.py, investigation_point.py
│   │   │   ├── pushed/        cpt.py, dmt.py
│   │   │   ├── borehole/      borehole.py, sample.py, borehole_test.py,
│   │   │   │                  observation.py, observation_layer.py,
│   │   │   │                  drill_segment.py, field_log_interval.py
│   │   │   ├── lab/           lab_test.py, grain_size.py, atterberg_limits.py,
│   │   │   │                  caco3_content.py, organic_content.py, water_content.py,
│   │   │   │                  scalar_lab_test.py    ← catch-all family
│   │   │   ├── monitoring/    piezometer.py, inclinometer.py
│   │   │   └── job.py         Job + JobStatus
│   │   ├── services/          cpt_interpretation.py, cpt_corrections.py, ec7/
│   │   └── value_objects/     depth.py, coordinate.py, unit_weight_profile.py,
│   │                          observation_type.py, field_log_kind.py, admixture.py,
│   │                          derived_value_source.py
│   ├── application/           import_cpt.py, import_cpt_dov.py,
│   │                          import_borehole_dov.py, import_borehole_dov_result.py,
│   │                          export_project.py, run_interpretation.py, queue.py
│   ├── infrastructure/
│   │   ├── db/                models/         cpt_orm.py, cpt_series_orm.py,
│   │   │                                      borehole_orm.py, drill_segment_orm.py,
│   │   │                                      field_log_interval_orm.py,
│   │   │                                      observation_orm.py, observation_layer_orm.py,
│   │   │                                      admixture_orm.py, sample_orm.py,
│   │   │                                      grain_size_orm.py, atterberg_limits_orm.py,
│   │   │                                      caco3_content_orm.py, organic_content_orm.py,
│   │   │                                      water_content_orm.py, scalar_lab_test_orm.py
│   │   │                      repositories/   cpt_repository.py, borehole_repository.py
│   │   │                      migrations/
│   │   ├── parsers/
│   │   │   ├── dov/           dov_common.py — DOV-domain shared constants
│   │   │   ├── cpt/           gef_parser.py, ags_parser.py, las_parser.py
│   │   │   ├── borehole/      dov/dov_constants.py, dov_boring_parser.py,
│   │   │   │                      borehole_parse_result.py,
│   │   │   │                      dov_interpretation_parser.py,
│   │   │   │                      interpretation_parse_result.py
│   │   │   └── lab/           dov/dov_constants.py, dov_grain_size_parser.py,
│   │   │                          grain_size_parse_result.py
│   │   ├── exporters/         base_exporter.py, plaxis_exporter.py, ...
│   │   ├── dem/               dem_provider.py (DemProvider ABC + DemZGrid),
│   │   │                      dhmvii_dem_provider.py, ahn4_dem_provider.py,
│   │   │                      dem_provider_factory.py (build_dem_provider,
│   │   │                      NoDemProviderError), dem_tile_cache.py,
│   │   │                      dhmvii_sampler.py (WCS multipart + line sampler)
│   │   ├── gis/               postgis_service.py, spatial_query.py
│   │   ├── codelists/         g3dv3_catalog.py — Flanders stratigraphy
│   │   │                      lookup; data/ has the DOV CSVs (hoofdnaam,
│   │   │                      kleur, consistentie), G3Dv3 xlsx sources +
│   │   │                      generated g3dv3_units.json + g3dv3_aliases.json
│   │   └── rust/              groundmodel_core/ (Phase 4)
│   ├── api/
│   │   ├── routers/           cpt.py, borehole.py, jobs.py
│   │   ├── schemas/
│   │   └── main.py
│   └── shared/
│       ├── logging/           levels.py, ground_model_logger.py,
│       │                      logger_factory.py
│       ├── config.py          pydantic-settings Settings
│       └── exceptions.py
├── tests/
│   ├── unit/                  no DB, no I/O
│   ├── integration/           real DB (Docker Compose)
│   └── e2e/                   full HTTP round-trips
├── pyproject.toml
├── docker-compose.yml         PostgreSQL + PostGIS
├── alembic.ini
└── .env.example
```

---

## Development Workflow

Package manager: **UV** (installed globally via winget). The `.venv` and `uv.lock` live in the repo root; `.venv` is gitignored, `uv.lock` is committed.

```
uv sync --group dev              # first-time setup or after pulling
uv run pytest tests/unit         # fast, no Docker needed
.\scripts\run-integration-tests.ps1   # integration suite (sets DATABASE_URL + runs alembic)
uv run pytest tests/e2e          # requires full stack running
uv run ruff check src tests      # lint
uv run ruff format src tests     # format
uv run mypy src                  # type check
```

**Integration tests run against a sibling DB, never the dev DB.**
``tests/integration/conftest.py`` TRUNCATEs every project-scoped
table at the start and end of every test, so running it against
``groundmodel`` (the dev DB) wipes whatever is imported. The repo
ships a separate ``groundmodel_integration`` DB on the same
dockerised Postgres instance + a wrapper script at
``scripts/run-integration-tests.ps1`` that points ``DATABASE_URL``
at it and runs ``alembic upgrade head`` first. A
``pytest_collection_modifyitems`` guard in the integration conftest
refuses to run if ``DATABASE_URL`` does not end in ``_integration``
or ``_test``, so a forgotten env var fails loudly instead of
silently destroying state. Usage:

```
.\scripts\run-integration-tests.ps1                     # full suite
.\scripts\run-integration-tests.ps1 -q                  # quiet
.\scripts\run-integration-tests.ps1 tests/integration/api/test_cross_section.py
```

One-time bootstrap (already done; recreate after a docker volume
wipe with these three commands):

```
docker exec strix-db-1 psql -U groundmodel -d groundmodel `
  -c "CREATE DATABASE groundmodel_integration;"
docker exec strix-db-1 psql -U groundmodel -d groundmodel_integration `
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
.\scripts\run-integration-tests.ps1 --collect-only       # triggers migrations
```

Alembic honours ``DATABASE_URL`` when set (see
``src/groundmodel/infrastructure/db/migrations/env.py``), so the
wrapper script's env override carries through to migrations cleanly.

**Playwright (Electron) e2e suite — `scripts/run-e2e.ps1`.** Self-contained
runner that TRUNCATEs the integration DB (clean slate — the fixture restore
is idempotent and can't repair a half-deleted project), starts a standalone
uvicorn on :8765, seeds the synthetic fixture, runs Playwright, and stops the
backend. **Close the dev desktop app first** — both use :8765, and the script
ABORTS (never kills) if the port is busy, so it can't point a live dogfeed
session at the integration DB (see ``memory/feedback_e2e_port_8765_conflicts_dev_app.md``).
A full green run is offline and deterministic.

```
.\scripts\run-e2e.ps1                                  # full suite
.\scripts\run-e2e.ps1 flow_auto_correlate              # one spec (filter)
.\scripts\run-e2e.ps1 --reporter=line                  # pass-through flags
```

**DOV cassettes — the `flow_dov_bbox_*` specs never touch the network.** The
runner sets ``STRIX_DOV_FIXTURE_MODE=1``, which makes ``make_dov_async_client``
(``dov_http.py``) back the client with an ``httpx.MockTransport``
(``dov_fixture_transport.py``) that serves every DOV call — WFS count/features
+ per-permkey CPT/borehole/interpretation/observation XML — from on-disk
fixture files under ``desktop/tests/e2e/fixtures/dov/``. The full URL→file
route table is the module docstring of ``dov_fixture_transport.py``.

The fixtures are **hand-authored synthetic DOV-format files** (permkeys like
``2024-E2E-001``, not real DOV ids) — there is no record-from-live step, so a
refresh is a pure file edit, no network. To refresh / extend them:

1. **Add or change a record** — drop the per-permkey XML under the matching
   subdir (``cpt/<permkey>``, ``borehole/<permkey>``, …) in DOV's export XML
   shape, and add the permkey to the relevant ``wfs/<layer>_features.json``.
2. **Keep the count file in sync** — the specs assert exact counts
   (``imported=3``), so bump ``wfs/<layer>_count.xml`` (the WFS
   ``numberMatched``/``numberReturned``) to match the feature list, and update
   the spec's expected count.
3. **Stay inside the fixture bbox** — a WFS request whose BBOX doesn't overlap
   ``_FIXTURE_BBOX_L72_*`` in ``dov_fixture_transport.py`` gets the *empty*
   fixture (the imported=0 rejection path). New records must sit inside that
   box, or widen the box + the spec's bbox together.
4. **New endpoint / layer** — add a route branch in the transport's ``handler``
   + a slug mapping, then the fixture file. An unmatched URL returns 404 by
   design (a missing fixture surfaces as a test failure, not a silent skip).
5. Verify with ``.\scripts\run-e2e.ps1 flow_dov_bbox_cpt_import flow_dov_bbox_borehole_import``.

**Pre-commit rules — apply to every Python file before staging:**

1. `uv run ruff format <file>` — auto-format
2. `uv run ruff check --fix <file>` — auto-fix lint issues
3. Add complete numpy style docstrings to all public modules, classes, methods, and functions that lack one

A PostToolUse hook auto-runs steps 1–2 after every file write. Step 3 is enforced by code review.

**Git pre-commit hook:** the repo ships a pre-commit hook in
`.githooks/pre-commit` that runs `uv run pytest tests/unit -q` whenever
any `.py` file is staged, plus the desktop `npm test` (Vitest) suite
when any `desktop/*.{ts,tsx}` is staged. Doc-only / config-only commits
skip the test layer. Enable it once per clone:

```
git config core.hooksPath .githooks
```

Skip in emergencies with `git commit --no-verify` — but treat that as
a flag that something needs a follow-up commit.

---

## Subagents

Six project-scoped subagents live in `.claude/agents/`. They are
Strix-tuned: each one reads CLAUDE.md (and CLAUDE.local.md, and the
memory directory) before opining, so its advice respects the layer
model, the .gmproj v3 contract, the data-integrity rules, and the
documented debt list rather than reaching for generic best practices.

| Agent | When the orchestrator reaches for it |
|---|---|
| `senior-code-reviewer` | Before commits / PRs that touch non-trivial code — a new feature, a refactor, a parser change, a migration. Returns blockers / should-fix / consider, with citations to the project rule. Skip for one-line fixes and doc-only commits. |
| `system-architect` | Before designing a new subsystem, evaluating a schema change, weighing competing implementation approaches, or considering whether to bend an architectural rule. NOT for stylistic tweaks. |
| `staff-engineer` | For non-trivial implementation work — designing + writing a feature inside the existing conventions, modernising a legacy module, mid-stream performance fixes. Less review-focused than `senior-code-reviewer`; this is who builds the thing. |
| `security-reviewer` | Before merging code that touches a security-sensitive surface — file parsers (DOV XML, GEF, .strix), DB query construction outside the ORM, Electron IPC handlers, file-system access from the renderer, endpoints that take user-supplied IDs, future license/auth flows. Critical / High / Medium / Low findings with concrete attack scenarios. NOT a substitute for `senior-code-reviewer` — pair them on diffs that touch trust boundaries. |
| `product-strategy-advisor` | Build/kill/defer/enhance decisions, competitive positioning vs gINT / D-Series / GeoStudio, pricing tier shape, validation cadence, v1.0 MVP gate scope. NOT for implementation questions. |
| `ux-reviewer` | Before committing a diff that touches the desktop UI — a new panel/modal/inspector, a changed interaction (selection / drag / keyboard / zoom), an empty/loading/error state, a colour/contrast/dark-mode change, or any engineer-facing flow. Judges against the layered UX stack in `docs/ux.md` AND against what the market leaders (gINT / LeapFrog / Plaxis / D-Series / GeoStudio) have trained the user's customers to expect. NOT for backend/parser/schema work. |

**What "automatic" means in practice.** The agent descriptions are
how Claude Code's orchestrator decides when to delegate — there is
no hard rule that says "every commit MUST run senior-code-reviewer".
When the situation matches the description (a real review on a real
diff, a real architecture question on a real subsystem), the
orchestrator will reach for the matching agent. When it doesn't,
ask explicitly: *"hand this to senior-code-reviewer first"* is
always a valid override.

**Cost discipline.** Each agent call spends a separate context
window. Use them where the signal-per-token is high: review before
push, architecture before a multi-day build, strategy before a
naming / pricing / launch call. Don't fan out four agents in
parallel for a one-line config change.

**Adding more.** Drop a new `.claude/agents/<name>.md` with the
standard frontmatter (`name`, `description`, `model`, optional
`color`, optional `tools`) and a body that's the agent's system
prompt. Keep the description tight and trigger-shaped (when to
delegate, not the agent's whole philosophy) — that's what drives
auto-selection.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| API | FastAPI | async, Pydantic validation |
| Database | PostgreSQL + PostGIS | spatial queries, depth series |
| ORM | SQLAlchemy + Alembic | migrations |
| Data | Polars | fast series processing; PostGIS for spatial |
| Performance | Rust / PyO3 | Phase 4 only |
| Testing | pytest, pytest-asyncio, factory-boy | |
| Frontend | Electron + React | desktop first, SaaS later |
| 3D | CesiumJS | geographic context |

**Node runtime — pinned to 22 LTS.** Node 24.15 segfaults on the
static-ESM resolver path that ``vite``/``vitest`` walks (deep
``tinyglobby → fdir`` chain) — diagnosed 2026-05-11. Plain
``node script.js`` works; ``vitest run`` crashes before any test
file is loaded. Stay on Node 22 LTS until V8 13.6 ships a fix.
``winget install OpenJS.NodeJS.22 --force`` is the recovery path.

---

## Depth Series Storage

Hardest schema decision — decide before writing any ORM model.

**Recommended (Option C — Hybrid):** store raw series as PostgreSQL arrays (one row per CPT, Polars-friendly) plus a materialized summary table for spatial and cross-CPT queries.

```sql
-- raw storage
cpt_series (cpt_id, depths FLOAT[], qc FLOAT[], fs FLOAT[], u2 FLOAT[])

-- queryable summary
cpt_summary (cpt_id, max_depth_m, avg_qc_mpa, location GEOMETRY, ...)
```

---

## Definition of Done

Every implementation is only complete when ALL of the following are satisfied.
Apply this checklist before committing any Python file:

### 1. Logging
- **Entry point** — every public method logs what it received (key params at INFO or DEBUG).
- **Exit point** — log the outcome at SUCCESS (happy path) or WARNING/ERROR (degraded path).
- **External calls** — every HTTP request logs the URL + params at TRACE/DEBUG *before* the call, and the status code + response size *after*. On non-2xx: log the full response body (truncated to 500 chars).
- **Null/missing structure** — log what *was* found when expected elements are absent (e.g. print actual XML child tags, actual JSON keys) so the mismatch is immediately visible without re-running with a debugger.
- **Progress in loops** — `[i/total]` prefix on every item in a bulk loop (imports, downloads, etc.).
- **Level guide:** `trace` = per-row / per-byte detail; `debug` = per-item decisions; `info` = phase boundaries; `warning` = degraded but continuing; `error` = item failed, processing continues; `success` = happy-path completion.

### 2. Docstrings
All public modules, classes, and methods must have a numpy-style docstring. Private helpers need at least a one-line summary. Docstrings must document: what the function does, every parameter (name, type, meaning), return value, and exceptions raised.

### 3. Comments
Add a comment when the WHY is non-obvious: hidden constraints, schema quirks, coordinate order, protocol version choices, workarounds. Do NOT comment what the code says — only why it is written that way.

### 4. Tests
- Every new parser / service / use case needs unit tests.
- Cover: happy path, at least one structural error path (missing field, bad input), and the type/variant detection logic if applicable.
- Tests live in `tests/unit/` (no DB, no I/O) unless integration is unavoidable.
- Run `uv run pytest tests/unit/ -q` and confirm all pass before committing.

---

## Data Integrity Rules

These rules govern what we store, what we compute on demand, and how we tag the difference. Their goal is to keep the database honest: a stored value should never silently disagree with the values you'd derive from its inputs.

### 1. Never store a value WE derived from other stored values without tagging its provenance

If our parser computes `Y` from `X1` and `X2`, then storing `Y` next to `X1` and `X2` creates a drift risk: editing `X1` later silently invalidates `Y`. Two acceptable patterns:

- **Compute on read.** Don't store `Y` at all. Implement it as a `@property` on the dataclass (e.g. `AtterbergLimits.plasticity_index_pct`) or recompute in the API endpoint (e.g. `Ic` and CPTU `qt_mpa` in `/cpt/{id}/plot` via `calculate_qt_series`). This is the default — choose it unless query performance forces otherwise. Note that "the source file provided it" is NOT a counter-argument: a source-provided value that is fundamentally `qc + u2(1-a)` (or `(fs/qc)·100` for some Rf cases) is the cone software performing the same arithmetic we'd perform — saving it as if it were a measurement is a category error.
- **Store with provenance.** Persist `Y` alongside a `*_source` column carrying `DerivedValueSource.MEASURED` (the source file gave us `Y` directly — preserve it as-is) or `DerivedValueSource.COMPUTED` (we derived it; safe to recompute and replace). Example: `cpt_series.rf_pct` + `cpt_series.rf_source`. Use this only when (a) the source-provided value carries information beyond a textbook recomputation (instrument-specific corrections, alternative definitions, manufacturer rounding) AND (b) recomputing on every read is too expensive. Rf qualifies because some cones report a slightly-different `Rf` than `(fs/qc)·100` due to internal corrections; CPTU `qt` does NOT qualify because the formula is fixed.

`NULL` provenance means "unknown" — typically a legacy row that pre-dates the flag. UI and consumers must handle the unknown case gracefully.

### 2. Pass-through values are NOT derived

A value the source provides directly — even if conceptually it could have been derived elsewhere — is a measurement, not a derivation. Examples:

- `depth_m` — DOV ships `<diepte>` already inclination-corrected; GEF ships `depth_m` directly. Our parsers never recompute depth from length and inclination, so they never own a derivation. No provenance flag needed.
- `Borehole.drill_method` (the WFS-level summary) — DOV provides it as its own field, not derived from the per-segment `DrillSegment` list.
- `Borehole.total_depth_m` — DOV ships `diepte_tot_m` as a header field.

If we ever start computing one of these from other stored fields, the rule from §1 kicks in and we add a provenance flag.

### 3. Don't auto-convert between independently measured quantities

When two related quantities are measured by different methods and the conversion factor is empirical (i.e. soil-type dependent), keep them as independent fields and refuse to derive one from the other. Examples:

- `OrganicContent.carbon_pct` and `OrganicContent.matter_pct` — Van Bemmelen `OM ≈ 1.724 × OC` is empirical; auto-converting would fabricate data the consumer can't tell from a measurement. Each lab reports either or both, and we store what was reported.
- `pct_passing` vs `pct_larger` for grain size — store the form the source uses (DOV: % larger). Conversion is trivial for the consumer; auto-flipping at ingest would require choosing a canonical direction and discarding source fidelity.

### 4. Denormalised summary columns are an exception, with discipline

A small number of aggregations (`cpt.max_depth_m`, `cpt.n_rows`, future `borehole.n_observations`, `borehole.n_samples`) are stored alongside the full series for cheap list/spatial queries. They will drift if the underlying rows are mutated. The rule:

- They MUST be written atomically with the parent row (same transaction).
- They MUST be recomputable from the persisted data — i.e. they're a query-perf optimisation, not a source of truth.
- They MUST NOT be exposed as separate API resources that consumers can update independently.

### 5. Validation invariants belong in the parse result, not in the domain

Cross-field invariants — e.g. `Borehole.total_depth_m ≈ max(drill_segments.base_m)`, sample/observation depths within `[0, total_depth_m]`, observations contiguous within a stream — are flagged as `ValidationIssue`s emitted by the parser, not enforced by raising in the domain dataclass. Reasoning: the domain has to accept whatever the source gave us (occasionally messy real-world data) so the rest of the pipeline can run; the validator records the problem for the user to see.

### 6. Committed boundaries are an audit point, not a UI-surface barrier

A `formation_contact` row (geological models) or a `litho_layer` row
with `status='accepted'` (litho models) is the *durable* record of a
committed boundary — every depth change must go through the matching
use case (`UpdateFormationContact` for FC; `UpdateLithoLayer` /
`MoveLithoLayerBoundary` / `BatchUpdateLithoLayers` for LL) so it
lands in backend logs, hits schema invariants, and increments
`updated_at`. The audit trail is the rule; *which UI fires the PATCH*
is not.

The litho-suggestion drag surface (`useBoundaryDrag` /
`LithoSuggestionGhostColumns`) is allowed to call the layer update
endpoints directly when a pending drag's mouseup moves a shared
boundary with an accepted neighbour — see
`docs/superpowers/specs/2026-05-30-unified-boundary-drag-design.md`.
Previously the rule was framed as "committed contact is the source
of truth, no propagation past it"; the renaming clarifies that *the
PATCH is the audit point*, not that the UI must avoid touching
committed state.

The functional invariant is preserved: the pending edits Map NEVER
carries a committed-row depth (no parallel writer), and every
committed depth change still flows through one backend endpoint with
full logs.

---

## Code Conventions

### English only
All identifiers (variables, functions, classes, modules, constants), comments, and docstrings must be in English. This applies to Python and TypeScript/React code alike.

GEF format field names from the Dutch spec (e.g. `opdrachtnummer`, `proefnummer`, `totaalweerstand`) may be mentioned in comments when cross-referencing the spec — but always alongside their English translation. Example: `# contract number (GEF: opdrachtnummer)`.

### One class per file
Every class lives in its own `.py` file named after the class in `snake_case`. The only exception is `shared/exceptions.py`, where the full exception hierarchy is grouped by convention.

### Constants in a dedicated file
Module-level constants (lookup dicts, conversion factors, magic numbers, regexes, URLs, namespaces, singleton transformers) belong in a `*_constants.py` file alongside the classes that use them. Examples:

- `gef_constants.py` next to `gef_parser.py` — quantity-to-column dict, unit conversions, MEASUREMENTVAR indices.
- `dov_constants.py` next to `dov_parser.py` — WFS URL/layer, parallelism, namespace strings, permkey regex, the WGS84→Lambert72 transformer.

Never define module-level constants at the top of a class file. Constants are uppercase public names (`DOV_WFS_URL`, not `_wfs_url`) so they're importable and discoverable. Comment WHY each value was chosen, not just what it is.

### Logging via inheritance — not module-level loggers
All service and logic classes inherit `GroundModelLogger` from `groundmodel.shared.logging.ground_model_logger`.

```python
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

class MyService(GroundModelLogger):
    def __init__(self) -> None:
        super().__init__(__name__)   # logger name = module path

    def do_work(self) -> None:
        self.debug("starting")
        self.success("done")
```

**Who inherits:** parsers, exporters, services, queue implementations, any class with non-trivial logic.

**Who does NOT inherit:** dataclasses, frozen value objects, enums, exception classes. These hold data — they don't act, so they don't log.

When a class already inherits from an ABC or another base, use multiple inheritance — `GroundModelLogger` goes first:

```python
class BaseExporter(GroundModelLogger, ABC): ...
class TaskQueue(GroundModelLogger, ABC): ...
```

Concrete subclasses always call `super().__init__(__name__)` with their own `__name__` so the logger reflects the correct module.

### `eslint-disable react-hooks/exhaustive-deps` — must carry a reason

Every `// eslint-disable-next-line react-hooks/exhaustive-deps` site MUST be preceded by a `// reason: ...` block comment explaining *why* the linter is wrong here. The S7 infinite-render-loop incident (commit `15fb2cb`) was exactly this class of bug — an effect dep array that looked correct but referenced a default-prop literal that re-identified every render. The lint rule catches most cases; the reason comment forces a human to think before silencing it. Reason-less suppressions are opaque to future reviewers and erase the linter's signal on the entire `useEffect` body.

---

## Logging

Three files under `shared/logging/` — see source for full implementation.

| File | Purpose |
|---|---|
| `levels.py` | Registers TRACE (5) and SUCCESS (25) |
| `ground_model_logger.py` | Typed wrapper: `.trace()` `.debug()` `.info()` `.warning()` `.error()` `.critical()` `.success()` `.exception()` |
| `logger_factory.py` | Singleton configurator, returns `GroundModelLogger` |

```python
logger = LoggerFactory.get_logger(__name__)
logger.trace("Parsing depth increment 1042")
logger.success("CPT imported: 10,432 rows in 0.3s")
```

**Always log:** imports, parsing errors, calculation steps, job execution, exports.

---

## GEF Parser

See [docs/parsers-gef.md](docs/parsers-gef.md) for the full reference: parsing flow, unit normalisation, quantity→column mappings (incl. the qty 15 vs qty 128 split that keeps `qt_mpa` and `q_total_mpa` in separate columns), validation enum, MEASUREMENTVAR indices, and the `ImportCpt.persist()` contract reused by every CPT importer.

---

## DOV Import

See [docs/parsers-dov.md](docs/parsers-dov.md) for the full reference: 5-phase pipeline, frontend bbox-draw flow, `ImportCptDov` backend (HTTP/2 streaming + cache-first + single-commit batching), DOV WFS / XML schema quirks (namespaces, units, `<diepte>` vs `<lengte>`), `DovXmlCache` semantics, and the httpx error→HTTP-status mapping.

---

## Job System

See `domain/models/job.py` (Job, JobStatus) and `application/queue.py` (TaskQueue ABC, SynchronousQueue).

MVP uses `SynchronousQueue` (inline execution). When load justifies it, swap for `RQQueue` or `CeleryQueue` — nothing else changes. Do not add a broker until there is a demonstrated need.

---

## Testing Strategy

**Rule:** a domain test that needs a DB connection means the architecture is leaking.

```
tests/
├── unit/          domain logic, fixture files only — no DB, no I/O, no network
├── integration/   real fixtures + real DB (or real files):
│                    db/        — full ImportCpt cycle against PostgreSQL (Docker)
│                    parsers/   — parser end-to-end against real DOV GEF files
│                    domain/    — domain services (e.g. Ic interpretation) on real data
├── e2e/           full HTTP round-trips via httpx
└── benchmarks/    pytest-benchmark performance tests (disabled by default)
```

Integration tests that need `data/cpt/` (gitignored) skip themselves at collection time when the directory is absent — see the `pytest.mark.skipif` at the top of each file.

Benchmarks use `bench_*.py` naming and are excluded from normal `pytest` runs via `addopts = "--benchmark-disable"` in pyproject.toml.

```
# Run benchmarks
uv run pytest tests/benchmarks/ --benchmark-enable -v

# Save a named result for comparison
uv run pytest tests/benchmarks/ --benchmark-enable --benchmark-save=baseline

# Compare against saved baseline
uv run pytest tests/benchmarks/ --benchmark-enable --benchmark-compare=baseline
```

### When to add a benchmark

A benchmark lands **alongside the code it measures**, not before. Specifically:

- **Add `bench_<thing>.py` when a CPU-bound function is introduced** that processes per-row or per-element work in process — parsers, interpretation services, batch transforms. These are the only things `pytest-benchmark` measures meaningfully (it times Python in-process work).
- **Don't add a benchmark just because a phase finished.** A phase that introduces only ORM models, repositories, or thin async-DB plumbing has nothing CPU-bound to benchmark — wall-clock there is dominated by Postgres round-trips and TCP, which `pytest-benchmark` cannot model. The "performance" property that matters at that layer (e.g. "`flush=False` causes one round-trip not N") is verified by the integration test, not a wall-clock benchmark.
- **End-to-end import timings live in `CLAUDE.local.md`**, not as benchmarks. They're real-network numbers (DOV bbox import wall-clock for 100 / 500 records, cold-cache vs warm-cache speedup) recorded after the full ingest pipeline lands and when something motivates re-measurement. They're documentation, not regression gates.

Concretely for current phases: borehole `bench_dov_borehole_parser.py` lands with `DovBoringParser` (Phase B); end-to-end timings get added to CLAUDE.local.md after the bbox client is wired (Phase C). The Phase A1 ORM/repository foundation has nothing meaningful for `pytest-benchmark` to measure.

---

## Build Sequence

Engineering interpretation (Robertson Ic, soil profiling, derived per-layer parameters, statistics across the model) is intentionally pushed to the **final phase**. Earlier phases focus on data: ingest it, store it, visualise it, export it. A small "preview" Ic implementation already exists from earlier work — it's kept and visible in the chart, but not extended until the final phase.

| Phase | Focus |
|---|---|
| 0 | Parse real GEF files; data reality doc; first-draft schema ✓ |
| 1 | Thin slice: import GEF → parse → store → FastAPI CPT routes ✓ |
| 2 | Electron + React desktop; project system; map; DOV chart; multi-file GEF + DOV bbox import + persistent XML cache ✓ |
| 3 | Data sources expansion: borehole + samples + lab ✓ (monitoring / DMT / pressuremeter deferred to post-v1.0) |
| **4 (v1.0 commercial MVP gate)** | **Geological model** (formations + surfaces ✓); **lithostratigraphic model** (refines geological → lithology + admixture units; borehole `ObservationLayer` + assisted-manual CPT Robertson-SBT segmenter; Lithology peer-stage scaffolding ✓ #55 resolved 2026-05-18; Phase-1 accept flow ✓ 2026-05-19; Phase-1.5 manual composition picker ✓ 2026-05-19 — two-tab `LithoCompositionPickerDialog`, `axisMode` + `handleManualLithoUnitCreate` wired through SectionPanel → SectionsCanvas, source-parameterised `_find_or_create_contact`; Phase-2 Slice 2+3 ✓ 2026-05-19 — `ResolveLithoInstances` use case + `POST /correlations/resolve` + `GET /correlations` endpoints + `GeologicalFormationUpdateRequest.instance_ordinal_locked` PATCH extension + `client.ts` `LithoCorrelationEdge`/`ResolveInstancesResponse` types + `resolveLithoInstances`/`listCorrelations` API calls + LithologyInspector ordinal badge + lock toggle + Resolve action + RO-3 inline amber stale-ordinal badge; Slice 4 (connect gesture) shipped 2026-05-19 — see Tier E resolved; Slice 5 (parent_formation_name server-side enrichment) ✓ 2026-05-19 — debt #67 fully resolved); **geotechnical subdivision** (lithostratigraphic unit → NAD packing class 1–31, driven by CPT qc/Dr; per-unit CPT-derived indicators: Robertson Ic SBT zone, Dr for sand, NAD class label, γ-estimate from SBT lookup — all labelled "CPT-derived estimate"; design-ready values φ′/c′/cu/E50 stay blank, Phase 5); **cross-sections** as the edit/view surface for all three model levels; **DXF + Plaxis exports** of the three-level geometry with unit identifiers. **G3Dv3 Flanders import** lands alongside or just after launch. The product is sellable here. Commercial-readiness work (license keys, signed installer, auto-update, marketing site) ships alongside, tracked as Tier B debt. |
| 5 (post-v1.0) | Engineering interpretation **as design-ready parameters**: the full Robertson/Mayne port (φ′ from Uzielli 2013, c′, cu, E50, OCR, Vs, G0, M per NAD class), the complete NAD-NEN xlsx parameter table (38×313), per-layer statistics (mean/std/percentiles of qc across CPTs in a corridor), Rust hotspots for batch compute. Sedimentological feature-shapes (true interfingering lenses between control points — DISTINCT from the user-invoked pinch-out wedge tool shipped 2026-05-18: that does deterministic dip-extrapolation-to-crossing for a single terminal wedge edge [explicit, ghost-previewed, commits provenance-tagged `source='pinch_out_extrapolation'` synthetic contacts via `ExtrapolatePinchOut` + `POST .../contacts/pinch-out`]; interfingering is the harder facies-geometry-between-points problem and stays Phase 5). Additional data sources: monitoring (piezometer / inclinometer), DMT, pressuremeter. Additional exports: D-Stability (`.stix` via GEOLib), D-Sheet, GeoStudio, IFC. PDF reports. Optional SaaS layer with cloud sync over the .gmproj bundle. |

**Out of scope at every phase:** Eurocode (EC7) design calculations, bearing capacity, settlement, slope stability, pile/wall design. Those belong in the downstream tools we export to.

---

## Performance Escape Hatches

| Phase | Approach |
|---|---|
| 1–4 | Pure Python + Polars (data ingest, storage, viz, exports — all I/O- or framework-bound, native code wouldn't help) |
| 5 (final) | Profile first, then replace genuine hotspots: batch Ic across a project, batch statistics across the geological model, spatial interpolation for formation surfaces |

Native code does not help: API routing, DB queries, HTTP downloads —
anything I/O-bound. asyncio + httpx + asyncpg already release the GIL
during I/O. Bench results in `CLAUDE.local.md` show current Python
performance is fine for typical project scopes; the escape hatch gets
used only when benchmarks prove Python is the bottleneck for a
real Phase 5 workload (the 2026-05-09 baseline retired all previously-
flagged candidates).

### Candidate technologies when a Phase 5 hotspot does emerge

Order roughly by solo-dev ease — pick the lowest one that fits.

1. **Numba** (`@njit(nogil=True, parallel=True)` + `prange`).
   Decorator-only; no separate toolchain, ships as a wheel, releases
   the GIL inside the JIT'd function. Best fit for embarrassingly
   parallel numeric loops: per-row Ic across all CPTs in a project,
   batch statistics. As of 2026-05 Numba 0.63 supports Python 3.14
   and ships experimental free-threading.
2. **Cython / mypyc**. Static compilation of Python-shaped code.
   Useful when the hot path is mostly Python control flow, not
   numeric loops. Adds a build step.
3. **Rust + PyO3**. Highest performance ceiling and the best
   Python-interop story of the native-language options. Cost: a
   parallel toolchain, a parallel test surface, and a parallel
   release flow. Reach for it only when Numba+Cython have both
   been measured and found wanting.
4. **Go (cgo / shared lib via ctypes)** or **C# (NativeAOT)** —
   viable fall-backs if the Rust learning curve is the blocker.
   Worse Python-interop than PyO3, better than nothing.

**CUDA is NOT on the list.** Two reasons: (a) our biggest plausible
workload is ~500 CPTs × ~10 k rows ≈ 5 M points run once per project
— GPU transfer + JIT overhead dwarfs the compute at that scale; (b)
BE/NL consulting laptops are not GPU-rich, and requiring NVIDIA
hardware is a customer-loss bet for this niche.

### Free-threaded Python (no-GIL) — tracking, not adopting

Python 3.14 (released Oct 2025) ships an officially supported
free-threaded build (PEP 779, Phase II) — no longer experimental,
but not yet the default. **We stay on the GIL build for now.**

Three conditions gate switching:

1. **Every Strix dep ships free-threaded wheels.** Today's gap:
   compatibility for psycopg / asyncpg / pyproj / shapely / ezdxf /
   defusedxml is in flux; check
   https://py-free-threading.github.io/tracking/ before any move.
2. **A measured CPU-bound multi-threaded workload exists in the
   codebase that pays for the migration.** The current bottleneck
   is I/O (DOV throttling, fsync) — free-threading helps neither.
3. **Phase III lands** (free-threaded becomes default) — at that
   point the question becomes "stay on legacy GIL or follow the
   ecosystem", not "is it worth the risk."

When (1) + (2) align before (3), revisit. Until then it's a watch
item, not an action.

---

## Export System

See `infrastructure/exporters/base_exporter.py` (`BaseExporter` ABC). Implement `PlaxisExporter`, `DStabilityExporter`, `GeoStudioExporter`, `DSheetExporter` in Phase 4 / early Phase 5. **Exports are how engineering happens** — once the ground model + parameters + statistics are exported, all design checks (bearing capacity, settlement, slope stability, etc.) run in the destination tool. The platform itself does not perform those calculations.

**Implementation note — Deltares D-Series via GEOLib.** The Deltares
D-Series (D-Stability `.stix`, D-Settlement `.sli`, D-Sheet Piling,
D-Foundations, ...) all share a single Python wrapper:
`pip install d-geolib` (MIT, actively maintained — v2.8.0 Sep 2025).
GEOLib lets us build a `DStabilityModel` (soils + polygonal layers
+ phreatic line + loads) in memory and serialise to `.stix` purely
in Python — no D-Stability install needed on the build machine.
That makes the D-Series exporters near-zero marginal cost once the
geometry contract is defined: one GEOLib call per target tool.
The probabilistic side (Probabilistic Toolkit / PTK) consumes
`.stix` downstream — Strix is the producer, PTK is not in our
integration surface.

**Plaxis is NOT a D-Series tool** — it's Bentley/PLAXIS BV, with
its own remote-scripting API (`plxscripting`). GEOLib doesn't
cover Plaxis. **Target (decided 2026-05-14): Plaxis 2D/3D 2018+;
the PlaxisExporter emits a runnable `plxscripting` Python script
(`.py`) that the engineer runs against their own Plaxis
instance.** No live Plaxis dependency at our build/test time, no
scripting license needed on our side, and the script is human-
readable so engineers can tweak it before running. `.plxs` itself
is undocumented binary (likely SQLite/Firebird inside a
compressed container, exposed via the `.plxzip` variant) and not
viable as a direct file-write target for a solo dev. The legacy
`.geo` ASCII format is pre-2014 and modern Plaxis no longer
guarantees a clean round-trip. The PlaxisExporter is a separate
effort from the GEOLib-backed exporters; targets the same
geometry contract.

**Plaxis 3D exporter — what it emits (shipped 2026-05-14).** A
self-contained `.py` script that connects to a running Plaxis 3D
via its Remote Scripting Server (`plxscripting.easy.new_server`),
clears the project, creates one Mohr-Coulomb-placeholder `soilmat`
per formation (Identification only, parameters blank — Phase 5
fills them), creates one global `soillayer` per formation in
stratigraphic order (display_order DESC → Plaxis layer 0 =
topmost = youngest), creates one `borehole` per investigation
with a known surface elevation, and calls `g_i.setsoillayerlevel`
per (borehole, layer) with the contact's absolute z. Formations
absent at a borehole emit a zero-thickness layer (top z inherits
the next-deeper present formation's top z). Endpoint:
`GET /projects/{pid}/geology/models/{mid}/export/plaxis3d`.

**Plaxis 2D per-section exporter — shipped 2026-05-16 (debt #29).**
`PlaxisSectionExporter` consumes a `SectionSnapshot` (investigations
already projected onto the section line) and emits the same shape of
`plxscripting` script as the 3D exporter, but with Plaxis 2D's
single-coordinate `g_i.borehole(x)` placed at each column's
along-section distance. Columns without a surface elevation are
dropped (a Plaxis borehole needs an absolute Head) and counted in
the script's print summary. Endpoint:
`GET /projects/{pid}/sections/{sid}/export/plaxis2d?model_id=...`
(mirrors the section DXF endpoint). Surfaced as a card in the
Export stage hub alongside section DXF; the model-wide Plaxis 3D
export stays its own card.

---

## API Endpoints

See [docs/api.md](docs/api.md) for the full endpoint catalogue (CPT, borehole, project, geology models / formations / units / contacts / surfaces, sections + DXF export, reviews, view-state). Two load-bearing rules stay here:

* **Additive only.** New fields default to optional / null. Removing or repurposing existing fields needs a deprecation cycle — see "Backwards Compatibility" above.
* **The frontend always goes through the API** — never directly to domain or DB.

Conflict semantics worth knowing without opening the catalogue:

* `409 Conflict` on duplicate import (same GEF project_id + test_id within the same app project) — response body includes `cpt_id` of the existing record so the client can auto-load it.


---

## Project files (`.gmproj`)

Engineering-app convention: each project is a file the user opens / saves.
The desktop client uses the extension ``.gmproj`` and JSON-on-disk content
versioned by ``format_version``. The DB is the live source of truth for
metadata; the file is a pointer + last-saved snapshot, mirrored via the
metadata editor.

```json
{
  "format_version": 4,
  "project": {
    "id": "<uuid>",
    "name": "Antwerp port — quay 7",
    "project_number": "GEO-2026-042",
    "client": "Port of Antwerp",
    "site_label": "Quay 7",
    "description": "Foundation investigation",
    "tags": ["foundation", "marine"],
    "default_horizontal_epsg": 31370,
    "default_vertical_epsg": 5710,
    "phase": "design",
    "status": "active",
    "view_state": { }
  },
  "cpts": [ ],
  "boreholes": [ ],
  "geological_formations": [ ],
  "geotechnical_units": [ ],
  "geological_models": [
    {
      "id": "<uuid>",
      "kind": "geological",
      "contacts": [ /* boundary-centric: FormationContact rows */ ],
      "litho_layers": []
    },
    {
      "id": "<uuid>",
      "kind": "lithostratigraphic",
      "contacts": [],
      "litho_layers": [ /* Shape A — layer-centric primitives */ ]
    }
  ],
  "cross_sections": [ ],
  "investigation_reviews": [ ]
}
```

* Pretty-printed (2-space indent, trailing newline) — git-diff-friendly.
* Timestamps (``created_at`` / ``updated_at`` / ``archived_at``) live in the
  DB only and are not persisted to the file, so re-saving without a DB
  change leaves the file byte-identical.
* **File format v4** (current — A4 of the unified litho boundary
  model) bundles the full project state with the litho axis in Shape A
  native shape. Header metadata + ``view_state`` toggle bag under
  ``project``; every CPT (with series) under ``cpts``; every borehole
  (with its full child tree: drill segments, field log intervals,
  observations + layers + admixtures, samples + 6 lab-test families)
  under ``boreholes``; the interpretation arrays
  (``geological_formations``, ``geotechnical_units``,
  ``geological_models``); the project-scoped cross-section definitions
  (``cross_sections``); and per-(project, investigation) decisions
  (``investigation_reviews``).
* **Per-model litho payload (v4):** each ``geological_models[]`` entry
  carries a nested ``contacts`` array AND a nested ``litho_layers``
  array. Geological models populate ``contacts`` only (boundary-centric
  FormationContact rows) and emit empty ``litho_layers``. Litho models
  populate ``litho_layers`` only (Shape A primitives — id, formation_id,
  anchor, depth_top_m, depth_base_m, status, source, confidence,
  parent_geo_contact_id, ...) and emit empty ``contacts``.
* Every per-project engineering decision lives here, never in
  localStorage — see ``memory/project_decisions_in_bundle.md``. The
  file weighs whatever the data weighs (JSON arrays of long
  depth-series add up — a few MB for typical projects, tens of MB
  for a 500-CPT DOV import).
* **v3 still parses.** ``SUPPORTED_BUNDLE_VERSIONS = {3, 4}``.
  v3 bundles carry litho data in the ``contacts`` array (boundary
  shape, no ``litho_layers`` field); restore creates the FCs and the
  LL→FC trigger materialises layers from them. The slice-1 de-dupe
  rule in the restore code keeps the round-trip pkey-safe when both
  fields are populated (legacy v4 bundles saved by a pre-slice-4c
  build also hit this path). v1 and v2 readers are gone — pre-shipping
  amnesty.
* Opening a file: read JSON → ``GET /projects/{id}`` → adopt the live
  metadata. If the DB row is missing (wiped DB, fresh install,
  archived elsewhere), the frontend automatically calls
  ``POST /projects/{id}/restore`` with the file's full bundle —
  metadata + CPTs + boreholes + geology + sections + reviews. The
  endpoint accepts v3 or v4 payloads; older versions return 400 +
  "re-save from a current build". Restore is idempotent (existing
  rows by id are skipped, missing rows are inserted with their
  original ids). CPTs and boreholes round-trip with their PostGIS
  geometry rebuilt from x/y/epsg on restore. The principle is:
  **the .gmproj file is the user's anchor; the DB is just a cache of
  the data**. Opening a valid v3/v4 .gmproj always brings everything
  back when the API is reachable.
* Recent-projects list lives at
  ``app.getPath('userData')/recent-projects.json`` (max 10 entries, MRU
  order). Both the File menu's "Open Recent" submenu and the Welcome
  screen's "Recent projects" column read from this single source.
* No auto-reopen on launch. The welcome screen is the always-on entry
  point — closer to Plaxis / AutoCAD / Photoshop than to Word's "reopen
  last document" behaviour. Users who want the previous project re-open
  it from the Recent column with a single click.
* Sharing a .gmproj file alone won't transfer data (the data lives in
  the recipient's DB). A self-contained "Export project bundle" feature
  is future work; today's flow is for solo work + same-machine project
  organisation.

The on-disk schema lives in ``desktop/src/renderer/src/utils/projectFile.ts``
(``ProjectFileV3`` type + ``buildProjectFile`` / ``serialiseProjectFile`` /
``parseProjectFile``). Once we ship, bumping ``format_version`` will
require keeping the old reader alive and writing an explicit
``upgrade_vN_to_vN+1`` function — see "Backwards Compatibility" at the
top of CLAUDE.md.

---

## Desktop Frontend

See [docs/desktop.md](docs/desktop.md) for the full reference: directory tree (`main/` / `preload/` / `renderer/src/{api,components,utils,hooks,App.tsx}`), per-component contracts (CptChart panel layouts, ElevationEditor, BoreholeLog, MapView, Sidebar, WelcomeScreen), the Sidebar / CptChart conventions block (sort persistence, Y_W=52 ghost axes, CPTU vs CPTM layout, color constants).

---
## UX Conventions

See [docs/ux.md](docs/ux.md) for the full reference: layered guide stack (WCAG 2.2 AA → Apple HIG → GitHub Primer → Tailwind UI / Catalyst → domain conventions), the override rule, selection model, the section-editor keyboard-shortcut table (incl. Shift-marquee, Alt-drag MOVE vs plain-drag COPY, ESC peel), detail-panel rules, map / borelog conventions, dark-mode strategy, translation + persistence, loading + error feedback. Two load-bearing rules stay here:

* **Translate at the presentation boundary, never at ingest** — domain stores raw upstream tokens; UI lookup tables live in `desktop/src/renderer/src/utils/`.
* **Reversible vs irreversible actions** — reversible (project-local hide, sort, theme): fire immediately + provide undo. Irreversible (DB delete, file delete, sending external requests): confirmation dialog, default-focus on Cancel, action-named button (never "OK").

---

## Known Architectural Debt

See [docs/debt.md](docs/debt.md) for the full backlog. Format conventions stay here so debt items written in the future match the existing shape:

* Items are bigger than a quick fix, smaller than a phase.
* When an item is resolved, **delete it from this list** — implementation history lives in commits on `develop`, not in the debt file.
* Numbers stay stable through a debt-fixing campaign (do not renumber after each fix); explicit cleanup passes compact them (last done 2026-05-14 — renumbered + priority-sorted, 21 open items, 1 resolved anchor moved out of the numbered list).
* Each open item carries three fields: **What** / **Why deferred** / **When to revisit**. The trigger condition ("when 5000 samples per borehole becomes typical", "before any non-solo user", "day-1 of debt #3") is the most important field — without it, debt items live forever.

Priority is **milestone-gated** — the next build milestone is the
**Geotech-subdivision stage**, which cannot start until the litho stage
is finished. So the litho-finishing items are **Tier G, above an
explicit gate**; everything else waits. Full entries in
[docs/debt.md](docs/debt.md). Currently open, in priority order:

**Tier G — Before the Geotech stage (finish the litho stage).**

*Currently open:* #131 (#131-c lithology-coloured gradient seam ribbon SHIPPED 2026-05-28 [contactStripeColors helper + two-stripe gradient render replacing the edge line; edge-to-edge anchoring + ±6 px; 33 vitest + tsc; dogfeed-confirmed — the one "wrong colour" was the ribbon faithfully colouring a #157 sliver, not a defect]; #131-a lens_id-FK opacity/dash variant + #131-b pinch-out terminus SUPERSEDED by body-with-extent refactor 2026-05-31 — the `lens_id` FK on `LithoCorrelationEdgeOrm` and the `formation_absence` thread are structurally moot; the ``BodyOrm`` entity owns per-side extents; see "Recently resolved" below), #123 (clay→silt correlation suggestion bug — needs owner reproduction C; diagnostic SQL documented in debt entry), #99 (litho drag-clamp through rejected layers — awaiting owner reproduction C; code investigated and confirmed correct via G34b), #138 (drag-lock after litho merge — handle becomes immovable, intermittent; needs deterministic repro; candidate paths: zero-thickness rejected stub OR stale edits Map post-absorb; filed dogfeed 2026-05-26), #149 (double SAND/SILT units after Accept-litho — v1 merge-on-accept reverted, v2 no-merge shipped, v3 straddle-retired reverted; doubling persists and is NOT straddle/segmenter-merge drift; likely admixture-sig drift across investigations or auto-populate↔Suggest aggregation mismatch — needs future dogfeed repro; **2026-05-28 dogfeed strongly suggests #157 [straddle-split slivers] is the same root cause** — a merged ghost straddling a geo boundary is re-split into two units), #134-C-bulk (extend the post-accept litho-geo snap check to accept-all-focused + bulk-one + bulk-all paths; blocked on a per-suggestion → created_contact_id mapping in the API response + a queue UI to surface N candidates without flooding the user; owner decision needed before code), #157 (accepted-litho thin slivers — CORE + SETTINGS KNOB SHIPPED 2026-05-28: `_compute_straddle_splits` drops sub-tolerance near-edge boundaries + midpoint parent assignment; `straddle_min_piece_thickness_m` Settings → Litho segmenter "Sliver guard" NumberRow, default 0.20 m; preventive-not-retroactive [re-accept to clear existing slivers]; structural follow-up = #162 coupling), #162 (couple coincident litho↔geo contacts — SHIPPED 2026-05-28 Slice 1: `formation_contact.parent_geo_contact_id` self-FK [SET NULL]; accept couple-step links + snaps geo→litho; auto-rebuild on geo move; bidirectional propagation w/ loop guard [litho→geo marks-stale, not auto-rebuild]; UnlinkLithoFromGeo + unlink-geo endpoint + context-menu item + glyph; reads the existing litho_snap_tolerance_m knob, Settings row relabelled "Litho↔geology snap". Subsumes #157 for the coincident case. mark-stale-vs-rebuild on propagation RESOLVED 2026-05-28 [owner: drags/manual edits don't auto-rebuild — mark stale; only accept auto-rebuilds]; Slice 2 [manual "Link to geology" — LinkLithoToGeo use case + link-geo endpoint + "Link to geology" menu item on uncoupled contacts] SHIPPED 2026-05-28; the coupled-contact drag/menu regression FIXED 2026-05-28 [060436ea — reference hit-strip suppressed where a litho contact is coupled to that geo contact, so the litho strip wins drag + shows the litho menu w/ Unlink]. link-geo endpoint integration tests SHIPPED 2026-05-29 [CP5 link-uncoupled+snap, CP6 no-geo-within-tolerance null body] — caught + fixed a real 500: the endpoint declared `response_model=FormationContactResponse` but the use case returns None when nothing is within tolerance, so FastAPI raised ResponseValidationError; fixed to `FormationContactResponse | None`. See docs/superpowers/specs+plans/2026-05-28-litho-geo-contact-coupling), #163 (auto-correlate refinements — adjacent-tests-only [headline], depth-band widening, post-correlate refresh bug, easier endpoint grab, right-click-edge-to-delete, split-suggestion-into-2-for-lenses; all pre-existing #127/#133 behaviour; (a) adjacent-only SHIPPED 2026-05-28 [RNG adjacency gate `_relative_neighbourhood_adjacency` over model-participant investigations — drops a pair if a third test lies in the lune between them; collinear → consecutive chain; kills spaghetti model-wide per owner "do all and delete all spaghetties"]; (b) depth-match window SHIPPED 2026-05-28 [Settings "Auto-correlate depth window" NumberRow → `view_state.litho_segmenter.auto_correlate_depth_window_m` → endpoint `base_depth_threshold_m`]; (c) refresh bug SHIPPED 2026-05-28 [coordinator `correlationEdgesRefetchNonce` bumped by `handleAutoCorrelate` → SectionsCanvas refetches edges; the edge state lives in the canvas not the hook]; (d)+(e) edge grab + right-click-delete SHIPPED 2026-05-28, then REDESIGNED 2026-05-29 [task #31, supersedes the 22px `unapproved-grab-a/b` endpoint handles]: the whole seam is now grabbable as two transparent midpoint-split `edge-grab-a/b` zones [`EDGE_DRAG_HIT_WIDTH`], each half dragging its nearer endpoint — plain left-drag retargets that end, Ctrl/Cmd-drag leaves the original + creates another from the anchor to the drop [→ wedge when it spans the layer's other boundary, 1↔2 → DetectLithoLenses]; right-click opens the delete menu on the grab zones [unapproved] or the ribbon `edge-hit-<id>` band [approved, CE-E3]; only (f) split-into-2 remains — a lens-authoring feature needing design [pair with #131-a/#101], though the new Ctrl-drag now offers a complementary drag-based lens path; owner dogfeed 2026-05-28/29).

*Recently resolved (do NOT re-add):* **2026-05-31 dogfeed batch** (lens auto-fire + ribbon weight + bulk count + lens-save race + bilateral pinch-out): (a) `bulk-suggest "investigations in this section" count` — SectionsToolbar bulkAnchors iterated project-wide visibleCpts/visibleBoreholes minus exclusion sets, so a section with 8 in-corridor tests reported "will run for 68". Routed through `investigationsOnSection(section, …)` to match every other section consumer; newTestAnchors + disabled-state gates inherit the fix; (b) `correlation ribbon thickness` — `RIBBON_HALF_HEIGHT_PX` halved 6 → 3 px (CorrelationEdgesOverlay.tsx); the band stopped fighting the lithology stripes for visual weight, 47 overlay tests pin the new size; (c) **lens detection is now an EXPLICIT verb** (owner directive 2026-05-31) — every site that used to auto-fire `DetectLithoLenses` stripped: CorrelateLithoContacts + UncorrelateLithoContacts + AcceptContactCorrelations + DeleteFormationContact + DeleteLithoLayer + UpdateFormationContact cross-merge. ResolveLithoInstances still runs inline on all six to keep instance ordinals coherent. New `POST .../geology/models/{mid}/lenses/detect` endpoint + `DetectLensesResponse` schema + `api.geology.detectLithoLenses` client method + toolbar "Detect lenses" verb (ScanSearch icon, sibling of "Materialise lens companions"). `AcceptResult.lenses_created` / `lenses_removed` stay on the response shape for client compatibility but are ALWAYS 0 from accept now. Trigger: a single manual correlate that incidentally closed a #135 topology was silently spawning a lens row, violating "no side-effects beyond the gesture". Stale `LithoLensOrm` rows survive destructive ops until the user clicks Detect lenses; the renderer tolerates dangling rows; (d) `SaveLensBoundary concurrent-PUT race` — the lens-shape editor fires PUTs ~1 ms apart while the user drags nodes; two concurrent transactions both passed the "shape exists" SELECT, both DELETEd existing nodes, both INSERTed → second commit died on `uq_litho_lens_boundary_node_order`. Serialised with `pg_advisory_xact_lock(hashtext(model_id || ':' || content_key))` at the top of `SaveLensBoundary.execute`; concurrent PUTs queue, lock auto-releases at commit, read paths (GetLensBoundary) untouched. 8 lens-boundary integration tests still pass. 1105 unit + 23 lens/correlation integration + 140 sections-stage + overlay vitest all green; (e) `lens fires prematurely on unilateral pinch-out` — `detect_lenses_from_graph` accepted a single-target #135 closure (one neighbour pinches to a point) as a lens, so a user who correlated "1 left ↔ top+base right" got a lens row even though the body's other side was unresolved. Tightened to require **bilateral closure** — a candidate body must pinch out on ≥2 distinct target investigations to fire. Algorithm rewritten to accumulate-then-filter; LensCandidate still records ONE primary target (smallest UUID) so the existing content_key triple stays stable. New unit test `test_unilateral_pinch_out_does_not_create_lens` pins the negative case; the 4 existing happy-path tests + 3 integration tests (test_detect_litho_lenses Tests 1+2+4, test_accept_contact_correlations Test 3) all reworked to a 3-investigation bilateral setup. 1106 unit + 23 integration green; (f) `stale lens rows from pre-bilateral bundles` — bundles saved under the old unilateral rule carry `LithoLensOrm` rows that the bilateral rule would no longer materialise; without intervention they survive every open + save cycle. DetectLithoLenses step 7 gained a `preserve-named` guard (skips rows where `name IS NOT NULL` — user-named lenses are intentional and only removable via `DELETE /lenses/{lens_id}`), then the project-restore endpoint (`/projects/{pid}/bundle` POST) now runs ResolveLithoInstances + DetectLithoLenses per litho model inside the same transaction as the restore, so legacy bundles self-clean on open. Named lens rows ride through untouched. New integration test `test_named_lens_survives_stale_topology_reconcile` pins the guard. 1106 unit + 38 integration green; (h) `lens shape ignored column-spacing nudge` — LensWedgeOverlay rendered its `along_m` geometry through raw `xToScreen` while every other section overlay uses `warpedXToScreen` (the post-nudge transform). At 100% spacing the two matched; at any other value the lens floated metres to the right of its parent columns (dogfeed 2026-05-31). Swapped to `warpedXToScreen` + new `warpedScreenXToAlongCb` for the drag-commit inverse (reads `warpAnchorsRef.current` at call time, same pattern as wheel-zoom). Third instance of the section-view-spacing-modifier-matters-for-ALL-geometry trap — the feedback memory is load-bearing. (i) `lens rendering not coworker-ready` — two presentation fixes (owner directive 2026-05-31, "i can't show it to my coworkers like this"): (1) source + pinch endpoints anchored at the column EDGE facing the other end of the wedge instead of column centre; the screen-edge X is converted back to world `along_m` via the warp-aware inverse so spacing stays correct. (2) Bilateral closure now renders BOTH sides — the overlay scans the approved-edge graph for every common pinch-out target of the (above, below) source pair and renders a secondary straight wedge to each one. Stored boundary shape nodes apply to the primary wedge only (data model carries one set per lens until Phase 5 two-sided authoring); secondaries render as straight pinches. Right-click → dissolve works symmetrically on both wedges. New tests LW8 (edge anchor), LW9 (secondary wedge present), LW10 (secondary has no draggable nodes). 10 lens-overlay tests + 450 sections-stage tests green. Phase 5 carve-out for two-sided authoring stays in place; we shipped the read-side without the data-model rework. (g) `stale lenses survive open-without-restore` — the restore-time reconcile (f) only fires on `POST /projects/{pid}/bundle`, but the desktop open path does `GET /projects/{id}` first and skips the restore when the project already exists in the DB, so legacy stale lens rows sat in the DB indefinitely until the user clicked `Detect lenses` manually. Added `_sweep_stale_lenses` to the FastAPI lifespan hook: after the DB probe, iterates every lithostratigraphic model in the DB and runs ResolveLithoInstances + DetectLithoLenses per model. Each model commits independently so a single bad model doesn't abort the rest; sweep failures log a warning and don't block startup. Preserve-named guard makes the sweep safe for user-named rows. Confirmed on the dogfeed DB — swept 4 models, removed 4 stale unnamed lens rows including the test2.strix one. **2026-05-29 dogfeed batch** (section + auto-correlate + lens cleanup — see docs/debt.md "2026-05-29 dogfeed batch" for detail): (a) section surface renders as a chord through the user's PLACED contacts not a TIN slice along the line (`surfaceThroughPicks`); (b) auto-correlate adjacency is SECTION-ALONG-ORDER not map-plane RNG (`AutoCorrelateContactEdges.section_id` + domain `adjacency=` override — supersedes #163a's RNG gate, which crossed columns on a section); (c) correlation grouping is LITHOLOGY-ONLY (dropped the `(parent, above, below)` triple that blocked obvious matches on boundary-edge parent mis-assignment or an extra interbed); (d) full-band correlate hit-target + void-click clears the armed source; (e) lens DEGENERACY GUARD `detect_lenses_from_graph(max_lens_thickness_m)` read from `view_state.litho_segmenter.max_lens_thickness_m` (0=off, default 5 m, Settings → Litho segmenter "Lens max thickness") — rejects near-whole-column spurious lenses + reconciles existing ones away on next correlate; (f) right-click a lens wedge DISSOLVES it via its two defining edges (the metadata-only DELETE left the body in the graph); (g) enclosed contacts correlating to NEITHER neighbour get an amber lens-candidate diamond in correlate mode (pinch-out-not-correlate cue; conversion flow + two-sided lens geometry stay future work). #159 (drag-lock after deleting an accepted litho unit — RESOLVED 2026-05-29. NOT the #152 clamp [a live-repro diagnostic never fired]; the real cause was a hit-strip overlap: `referenceContactHitStrips` suppressed the geo reference strip only when a litho contact was COUPLED [`parent_geo_contact_id`], but the #134 snap dialog leaves litho+geo coincident WITHOUT coupling, so the reference strip [painted on top, pointer-events all] ate the litho drag-strip's hover+mousedown → no drag cursor, locked. Fix: suppress the reference strip when a litho contact on the same anchor is coincident within `REFERENCE_COINCIDENCE_EPSILON_M`=1cm, not only coupled. RS3 pins it, GD5 reworked [old Slice-D z-order assertion encoded the bug]. Commits 58236f87/1466bac8/049915df. Milder near-coincident pixel-overlap variant intentionally not covered), #144 (litho accept flows now mark the project dirty — shipped 2026-05-28. The dogfeed title was a misdiagnosis: every contact mutation already writes to the DB immediately by design; the real defect was that the four accept handlers [handleAcceptLithoSuggestion, handleAcceptAllLithoSuggestions, handleAcceptBulkLitho, handleAcceptAllBulkLitho] skipped the session-imports manifest that handleCreateContact/seed/pinch-out all populate, so accepting layers left the amber flag dark + the .gmproj silently stale on close. Fix: feed each accept's created_contact_ids / created_formation_ids into addToSessionImports, guarded on non-empty so found-only accepts stay clean; bulk-all aggregates across anchors into one call per kind. No staged-commit refactor needed — the DB-is-source-of-truth architecture was never the problem. D1/D2/D3 pin it), #153 (accept-all-bulk wall-clock — shipped 2026-05-28: seeded-array leak #154 fixed + recompute-all-absences optimised [batched UPSERTs + per-section cache, 1015→377 ms] + batch accept endpoint [`POST .../contacts/batch-accept-litho-suggestions` + `BatchAcceptLithoSuggestions` use case + frontend one-call rewire of handleAcceptAllBulkLitho] — N-anchor bulk accept now 1 call / 3 commits instead of N+2 / ~2N+1; needs backend restart; see docs/debt.md), #154 (seeded-array leak — delete + Clear now prune `seeded_formation_contact_ids`; `remove_seeded_contact_ids` + `prune_orphan_seeded_ids` on CrossSectionRepository), #134-A (litho-geo snap tolerance moved from a `SectionsCanvas.tsx` constant onto `view_state.litho_segmenter.litho_snap_tolerance_m`, default 0.20 m, range 0.01-5.0 m; Settings → Litho segmenter exposes a NumberRow with hint copy on both directions; reads via `useMemo(readLithoSegmenterPrefs(project?.view_state).lithoSnapToleranceM)`. Shipped 2026-05-27), #134-B (in-flight drag-readout snap indicator — ContactsLayer's `geoSnapToleranceM` prop lights up an extra amber "↦ snap on release: 12.34 m" line + a small amber dot at the cursor anchor when the cursor is within ±tolerance of a geo contact on the same investigation; telegraphs the post-release prompt. Shipped 2026-05-27), #134-C single-path (handleAcceptLithoSuggestion now returns `Promise<AcceptLithoSuggestionsResponse | null>`; sectionAwareAcceptLithoSuggestion runs the same find-geo-snap-candidates check the drag uses and opens the existing LithoGeoSnapDialog for the new contact id when an accept lands within tolerance. Bulk paths [accept-all-focused + bulk-one + bulk-all] tracked as #134-C-bulk — they accept N suggestions with a flat created_contact_ids list and would need a queue UI to surface multiple matches. Shipped 2026-05-27), #141 (correlation triad collapsed into one SplitToolbarButton — shipped 2026-05-27: Correlate as primary verb [amber-tinted when mode is on], Auto-correlate + Accept correlations as caret items; preserves CT4/CT5 single-click toggle ergonomics; SplitToolbarButton gained `amber` prop + smarter primary-as-caret fallback that requires ≥1 enabled item so the shared-gate case fully disables the button), #148 (Clear leaves one unit + misleading "already empty" toast — resolved 2026-05-27 by today's #147 follow-up: pill unit count is model-scoped via `new Set(lithoContacts.map(c => c.formation_id)).size` and the LithologyInspector roster filters `lithoFormations` to those referenced by `lithoContacts`, so a Clear that leaves shared-sibling units in the project vocabulary now correctly reads "0 contacts, 0 units" + empty roster on the cleared model — the "1 unit retained" symptom can no longer render. `ClearLithoModel`'s orphan-aware backend sweep was correct all along; the bug was consumer-side), #147 (delete litho model + create new showed the OLD model's 823 contacts — shipped 2026-05-27, the `[project, activeLithoModel]` effect now clears `lithoContacts` + `lithoSurfacesByFormationId` SYNCHRONOUSLY at the top before the async fetch fires; previously only cleared when the new model was null, so A→B direct transitions left stale state in the fetch window. Inspector pill unit count also re-scoped to `new Set(lithoContacts.map(c => c.formation_id)).size` so a freshly-created empty model shows "0 contacts, 0 units" instead of "0 contacts, 30 units" from the project-scoped lithoFormations vocabulary), #151 (right-click menu on litho band + empty space — shipped 2026-05-27, single portalled menu with mode-branched item: band-rclick → Remove this litho unit → existing DeleteContactConfirmDialog; empty-rclick on a transparent per-column capture rect → Add new suggestion here → opens the LithoCompositionPickerDialog via useContactPicker's handlePickCpt/handlePickBorehole; LB1-LB4 pin the gesture surface), #152 (litho contact drag clamp at 10 cm + popup — shipped 2026-05-27, `contactDragClampMinThicknessM` prop on ContactsLayer, soft bounds respect the dragger's start-depth so legacy overlaps don't auto-jerk; portalled `contact-drag-clamp-popup` near the cursor when the cursor would commit past a peer's near-edge with the "right-click → delete adjacent layer first" wording; CL1-CL4 pin clamp + popup), litho cross-merge disabled (commit 9d4a01db, 2026-05-27 owner directive — `UpdateFormationContact` gates the cross-merge block on `model.kind != 'lithostratigraphic'`; geological cross-merge unchanged; Case 9 of `test_update_formation_contact_cross_merge.py` reworked to pin the new behaviour), #142 (accepted litho-ghost stayed at OLD suggestion depth after committed contact was dragged — shipped 2026-05-27, `LithoSuggestionGhostColumns` early-returns null for accepted indices so the committed contact stands alone; pending layers get a 45°-diagonal hatching overlay so the user reads "still suggestion" at a glance; G14 reworked + G14b/G14c pin the new visibility rules), #134 drag-path MVP (litho-geo snap prompt — shipped 2026-05-27 by owner-approved scope split: pure `findGeoSnapCandidates` helper sorts nearer-first / deeper-tie-break, `LithoGeoSnapDialog` modal with three actions [Snap-litho default-focused, Move-geo with rebuild+sync cascade, Cancel keep-separate] + radio group for two candidates, snap-aware wrapper around `handleUpdateContactDepth` in SectionsCanvas commits the raw drag first then opens the prompt when geo candidates exist; GS1-GS8 + SD1-SD9 pin helper + dialog; tolerance hard-coded at 0.20 m; remaining slices filed as #134-A/B/C), #136 (manual contact drag now snaps to other committed contacts on the same anchor — shipped 2026-05-27, `snapDepthsByAnchorId` carries `SnapCandidate { depth, contactId? }` and merges stratigraphy + committed contacts; ContactsLayer's `snapDepth` accepts `excludeContactId` and skips the dragger's own row so small drags no longer pull back to start; S-SC1/SC2 pin contact-snap + self-snap suppression), #139 (correlate mode unclickable when section has 0 litho contacts — shipped 2026-05-27, CanvasHints third-line hint pill `correlate-blocked-hint` + SectionsToolbar gate that intersects `lithoContacts` with `section.seeded_formation_contact_ids`; CT7/CT7b/CT8 + CH-CR1/CR2 pin the gate and hint; button stays clickable while correlateMode is on so the user can always exit), #133 Phase 2+3 (contact-level auto-correlate + lens detection + lens companions + formation-level removal — shipped 2026-05-26; user_approved column + AcceptContactCorrelations + DetectLithoLenses + MaterialiseLensCompanions; resolver + admixture propagation rewritten to consume contact edges; litho_correlation_edge table dropped; formation-level body-click gesture + ribbon + Resolve button removed), #135 (lens-pinch-out gesture — shipped 2026-05-26, lens-aware contact-correlate state machine with `lastTargetTestId` sticky window; first edge keeps source armed, second click on same target test fires another edge from same source; conservative branches for source-test re-arm + third-test re-arm; also fixed Phase 1's missing api/client wiring for the contact-correlation endpoints; CC1–CC7 pin the seven branches), #119 (same-lithology auto-merge — shipped 2026-05-25; merge_adjacent_same_lithology + Settings toggle + nad_class_range range tooltip; owner directive 2026-05-25 supersedes 2026-05-20), #122 (correlation edge opacity fade + body-hover spike — shipped 2026-05-25, always-on 20% ambient + 80% spike on body-hover; CE-O1/O2/O3 pin it), #121 (correlation polygon-ribbon rendering — shipped 2026-05-25, continuous ribbon per body ordinal replacing per-edge dashed lines; CE-R1/R2/R3/R4 pin it; lens_id variant + pinch-out terminus deferred, lens_id FK not in schema), #120 (band-rect clamp to investigation depth — shipped 2026-05-25, CE-B1/B2/B3 pin it), #76 (straddle split toast after accept-all — shipped 2026-05-25, S1-S4 + wired in useGeologicalModel), #101 (lens entity — shipped via Position 4 R1-R7 + fix-up #2 + #129 batch), #118 (pinch-out wired for Litho — shipped), #98 (right-click Split layer — shipped commit 060c6f41), #102 (same-lithology boundary merge button — shipped commit 3950385b), #127 (auto-correlate — shipped 2026-05-25), #128 (Playwright e2e harness — shipped 2026-05-25), #129a/b/c (post-Position-4 dogfeed batch — all shipped), #130 (Playwright coverage expansion convention — filed 2026-05-25, ongoing).

**═══ GEOTECH-STAGE GATE — everything below waits ═══**

**Tier B — Commercial launch gates + pre-distribution hardening:** #2 (bundled Postgres), #3 (license keys), #4 (auth on by-id endpoints; sub of #3), #5 (tamper hardening; sub of #3), #6 (installer + code signing + auto-update), #7 (marketing site + market-facing name), #47 (bundle column auto-enumeration → silent .gmproj format drift; fires at backwards-compat re-arm), #112 (bundle/restore + API input bounds — series-row cap, TIN-payload validation, PDF query-param caps), #113 (security pattern-risk cleanup — secret_key default, CQL quoting, regex anchors, IPC title cap).

**Tier D — Phase-4 export step + post-launch / Phase 5:** #104 (three-level export gap — snapshots carry geological-level data only; Phase-4 MVP export step), #13 (geotech units in section editor), #106 (application layer welded to the ORM — clean-architecture leak), #107 (schema integrity hardening — CHECK constraints / FKs / partial-unique + missing indexes), #108 (documentation refresh — docs/ + CLAUDE.md drifted from the shell + Phase-4), #109 (BaseExporter ABC split — ProjectExporter vs SectionExporter), #110 (export-path duplication — Plaxis exporters + section-export boilerplate), #111 (useGeologicalModel duplication — litho-accept block + bypassed _updateGhostEntry), #116 (test coverage gaps — RebuildModelSurfaces + SectionPdfReportExporter), #44 (cross-stage selection — per-stage consumers deferred; v1 footer shipped 2026-05-21), #52 (PDF report export — slice 1 shipped 2026-05-21; B/C/D slices pending), #56 (manual-lump cross-project reuse + standalone group editor), #60 (SeedLithoFromGeologicalModel orphaned — 4-layer chain), #70 (decision-log table for ML training — owner-audited), #71 (ML training pipeline that consumes the log — owner-audited), #79 (DOV Phase-2 import wall ~54 s decomposes as parse-bound not network-bound — instrument the offload path before any further speed work), **#93** (first-use tutorial + per-stage 'next step' hinting — onboarding; content authoring is the load-bearing piece; pre-coworker-binary trigger), **#95** (gesture cheatsheet + Help→Cheatsheet — the litho gestures landed in the section hint pill 2026-05-22; the all-stage cheatsheet half is still open), #11 (NL / multilingual stratigraphy catalog), #100b (Correlate inspector-select sticky reveal — hover half shipped 2026-05-23; sticky-select needs shared selectedFormationId).

**Tier E — Lower technical debt:** #16 (telemetry / crash reporting), #17 (legacy NULL-permkey — recovery runbook documented, no backfill code per 2026-05-17 architect review), #27 (bathymetry / water-surface DEM cells), #41 (Geology3DViewer component-mount smoke — needs a Cesium mock harness; pure-geometry math netted by `cesiumGeometry.test.ts`), #62 (pinch-out ghost-UX residual — full target+direction picker), #64 (litho 3D viewer split-viewport mode — revisit when user asks for side-by-side litho view or Phase 5 interfingering), #65 (excluded-boreholes UI for litho inspector), #68 (CorrelationEdgesOverlay menu robustness), #82 (drag-from-ghost-edge → correlation — variants B+C of #78), #114 (large-file readability — bundle restore fn + ContactsLayer), #156 ("Edit in Geology stage" deep-link lands on the 3D viewer + "contact not found" ×2 — should open the cross-section; owner dogfeed 2026-05-28), #158 (thin litho bands/slivers hard to click — expand the hit target for thin bands; owner dogfeed 2026-05-28; lower priority once #157 reduces sliver count), #155 (litho bulk flow ~4 s on a real project — ROOT-CAUSED 2026-05-28: `RecomputeAllAbsencesForModel` re-processes the ENTIRE litho model on every bulk accept, so it scales O(model size): recompute 0.36 s on a clean 553-contact model vs 3.09 s on a 1331-contact model [backend total 4.15 s]. accept/seed/auto-correlate are all ≤0.2 s. PRIMARY LEVER SHIPPED 2026-05-28: incremental recompute [`RecomputeAllAbsencesForModel(only_formation_ids=...)` wired through the batch endpoint] re-infers only the formations the accept touched — synthetic 30-formation model: full 301 ms vs incremental 50 ms for 5 touched (6×, proportional). Secondary levers still open: frontend per-anchor setState fan-out in handleSuggestAllLitho [N renders], section-scoping, and the suggest phase. See docs/debt.md).

**body-with-extent refactor (2026-05-31, ~50 commits on develop, 8 slices):** supersedes the ``LithoLensOrm``-based lens entity family (#101, #129, #131). The unilateral lens rule (bilateral closure required, but stored as one primary target) is replaced by a ``BodyOrm`` entity with independently addressable left + right extents. Four extent kinds: ``to_target`` (detector-set), ``pinch_out_halfway``, ``extrapolated``, ``open`` (user-claimed). Provenance rule: detector never overwrites user-claimed extents — user must call ``ClearBodyExtent`` first. New verb: ``POST .../bodies/suggest-pinch-outs`` (ephemeral candidates, no DB writes). Frontend: ``BodyExtentOverlay`` replaces ``LensWedgeOverlay``; ``BodyContextMenu`` + ``ProvenanceConflictDialog`` + ``ClaimExtentKindDialog`` add the user-claim gesture surface. Bundle v4 gains a top-level ``bodies[]`` array per model (pre-ship amnesty — no version bump). Spec: ``docs/superpowers/specs/2026-05-31-body-with-extent-design.md``. Plan: ``docs/superpowers/plans/2026-05-31-body-with-extent.md``. Items #131-a + #131-b are structurally moot (the ``lens_id`` FK and ``formation_absence`` thread lived on ``LithoCorrelationEdgeOrm`` which is now retired). **Lens-aware suggest (2026-06-02):** ``SuggestBodyPinchOuts`` now suppresses the host-half candidates of an enclosed lens — a thin unit bracketed by the same ``formation_id`` above and below (e.g. SAND·SILT·SAND, both sands one formation row) suggests only the lens, not the two host halves (pure helper ``domain/services/classify_enclosed_lenses.py``; exact same-formation bracket + recurring-formation-is-matrix tiebreak, ties stay normal candidates). Continuity stays emergent from correlations (no separate "continuous body" primitive); body-level admixture editing deferred to the geotech stage. Spec: ``docs/superpowers/specs/2026-06-02-lens-aware-pinch-out-suggestions-design.md``; plan: ``docs/superpowers/plans/2026-06-02-lens-aware-pinch-out-suggestions.md``. **Open-extent refinements (2026-06-02 dogfeed):** (a) an ``open`` extent (committed or ghost) draws a fixed length past the source column rather than to the section endpoint/DEM edge — configurable via Settings → Litho segmenter → "Open extent length" (``view_state.litho_segmenter.open_extent_length_m``, default 3 m, range 0.5–50). (b) the DEEPEST formation (top contact, no base contact → never framed as a body) now gets an ``open`` candidate at section EDGE tests only (substrate continues past the section; no interior pinch-out). Its base aligns with the litho band (``columnMaxDepthM`` → ``plotBottom`` fallback); the candidate carries ``below_contact_id=null`` + ``below_depth_m``, and ``BodyExtentOverlay`` derives the base from the source column's bottom for both ghost + committed render.

**Recent resolutions:** see [docs/debt.md](docs/debt.md) for full RESOLVED entries with owner directives + design rationale on each shipped item. Architectural debt history lives there; this section carries only what is currently open.

**Resolved anchor (outside numbered list):** Contact selection toolbox — kept for design rationale only.
