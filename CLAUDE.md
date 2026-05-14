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
- Robertson Ic / Soil Behaviour Type classification
- Auto soil profiling (merging Ic into layers)
- Per-layer unit weights from Robertson SBT
- Per-CPT validation that requires geotech judgement (RF range checks, qc spike detection, hybrid-method detection)

---

## Core Philosophy

- **Data correctness first** — clean ingestion + storage before any interpretation
- **Clean architecture** — dependencies flow one way: API → Application → Domain ← Infrastructure
- **Queue-ready, not queue-first** — abstract the queue from day one, add a broker when needed
- **No premature optimisation** — Python + Polars first; Rust only where profiling proves it is needed
- **Never design a layer you haven't needed yet** — build, feel the pain, then abstract
- **Engineering interpretation last** — soil behaviour type, layer detection, derived parameters all happen after data plumbing is solid
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

The data model has two distinct levels, not one:

1. **Geological model** — formations are the substrate entities
   (Boom Klei, Diest Zand, Quaternary deposits, ...). Each carries a
   surface defined at known points (borehole/CPT contacts) and
   interpolated between them. Initially manual; in Flanders the
   public G3Dv3 model can seed the default formation set + baseline
   surfaces (post-v1.0 import, big differentiator at launch).
2. **Geotechnical model** — derived from the geological. A single
   geological unit often contains multiple geotechnical units with
   different parameter sets (e.g. weathered crust of Boom Klei vs
   undisturbed clay below). Subdivision lives here, parameters land
   in Phase 5.

**Cross-sections are the editing surface, not the data primitive.**
Pick a slice through the project, see the investigations projected
on it, draw/edit formation tops between them — the edits commit to
the geological model, not to the section. The section is a view.

**Stratigraphic order — `display_order` is the age axis.** Lower
`display_order` = older formation (deeper in the stratigraphic
column). Section views and any other layered renderer iterate
formations ASCENDING by `display_order` so older paints first and
younger formations render visually on top — the geological
superposition rule. Reorder lives in InterpretationPane via
drag-and-drop; the drag-end commit renumbers every visible
formation 0..N-1 (compact) and PATCHes only the rows whose index
actually changed. The crossing validator
(``GET /geology/models/{mid}/validate/crossings``) consumes this
ordering: it samples each pair of cached TIN surfaces and flags any
(x, y) where the younger formation dips below the older. Results
surface in InterpretationPane as an amber "N surface crossings
detected" banner; refetched on every contact mutation.

**On-click build — the user controls when surfaces compute.** Per-
contact mutations (Create / Update / Delete / Batch update) DO NOT
auto-run Delaunay; they flip ``formation_surface.is_stale = True``
on the affected (model, formation) row. Only ``POST /geology/models/
{mid}/surfaces/rebuild`` (the InterpretationPane "Build model"
button + auto-fire on File → Save) clears the flag by re-running
the recompute. The section view renders stale TINs at opacity 0.35
+ dashed ``6 3`` so the engineer sees "this is your last build,
refresh to update." Distinct from the connect-the-dots fallback
(dashed ``4 3``, opacity 0.55) and from fresh TIN (solid 0.7).
Auto-recompute IS retained on the explicit "do a thing" actions
(Auto-populate from boreholes, Dedupe) — they're build-shaped
intents, not iterative edits. The ``method`` query param scaffolds
for kriging / RBF / GemPy in Phase 5; v1 enforces ``method=tin``
via regex.

### v1.0 commercial MVP gate

The product is "sellable" the moment a geotech engineer can do this
end-to-end on a real project:

1. Import CPTs + boreholes (DOV bbox + GEF files — done).
2. Define a **geological model** (formations + surfaces) for the project.
3. **Subdivide** geological formations into geotechnical units (structure only; parameter values stay blank in v1).
4. View / edit the model on **cross-sections** between investigation points.
5. **Export** the layer geometry to DXF and/or Plaxis.

Per-layer parameters, soil classification, statistics — all Phase 5
(post-v1.0). Engineers prefer to control those values manually
anyway; the layer geometry is the integration unit downstream design
tools actually consume. G3Dv3 import lands alongside or just after
v1.0 — it's high-impact for the Flanders launch demo but not a
gate (manual formation creation works elsewhere too).

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
│   │   ├── gis/               postgis_service.py, spatial_query.py
│   │   ├── codelists/         data/ — authoritative DOV CSVs (hoofdnaam,
│   │   │                              kleur, consistentie) + working-group XLSX
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
uv run pytest tests/integration  # requires docker-compose up
uv run pytest tests/e2e          # requires full stack running
uv run ruff check src tests      # lint
uv run ruff format src tests     # format
uv run mypy src                  # type check
```

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

Five project-scoped subagents live in `.claude/agents/`. They are
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
| **4 (v1.0 commercial MVP gate)** | **Geological model** (formations + surfaces); **geotechnical subdivision** (formations → units, structure only); **cross-sections** as the edit/view surface; **DXF + Plaxis exports** of the layer geometry. **G3Dv3 Flanders import** lands alongside or just after launch. The product is sellable here. Commercial-readiness work (license keys, signed installer, auto-update, marketing site) lives as separate debt items; it ships alongside the MVP feature gate, not before. |
| 5 (post-v1.0) | Engineering interpretation: Robertson Ic (production), auto soil profiling, per-layer unit weights, derived parameters, statistics, Rust hotspots for batch compute. Additional data sources: monitoring (piezometer / inclinometer), DMT, pressuremeter. Additional exports: D-Stability (`.stix` via GEOLib), D-Sheet, GeoStudio, IFC. PDF reports. Optional SaaS layer with cloud sync over the .gmproj bundle. |

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
its own remote-scripting API (`plxscripting`) that drives a
running Plaxis instance, OR a direct `.plxs` / legacy `.geo` file
write. GEOLib doesn't cover Plaxis. The PlaxisExporter is a
separate effort from the GEOLib-backed exporters — see debt #34
for the version-target decision that gates it.

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
* Numbers stay stable through a debt-fixing campaign (do not renumber after each fix); explicit cleanup passes compact them (last done 2026-05-13).
* Each open item carries three fields: **What** / **Why deferred** / **When to revisit**. The trigger condition ("when 5000 samples per borehole becomes typical", "before any non-solo user", "day-1 of debt #10") is the most important field — without it, debt items live forever.

Currently open: #1 (WFS base class), #3 (parameter-slug), #5 (telemetry), #7 (permkey backfill), #8 (elevation rollback), #10 (license keys), #11 (installer + signing), #12 (tamper hardening), #13 (marketing site + name), #25 (geotech units in section editor), #33 (bundled Postgres), #34 (Plaxis target version), #40 (auth on by-id endpoints), #44 (resolved — kept as design rationale anchor), #45 (Ctrl+Z undo), #46 (Sidebar UI overhaul), #47 (App smoke test).
