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
├── GrainSize / Atterberg / Triaxial / ...

Monitoring: Piezometer, Inclinometer
Geophysical: MASW, Seismic CPT
```

**Key rules:**
- `LabTest` is associated with a `Sample`, not a `Borehole`
- `DMT` is a pushed test; `Pressuremeter` is a borehole test
- Shared location ≠ inheritance — use composition

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
│   │   │   ├── lab/           lab_test.py, grain_size.py
│   │   │   ├── monitoring/    piezometer.py, inclinometer.py
│   │   │   └── job.py         Job + JobStatus
│   │   ├── services/          cpt_interpretation.py, ec7/
│   │   └── value_objects/     depth.py, coordinate.py, unit_weight_profile.py,
│   │                          observation_type.py, field_log_kind.py, admixture.py
│   ├── application/           import_cpt.py, export_project.py,
│   │                          run_interpretation.py, queue.py
│   ├── infrastructure/
│   │   ├── db/                models/, repositories/, migrations/
│   │   ├── parsers/
│   │   │   └── cpt/           gef_parser.py, ags_parser.py, las_parser.py
│   │   ├── exporters/         base_exporter.py, plaxis_exporter.py, ...
│   │   ├── gis/               postgis_service.py
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
- qty 6 = `u2_mpa`, qty 11 = `length_m`, qty 15 = `qt_mpa`, qty 128 = `qt_mpa` (CPTM totaalweerstand)

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
POST   /cpt/import          Import a GEF file (multipart form; project_id form field)
POST   /cpt/import-dov      Import CPTs from DOV bbox (JSON body: west,south,east,north,project_id)
GET    /cpt/                List CPTs (optional ?project_id=UUID filters by project)
GET    /cpt/{id}            CPT metadata (location, elevation, cone props, summary)
GET    /cpt/{id}/plot       Depth-series arrays for plotting (depths, qc, fs, u2, rf, qt)
DELETE /cpt/{id}            Delete CPT and its series (cascade)
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
    │   ├── MapView.tsx    Leaflet map with CPT markers; accepts drawMode + onBboxDrawn props
    │   ├── Sidebar.tsx    CPT list with delete; project name header
    │   ├── Toolbar.tsx    Import button (GEF + DOV)
    │   └── WelcomeScreen.tsx  Shown until a project is created
    ├── hooks/
    │   └── useProject.ts  localStorage project persistence (id, name, createdAt)
    └── App.tsx            Project gate, data loading, import/delete handlers, toasts
```

### CptChart conventions
- `Y_W = 52` — width constant used for ALL Y-axes (real and ghost) to align plot areas across side-by-side `ComposedChart` panels
- Ghost axes: `tick={false} axisLine={false} tickLine={false} width={Y_W}` — reserve pixel space without display
- Level (mTAW) always on the leftmost panel's left axis; Length (m) always on the rightmost panel's right axis
- CPTU layout: u2 panel (kPa) | qc+fs panel | Rf panel
- CPTM layout: single panel with qc (black) + Qt total resistance (blue `#1d4ed8`) on same qc axis
- Panel renderers are called as functions `{renderPanel(...)}` not JSX components — no hooks, avoids remount
- Colors: `QC_CLR=#111827`, `FS_CLR=#16a34a`, `RF_CLR=#b45309`, `U2_CLR=#7c3aed`, `QT_CLR=#1d4ed8`, `PD_CLR=#dc2626`
- `surfaceElevationRef` — ReferenceLine at depth=0 labelled with mTAW elevation when known
- `IcZoneLabelsOverlay` — absolute overlay at `bottom: 46` inside the Ic panel; each label is pinned at its zone's x-centre and rotated -55° (`transformOrigin: bottom center`) so they read diagonally upward; uses `IC_ZONE_SHORT` for abbreviated names in narrow zones
