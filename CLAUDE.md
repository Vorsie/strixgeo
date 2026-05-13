# Ground Model Platform — CLAUDE.md

## Project Overview

Commercial **ground model platform** — builds and manages the unified subsurface dataset for a project. Ingests CPT, borehole, lab, monitoring, DMT, pressuremeter, and geophysical data; derives parameters and statistics; exports to design tools (Plaxis, D-Sheet, GeoStudio, ...). Built for solo development; targets Electron + React desktop first, SaaS later.

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
- Anything that produces a value used directly in a design check — those calculations belong in the downstream design tool (Plaxis, D-Sheet, GeoStudio, ...)
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
│   │   ├── gis/               postgis_service.py
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

Implemented in `infrastructure/parsers/cpt/gef/gef_parser.py`. Constants in `gef_constants.py`. Handles CPTU, CPTE, CPTM, and UNKNOWN types.

**Parsing flow:** header → data → CPT type detection → void masking → column rename → unit normalisation → depth column → Rf calculation → validation → `GEFParseResult`

**Unit normalisation:** MPa, kPa, bar, tf/m², Pa, kgf/cm² → MPa. kN (qty 128 totaalweerstand) is left as-is — for the standard 1000 mm² Belgian CPTM cone the numeric value equals MPa.

**Key quantity → column mappings (`QUANTITY_TO_COLUMN`):**
- qty 1 = `depth_m`, qty 2 = `qc_mpa`, qty 3 = `fs_mpa`, qty 4 = `rf_pct`
- qty 6 = `u2_mpa`, qty 11 = `length_m`
- qty 15 = `qt_mpa` (**CPTU only** — corrected cone resistance, qt = qc + u2(1-a))
- qty 128 = `q_total_mpa` (**CPTM only** — totaalweerstand: combined tip + sleeve force read in one go by a mechanical Begemann cone). Physically distinct from qty 15 — they share the historic "qt" symbol but are different quantities, and they're stored in separate columns to keep the data model honest.

**Validation checks (ValidationLevel: ERROR / WARNING / INFO):**
- `NO_COORDINATES` / `ZERO_COORDINATES` / `NO_EPSG` / `NO_ELEVATION`
- `MISSING_COLUMN` — qc always required; fs + u2 required for CPTU; fs required for CPTE
- `DEPTH_NOT_MONOTONIC` — ERROR
- `NEGATIVE_VALUES` — qc, fs must be ≥ 0
- `NULL_VALUES` — after void masking
- `PRE_DRILL` — detected from MVAR 13, or inferred when first depth > 0.5 m
- `NO_NET_AREA_RATIO` — WARNING for CPTU without `a` coefficient (MVAR 3)
- `RF_OUT_OF_RANGE` — Rf outside 0.05–15 % is suspicious
- `QC_SPIKES` — flags outliers > 5× neighbouring values
- `HYBRID_METHOD` — depth increment changes significantly (electric → mechanical mid-test)
- `PARTIAL_U2` — u2 only available from a depth > 0 (CPTE → CPTU mid-test)

**Key MEASUREMENTVAR indices (GEF-CPT-Report standard):**
- 3 = net area ratio (a-value)
- 12 = cone type (0=electric, 1=mechanical)
- 13 = pre-drill depth
- 14 = groundwater depth
- 17 = stop criterion

**Import guard:** `ImportCpt.execute()` raises `ParseError` (→ HTTP 400) when XY coordinates or EPSG code are missing — a CPT without a CRS-tagged position cannot be placed on a map.

**`ImportCpt.persist(result, name, app_project_id)`** — public method that accepts any `GEFParseResult` (from GEFParser, DovParser, or future parsers) and handles coordinate validation, duplicate detection, ORM mapping, and commit. `execute()` wraps this: it parses the file then calls `persist()`. Other use cases (e.g. `ImportCptDov`) call `persist()` directly without going through a file.

---

## DOV Import

DOV (Databank Ondergrond Vlaanderen) CPTs are imported via `POST /cpt/import-dov` with a WGS84 bounding box. No `pydov` dependency — direct WFS + async XML downloads + persistent on-disk cache.

**Pipeline (5 phases, all timed in logs):**

| Phase | What | Typical time (500 CPTs cold / warm cache) |
|---|---|---|
| 1+2 | WFS query + parallel download + stream-parse | 4–10 s / 0.2–0.5 s |
| 3 | Batch dedup (one IN-query for all test_ids) | <10 ms |
| 4 | Persist (one INSERT per CPT, no commit) | ~80 ms |
| 5 | Single transaction commit | ~300 ms |

**Frontend flow:**
1. User clicks "Import from DOV" → map switches to crosshair draw mode (`BboxDrawer`).
2. User drags a rectangle; `onBboxDrawn` fires `(west, south, east, north)` in WGS84.
3. `POST /cpt/import-dov` → `ImportCptDov.execute()`.
4. Frontend toast: `"X imported, Y already existed, Z failed"`. Markers refresh from a single `GET /cpt/?project_id=...` call (coordinates are in `CptListItem` so no per-CPT detail fetch).

**Backend pipeline (`ImportCptDov`):**
1. `DovClient.fetch_bbox_processed()`:
   - Transforms bbox to Lambert72 (EPSG:31370) via pyproj `always_xy=True`.
   - WFS `resultType=hits` count check; auto-splits into 4 quadrants if `> 500` features (recursive, max depth 5).
   - Streams: each XML download immediately runs the parse callback in the same async task — parse wall time is hidden inside download wait. Concurrency limited by `DOV_DOWNLOAD_PARALLELISM` (50, in `dov_constants.py`).
   - HTTP/2 client (`httpx[http2]`, `follow_redirects=True`) multiplexes requests over one TLS connection.
   - **Cache check first** — `DovXmlCache.get(permkey)` skips the network entirely on hit.
2. `_repo.find_existing_test_ids("DOV", test_ids, app_project_id)` — single batch IN-query.
3. For each non-duplicate: `ImportCpt.persist(result, name, app_project_id, commit=False, skip_duplicate_check=True)` — `add()` only, no per-row flush, no per-row commit.
4. `session.commit()` once at the end → one fsync for the whole batch.

**Reusing `ImportCpt.persist()`** — DovParser produces a `GEFParseResult`, the same type GEFParser produces. So all duplicate-detection, ORM mapping, and validation logic is shared. The `commit=False` and `skip_duplicate_check=True` kwargs let the bulk caller batch.

