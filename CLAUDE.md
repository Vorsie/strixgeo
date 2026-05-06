# Ground Model Platform — Architecture & Build Plan

## Project Overview

A commercial geotechnical data platform targeting EC7 Gen2 compliance.
Supports CPT, borehole, lab tests, monitoring, DMT, pressuremeter, and geophysical data.
Built for solo development, designed for eventual SaaS or desktop commercial release.

---

## Core Philosophy

- **Domain correctness first** — geotechnical logic before infrastructure
- **Clean architecture** — dependencies flow one way only (API → Application → Domain → Infrastructure)
- **Queue-ready, not queue-first** — abstract the queue from day one, add a broker when there is evidence it is needed
- **No premature optimization** — Python + Polars first, Rust only where profiling proves it is needed
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
This is what makes the system testable, auditable, and extensible.

---

## Domain Model

### Fundamental distinction

```
InSituTest (abstract base)
│
├── PushedInTest                  ← independent of borehole
│   ├── CPT                       ← GEF / AGS / LAS
│   └── DMT                       ← flat dilatometer, also pushed
│
└── BoreholeTest                  ← executed inside a borehole
    ├── Pressuremeter (PMT)
    ├── SPT
    ├── VST (vane shear)
    └── ...

Borehole                          ← a physical hole, not a test
├── BoreholeTests[]
├── Samples[]
└── Observations[]                ← visual log, soil description

LabTest                           ← performed on a Sample, NOT on a Borehole
├── GrainSize
├── Atterberg
├── Triaxial
└── ...

Monitoring
├── Piezometer
├── Inclinometer
└── ...

Geophysical
├── MASW
├── Seismic CPT
└── ...
```

### Key rules
- `LabTest` is **not** a subclass of `Borehole` — it is associated with a `Sample`
- `DMT` is a **pushed test**, not a borehole test
- `Pressuremeter` is a **borehole test**
- Shared location ≠ inheritance — use composition and relationships

---

## Project Structure

Uses a `src` layout — the package lives under `src/groundmodel/`, keeping it isolated from the repo root and preventing accidental imports during testing.

```
Strix/
│
├── src/
│   └── groundmodel/
│       ├── domain/                        # pure logic, zero frameworks
│       │   ├── models/
│       │   │   ├── base/
│       │   │   │   ├── insitu_test.py     # abstract base
│       │   │   │   └── investigation_point.py
│       │   │   ├── pushed/
│       │   │   │   ├── cpt.py
│       │   │   │   └── dmt.py
│       │   │   ├── borehole/
│       │   │   │   ├── borehole.py
│       │   │   │   ├── sample.py
│       │   │   │   └── borehole_test.py
│       │   │   ├── lab/
│       │   │   │   ├── lab_test.py
│       │   │   │   └── grain_size.py
│       │   │   ├── monitoring/
│       │   │   │   ├── piezometer.py
│       │   │   │   └── inclinometer.py
│       │   │   └── job.py                 # Job + JobStatus
│       │   ├── services/                  # domain logic (Ic classification, EC7)
│       │   │   ├── cpt_interpretation.py
│       │   │   └── ec7/
│       │   └── value_objects/             # depth, coordinate, measurement units
│       │       ├── depth.py
│       │       └── coordinate.py
│       │
│       ├── application/                   # use cases, orchestration
│       │   ├── import_cpt.py
│       │   ├── export_project.py
│       │   ├── run_interpretation.py
│       │   └── queue.py                   # TaskQueue ABC + SynchronousQueue
│       │
│       ├── infrastructure/
│       │   ├── db/
│       │   │   ├── models/                # SQLAlchemy ORM models
│       │   │   ├── repositories/          # one per aggregate root
│       │   │   └── migrations/            # Alembic
│       │   │       └── env.py
│       │   ├── parsers/
│       │   │   ├── gef_parser.py
│       │   │   ├── ags_parser.py
│       │   │   └── las_parser.py
│       │   ├── exporters/
│       │   │   ├── base_exporter.py       # abstract interface
│       │   │   ├── plaxis_exporter.py
│       │   │   ├── geostudio_exporter.py
│       │   │   └── dsheet_exporter.py
│       │   ├── gis/
│       │   │   └── postgis_service.py
│       │   └── rust/                      # PyO3 bindings (Phase 4)
│       │       └── groundmodel_core/
│       │
│       ├── api/
│       │   ├── routers/
│       │   │   ├── cpt.py
│       │   │   ├── borehole.py
│       │   │   └── jobs.py
│       │   ├── schemas/                   # Pydantic I/O models
│       │   └── main.py
│       │
│       └── shared/
│           ├── logging/
│           │   ├── logger_factory.py
│           │   └── levels.py              # TRACE, SUCCESS
│           ├── config.py                  # pydantic-settings
│           └── exceptions.py
│
├── tests/
│   ├── conftest.py
│   ├── unit/                      # domain logic, no DB, no I/O
│   ├── integration/               # real DB, real files
│   └── e2e/                       # full API round-trips
│
├── pyproject.toml                 # dependencies, build config, tool settings
├── docker-compose.yml             # PostgreSQL + PostGIS for local dev and tests
├── alembic.ini                    # Alembic migration config
└── .env.example                   # environment variable template
```

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| API | FastAPI | async-ready, Pydantic validation |
| Database | PostgreSQL + PostGIS | spatial queries, depth series |
| ORM | SQLAlchemy + Alembic | migrations |
| Data processing | Polars | fast, modern, no GeoPolars yet → use PostGIS for spatial |
| Performance | Rust via PyO3 | Phase 4 only, after profiling |
| Testing | pytest + pytest-asyncio + factory_boy | |
| Frontend | React + Electron (desktop) or React SaaS | decide before Phase 3 |
| 3D viewer | CesiumJS (geo context) or Three.js | |

