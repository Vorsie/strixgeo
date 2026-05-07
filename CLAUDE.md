# Ground Model Platform — CLAUDE.md

## Project Overview

Commercial geotechnical data platform targeting EC7 Gen2 compliance. Supports CPT, borehole, lab tests, monitoring, DMT, pressuremeter, and geophysical data. Built for solo development; targets Electron + React desktop first, SaaS later.

---

## Core Philosophy

- **Domain correctness first** — geotechnical logic before infrastructure
- **Clean architecture** — dependencies flow one way: API → Application → Domain ← Infrastructure
- **Queue-ready, not queue-first** — abstract the queue from day one, add a broker when needed
- **No premature optimisation** — Python + Polars first; Rust only where profiling proves it is needed
- **Never design a layer you haven't needed yet** — build, feel the pain, then abstract

---

## Architecture

```
┌─────────────────────────────────────┐
│           API Layer (FastAPI)        │  ← HTTP, validation, routing
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
│   │   │   ├── borehole/      borehole.py, sample.py, borehole_test.py
│   │   │   ├── lab/           lab_test.py, grain_size.py
│   │   │   ├── monitoring/    piezometer.py, inclinometer.py
│   │   │   └── job.py         Job + JobStatus
│   │   ├── services/          cpt_interpretation.py, ec7/
│   │   └── value_objects/     depth.py, coordinate.py
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

## Code Conventions

### One class per file
Every class lives in its own `.py` file named after the class in `snake_case`. The only exception is `shared/exceptions.py`, where the full exception hierarchy is grouped by convention.

### Constants in a dedicated file
Module-level constants (lookup dicts, conversion factors, magic numbers) belong in a `*_constants.py` file alongside the classes that use them (e.g. `gef_constants.py` next to `gef_parser.py`). Never define constants at the top of a class file.

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

Implemented in `infrastructure/parsers/cpt/gef_parser.py`. Handles CPTU, CPTE, CPTM, and UNKNOWN types.

**Parsing flow:** header → data → CPT type detection → void masking → column rename → unit normalisation → depth column → Rf calculation → validation → `GEFParseResult`

**Unit normalisation:** MPa, kPa, bar, tf/m², Pa, kgf/cm² → MPa

**Validation checks (ValidationLevel: ERROR / WARNING / INFO):**
- `NO_COORDINATES` / `ZERO_COORDINATES` / `NO_EPSG` / `NO_ELEVATION`
- `MISSING_COLUMN` (qc required always; fs and u2 required for CPTU; fs required for CPTE)
- `DEPTH_NOT_MONOTONIC` — ERROR
- `NEGATIVE_VALUES` — qc, fs must be ≥ 0
- `NULL_VALUES` — after void masking
- `PRE_DRILL` — detected from MVAR 13, or inferred when first depth > 0.5 m
- `NO_NET_AREA_RATIO` — WARNING for CPTU without `a` coefficient (MVAR 3)
- `RF_OUT_OF_RANGE` — Rf outside 0.05–15 % is suspicious
- `QC_SPIKES` — flags outliers > 5× neighbouring values

**Key MEASUREMENTVAR indices (GEF-CPT-Report standard):**
- 3 = net area ratio (a-value)
- 12 = cone type (0=electric, 1=mechanical)
- 13 = pre-drill depth
- 14 = groundwater depth
- 17 = stop criterion

---

## Job System

See `domain/models/job.py` (Job, JobStatus) and `application/queue.py` (TaskQueue ABC, SynchronousQueue).

MVP uses `SynchronousQueue` (inline execution). When load justifies it, swap for `RQQueue` or `CeleryQueue` — nothing else changes. Do not add a broker until there is a demonstrated need.

---

## Testing Strategy

**Rule:** a domain test that needs a DB connection means the architecture is leaking.

```
tests/
├── unit/          domain logic, fixture files only
├── integration/   real PostgreSQL (Docker Compose), real files
└── e2e/           full HTTP round-trips via httpx
```

---

## Build Sequence

| Phase | Focus |
|---|---|
| 0 | Parse real GEF files; data reality doc; first-draft schema ✓ |
| 1 | Thin slice: import GEF → parse → store → FastAPI CPT routes ✓ |
| 2 | Electron + React desktop; project system; DOV chart; EC7 Ic |
| 3 | Borehole + samples + lab; PDF reports; map enhancements |
| 4 | Multi-project, accounts, exports, Rust hotspots |

---

## Rust Strategy

| Phase | Approach |
|---|---|
| 1–2 | Pure Python + Polars |
| 3 | Profile — do not guess |
| 4 | Replace hotspots: GEF parser (10MB+), Ic classification (100k points), spatial interpolation, export serialisation |

Rust will not help: API routing, DB queries, anything I/O-bound.

---

## Export System

See `infrastructure/exporters/base_exporter.py` (`BaseExporter` ABC). Implement `PlaxisExporter`, `GeoStudioExporter`, `DSheetExporter` in Phase 4. Do not build until Phase 4.

---

## API Endpoints

```
POST   /cpt/import          Import a GEF file (multipart form; project_id form field)
GET    /cpt/                List CPTs (optional ?project_id=UUID filters by project)
GET    /cpt/{id}            CPT metadata (location, elevation, cone props, summary)
GET    /cpt/{id}/plot       Depth-series arrays for plotting (qc, fs, u2, rf, depths)
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
    │   ├── CptChart.tsx   DOV-standard chart: type-aware panels, ghost axis alignment
    │   ├── MapView.tsx    Leaflet map with CPT markers
    │   ├── Sidebar.tsx    CPT list with delete; project name header
    │   ├── Toolbar.tsx    Import button
    │   └── WelcomeScreen.tsx  Shown until a project is created
    ├── hooks/
    │   └── useProject.ts  localStorage project persistence (id, name, createdAt)
    └── App.tsx            Project gate, data loading, import/delete handlers, toasts
```

### CptChart conventions
- `Y_W = 52` — width constant used for ALL Y-axes (real and ghost) to align plot areas across side-by-side `ComposedChart` panels
- Ghost axes: `tick={false} axisLine={false} tickLine={false} width={Y_W}` — reserve pixel space without display
- Peil (mTAW) always on the leftmost panel's left axis; Lengte (m) always on the rightmost panel's right axis
- CPTU layout: u2 panel (kPa) | qc+fs panel | Rf panel
- CPTM layout: single panel with qc only, both axes on same chart
- Panel renderers are called as functions `{renderPanel(...)}` not JSX components — no hooks, avoids remount