**Deduplication:** DOV CPTs use `project_id="DOV"` + `test_id=<sondeernummer>`, scoped to `app_project_id`. The same CPT can be imported into different projects but never twice into the same one.

**DOV WFS** — endpoint: `https://www.dov.vlaanderen.be/geoserver/ows`, feature type `dov-pub:Sonderingen` (plural). Properties: `fiche` (URL of the CPT record), `sondeernummer` (test name), `X_mL72` / `Y_mL72` / `Z_mTAW` (Lambert 72 coordinates).

**DOV XML structure** (namespace `http://kern.schemas.dov.vlaanderen.be`, plus GML for coordinates):
```
dov-schema/sondering/sondeernummer                            CPT ID
dov-schema/sondering/datum_aanvang                            ISO date
dov-schema/sondering/uitvoerder/naam                          Company
dov-schema/sondering/ligging/gml:Point/gml:pos                "X Y Z"  (EPSG:31370)
dov-schema/sondering/sondeonderzoek/sondeerapparaat/sondeerconus/conustype  E* / U* / M*
dov-schema/sondering/sondeonderzoek/sondeerapparaat/sondeerconus/net_area_ratio
dov-schema/sondering/sondeonderzoek/penetratietest/meetdata/{lengte,diepte,qc,fs,u,Qt,i}
```

Important schema quirk: only the `<dov-schema>` root is in the DOV namespace — its children (`<sondering>`, etc.) are unprefixed. GML elements ARE prefixed.

**Units in DOV XML:** `qc`, `Qt` are MPa; `fs` and `u` are kPa (DovParser divides by 1000). Depth: prefer `<diepte>` (vertical) over `<lengte>` (penetration distance).

**`DovXmlCache`** — filesystem cache at `~/.groundmodel/dov_cache/` (overridable via `DOV_CACHE_DIR` env var). One file per permkey, valid forever (DOV measurements are historical). Atomic writes (tempfile + rename). Cache failures are logged but never block the import — every operation falls through to the network path on disk error. Hit/miss rate is logged per import.

**API error mapping** — `POST /cpt/import-dov` translates httpx errors:
- `ConnectError` → 503 "Cannot reach DOV"
- `TimeoutException` → 504
- `HTTPStatusError` / other `RequestError` → 502 with upstream details

**Module layout** under `infrastructure/parsers/cpt/dov/`:
- `dov_constants.py` — all module-level constants (URLs, namespaces, parallelism, regexes, transformer)
- `dov_parser.py` — XML → `GEFParseResult`
- `dov_client.py` — async WFS + parallel XML downloads (with optional cache)
- `dov_xml_cache.py` — filesystem cache, atomic writes, permkey validation
- `__init__.py` — package marker (kept explicit for setuptools / mypy / pytest)

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
| 5 (post-v1.0) | Engineering interpretation: Robertson Ic (production), auto soil profiling, per-layer unit weights, derived parameters, statistics, Rust hotspots for batch compute. Additional data sources: monitoring (piezometer / inclinometer), DMT, pressuremeter. Additional exports: D-Sheet, GeoStudio, IFC. PDF reports. Optional SaaS layer with cloud sync over the .gmproj bundle. |

**Out of scope at every phase:** Eurocode (EC7) design calculations, bearing capacity, settlement, slope stability, pile/wall design. Those belong in the downstream tools we export to.

---

## Rust Strategy

