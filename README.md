# StrixGeo

Commercial **ground model platform** — builds and manages the unified subsurface dataset for a project. Ingests CPT, borehole, lab, monitoring, DMT, pressuremeter, and geophysical data; derives parameters and statistics; exports to design tools (Plaxis 2D/3D, DXF, D-Stability, D-Sheet Piling, PDF).

Built for solo development — Electron + React desktop first, SaaS later.

## Scope

The platform's job is to deliver a clean, validated **ground model + derived parameters + statistics**. Design checks happen elsewhere using this output as input.

| | |
|---|---|
| **In scope** | data ingest, storage, spatial queries, visualisation, derived parameters, statistics, exports |
| **Out of scope (forever)** | Eurocode (EC7) design calculations, bearing capacity, settlement, slope/pile/wall design — those belong in the downstream tools we export to |
| **Deferred to the final phase** | Design-ready parameters (φ′, c′, cu, E50, OCR, Vs), the full Robertson/Mayne port, auto soil profiling. The MVP ships characterisation outputs (Ic / SBT zone, Dr, NAD packing class); design-ready values stay Phase 5. |

---

## Tech Stack

| Layer | Choice |
|---|---|
| API | FastAPI (async, Pydantic validation) |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| ORM | SQLAlchemy 2 + Alembic |
| Data processing | Polars |
| Coordinate transforms | pyproj |
| Testing | pytest + pytest-asyncio + pytest-benchmark |
| Frontend | Electron + React + TypeScript (electron-vite) |
| Map | react-leaflet |
| Charts | Recharts |
| 3D (Phase 4) | CesiumJS |

---

## Getting Started

### Prerequisites

