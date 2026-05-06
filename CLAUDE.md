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
│   │   ├── parsers/           gef_parser.py, ags_parser.py, las_parser.py
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

Implemented in `infrastructure/parsers/gef_parser.py`. Handles CPTU, CPTE, CPTM, and UNKNOWN types.

**Parsing flow:** header → data → CPT type detection → void masking → column rename → unit normalisation → depth column → Rf calculation → validation → `GEFParseResult`

**Unit normalisation:** MPa, kPa, bar, tf/m², Pa, kgf/cm² → MPa

**Validation checks (ValidationLevel: ERROR / WARNING / INFO):**
- `NO_COORDINATES` / `ZERO_COORDINATES` / `NO_EPSG` / `NO_ELEVATION`
- `MISSING_COLUMN` (qc required; fs required for CPTU/CPTE)
- `DEPTH_NOT_MONOTONIC` — ERROR
- `NEGATIVE_VALUES` — qc, fs must be ≥ 0
- `NULL_VALUES` — after void masking
- `PRE_DRILL` — detected when depth starts > 0.5 m
- `NO_NET_AREA_RATIO` — WARNING for CPTU without `a` coefficient
- `RF_OUT_OF_RANGE` — Rf outside 0–10 % is suspicious
- `QC_SPIKES` — flags outliers > 3 std from rolling median

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

| Phase | Focus | Weeks |
|---|---|---|
| 0 | Parse 10–20 real GEF files; produce data reality doc and first-draft schema | 1–2 |
| 1 | Thin slice: import GEF → parse → store → plot qc/fs vs depth | 3–6 |
| 2 | Borehole + samples + lab; job system; EC7 Ic classification | 7–12 |
| 3 | Real frontend (Electron + React); map; EC7 for consulting use | 13–20 |
| 4 | Multi-project, accounts, exports, PDF reports, Rust where profiling shows need | ongoing |

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

See `infrastructure/exporters/base_exporter.py` (`BaseExporter` ABC). Implement `PlaxisExporter`, `GeoStudioExporter`, `DSheetExporter` in Phase 4. Do not build this until Phase 4 — it expands in complexity the moment you touch a real format.

---

## API Endpoints

```
POST /jobs/import-cpt
GET  /jobs/{id}
GET  /cpt/{id}
GET  /cpt/{id}/plot
POST /export/plaxis
```

The frontend always goes through the API — never directly to domain or DB.

---

## Git Workflow

### Commit Format — Conventional Commits, one file per commit

```
<type>(<scope>): <description>
```

| Type | Use |
|---|---|
| `feat` | new feature |
| `fix` | bug fix |
| `docs` | documentation |
| `refactor` | restructure, no behaviour change |
| `test` | tests |
| `chore` | config, dependencies, build |
| `perf` | performance |

Scope: `domain`, `api`, `application`, `infrastructure`, `parser`, `db`, `cpt`, `borehole`, `lab`, `shared`

Rules: present tense, lowercase, no trailing period, ≤ 72 chars on first line.

### Issue Format

**Title:** `[type] short description`

**Body:**
```markdown
## Description
## Acceptance Criteria
- [ ] ...
## Notes
```

**Labels:** type (`feat`, `bug`, ...) + layer (`domain`, `parser`, ...) + phase (`phase-0` … `phase-4`)