| Phase | Approach |
|---|---|
| 1–4 | Pure Python + Polars (data ingest, storage, viz, exports — all I/O- or framework-bound, Rust wouldn't help) |
| 5 (final) | Profile first, then replace genuine hotspots: GEF parser at 10MB+ files, Ic classification on 100k+ points, spatial interpolation, batch model statistics |

Rust will not help: API routing, DB queries, HTTP downloads — anything I/O-bound. Bench results in `CLAUDE.local.md` show current Python performance is fine for typical project scopes; Rust gets brought in only when benchmarks prove Python is the bottleneck for the model-statistics workload (Phase 5).

---

## Export System

See `infrastructure/exporters/base_exporter.py` (`BaseExporter` ABC). Implement `PlaxisExporter`, `GeoStudioExporter`, `DSheetExporter` in Phase 4. **Exports are how engineering happens** — once the ground model + parameters + statistics are exported, all design checks (bearing capacity, settlement, slope stability, etc.) run in the destination tool. The platform itself does not perform those calculations.

---

## API Endpoints

```
POST   /cpt/import              Import a GEF file (multipart form; project_id form field)
POST   /cpt/import-dov          Import CPTs from DOV bbox (JSON body: west,south,east,north,project_id)
GET    /cpt/                    List CPTs (optional ?project_id=UUID filters by project)
GET    /cpt/{id}                CPT metadata (location, elevation, cone props, summary)
GET    /cpt/{id}/plot           Depth-series arrays for plotting (depths, qc, fs, u2, rf, qt)
DELETE /cpt/{id}                Delete CPT and its series (cascade). NOTE: the
                                desktop frontend no longer calls this — sidebar
                                "remove from project" is project-local
                                (localStorage), preserving the DB cache so a
                                re-import doesn't refetch.
PATCH  /cpt/{id}/elevation      Phase 3a manual surface-elevation editor.
                                JSON body: ``{elevation_m: float | null,
                                z_epsg?: int | null}``. ``elevation_m: null``
                                clears a previously-entered value. When
                                ``z_epsg`` is omitted, the canonical vertical
                                datum for the row's horizontal CRS is used
                                (31370 → 5710 mTAW for BE; 28992 → 5709 NAP
                                for NL — see ``infrastructure/codelists/
                                vertical_crs.py``). Returns the full
                                ``CptResponse`` so the frontend can patch its
                                detail cache without a second GET. 404 when
                                the id is unknown.

POST   /borehole/import-dov     Import boreholes + 8 interpretation streams + samples
                                + grain-size + Atterberg + CaCO3 + organic-C + water-content
                                + the ScalarLabTest catch-all from DOV bbox
                                (Phase C1+C2+C3+C4+C5). Response carries per-test
                                attached/failed counters in addition to the borehole
                                counts; the catch-all reports under
                                ``scalar_lab_tests_attached / _failed``.
GET    /borehole/{id}           Full borehole tree (header + drill segments + field log
                                + observations with layers + admixtures + samples with
                                grain-size + Atterberg + CaCO3 + organic + water-content
                                + the ``scalar_lab_tests`` catch-all list). 404 when missing.
PATCH  /borehole/{id}/elevation Mirror of ``PATCH /cpt/{id}/elevation`` — same
                                request body. Returns the lightweight
                                ``BoreholeListItem`` shape so the frontend can
                                refresh the sidebar badge without re-fetching
                                the heavy detail tree.

GET    /projects/               List active projects, most-recent first.
                                Optional ``?include_archived=true`` returns
                                both active and archived in one query.
GET    /projects/archived       List only archived projects (the
                                "Archived projects" view).
POST   /projects/               Create a new project. Body matches
                                ``ProjectCreateRequest`` — ``name`` is
                                required; everything else (project_number,
                                client, site_label, description, tags,
                                default CRSes, phase, status) optional.
                                Returns the full ``ProjectResponse``.
GET    /projects/{id}           Project detail (returns archived rows too).
PATCH  /projects/{id}           Partial update. Only fields present in the
                                JSON body are written; null clears optional
                                fields. ``name`` and ``status`` are NOT NULL
                                in the DB — sending null for either returns
                                400.
POST   /projects/{id}/archive   Soft-delete (stamps ``archived_at``).
                                Project + all its data preserved in the DB.
POST   /projects/{id}/unarchive Restore (clears ``archived_at``).
GET    /projects/{id}/bundle    Full project snapshot — metadata + every
                                CPT (with series) + every borehole (with
                                full child tree). Embedded verbatim in
                                .gmproj v2 files on save.
POST   /projects/{id}/restore   Idempotently materialise a project + its
                                CPTs + boreholes from a bundle when the
                                DB has lost the rows (wiped local DB,
                                fresh install). Body matches the bundle
                                shape; id is in the URL. Existing rows
                                are returned / skipped (no mutation);
                                missing rows are inserted with the
                                supplied ids. Always 200.

POST   /projects/{pid}/geology/formations           Create a formation.
GET    /projects/{pid}/geology/formations           List project formations
                                                    (display order, then name).
PATCH  /projects/{pid}/geology/formations/{fid}     Partial update.
DELETE /projects/{pid}/geology/formations/{fid}     Cascade-removes every
                                                    contact pointing at it,
                                                    plus every geotechnical
                                                    unit hanging off it.

POST   /projects/{pid}/geology/formations/{fid}/units
                                                    Create a geotechnical unit
                                                    under a formation. Structure
                                                    only in v1 (name / code /
                                                    color / display_order /
                                                    description) — parameter
                                                    values are Phase 5.
GET    /projects/{pid}/geology/formations/{fid}/units
                                                    List units under the
                                                    formation (display order,
                                                    then name).
PATCH  /projects/{pid}/geology/formations/{fid}/units/{uid}
                                                    Partial update. Parent
                                                    formation_id NOT updatable —
                                                    delete + recreate to
                                                    re-parent.
DELETE /projects/{pid}/geology/formations/{fid}/units/{uid}
                                                    Delete a geotechnical unit.

POST   /projects/{pid}/geology/models               Create a model.
GET    /projects/{pid}/geology/models               List models (active first).
PATCH  /projects/{pid}/geology/models/{mid}         Partial update.
                                                    is_active NOT updatable
                                                    here — use /activate.
POST   /projects/{pid}/geology/models/{mid}/activate
                                                    Mark active; clear flag on
                                                    every sibling.
DELETE /projects/{pid}/geology/models/{mid}         Cascade-removes contacts.

POST   /projects/{pid}/geology/models/{mid}/contacts
                                                    Add a formation top at an
                                                    investigation. Exactly one
                                                    of borehole_id / cpt_id
                                                    must be set (XOR enforced
                                                    at API + DB layers).
GET    /projects/{pid}/geology/models/{mid}/contacts
                                                    List contacts. Optional
                                                    ?borehole_id and
                                                    ?formation_id filters.
                                                    Sorted shallowest-first.
PATCH  /projects/{pid}/geology/models/{mid}/contacts/{cid}
                                                    Update depth / formation /
                                                    notes. Anchor (borehole_id
                                                    / cpt_id) NOT updatable —
                                                    delete + recreate.
DELETE /projects/{pid}/geology/models/{mid}/contacts/{cid}

GET    /projects/{pid}/geology/models/{mid}/boreholes/{bid}/validate
                                                    No-gaps validator. Returns
                                                    a list of GapIssue. Empty
                                                    list = clean stratigraphy.
                                                    Issue kinds:
                                                    missing_surface_contact,
                                                    duplicate_depth,
                                                    contact_below_test,
                                                    no_contacts.

POST   /projects/{pid}/sections             Create a cross-section (line
                                            endpoints + projection buffer
                                            + view prefs). 422 when the
                                            endpoints coincide.
GET    /projects/{pid}/sections             List sections, display_order
                                            then name.
GET    /projects/{pid}/sections/{sid}       Fetch one.
PATCH  /projects/{pid}/sections/{sid}       Partial update. Post-update
                                            distinct-endpoints invariant
                                            re-checked at the API layer.
DELETE /projects/{pid}/sections/{sid}       Delete a section.

GET    /projects/{pid}/reviews              List every per-(project,
                                            investigation) decision row
                                            (review status / notes /
                                            hidden flag). Empty when
                                            nothing has been reviewed
                                            yet — absence of a row =
                                            the default unreviewed /
                                            not-hidden state.
GET    /projects/{pid}/reviews/{kind}/{tid} Look up the decision row
                                            for one investigation.
                                            ``kind`` ∈ {cpt, borehole}.
                                            404 when no row exists.
PUT    /projects/{pid}/reviews/{kind}/{tid} Upsert by target. Body keys
                                            (all optional):
                                            review_status,
                                            review_notes, is_hidden.
                                            reviewed_at is managed
                                            server-side on transitions
                                            into / out of 'reviewed'.
                                            404 when the target row
                                            isn't in this project.
DELETE /projects/{pid}/reviews/{kind}/{tid} Drop the decision row.
                                            Idempotent — no 404 when
                                            already absent.

PATCH  /projects/{pid}/view-state           Shallow-merge a patch dict
                                            into ``project.view_state``
                                            (project-level toggles:
                                            DEM overlay, hidden-by-type
                                            sets, …). ``null`` for a
                                            key removes it. Returns
                                            the full ProjectResponse.
```

409 Conflict on duplicate import (same GEF project_id + test_id within the same app project) — response body includes `cpt_id` of the existing record so the client can auto-load it.

The frontend always goes through the API — never directly to domain or DB.

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

Electron + React (TypeScript), built with `electron-vite`. Entry: `desktop/`.

```
desktop/src/
├── main/              Electron main process — spawns FastAPI, IPC handlers
├── preload/           Context bridge: openFile, readFile, waitForApi, menu events
└── renderer/src/
    ├── api/
    │   └── client.ts  Typed fetch wrappers; DuplicateCptError class for 409 handling
    ├── components/
    │   ├── ui/        Button.tsx — shared variant (primary/secondary/danger/ghost) + size (sm/md)
    │   ├── BboxDrawer.tsx     Inside MapContainer; crosshair draw mode for DOV bbox selection
    │   ├── CptChart.tsx   DOV-standard chart: type-aware panels, ghost axis alignment.
    │   │                  Header carries the inline ``ElevationEditor`` when an
    │   │                  ``onElevationChange`` handler is wired (Phase 3a).
    │   ├── ElevationEditor.tsx Inline manual-Z editor shared by CptChart and
    │   │                       BoreholeLog headers. Idle: amber "Set elevation"
    │   │                       link when null, "Z = X.XX m TAW" + pencil hover
    │   │                       when present. Editing: text+inputMode=decimal,
    │   │                       Enter saves, Esc cancels, "Clear" returns the
    │   │                       row to the "needs Z" state. Range-clamps to
    │   │                       [-500, 9000] m client-side mirroring the
    │   │                       ElevationPatchRequest server validator.
    │   ├── MapView.tsx    Leaflet map: CPT + borehole markers, layer-control dropdown
    │   │                  (Option B per-category expand), bottom-right legend.
    │   │                  Visibility state lives in App so Sidebar can read it too.
    │   ├── Sidebar.tsx    CPT + borehole list; sort dropdown (Default / Name / Depth);
    │   │                  multi-select checkboxes + bulk "Remove from project"
    │   │                  action bar; hover-trash for single-row remove. Removes are
    │   │                  project-local (localStorage), never DB delete.
    │   ├── BoreholeLog.tsx    Borelog SVG: lithology with patterns + admixture chips
    │   │                       (color swatch + qualifier code), drill method, field log,
    │   │                       sample track with lab-test family icons (★ for catch-all).
    │   │                       Header carries the inline ``ElevationEditor`` when an
    │   │                       ``onElevationChange`` handler is wired (Phase 3a).
    │   ├── LabTestPanel.tsx   Slide-in detail panel; ScalarTestsSection groups catch-all
    │   │                       tests by parametergroep, ASTM rows show D2487 description.
    │   ├── NewProjectDialog.tsx Modal for File → New Project. Replaces the
    │   │                        Electron-disabled ``window.prompt``. Name-only
    │   │                        MVP today; richer metadata editor extends this
    │   │                        component when task #16 ships.
    │   ├── Toolbar.tsx    Import button (GEF + DOV)
    │   └── WelcomeScreen.tsx  Shown when no project is loaded. Two-column
    │                          layout: Create / Open card on the left, Recent
    │                          Projects column on the right (hidden when empty).
    │                          Engineering-app convention — no auto-reopen on
    │                          launch (Plaxis / AutoCAD / Photoshop pattern).
    ├── utils/
    │   ├── soilColors.ts      108-code DOV hoofdnaam lookup → English label + color
    │   ├── soilPatterns.tsx   SVG <pattern> defs (FZ/KL/SI/LE/KA/GL/ZS/XZ/NN/ST/VE/SN…)
    │   ├── labTestLabels.ts   Translations for DOV parameter / parametergroep + USCS
    │   │                      D2487 ASTM code descriptions (CL → "Clay (lean)", …)
    │   ├── projectFile.ts     .gmproj file format helpers (build/serialise/parse).
    │   │                      Format version 1 — JSON pointer to a DB row. See
    │   │                      "Project files" below for the schema.
    │   ├── verticalDatum.ts   EPSG → datum-label lookup (5710→mTAW, 5709→NAP)
    │   └── useWgs84.ts        Lambert72 → WGS84 projection cache
    ├── hooks/
    │   └── useProject.ts  File-aware project hook. State: project (live
    │                      ProjectResponse from API) + filePath (.gmproj path).
    │                      Actions: newProject (POST + save dialog + write file,
    │                      with archive-rollback on cancel/error), openProjectFile,
    │                      pickAndOpenProject, updateMetadata, archiveCurrent,
    │                      closeProject. No auto-reopen — welcome screen is the
    │                      always-on launch surface.
    └── App.tsx            Project gate, data loading, import handlers, toasts.
                           Owns layer-visibility state (hidden CPT types, hidden
                           borehole values per axis, current axis) AND project-local
                           "removed" sets persisted to localStorage per project id.
                           Filters cpts/boreholes via removed sets before passing
                           anywhere user-visible.
```

### Sidebar conventions
- Sort persists per session: `localStorage["groundmodel.sidebar.sort"]`
- Removed-from-project set persists per project: `localStorage["groundmodel.removed.{projectId}.{cpt|borehole}"]`
- Multi-select checkbox ALWAYS visible (left of row icon); row body click opens detail
- Bulk action bar appears only when ≥1 selected; "Remove" + "Clear"; tab switch resets selection
- Hidden-by-map-filter rows go to the bottom of the list at `opacity-40`, still clickable
- Footer "N removed · restore all" link undoes everything in the active tab

### CptChart conventions
- `Y_W = 52` — width constant used for ALL Y-axes (real and ghost) to align plot areas across side-by-side `ComposedChart` panels
- Ghost axes: `tick={false} axisLine={false} tickLine={false} width={Y_W}` — reserve pixel space without display
- Level (mTAW) always on the leftmost panel's left axis; Length (m) always on the rightmost panel's right axis
- CPTU layout: u2 panel (kPa) | qc+fs panel | Rf panel
- CPTM layout: single panel with qc (black) + Qt total resistance from `q_total_mpa` (blue `#1d4ed8`) on same qc axis. The chart's `qt` data field falls back to `qt_mpa` for CPTU but renders the line only when present.
- Panel renderers are called as functions `{renderPanel(...)}` not JSX components — no hooks, avoids remount
- Colors: `QC_CLR=#111827`, `FS_CLR=#16a34a`, `RF_CLR=#b45309`, `U2_CLR=#7c3aed`, `QT_CLR=#1d4ed8`, `PD_CLR=#dc2626`
- `surfaceElevationRef` — ReferenceLine at depth=0 labelled with mTAW elevation when known
- `IcZoneLabelsOverlay` — absolute overlay at `bottom: 46` inside the Ic panel; each label is pinned at its zone's x-centre and rotated -55° (`transformOrigin: bottom center`) so they read diagonally upward; uses `IC_ZONE_SHORT` for abbreviated names in narrow zones

---

## UX Conventions

The desktop UI is built against a **layered stack of style guides**, in
order of precedence when they disagree:

1. **WCAG 2.2 — level AA**, the non-negotiable accessibility floor.
   4.5 : 1 contrast for body text, 3 : 1 for large text and UI
   components, visible focus rings on every keyboard-reachable
   element, 44 × 44 px minimum hit-target on touchable surfaces, full
   keyboard reachability, no information conveyed by colour alone.
2. **Apple HIG** for desktop interaction conventions. The most useful
   chapters for this app: Modality / Sheets / Popovers / Sidebars /
   Inspectors / Keyboard Shortcuts. Treats Esc as the universal
   dismiss key, ⌘0 / Ctrl+0 as zoom-reset, ⌘W / Ctrl+W as close pane.
3. **GitHub Primer** for visual tokens + dark-mode strategy. Two
   surface levels (page, card), accent (blue) reserved for primary
   action / selection, danger (red) reserved for destructive intent,
   muted greys for secondary chrome. We map these onto Tailwind
   utility classes (mostly `slate-*` / `gray-*` / `blue-*` /
   `red-*`); when Primer says "use accent.primary" we read that as
   `blue-600` light / `blue-400` dark.
4. **Tailwind UI / Catalyst** for code-level pattern lifts when a
   component shape exists there.
5. **Domain conventions** (ISO 14688-1 soil patterns, DOV PDF report
   layout) override every general guide above for the borelog and
   anything geotechnical-domain-specific. Generic UI (sidebars,
   dialogs, panels) follows the layered defaults strictly.

### Override rule

When a guide actively hurts UX or conflicts with domain need:

* Override at the smallest scope possible (one component, never the
  whole app theme).
* Document **why** in a header comment near the override, citing the
  guide rule it bypasses.
* Domain convention beats general convention; general convention beats
  personal taste. "I think it looks better" is not a documented
  reason — find which higher principle the guide rule is failing in
  this case (e.g. "ISO 14688-1 mandates dotted fill for sand, which
  Primer's solid-fill cards fight against — overriding").

### Selection

* **Click row body** — select / open detail (single-select).
* **Hover-X icon** — single-row remove (project-local; never DB delete).
* **Checkbox** — multi-select, always visible left of the row icon
  (NOT hover-only — discoverability beats clean-row aesthetics for
  power users curating large lists).
* **Bulk action bar** — appears at the top of the list when ≥ 1 row
  is checked; format: `N selected · [Action] · Clear`.
* **Tab switch resets selection** — checkboxes in a different tab
  refer to different items; carrying selection across is misleading.

### Keyboard shortcuts

| Shortcut | Action | Scope |
|---|---|---|
| `Esc` | Close detail panel / cancel bbox draw / cancel modal | Global, when applicable |
| `← / →` | Prev / next item in detail panel (samples, future CPTs) | When detail panel open |
| `Ctrl + wheel` | Zoom (vertical scale on borelog, depth axis on map) | Map + borelog |
| `Ctrl + 0` | Reset zoom to 100 % | Borelog |
| `Delete` / `Backspace` | Remove selection (project-local) | When ≥ 1 row checked |
| `Ctrl/Cmd + A` | Select all | Future — list views |
| `Ctrl/Cmd + F` | Filter / find | Future — list views |

All shortcuts skip when an `<input>` / `<textarea>` / `<select>` /
`contentEditable` element owns focus — a centralised `isTypingTarget`
helper checks this before firing. The same helper is duplicated across
the three components that listen today (Sidebar / BoreholeLog /
LabTestPanel); collapsing into a shared `hooks/useGlobalShortcut.ts`
when a fourth use lands per the project's "extract on the third
copy" rule.

### Detail panels

* **Push-mode**, NOT overlay. The panel is a flex sibling that pushes
  the main view to a narrower width, so the user can interact with
  both. Apple HIG calls this an Inspector.
* **420 px fixed width** — wide enough for tables and small charts,
  narrow enough not to dominate.
* **Header** = title + nav (prev / next / close). **Body** = scrolls
  independently. **No sticky footer** — actions live in-place.
* **Close**: X button OR `Esc` key. Both must be wired.
* **Open via single-click** of the source item. No double-click.
* **Don't trap focus** — the panel coexists with the main view, so
  unlike a modal it must NOT trap keyboard focus. (HIG: Inspectors
  are non-modal.)

### Map

* **Shape encodes source kind, colour encodes property within kind.**
  ● Circle = CPT, ■ Square = Borehole. Within each kind, colour comes
  from the active filter axis (CPT type / drill method / borehole
  type). This satisfies WCAG "no info by colour alone".
* **Layout** (Leaflet defaults): zoom controls top-left, fit-to-data
  below them. Layer-control dropdown top-right (Option B — only one
  category expanded at a time). Legend bottom-right, mirrors marker
  shapes (circle vs. square).
* **Bbox draw**: drag a rectangle in crosshair mode; `Esc` cancels.
* **Tooltip on hover** = name + key fact; click = select + fly-to at
  zoom 17.
* **Hidden vs. removed**: layer-control hides per type (visual filter
  only); sidebar removes per ID (project-local persisted).

### Borelog

* **Vertical depth axis, top → down.** Domain convention; ISO 14688-1
  / DOV PDF style.
* **Lithology patterns** from ``soilPatterns.tsx`` — fine sand =
  small dots, clay = 45° hatching, glauconite = green V-chevrons,
  etc. Override of Primer because Primer doesn't ship soil patterns.
* **Zoom**: `Ctrl + wheel` adjusts vertical scale. `Ctrl + 0` resets.
  Wheel without `Ctrl` scrolls vertically as expected.
* **Selecting a sample auto-centers** its depth in the visible
  viewport (smooth scroll). Re-zooming keeps the sample centered.
* **Hidden / type-filtered rows** in the sidebar are still visible at
  `opacity-40`, partitioned to the bottom of the list — they're
  demoted, not removed. `Hidden (N)` separator with `EyeOff` icon.

### Destructive actions

The desktop UI distinguishes **reversible** from **irreversible**
actions:

* **Reversible** (project-local hide, sort change, theme switch) —
  fire immediately, no confirmation. Provide an undo path: the
  sidebar's `N removed · restore all` link is the canonical example.
* **Irreversible** (DB delete, file delete, project delete, sending
  external requests) — require an explicit confirmation dialog.
  Default-focus on Cancel, not the destructive action. Match the
  destructive button copy to the action ("Delete" / "Discard" /
  "Remove permanently") — never just "OK".

The desktop frontend currently has **no irreversible actions** — the
old `DELETE /cpt/{id}` flow was removed in favour of project-local
hide. If you add one, the convention says: confirmation dialog
required.

### Dark mode

* **Strategy**: `darkMode: 'class'` in Tailwind. The `useTheme` hook
  toggles a `dark` class on `<html>`. Three modes:
    1. `system` (default) — follows `prefers-color-scheme` and
       responds live when the OS preference changes.
    2. `light` — explicit override, persisted to
       `localStorage["groundmodel.theme"]`.
    3. `dark`  — same.
* **Token mapping**: every component MUST author colours as `dark:`
  variants when introduced. Migrating existing components to dark is
  a separate pass; new components write light + dark from day one.
* **Test contrast** in both modes — Primer's dark palette already
  hits WCAG AA against the recommended dark-surface backgrounds, but
  custom hues (soil patterns, marker fill colours derived from
  `hashColor`) need to be re-checked when displayed on a dark
  background.

### Translation & persistence

* **Translate at the presentation boundary, never at ingest** —
  domain stores raw DOV tokens; `desktop/src/renderer/src/utils/`
  hosts lookup tables (e.g. `soilColors.ts`, `labTestLabels.ts`).
* **Show the source token as a `title` tooltip** on every translated
  label so domain experts can verify the mapping without leaving the
  UI.
* **Persist user preferences in localStorage** with project-scoped
  keys: `groundmodel.<area>.<projectId>.<kind>`. The `usePersistedSet`
  hook is the canonical pattern for project-scoped sets.

### Loading + error feedback

* **Async actions** — disable the trigger button while pending,
  show a spinner inside it; do NOT show a full-screen loader unless
  the action blocks all interaction (rare).
* **Toast notifications** for completion (success / error) of
  user-initiated bulk actions. Keep concise: 1 line, dismiss on
  click + auto-dismiss after 4 s.
* **Inline validation** for forms; never use a toast or alert box
  for "field X is invalid".
* **Empty states** — text + icon (Lucide), never just blank.

---

## Known Architectural Debt

Items that need a focused session — bigger than a quick fix, smaller
than a phase. Tracked here so each one is visible in PR / commit
context without rediscovering it from grep. Order is loose priority.

When an item is resolved, **delete it from this list** — its
implementation history lives in the relevant commit on ``develop``,
not here. Numbers stay stable through a debt-fixing campaign (do
not renumber after each fix); explicit cleanup passes (last done
2026-05-13, 24 DONE items removed, open items compacted to 1–34)
compact them.

### 1. WFS client base class (medium)

**What.** The bbox-split + count + features pattern is duplicated
across 5 DOV WFS clients (boring, interpretation, sample, grain-size,
scalar). Every time DOV changes their query rules (the BBOX+CQL
mutual-exclusion was the latest one) we patch in 5 places.
``collect_wfs_features_recursive`` already extracts the bbox
recursion; the remaining duplication is the HTTP request shape and
common params.

**Why deferred.** The 5 clients differ in subtle ways
(``DovBoreholeClient`` has a download phase; ``DovSampleClient`` is
WFS-only; ``DovGrainSizeClient`` takes a process callback). A clean
abstraction needs all 5 cases tested; the refactor is high-touch
across files I'd rather not regress on the same day.

**When.** Pair this with the DMT / pressuremeter / monitoring
clients in Phase 3 — the 6th and 7th instance will make the
abstraction obvious, and we'll have fresh test coverage.

### 2. ``API include=`` parameter for SampleResponse (low)

**What.** ``GET /borehole/{id}`` always selectinloads all 6 lab-test
relationships per sample. Fine at our 232-sample scale; at 5000
samples per borehole this becomes a measurable bottleneck. An
``?include=grain_size,atterberg_limits`` style scope on the endpoint
would let the caller request only what it'll render.

**When.** When a single borehole-detail call exceeds ~500 ms in
production.

### 3. Translate ``ScalarLabTest.parameter`` storage (low)

**What.** 671 rows already store the verbatim DOV string
``"Korrelvolumemassa (korrelvolumemassa)"`` etc. If DOV changes their
inconsistent doubled-tail convention again, we'd need to migrate all
rows. A separate ``parameter_slug`` column with a canonical short
name (derived at ingest from a curated map) would help reporting and
make the storage column independent of upstream tweaks.

**When.** When a query against ``scalar_lab_test`` is added that
filters by parameter — at that point the slug becomes load-bearing.

### 4. ``BoreholeLog.tsx`` size (low)

**What.** ~1850 lines. Cohesive (everything is borelog rendering)
but big. If we add another track type (e.g. CPT-overlay-on-borelog
in Phase 5) it'll cross the "split this file" threshold.

**When.** Before adding the next track type. Natural splits:
``borelog/utils.ts`` for pure helpers, ``borelog/tracks/`` for the
per-track components.

### 5. Telemetry / crash reporting (low)

**What.** No Sentry-equivalent. Frontend ``log.*`` calls go to the
devtools console; user-side crashes are invisible to us.

**When.** Before any non-solo user.

### 7. Backfill `dov_permkey` for legacy rows (low)

**What.** Refresh-on-duplicate (resolved in an earlier PR) keys
per-row dedup on `dov_permkey`. Children stored before that PR landed have
`dov_permkey = NULL` and don't participate in dedup, so the first
re-import of a previously-imported bbox creates duplicate observation
/ sample / lab-test rows for those legacy boreholes.

**Why deferred.** Solo-dev wiped the DB on 2026-05-10, so all
locally-stored data is post-PR and has permkeys. The trade-off only
bites when a non-solo user receives the migration on top of an
existing dataset.

**When.** Before any non-solo user inherits an existing DB. The fix
shape is well-defined: a one-off backfill that walks
`observation` / `sample` / 6 lab-test families, derives the
`dov_permkey` from a re-fetch of the parent's source XML or WFS row,
and stamps the column. ~Half a day of work plus a careful run.

### 8. Elevation provenance + audit (medium)

**What.** ``PATCH /{cpt,borehole}/{id}/elevation`` blindly overwrites
``elevation_m`` and ``z_epsg`` with no source-tag and no history. Today's
re-import path skips parent-column refresh on duplicates (see
``import_borehole_dov.py:201-213`` and ``import_cpt_dov.py:144-149``),
so manual edits are accidentally protected — but the same logic also
prevents a corrected upstream Z from ever landing. Two known gaps:

1. **No rollback.** A typo overwrites the upstream Z; the user has to
   remember the original to re-enter it. The "Clear" path returns the
   row to ``NULL`` rather than restoring the imported value.
2. **No source tag.** A reader of the DB can't tell whether
   ``elevation_m`` came from DOV's ``Z_mTAW``, the GEF header, or a
   manual edit — they all collapse into the same column.

**Fix shape.** Add ``elevation_source: enum {DOV, GEF, MANUAL, NONE}``
on both ``cpt`` and ``borehole`` (Alembic migration). ``set_elevation``
stamps ``MANUAL``. ``ImportBoreholeDov`` / ``ImportCptDov`` stamp
``DOV`` / ``GEF`` on initial insert. The refresh path can then safely
overwrite ``elevation_m`` only when ``elevation_source != MANUAL`` —
unlocking proper refresh-on-duplicate for parent columns without
clobbering user edits. Optional second column ``elevation_m_source``
holds the original upstream value so "Clear" can restore it instead of
nulling the row.

**When to revisit.** Before the platform accepts non-DOV inputs at
scale (manual GEF imports become the dominant flow, or BRO integration
lands), AND/OR when refresh-on-duplicate needs to update parent header
fields (currently it only refreshes child collections). For solo dev
on DOV-Belgium data, the current "manual edits survive re-imports
because re-imports are no-ops on the parent" behaviour is acceptable.

### 9. Vertical-CRS picker in elevation editor (low)

**What.** The desktop ``ElevationEditor`` has no CRS picker — it sends
``z_epsg = null`` and lets the backend default from the row's
horizontal EPSG (``vertical_crs.default_vertical_epsg``). That's
correct for DOV-Belgium and BRO-NL but not for cases where a user
imports a Belgian-coordinate borehole but knows the elevation is in,
say, ETRS89 (5730), or for a row whose horizontal EPSG is unmapped
and the fallback (mTAW) would mis-label.

**When.** The first time a user reports a wrong-datum mTAW label, OR
when a non-Belgium-non-Netherlands source lands and forces multiple
plausible defaults per horizontal CRS. The component contract already
accepts ``zEpsg`` as a prop, so the picker is purely additive — drop a
``<select>`` next to the input and pass the chosen value through.

### 10. License key + activation system (medium → blocking before paid release)

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

### 11. Installer + code signing + auto-update (medium → blocking before paid release)

**What.** electron-builder produces .exe / .dmg / .deb / .AppImage,
electron-updater handles deltas. Windows requires EV code signing
(~€200–400/year for a hardware-token cert) to avoid SmartScreen
"untrusted publisher" warnings that scare off enterprise IT.
macOS notarization is similar (~€100/year Apple Developer
membership + signing + Apple notary upload). Linux can ship
unsigned today.

**Why deferred.** Same as #10 — pre-revenue, premature.

**When.** In parallel with #10, before the first paid release.
Auto-update is especially important because future .gmproj format
upgrades depend on every user reaching the build that introduced
the upgrade path.

### 12. Tamper / reverse-engineering hardening (low — pragmatic posture)

**What.** A determined reverse engineer will defeat any client-side
license check. The goals here are modest:

* Defeat casual bypass (renamed exe, deleted license file).
* Make file parsers safe against malformed input that could crash
  the app or worse (path traversal, zip-slip if we ever bundle
  archives, JSON parser DoS).
* No anti-debug, no obfuscation, no DRM theatre — these annoy
  paying users more than they slow attackers down.

**Why low priority.** Geotech engineers don't pirate software at
scale. The .gmproj format is also not inherently sensitive — losing
the geometry of someone's site investigation isn't catastrophic the
way leaking a movie pre-release is.

**When.** Audit pass before v1.0 release: review all file-read
paths (DOV XML, GEF, .gmproj, future imports) for malformed-input
robustness. License check itself stays simple.

### 13. Marketing site + market-facing name (medium → blocking before paid release)

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

### 15. Cross-field invariants raise from domain dataclasses

**What.** ``DrillSegment``, ``ObservationLayer``,
``FieldLogInterval``, ``Sample`` all raise ``ValueError`` in
``__post_init__`` for ``base_m <= top_m``. Data Integrity Rule §5
(CLAUDE.md): cross-field invariants belong in the parser's
``ValidationIssue`` list, not as ``raise`` in the domain
dataclass. A malformed real-world DOV row with an inverted
segment hard-crashes the import instead of flowing through as a
flagged issue.

**Why deferred.** DOV data is generally clean; the raise has not
triggered in practice. Single-field non-negativity guards
(``top_m >= 0``) are NOT in scope here — those are not
cross-field.

**When to revisit.** Before any non-DOV borehole source lands
(BRO, manual import, BIM upload). Source data quality is unknown
and a hard crash on first import is the wrong UX.

### 16. Mixed-CRS spatial-query guard absent

**What.** The bundle format and the API both accept per-investigation
EPSG. PostGIS spatial queries (bbox containment, proximity) on a
mixed-CRS project silently compare geometries in different
coordinate systems and return wrong results. The
``_make_location(x, y, epsg)`` builder on bundle restore rebuilds
``POINT(x y, SRID=epsg)`` correctly, but downstream queries don't
ST_Transform to a common CRS.

**Why deferred.** All real projects today are mono-CRS (Belgian
Lambert72 from DOV). The issue surfaces only with multi-source
imports.

**When to revisit.** Before G3Dv3 import (Phase 5) lands — G3Dv3
is Lambert72 but users may have RD New (28992) NL boreholes in
the same project. Or before any project spans the BE/NL border.

### 25. Geotechnical units invisible to the section editor (medium — Phase 5 trigger)

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

### 28. ``PlacedColumn.proj.item`` is a union — narrowed by casts everywhere (medium)

**What.** ``PlacedColumn.proj`` is typed
``ProjectedInvestigation<CptListItem | BoreholeListItem>``. Every
per-kind access requires a cast (``col.proj.item as CptListItem``,
etc.) — 8+ sites in ``SectionPanel.tsx``, more in
``ContactsLayer.tsx``. Casts are locally correct (guarded by
``col.kind === 'cpt'`` / ``'borehole'``) but not enforced by the
type system.

**Why deferred.** Fix is a refactor: narrow ``PlacedColumn`` to a
discriminated union (``CptPlacedColumn | BoreholePlacedColumn``);
touches the column builder + all consumers + sub-component prop
types.

**When to revisit.** Before the geological-model editor grows
another ``PlacedColumn`` consumer (likely the formation-surface
interpolation overlay). At three cast sites outside SectionPanel
the structural type collapses.

### 29. ContactsLayer ``useMemo`` invalidates on every pan via ``levelToScreen`` dep (medium — perf)

**What.** ``ContactsLayer`` lists ``levelToScreen`` in its main
``useMemo`` dep array. ``levelToScreen`` is a ``useCallback`` in
``SectionPanel`` keyed on ``[effLevelMax, scaleV]`` — both change
on every vertical pan. The whole ``layers + polylines`` derivation
(O(N × M) over columns × contacts) re-runs on every pan frame.
Imperceptible at today's typical scale (~30 columns × 30
contacts); becomes measurable at 500+ contacts on a tall section.

**Why deferred.** Correct fix is to decouple the screen-Y
computation from the data-geometry pass: compute anchor
``depth_m`` + ``surfaceElevationM`` inside the memo, defer screen
coords to the render pass. Structural change to ``RenderedLayer``.

**When to revisit.** If pan stutter is reported on a real ≥ 200
contact section, or before any viewport tweening / animation
lands.

### 30. ``SectionPanel.tsx`` at ~1280 lines — split interactions into hooks (medium)

**What.** ``SectionPanel.tsx`` re-crossed the split threshold this
session (was 591 lines after the prior split; now ~1280). Three
interaction modes added this session share no state with each
other and could each live in a dedicated hook: ``useContactPicker``
(~60 lines: pickContext + handlePickCpt / handlePickBorehole /
handlePickerSelect), ``useFocusColumn`` (~100 lines: focusedColumn
+ focus-viewport effect + visibleColumns filter),
``useColumnContextMenu`` (~80 lines: contextMenu +
handleColumnContextMenu + handleSvgContextMenu).

**Why deferred.** Each hook reads from props or other hooks;
extracting is mechanical but not zero-risk.

**When to revisit.** Before the next interaction mode lands
(surface-interpolation overlay editing, or free-draw formation
boundaries).

### 33. Bundled Postgres distribution path not prototyped (medium → blocking before beta)

**What.** CLAUDE.md "Distribution model" plans an installer that
bundles Postgres + PostGIS (the Plaxis pattern). No prototype
exists. Failure modes are non-trivial for a solo dev: port
conflict on ``localhost:5433``, Windows Defender quarantine of the
Postgres binary, upgrade paths across Postgres major versions.
Distribution risk that hits before any geotech engineer sees the
UI.

**Why deferred.** Not blocking development; current dev flow uses
Docker Compose.

**When to revisit.** Before approaching the first 5 validation
engineers. Build a one-off prototype on a clean Windows machine
without Docker. If the bundled path is fragile, the SQLite +
SpatiaLite fallback (already called out in CLAUDE.md) becomes the
real plan and is a non-trivial refactor. The decision belongs
ahead of the first beta install.

### 34. Plaxis target version unconfirmed (medium → blocking before exporter implementation)

**What.** The Plaxis exporter (MVP gate item) needs a target file
format. Plaxis 2D 2016+ uses ``.plxs``; older versions (still
common in BE consultancies) use the legacy ``.geo`` / PLAXIS Input
ASCII. Building for ``.plxs`` and shipping to a 2014-vintage
paying customer is a support conversation before revenue.

**Why deferred.** Cannot decide without market signal.

**When to revisit.** Ask the first 5 validation contacts which
Plaxis version they run. Decide format target from the modal
response. Implement exporter only after the version is named —
format delta is non-trivial.

### Items #40, #42 — 2026-05-13 security-reviewer audit pass (#35–#39, #41, #43 resolved)

The remaining audit findings — #35 CORS, #36 CSP+window-open+
unpkg, #37 IPC paths, #38 bundle bounds, #39 GEF cap, #41
recent-projects, #43 error messages — landed in the same session.
Open items kept: #40 (auth threading, blocked by #10) + #42
(ESLint reason-rule enforcement, project bigger than 30 min).

### 40. Project-by-id endpoints rely on "only caller is local user" (medium → day-1 of #10)

**What.** ``POST /projects/{id}/duplicate`` (project.py:281-300)
and ``PATCH /projects/{id}/view-state`` (router-resolved via the
project id) operate on the resolved row without an identity
check. Today that's correct (single user, no auth). When debt
#10 lands, these endpoints will need a ``user_owns(project_id)``
predicate threaded through. The geology + cross-section + review
routers already use a two-stage ``get_in_project_or_404`` pattern
— mirror that.

**Why deferred.** No auth shipped.

**When to revisit.** Day-1 of debt #10 license-token work — auth
scaffolding must thread ``current_user`` through these routes
before any token-gated call ships.

### 42. No lint enforcement of the ``// reason:`` comment on ``eslint-disable react-hooks/exhaustive-deps`` (low)

**What.** CLAUDE.md "Code Conventions" requires every
``eslint-disable react-hooks/exhaustive-deps`` to be preceded by a
``// reason: ...`` block (codified after the S7 infinite-render
incident). The convention is documented; no lint rule enforces
it. Reviewer trust gate, not a security boundary.

**Why deferred.** Solo dev; review catches violations.

**When to revisit.** Before opening the repo to collaborators
(debt #6 trigger). Write a small custom ESLint rule.