---

## Depth Series — Solve Before Writing Schema

The hardest data modeling decision in the system. A CPT has 10,000+ rows of `(depth, qc, fs, u2, ...)`.

**Option A — Wide table**
```sql
cpt_measurements (cpt_id, depth_m, qc_mpa, fs_kpa, u2_kpa, ...)
```
✅ Easy depth-range queries. ❌ Can reach 100M+ rows at scale.

**Option B — Array columns**
```sql
cpt_series (cpt_id, depths FLOAT[], qc FLOAT[], fs FLOAT[], u2 FLOAT[])
```
✅ One row per CPT, fast bulk retrieval. ❌ Hard to query across CPTs by depth.

**Option C — Hybrid (recommended)**
Store raw series as arrays (fast retrieval, Polars-friendly) plus a materialized summary table for spatial and cross-CPT queries. Decide this before writing a single ORM model.

---

## Logging

```python
# shared/logging/levels.py
import logging

TRACE = 5
SUCCESS = 25
logging.addLevelName(TRACE, "TRACE")
logging.addLevelName(SUCCESS, "SUCCESS")
```

```python
# shared/logging/logger_factory.py
class LoggerFactory:
    _handlers_configured = False

    @classmethod
    def get_logger(cls, name: str) -> logging.Logger:
        if not cls._handlers_configured:
            cls._configure()
        logger = logging.getLogger(name)
        cls._add_custom_methods(logger)
        return logger

    @classmethod
    def _configure(cls):
        logging.basicConfig(
            format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            level=TRACE
        )
        cls._handlers_configured = True

    @staticmethod
    def _add_custom_methods(logger):
        def trace(msg, *args, **kwargs):
            logger.log(TRACE, msg, *args, **kwargs)
        def success(msg, *args, **kwargs):
            logger.log(SUCCESS, msg, *args, **kwargs)
        logger.trace = trace
        logger.success = success
```

**Usage everywhere:**
```python
logger = LoggerFactory.get_logger(__name__)
logger.trace("Parsing depth increment 1042")
logger.success("CPT imported: 10,432 rows in 0.3s")
```

**Log these things without exception:** imports, parsing errors, calculation steps (traceability), job execution, export operations.

---

## Job System

```python
# domain/models/job.py
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4

class JobStatus(Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"

@dataclass
class Job:
    type: str
    payload: dict
    id: UUID = field(default_factory=uuid4)
    status: JobStatus = JobStatus.PENDING
    result: dict | None = None
    logs: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
```

```python
# application/queue.py
from abc import ABC, abstractmethod

class TaskQueue(ABC):
    @abstractmethod
    async def enqueue(self, job: Job) -> None: ...

    @abstractmethod
    async def get_status(self, job_id: UUID) -> Job: ...

class SynchronousQueue(TaskQueue):
    """MVP — runs inline, no broker needed"""
    async def enqueue(self, job: Job) -> None:
        await self._execute(job)
```

When ready to go async: swap `SynchronousQueue` for `RQQueue` or `CeleryQueue` without touching anything else. Do not add RabbitMQ until there is a specific, demonstrated problem it solves.

---

## Testing Strategy

```
tests/
├── unit/              # fast, no I/O, no DB
│   ├── test_cpt_interpretation.py   # Ic classification, Robertson chart
│   └── test_gef_parser.py           # parser logic on fixture files
├── integration/       # real DB, real files
│   ├── test_cpt_repository.py
│   └── test_import_use_case.py
└── e2e/               # full HTTP round-trips
    └── test_cpt_api.py
```

**Rule:** If a domain logic test needs a database connection, the architecture is leaking. Domain tests must have zero dependencies on FastAPI, PostgreSQL, or Polars.

Use a real PostgreSQL instance via Docker Compose for integration tests — not SQLite mocks.

---

## Rust Strategy

Do not learn Rust and build the application simultaneously.

| Phase | Approach |
|---|---|
| Phase 1–2 | Pure Python everywhere, Polars for data |
| Phase 3 | Profile actual bottlenecks — do not guess |
| Phase 4 | Replace hotspots with Rust via PyO3 |

**Where Rust earns its place:**
- GEF/AGS parser for large files (10MB+)
- Ic classification over 100k depth points
- Spatial interpolation for ground model generation
- Export serialization for large projects