- **Python 3.11+** (uv manages the venv automatically)
- **uv** — install via `winget install astral-sh.uv` (Windows) or [astral.sh/uv](https://astral.sh/uv)
- **Docker Desktop** (for PostgreSQL + PostGIS)
- **Node 22 LTS** + **npm** (for the desktop app — pinned to 22; Node 24 segfaults vitest)

### Setup

```bash
# Clone and enter the repo
git clone https://github.com/Vorsie/Strix.git
cd Strix

# Install Python deps + create venv
uv sync --group dev

# Copy environment file (defaults work as-is against the included docker-compose)
cp .env.example .env

# Start PostgreSQL + PostGIS
docker compose up -d

# Run database migrations
uv run alembic upgrade head

# Install desktop app deps
cd desktop
npm install
```

### Running

```bash
# Backend API only (port 8765)
uv run uvicorn groundmodel.api.main:app --reload --port 8765

# Desktop app (spawns the API automatically)
cd desktop
npm run dev
```

### Running Tests

```bash
uv run pytest tests/unit                # fast, no Docker needed
```

Integration tests run against a **sibling DB, never the dev DB** — use the
wrapper script only. A bare `pytest tests/integration` TRUNCATEs whatever
`DATABASE_URL` points at (the dev DB). Only one integration run at a time; the
wrapper takes a lock and **aborts** (never waits, never kills) if one is live.

```powershell
.\scripts\run-integration-tests.ps1     # sets DATABASE_URL to *_integration + runs alembic first
.\scripts\run-e2e.ps1                    # Playwright Electron e2e (close the dev app first — both use :8765)
```

Benchmarks are disabled by default:

```bash
uv run pytest tests/benchmarks --benchmark-enable -v
```

### Lint / format / type-check

```bash
uv run ruff format src tests
uv run ruff check --fix src tests
uv run mypy src
```

---

## Features Today (Phase 4 — v1.0 MVP gate)

- **Import** — CPT from local GEF files (multi-file), and CPT + borehole + lab (samples, grain-size, Atterberg, CaCO₃, organic, water content) from DOV by drawing a bounding box on the map. Imports stream with a persistent on-disk XML cache, so re-imports of overlapping regions skip the network. (The DOV client requests HTTP/2 but the live DOV endpoints serve HTTP/1.1; throughput comes from connection pooling + a bounded concurrency semaphore, not h2 multiplexing.)
- **Project system** — projects scope investigations, dedupe imports, and save/restore as a portable `.strix` bundle.
- **Map + charts** — Leaflet basemap with markers by source/type; DOV-standard CPT depth plots (qc / fs / Rf; qc + Qt for CPTM) with a preview Robertson Ic / SBT panel.
- **Three-level model** — geological → lithostratigraphic → geotechnical (NAD packing class 1–31 from CPT-derived indicators), edited on **cross-sections** and built into a 3-D voxel model with a fence diagram.
- **Exports** — DXF (section + fence), Plaxis 2D/3D scripts, D-Stability `.stix`, D-Sheet Piling `.shi`, and a characterisation-level PDF report.

---

## Project Structure

```
Strix/
├── src/groundmodel/
│   ├── api/             # FastAPI routers + Pydantic schemas
│   ├── application/     # use cases (ImportCpt, ImportCptDov, ...)
│   ├── domain/          # pure geotechnical logic — models, services, value objects
│   ├── infrastructure/
│   │   ├── db/          # SQLAlchemy ORM + repositories + Alembic migrations
│   │   ├── parsers/cpt/ # GEF, DOV (and future AGS, LAS)
│   │   ├── exporters/   # DXF, Plaxis 2D/3D, D-Stability, D-Sheet Piling, PDF
│   │   └── gis/         # PostGIS helpers
│   └── shared/          # logging, config, exceptions
├── desktop/             # Electron + React + TS frontend
├── tests/
│   ├── unit/            # no DB, no I/O, no network
│   ├── integration/     # real DB / real fixture files (Docker required)
│   ├── e2e/             # Python httpx round-trips (placeholder); Playwright Electron e2e lives in desktop/tests/e2e/
│   └── benchmarks/      # pytest-benchmark, disabled by default
├── data/cpt/            # real DOV GEF fixtures (gitignored)
├── docker-compose.yml   # PostgreSQL + PostGIS
├── alembic.ini
├── pyproject.toml
└── CLAUDE.md            # full architecture, conventions, build sequence
```

See **[CLAUDE.md](CLAUDE.md)** for the full architecture, domain model, code conventions, DOV import internals, and Definition of Done checklist.

---

## Supported Data Sources

| Source | Type | Status |
|---|---|---|
| GEF (.gef) | CPT (CPTU / CPTE / CPTM) | ✓ implemented |
| DOV WFS / XML | CPT + borehole + interpretations + samples + lab (Belgian public dataset) | ✓ implemented |
| Borehole + samples + lab | grain-size, Atterberg, CaCO₃, organic, water content | ✓ implemented |
| Monitoring / DMT / pressuremeter | mixed | post-v1.0 |
| AGS | CPT + borehole + lab | Phase 5 |
| LAS | CPT / borehole logs | Phase 5 |

---

## Build Phases

| Phase | Focus | Status |
|---|---|---|
| 0 | Parse real GEF files; data reality doc; first-draft schema | ✓ done |
| 1 | Thin slice: import GEF → parse → store → FastAPI CPT routes | ✓ done |
| 2 | Electron + React desktop; project system; map; DOV chart; multi-file GEF + DOV bbox import + persistent XML cache | ✓ done |
| 3 | Data sources: borehole + samples + lab (monitoring / DMT / pressuremeter deferred post-v1.0) | ✓ done |
| **4 (v1.0 commercial MVP gate)** | Geological + lithostratigraphic + geotechnical models; cross-sections as the edit surface; 3-D voxel build + fence; DXF / Plaxis / D-Stability / D-Sheet / PDF exports | **in progress** |
| 5 (post-v1.0) | Engineering interpretation as design-ready parameters (full Robertson/Mayne port, φ′ / c′ / cu / E50 / OCR / Vs); additional data sources (monitoring, DMT, pressuremeter, AGS); IFC export; Rust hotspots; optional SaaS | future |

Engineering interpretation is intentionally pushed to the final phase. Earlier phases focus on getting the data plumbing rock-solid.

---

## Contributing

Private solo-development project. Conventions enforced (full details in [CLAUDE.md](CLAUDE.md)):

- **Conventional Commits** — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`. Lowercase, no trailing period, ≤ 72 chars on the first line.
- **One file per commit** — stage and commit files individually.
- **Definition of Done** for every Python module: comprehensive logging (entry/exit/null-paths/HTTP bodies), numpy-style docstrings, unit tests covering happy + error paths.
- **English only** for every identifier, comment, and docstring. Dutch DOV/GEF spec field names are allowed only as string literals or in comments alongside their English translation.
