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
   driven by CPT qc/Dr. **MVP scope (owner directive 2026-05-18):**
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

### Floor: format_version = 3

v1 (metadata-only) and v2 (CPTs + boreholes + geology + sections) were
dev-only and have been removed pre-shipping (one-time amnesty). v3 is
the first format we commit to: it carries every per-project decision
(geology + cross-sections + investigation_reviews + view_state) so
opening on a wiped DB rehydrates the user's complete state. The
backend's ``SUPPORTED_BUNDLE_VERSIONS`` is the runtime contract;
bumping it requires the upgrade-chain steps below.

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
  "format_version": 3,
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
  "geological_models": [ ],
  "cross_sections": [ ],
  "investigation_reviews": [ ]
}
```

* Pretty-printed (2-space indent, trailing newline) — git-diff-friendly.
* Timestamps (``created_at`` / ``updated_at`` / ``archived_at``) live in the
  DB only and are not persisted to the file, so re-saving without a DB
  change leaves the file byte-identical.
* **File format v3** (current) bundles the full project state. Header
  metadata + ``view_state`` toggle bag under ``project``; every CPT
  (with series) under ``cpts``; every borehole (with its full child
  tree: drill segments, field log intervals, observations + layers +
  admixtures, samples + 6 lab-test families) under ``boreholes``;
  the geological-model interpretation arrays (``geological_formations``,
  ``geotechnical_units``, ``geological_models``); the project-scoped cross-section definitions
  (``cross_sections``); and every per-(project, investigation)
  decision (``investigation_reviews``: review status / notes / hidden
  flag, polymorphic target). Every per-project engineering decision
  lives here, never in localStorage — see
  ``memory/project_decisions_in_bundle.md``. The file weighs whatever
  the data weighs (JSON arrays of long depth-series add up — a few
  MB for typical projects, tens of MB for a 500-CPT DOV import).
* **v1 and v2 readers are gone.** Pre-shipping we cut the legacy
  parse paths in favour of one clean v3 reader/writer. Opening a
  pre-v3 .gmproj returns ``null`` from ``parseProjectFile`` and the
  frontend surfaces "re-save from a build that emits v3" instead of
  silently materialising partial state.
* Opening a file: read JSON → ``GET /projects/{id}`` → adopt the live
  metadata. If the DB row is missing (wiped DB, fresh install,
  archived elsewhere), the frontend automatically calls
  ``POST /projects/{id}/restore`` with the file's full bundle —
  metadata + CPTs + boreholes + geology + sections + reviews. The
  endpoint rejects non-v3 payloads with a 400 + "re-save from a
  current build" message; on a valid v3 payload it's idempotent
  (existing rows by id are skipped, missing rows are inserted with
  their original ids). CPTs and boreholes round-trip with their
  PostGIS geometry rebuilt from x/y/epsg on restore. The principle
  is: **the .gmproj file is the user's anchor; the DB is just a
  cache of the data**. Opening a valid v3 .gmproj always brings
  everything back when the API is reachable.
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

Order is strict priority — top-of-list = highest. Currently open in priority order:

**2026-05-16 — six-agent codebase audit** (senior-code-reviewer, system-architect, security-reviewer, staff-engineer, product-strategy-advisor, ux-reviewer-proxy) added #29–#50 and deleted #24 (Modal semantic-token migration shipped); the quick-fix follow-up de-scoped one item to #51. **Tier C campaign started 2026-05-16: #30 resolved (Export stage hub shipped), #52 filed (PDF report), #29 resolved (Plaxis 2D per-section exporter shipped), #31 resolved (section CRS allowlist guard), #33 resolved (Geology empty-state CTA), #32 resolved (geotech-units round-trip already test-covered), #34 resolved (elevation PATCH stales dependent TINs), #35 resolved (pinned_order survives Build). Tier C fully cleared 2026-05-16.** 38 open items. See [docs/debt.md](docs/debt.md) for the full text of every item below.

**Tier A — Phase 4 engineering blocker:** *(none open — #1 resolved 2026-05-14; the MVP gate's "DXF and/or Plaxis" is satisfied by the shipped DXF + Plaxis-3D exporters. Plaxis 2D is #29 in Tier C, demo-blocking not gate-blocking.)*

**Tier B — Commercial launch gates, pre-paid-revenue:** #2 (bundled Postgres), #3 (license keys), #4 (auth on by-id endpoints; sub of #3), #5 (tamper hardening; sub of #3), #6 (installer + code signing + auto-update), #7 (marketing site + market-facing name), #47 (bundle column auto-enumeration → silent .gmproj format drift; fires at backwards-compat re-arm).

**Tier C — Current work, dogfeed correctness / velocity / friction (2026-05-16 re-tier; launch-demo blockers #29–#35 all cleared, Tier B bundling deferred — app not feature-ready for packaging):** #41 (Geology3DViewer component-mount smoke — residual after pure cesiumGeometry extraction; needs a Cesium mock harness; far lower value once the pure-geometry math is covered in `cesiumGeometry.test.ts`), **#73** (bulk "Suggest litho for all tests" — confirmation dialog + Map-keyed multi-investigation ghost state; the typical project-level workflow target per owner directive 2026-05-20). *(Resolved 2026-05-18: **#55 litho peer-stage scaffolding** — LithologyStage StageDescriptor + LithologyCanvas [single-viewport Geology3DViewer when hasLithoSurfaces, guided EmptyState otherwise, module-level resetLithoCameraCallback, ground-surface useEffect keyed on lithoModelId] + LithologyInspector [ModelKindPicker + stale-surface info banner + read-only formation roster grouped under parent geological formations ordered ascending by display_order + workflow guidance footer] + LithologyToolbar [Build-litho button with stale-count amber badge + Reset Camera when hasLithoSurfaces] + `lithoStaleSurfaceCount` useMemo + `handleRebuildLithoSurfaces` + `handleAcceptLithoSuggestion` + `handleAcceptAllLithoSuggestions` useCallbacks in useGeologicalModel; **Phase 1 accept flow (2026-05-19)**: SectionsToolbar Build-litho removed → Accept-all button (BL1–BL4 rewritten); LithologyToolbar Build-litho wired (BL1–BL5); `sectionAwareAcceptLithoSuggestion` wraps accept handler at SectionsCanvas boundary forwarding `applyUpdatedSection` (#57 invariant); auto-load backdrop useEffect on litho-axis switch (idempotent, cache-first); `LithoSuggestionGhostColumns` extended: `spans_boundary` amber dashed border + straddle tooltip + parent formation name + confidence (G1–G7 vitest); `lithoLabels.ts` `formatLithoDisplayName()` Dutch label formatter (L1–L9 vitest: amount+soil adjective composition, fallback for unknown codes, null safety); `formations` prop threaded from SectionPanel to ghost columns; inspector grouped roster I4 vitest (DOM order asserted against display_order). L1–L5 hook + BL1–BL5 litho toolbar + BL1–BL4 sections toolbar + I1–I4 inspector + C1–C2 canvas + G1–G7 ghost + L1–L9 label vitest green; 831 unit total. **Phase-1.5 manual litho composition picker (2026-05-19)**: two-tab `LithoCompositionPickerDialog` (Tab 1 existing units grouped by parent geological formation / null → "Unassigned", Tab 2 new unit composition builder with live Dutch preview via `formatLithoDisplayName`; amber no-geology-context warning; `onCreateLithoUnit` chains `acceptLithoSuggestions` with synthetic one-item payload [source='manual_pick', depth_base=depth_top+0.01 sentinel] then routes to onSelect); SectionPanel: `axisMode` + `onManualLithoUnitCreate` props, picker branch; SectionsCanvas: `handleManualLithoUnitCreate` useCallback wired to acceptLithoSuggestions + #57 applyUpdatedSection invariant on both created and found paths; backend: `_find_or_create_contact` parameterised to thread `source` from suggestion (was hard-coded by anchor type). D1–D9 dialog vitest + A6–A7 backend source-passthrough unit tests + M1–M2 SectionsCanvas #57-invariant tests; 847 vitest total. **Phase-2 Slice 2+3 (2026-05-19)**: `ResolveLithoInstances` use case (`application/resolve_litho_instances_use_case.py`) — thin wrapper over `CorrelateLithoUnits.run_resolver`, no BFS duplication; `ResolveInstancesResponse` + `LithoCorrelationEdgeListItem` schemas; `POST /correlations/resolve` (idempotent, project-scope-guarded, no section_id — structural #57 guard) + `GET /correlations` (ordered by created_at) in `api/routers/geology/correlations.py`; `instance_ordinal_locked: bool | None` added to `GeologicalFormationUpdateRequest` (additive PATCH); `client.ts`: `LithoCorrelationEdge` + `ResolveInstancesResponse` types + `resolveLithoInstances` + `listCorrelations` API calls + `instance_ordinal_locked` in `GeologicalFormationUpdatePayload`; LithologyInspector: ordinal badge ("body N"/"body ?") + lock toggle (PATCH instance_ordinal_locked) + "Resolve instances" button + RO-3 inline amber stale-ordinal badge (useRef baseline + useMemo); R1–R4 use-case unit + 8 integration (incl. #57 structural guard) + S1a/S1b/S2/S3/S4a/S4b/S4c vitest; 856 vitest + 822 unit green. Slice 4 (connect-gesture on section canvas) shipped 2026-05-19 — see #67 resolved-anchor in Tier E. Split-viewport deferred → #64; litho crossings validator deferred → #65. **#58 formal/informal bridge** — `build_formal_informal_bridge` + `_resolve_bridge_key` threaded into the shared scan/execute/discover pipeline; formal-only boreholes whose code is proven by any dual-stream borehole now merge with informal-only boreholes for the same unit; Gavere dogfeed has 22 dual-stream boreholes so the bridge actively helps; 12 new unit tests B1–B6/R1–R4/I1–I3; 793 unit + 49 geology integration green. **Decision-3 stale-lump gap RESOLVED 2026-05-18 (dogfeed): bridge↔lump precedence flipped to "lump wins over bridge" — an explicit lump on the RAW key wins outright, the bridge runs only for unlumped raw keys (owner-decided). Both scan + execute now route through one shared `_resolve_lumped_key` helper (kills the scan/execute key-divergence class too). A `stratigraphy_lumping` map saved BEFORE the bridge shipped now resolves with zero re-lumping; no user action needed. Documented accepted asymmetry: lump-formal-only-but-not-informal-and-rely-on-bridge no longer auto-merges the two streams (a hand-crafted partial map; the dialog presents the bridge-merged candidate so the real flow is unaffected). +5 L-series unit tests (L1–L5), 798 unit green.** **#59 DOV formal-stratigraphy lexicon RESOLVED 2026-05-18 (re-tiered D→C by product-strategy: it degraded the v1.0 gate — formal-only boreholes split one unit into code-vs-name twins on the section). Source = DOV `FormeleStratigrafieLedenEnumType` XSD (one-time httpx pull → committed `data/dov_formal_stratigraphy.json`, 403 codes whole-of-Belgium, XSD snapshot committed as the offline-rebuild fallback; `scripts/build_dov_formal_stratigraphy.py`). Loader `dov_formal_stratigraphy_catalog.py` mirrors `g3dv3_catalog` (frozen dataclass + lru_cache singleton). Slotted into `_resolve_bridge_key` (now returns `(resolved_key, canonical|None)`): precedence raw-manual-lump → in-project bridge → **#59 lexicon** → raw passthrough; the user can STILL lump the resolved candidate (C6/C7 — owner requirement). Compound `lid1-rel-lid2` (e.g. `QH-T-QP`) decomposed + composed ("tot/of/en"); `U`=Onbekend is an owner-decided sentinel → falls through (never an "Onbekend" bucket). Full-DOV-style canonical names (owner directive). `regional_ref` keeps the raw DOV code (provenance, "translate at the presentation boundary"). Existing-project reconciliation: a pre-#59 raw-code formation is re-indexed under its canonical key so re-seeding REUSES it (no duplicate) — resolution-time only, no migration. **Layer fix:** `normalize_formation_key` relocated application→`shared/formation_key.py` (the infra catalog was a second cross-layer consumer; importing it upward was an infra→app violation + import cycle); `auto_populate` re-exports it via `__all__` so API/app/test importers are unchanged. Dual-stream display-name change (surfaced, owner-accepted): a formal layer with an informal counterpart now shows the canonical DOV name not the informal working text — deterministic + recoverable via lump. 4 loader + 9 C-series (incl. C6/C7 user-can-still-lump, C8 reconciliation, C9 discover≡execute parity) + R1–R4 retargeted to the tuple contract; 822 unit green.** **#57 — the dedupe 409 path now seeds the SURVIVOR's id into the section's `seeded_formation_contact_ids` so a deduped manual draw still renders on the section (was: 409 → ghost id → contact invisible). The seeding logic is the single `CrossSectionRepository.union_seeded_contact_ids` method (debt #60-A extraction 2026-05-19; was a shared `_seed_section_contacts` router helper) — idempotent union, project-scope IDOR guard, non-fatal + rollback-on-fail uniform, backing every site (create-201, create-409 dedup, Seed, LithoSeed, AcceptLithoSuggestions, pinch-out). Unit (`test_create_contact_section_seed`, 409 test inverted to assert the new contract) + 57 cross_section/geology integration tests green.** Resolved 2026-05-16/17: **#41 part (a) done + re-tiered to E (2026-05-17)** — the pure 3D-viewer geometry (`computeBasemapBounds` / `sampleTinZ` / `clipTrisToHalfSpace` / `clipTexTrisToHalfSpace`) extracted VERBATIM into `cesiumGeometry.ts` with 13 vitest cases; Geology3DViewer 1,739→1,580; the 585c714 `flyToCutFace` bug class is now netted. Residual = component-mount smoke (needs a Cesium mock harness; far lower value once the math is covered) → Tier E. **#12 App.tsx split — RESOLVED on substantive completion + owner-approved revised DoD: 3,200→833 lines, Sidebar.tsx deleted (#14 closed), R1 loaded-project smoke, handleCloseProjectRequest rename, visibleFormations into useGeologicalModel, AppBootError/AppLoading/AppDialogs extracted, and — net-first — the 194-line `shellContextValue` memo isolated into `hooks/useShellContextValue.ts` with a renderHook contract (`useShellContextValue.test.tsx`: T1 assembly / T2 no-stale per-slice / T3 referential stability) written GREEN before App was touched; verbatim body+deps, tsc-proven 134 bindings, net 3/3 + R1 mount + zero new tsc. The architect's literal `<400` was de-scoped: the documented coordinator-pattern floors App.tsx ~480–520, so chasing it = low-value churn; the dangerous memo + #53 are now NETTED, which was the real risk. #53 (Tier E) reframed: net exists, residual = hand-maintained dep array. #41 un-folded.**, #30 Export hub, #29 Plaxis 2D exporter, #31 section-CRS allowlist guard, #33 Geology empty-state CTA, #32 geotech round-trip verified, #34 elevation→stale TINs, #35 pinned_order survives Build, #37 delete_model now model-aware, **#38 contact-mutation use cases now unit-covered in the pre-commit suite — CreateFormationContact (DuplicateContactError pre-check + race-loser re-query), Update/Delete stale-pair propagation, and the pure dedup-survivor key. Deliberate boundary: the snapshot/rebuild/crossings orchestration use cases stay integration-tested (force-mocking 6+ session.execute chains is brittle mock-wiring, not behaviour — covered by test_geology / test_cross_section_export incl. the new #34/#35 tests). No GeologyRepositoryProtocol added: per-instance `_repo` swap + AsyncMock session is a sufficient test seam, a Protocol was speculative.**, **#51 inspector chrome migrated to semantic tokens — GeologyInspector + DataInspector + Geology3DViewer basemap dropdown + GeologyCanvas/SectionsToolbar/DataCanvas fallbacks. Deliberate boundary: categorical CPT-type badge colours (`cptBadgeColor`) and tinted selection/dirty row backgrounds stay raw+`dark:` pairs — they're data-encoding / have no tinted-surface token and are already theme-correct; only no-dark-variant chrome and clean-token-mappable classes were migrated.**, **#43 Data-stage Esc-to-map peel restored — AppShell registers ONE guarded keydown that clears the CPT/borehole detail selection back to the map. Scoped to the Data stage and yields to every more-specific Esc owner (open modal via `role="dialog"`, active bbox/section draw, the Sections editor's own per-layer peel, typing targets). Deliberate boundary: the persistent right Inspector is NOT closed on Esc — it is an always-on workspace panel (ui-shell §2.4 + soft-coupling rule), not the transient "detail panel" docs/ux.md's Esc rule targets. Shared `useGlobalShortcut` extraction still deferred to the #12 R-plan; this is the focused single-peel fix.**, **#36 RecomputeFormationSurface now filters out contacts anchored to the model's `excluded_borehole_ids` BEFORE the anchor-load + checksum, so excluding a borehole drops its point from the TIN and changes the checksum (→ recompute). Skip-not-delete: the contact row survives so un-excluding restores it, mirroring BuildSectionSnapshot's filter-at-projection. The TIN and the section view no longer disagree.**, **#40 geology.py 1,100-line monolith split into `api/routers/geology/` package — formations/models/contacts/surfaces/exports sub-routers, each a bare `APIRouter()`, aggregated in `__init__.py` on the shared `/projects/{project_id}/geology` prefix via include_router; paths byte-identical, main.py unchanged. Endpoint bodies relocated verbatim (git-slice, no retype); imports ruff-F401-pruned per file. 27 routes == 27 monolith decorators; 49 test_geology API + 26 plaxis/repo integration green; 2 DemProvider mypy errors pre-existing/verbatim-moved. Largest module 415 lines.**)*

**Tier D — Post-launch / Phase 5:** #11 (NL / multilingual stratigraphy catalog), #13 (geotech units in section editor), #39 (no batch borehole-detail endpoint — N GETs on section open), #44 (cross-stage selection model inconsistency), #28 (no interpolation-confidence signal on formation surfaces), #52 (PDF report export — Phase 5 reporting deliverable), #60 (SeedLithoFromGeologicalModel use case orphaned — no frontend verb calls seed-from-parent after owner override #1; revisit if a future automated litho-seed workflow needs the endpoint), **#70** (decision-log table for ML training — schema scaffolds now, per-decision wiring incremental; owner-audited ML directive 2026-05-20), **#71** (ML training pipeline that consumes the log — owner wants to audit ML rigorously by hand before any pipeline ships), **#72** (editable ghost composition — right-click ghost → edit soil/admixture before accept; dogfeed gap, workaround via Reject + manual create). *(#59 RESOLVED 2026-05-18 — re-tiered D→C then shipped; see the Tier C resolved-anchor.)*

**Tier E — Lower technical debt:** #15 (WFS client base class), #16 (telemetry / crash reporting), #17 (legacy NULL-permkey — documented recovery runbook + precise trigger + escape-hatch design; no backfill code per 2026-05-17 architect review: zero affected DBs, network-rematch riskier than the bug, lab-family domain key collides), #22 (CPT chart Ic/SBT conflation), #23 (toolbar clip at narrow widths), #26 (3D viewer blank basemap offline), #27 (bathymetry / water-surface DEM cells), #48 (project_bundle procedural-logger style residual — restore progress logging shipped 2026-05-17), #53 (shellContextValue dep-array silent drift — net-first fix; pairs with #12), #41 (Geology3DViewer component-mount smoke — residual after part (a); needs a Cesium mock harness), #63 (desktop tsc gate absent — ~20 standing pre-existing errors, no pre-commit tsc check; fix before first external distribution), #64 (litho 3D viewer split-viewport mode deferred — revisit when user asks for side-by-side litho view or Phase 5 interfingering), #65 (litho borehole scope toggles + crossings validator absent — revisit when litho inspector gains exclusion-toggle or first silent crossing surfaces), #66 (admixture aggregation heuristic — `_aggregate_admixtures` uses >50% thickness-weighted majority; owner-tunable at dogfeed; revisit if thin interbedded sequences produce wrong dominant admixtures), #68 (stale-TIN straddle fallback — `AcceptLithoSuggestions._compute_straddle_splits` falls back to depth-ordered contacts when geology TIN is stale/absent; logs WARNING; rebuild the geological model for full precision; revisit if stale-TIN fallbacks surface in dogfeed as incorrect parent-formation assignments), **#74** (segmenter over-segmentation — multiple same-lithology layers stacked; needs merge-threshold tuning or user-tunable slider), **#75** (drag handles in cross-section global view — works in focus but reported not in zoomed-out section, dogfeed 2026-05-20), **#76** (accept-all "splits" displayed layers — needs straddle-split-count diagnostic from next dogfeed to discriminate vs over-segmentation). *(Resolved 2026-05-19: **#67 Slice 4 on-section connect gesture** — `useCorrelate` state machine hook (Idle→Mode→Armed→clearArmed→Mode; exits on axis-switch + section-change via useSections wrapper); 6 correlate fields lifted into `UseSectionsResult` / `useShellContextValue` / `App.tsx` shell bus; SectionsToolbar `GitMerge` Correlate button (hidden on geo axis, disabled without model/section, amber when active, toggles enter/exitCorrelateMode); SectionsCanvas: `LithoCorrelationEdge[]` state + `refetchEdges` useEffect keyed on model+section, `handleCorrelate` (POST→resolve→refetch→clearArmed, no toast), `handleUncorrelate` (optimistic remove→DELETE→resolve→refetch, rollback on failure), `correlateGestureState` useMemo; `CorrelationEdgesOverlay.tsx` SVG component: always-on dashed blue edges (5 3, 1.5px, blue-500) between band midpoints, body-N/amber-? badges, dangling suppression, arm source 2px accent outline + label, valid target tint+dashed, crosshair arm rects (data-testid), not-allowed cross-group placeholder, right-click EdgeContextMenu "Remove correlation" → onUncorrelate, true-spacing amber warning (<1 m); SectionPanel: `correlationEdges` + `correlateGestureState` props wired to overlay, Esc peel extended LIFO (contextMenu→correlationSource→correlateMode→focusedColumn). 8 useCorrelate + 6 toolbar CT + 8 overlay CE + 10 fixture-update vitest; 878 total green. No LithologyInspector.tsx edits (parallel-agent lock). **Slice 5 / debt #67 parent_formation_name server-side enrichment (2026-05-19)**: `parent_formation_name: str | None = None` added to `GeologicalFormationResponse` schema (compute-on-read, Data Integrity Rule §1); `_build_parent_name_map` / `_enrich_formation` / `_enrich_formation_list` helpers in `api/routers/geology/formations.py` build an in-memory id→name map from the already-loaded project formation set — no new ORM relationship, no MissingGreenlet risk; `list_formations`, `create_formation`, `update_formation` return enriched responses; `parent_formation_name: string | null` added to `GeologicalFormationResponse` TypeScript interface; `groupByParent` in `LithoCompositionPickerDialog` prefers server-resolved name over geoFormations join, existing-unit rows show "under <name>" sub-label; `LithoFormationRoster` in `LithologyInspector` builds `parentNameById` map as source of truth for group labels with join fallback; N1–N6 pure unit tests (SimpleNamespace duck-typing, no DB); D11/D12 + I5a/I5b vitest; 886 unit + 888 vitest green. Debt #67 fully resolved.)** *(Resolved 2026-05-18: **#54 litho layer-purity — `model_kind` + `litho_constants` git-mv'd to `shared/constants/`, `SuggestionConfidence` extracted out of `litho_segmentation` into `shared/constants/suggestion_confidence.py`; all importers (api/app/infra/domain + 1 test + an ORM doc-comment) repointed; no re-export shim (internal-only, backwards-compat suspended). API layer no longer imports from domain for these. Behaviour-neutral atomic relocate (split per-file would break bisect); 779 unit + 84 integration green, enum identity asserted.** Resolved 2026-05-18: **#20 ScalarLabTest parameter-slug — owner-decided (2026-05-18) compute-on-read over a stored derived column: `infrastructure/codelists/scalar_lab_parameter_slug.py` curated `{verbatim DOV string → slug}` map (keyed off the `DOV_PARAMETER_*` constants, no re-typed literals) + `parameter_slug()` / `raw_parameters_for_slug()`. No migration, no ingest mutation — storage stays upstream-faithful (Data Integrity Rule §1 compute-on-read default); a future slug-filtered query does `slug → raw set → WHERE parameter IN (...)`. 6 unit incl. a coverage guard tying the map to `DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS`.** Resolved 2026-05-18: **#21 elevation rollback — clearing a manual override of an imported (DOV/GEF) Z now restores the surveyed value+CRS+source instead of nulling the row (graceful typo-undo); `original_elevation_m`/`original_z_epsg`/`original_elevation_source` snapshot-on-first-override on `cpt`+`borehole`, shared pure `domain/services/elevation_rollback.resolve_elevation_change` (8 unit + 2 integration), migration `b2c3d4e5f6a7`. Scope note: implemented the full 3-column snapshot (not the debt's "1 column") — value alone restores a number with lost CRS+provenance. Frontend unchanged (ElevationEditor re-renders from the PATCH response). Dev+integration DBs migrated.** Resolved 2026-05-18: **#19 bundle TIN size cap — `restore_project_bundle` now blanks `vertices`/`triangles` + forces `is_stale` on any surface whose claimed `source_contact_count` > 50_000 or whose `vertices`/`triangles` array > 200_000 (row survives, user rebuilds); `_MAX_SURFACE_SOURCE_CONTACTS`/`_MAX_TIN_ARRAY_LEN` constants + integration test. Electron total-size pre-parse cap stays #5's tamper-hardening concern, not a #19 residual.** Resolved 2026-05-17: #50 Virtuele Boring model codes codelist-gated before fan-out; #49 crossings validator collapsed N+2 round-trips → one model-contacts query; #46 shared ToolbarPrimitives extracted + in-button busy spinner on every long verb; #45 shared EmptyState/LoadingState primitive extracted + adopted across GeotechnicalCanvas/DataCanvas/DataInspector; #41 part (a) pure cesiumGeometry extracted + netted (component-mount smoke residual → Tier E); #48 restore-progress [i/total] logging (procedural-logger style residual); #45 DataInspector adopted shared EmptyState (compact variant) — #45 fully closed; #42 all three multi-class files split (formation_contact package + re-export, tin_surface/geology_validator VOs → domain/value_objects, verbatim, importers unchanged); #18 stale surfaces suppress crossings validation (shared useCrossingsValidation hook + neutral pending-build banner, auto re-validates on Build).)*

**Resolved anchor (outside numbered list):** Contact selection toolbox — kept for design rationale only.
