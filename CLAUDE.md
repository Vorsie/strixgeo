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
| 3 | Data sources expansion: borehole + samples + lab; monitoring (piezometer, inclinometer); DMT; pressuremeter |
| 4 | Exports (Plaxis, D-Sheet, GeoStudio); PDF reports; multi-project; accounts; map / 3D model viz enhancements |
| 5 (final / engineering layer) | Robertson Ic (production), auto soil profiling, per-layer unit weights, derived parameters across the model, statistics, Rust hotspots for batch compute |

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
```

409 Conflict on duplicate import (same GEF project_id + test_id within the same app project) — response body includes `cpt_id` of the existing record so the client can auto-load it.

The frontend always goes through the API — never directly to domain or DB.

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
    │   ├── CptChart.tsx   DOV-standard chart: type-aware panels, ghost axis alignment
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
    │   ├── LabTestPanel.tsx   Slide-in detail panel; ScalarTestsSection groups catch-all
    │   │                       tests by parametergroep, ASTM rows show D2487 description.
    │   ├── Toolbar.tsx    Import button (GEF + DOV)
    │   └── WelcomeScreen.tsx  Shown until a project is created
    ├── utils/
    │   ├── soilColors.ts      108-code DOV hoofdnaam lookup → English label + color
    │   ├── soilPatterns.tsx   SVG <pattern> defs (FZ/KL/SI/LE/KA/GL/ZS/XZ/NN/ST/VE/SN…)
    │   ├── labTestLabels.ts   Translations for DOV parameter / parametergroep + USCS
    │   │                      D2487 ASTM code descriptions (CL → "Clay (lean)", …)
    │   └── useWgs84.ts        Lambert72 → WGS84 projection cache
    ├── hooks/
    │   └── useProject.ts  localStorage project persistence (id, name, createdAt)
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

### 1. Refresh-on-duplicate — DONE

Resolved by ``dov_permkey`` columns on every Borehole/Sample child +
partial unique indexes scoped per parent. ``ImportBoreholeDov`` phases
4b/4c now run for ALL in-scope boreholes (new + duplicates); per-row
dedup against ``dov_permkey`` keeps existing children intact while
attaching anything the upstream now provides. Eliminates the
``TRUNCATE borehole CASCADE`` loop after a parser fix.

Two follow-ups split out into their own debt items:

* **#12 Legacy NULL-permkey rows.** Pre-PR rows have ``dov_permkey =
  NULL`` and don't participate in dedup, so the first re-import after
  this lands creates duplicate children for those legacy boreholes.
  Documented trade-off; fine for solo dev (we wiped the DB on
  2026-05-10), bites the moment a second user with pre-existing data
  shows up.
* **#13 Integration test for refresh.** Five unit tests cover the
  helpers and per-row skip path; no test asserts the full end-to-end
  ``import → re-import → no DB duplicates``. Manual smoke test
  validates it for now.

### 2. WFS client base class (medium)

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

### 3. Frontend test infrastructure (medium)

**What.** Zero frontend tests today. The 4 admixture-rendering
iterations relied entirely on visual playtest. A snapshot test on
``BoreholeLog`` against a fixture borehole would have caught the
layer-overflow regressions instantly. Our backend has 313 unit
tests; the frontend has 0.

**Why deferred.** Vitest + jsdom + react-testing-library setup is
non-trivial in Electron + Vite, and snapshot tests for SVG-heavy
components have notorious churn. Worth doing right rather than
hastily.

**When.** When the frontend grows past current ~5000 lines, OR after
the next visual regression that should have been caught
automatically.

### 4. Single-project model (Phase 4)

**What.** ``useProject.ts`` holds one project at a time in
``localStorage["groundmodel.project"]``. Switching projects means
clearing localStorage. Multi-project + project-list UI is implied by
the Phase 4 roadmap but not delivered.

**When.** Phase 4 — multi-project / accounts / SaaS prep.

### 5. DOV cache eviction — DONE

Resolved by ``DovXmlCache(max_bytes=…)``. Each cache instance sweeps
oldest-by-mtime when over its cap, with a 10 % headroom to avoid
thrashing. Default per-instance budget: 256 MiB (``DOV_CACHE_MAX_BYTES``
env override). With CPT + 4 borehole subdirs we ceiling at ≈1.25 GiB
total. Set ``DOV_CACHE_MAX_BYTES=0`` to disable eviction entirely.

### 6. ``API include=`` parameter for SampleResponse (low)

**What.** ``GET /borehole/{id}`` always selectinloads all 6 lab-test
relationships per sample. Fine at our 232-sample scale; at 5000
samples per borehole this becomes a measurable bottleneck. An
``?include=grain_size,atterberg_limits`` style scope on the endpoint
would let the caller request only what it'll render.

**When.** When a single borehole-detail call exceeds ~500 ms in
production.

### 7. Translate ``ScalarLabTest.parameter`` storage (low)

**What.** 671 rows already store the verbatim DOV string
``"Korrelvolumemassa (korrelvolumemassa)"`` etc. If DOV changes their
inconsistent doubled-tail convention again, we'd need to migrate all
rows. A separate ``parameter_slug`` column with a canonical short
name (derived at ingest from a curated map) would help reporting and
make the storage column independent of upstream tweaks.

**When.** When a query against ``scalar_lab_test`` is added that
filters by parameter — at that point the slug becomes load-bearing.

### 8. ``BoreholeLog.tsx`` size (low)

**What.** ~1850 lines. Cohesive (everything is borelog rendering)
but big. If we add another track type (e.g. CPT-overlay-on-borelog
in Phase 5) it'll cross the "split this file" threshold.

**When.** Before adding the next track type. Natural splits:
``borelog/utils.ts`` for pure helpers, ``borelog/tracks/`` for the
per-track components.

### 9. Telemetry / crash reporting (low)

**What.** No Sentry-equivalent. Frontend ``log.*`` calls go to the
devtools console; user-side crashes are invisible to us.

**When.** Before any non-solo user.

### 10. CI runner / `tsc` enforcement (low — partial)

**What.** Local `pytest tests/unit` + desktop `npm test` now gate the
git pre-commit hook (see Development Workflow). Still missing: a CI
workflow that runs the same gate on push, and a `tsc --noEmit` step on
the desktop side. Both become important the moment a second
contributor lands.

**When.** Before opening the repo to collaborators.

### 11. Bump Electron + vitest majors (medium)

**What.** `npm audit` reports 6 vulnerabilities — 1 high in Electron
36 (17 CVEs, mostly sandbox / IPC injection variants), 5 moderate in
esbuild (dev-server-only, surfaces via vitest's transitive deps).
Fixes are both major version jumps:

* Electron 36 → 42 — breaking-change review needed (main-process API
  shifts, deprecated webPreferences, native module rebuild).
* vitest 2 → 4 — config / API breakage possible, re-run the test
  suite + check for moved exports.

**Why deferred.** Practical risk is low for a solo-dev internal tool:
the Electron CVEs need a local malicious actor or untrusted content;
the esbuild CVE only affects whoever can reach your dev port. None
applies to the shipped artifact in current solo use. The combined
upgrade wants a focused empty afternoon, not a mid-review-queue
detour.

**When.** Before any non-solo user / any internet exposure of the
dev server. Practically: same trigger as item #9 (telemetry).

### 12. Backfill `dov_permkey` for legacy rows (low)

**What.** Refresh-on-duplicate (debt #1, resolved) keys per-row dedup
on `dov_permkey`. Children stored before that PR landed have
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

### 13. Integration test for refresh-on-duplicate (low)

**What.** Five unit tests cover the dedup helpers and per-row skip
path; no test exercises the full `import → re-import → assert no
DB duplicates` flow. Manual smoke testing carries the load right now.

**Why deferred.** Integration tests need Docker Compose + a real
PostgreSQL session, and the existing integration suite already covers
the single-import path. The refresh path is short enough that one
focused test (`test_refresh_attaches_no_duplicates`) would cover it
end-to-end.

**When.** Before another orchestrator change touches the dedup code,
OR if a manual smoke test ever surfaces a duplicate-row regression.