**Where it will not help:** API routing, DB queries, anything I/O-bound.

---

## Frontend Decision

| Option | Effort | 3D | Commercial viability | Verdict |
|---|---|---|---|---|
| Flet | Low | ❌ | Low | Dead end for this product |
| Dash/Plotly | Medium | Limited | Medium | OK for internal tool only |
| React + CesiumJS | High | ✅ | High | Right for SaaS |
| Electron + React | High | ✅ | High | Right for desktop commercial |

**Recommendation:** Electron + React for first commercial version. Geotech firms have IT security restrictions, procurement processes, and resistance to cloud subscriptions for sensitive site data. A desktop app is an easier first sale. SaaS can follow.

3D viewer: **CesiumJS** for real geographic context (recommended). **Three.js** for custom rendering. They can coexist.

---

## Export System

```python
# infrastructure/exporters/base_exporter.py
from abc import ABC, abstractmethod

class BaseExporter(ABC):
    @abstractmethod
    def export(self, project) -> bytes: ...
```

Implement: `PlaxisExporter`, `GeoStudioExporter`, `DSheetExporter`. Do not build export until Phase 4 — it expands in complexity the moment you hit a real format.

---

## Build Sequence

### Phase 0 — Know your data (weeks 1–2)
Before writing application code, parse 10–20 real GEF files manually. Document what fields are present, what is missing, what edge cases appear. Do the same for borehole logs and lab data.

Output: a data reality document and a first-draft DB schema grounded in actual files.

### Phase 1 — Thin vertical slice (weeks 3–6)
One complete workflow only: **import one GEF file → parse → store → plot qc/fs vs depth.**

No export. No map. No borehole. No job system. No frontend framework. Return a plot image or JSON array from the API. Every hard decision gets made once, on a small surface.

### Phase 2 — Expand domain (weeks 7–12)
Add borehole + samples + lab tests. Add the job system. Add basic EC7 CPT interpretation (Robertson Ic classification, soil classification). This is where clean architecture earns its value.

### Phase 3 — Make it usable (weeks 13–20)
Build the real frontend. Commit to Electron + React here — stop deferring. Add map visualization (Leaflet or CesiumJS). Add enough EC7 interpretation to use it in real consulting work. Daily use is your QA.

### Phase 4 — Commercial features (ongoing)
Multi-project management, user accounts, export formats, report generation (PDF), remaining data types (DMT, monitoring, geophysics). Add Rust where profiling shows it is needed.

---

## What Will Make or Break This System

**Do these well:**
- Domain model (especially the Sample → LabTest relationship)
- DB schema for depth series (decide the hybrid strategy before writing ORM models)
- Clean architecture separation (domain must never import infrastructure)
- Job system with proper audit trail (critical for engineering traceability)
- Logging at every layer (EC7 calculations must be traceable)

**Avoid:**
- Deep inheritance trees
- Premature optimization (no Rust until Phase 4)
- Tight coupling between layers
- Designing abstractions before you have felt the pain they solve
- Leaving the frontend decision open past Phase 2

---

## Git Workflow

### Commit Format

Use [Conventional Commits](https://www.conventionalcommits.org/). One file per commit.

```
<type>(<scope>): <short description>

[optional body]
```

**Types:**
| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code restructure, no behaviour change |
| `test` | Adding or updating tests |
| `chore` | Config, dependencies, build system |
| `perf` | Performance improvement |

**Scope** — the layer or module affected: `domain`, `api`, `application`, `infrastructure`, `parser`, `db`, `cpt`, `borehole`, `lab`, `shared`, etc.

**Rules:**
- One file per commit — stage and commit files individually
- Present tense, lowercase, no trailing period
- First line max 72 characters
- Add a body if the why is non-obvious

**Examples:**
```
feat(domain): add CPT value object with qc/fs/u2 fields
fix(parser): handle missing u2 column in GEF files
refactor(db): switch depth series storage to hybrid array strategy
test(domain): add Ic classification boundary tests
chore: add .gitignore for Python and Rust artifacts
```

---

### Issue Format

**Title:** `[type] short description` — same types as commits.

**Body:**
```markdown
## Description
What needs to be done and why.

## Acceptance Criteria
- [ ] criterion 1
- [ ] criterion 2

## Notes
Constraints, links, relevant context.
```

**Labels** (apply at least one):
- `feat`, `bug`, `refactor`, `test`, `docs`, `chore`
- `domain`, `api`, `infrastructure`, `frontend`, `db`, `parser`
- `phase-0`, `phase-1`, `phase-2`, `phase-3`, `phase-4`

---

## API Role

The API is the control layer, not a data pipe. It handles: validation, parsing orchestration, calculation triggers, and job management.

```
POST /jobs/import-cpt       ← triggers import job
GET  /jobs/{id}             ← poll job status
GET  /cpt/{id}              ← retrieve parsed CPT
GET  /cpt/{id}/plot         ← return plot data
POST /export/plaxis         ← triggers export job
```

The frontend never talks directly to the domain or database — always through the API.
