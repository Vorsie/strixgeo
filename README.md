# Ground Model Platform

Commercial **ground model platform** — builds and manages the unified subsurface dataset for a project. Ingests CPT, borehole, lab, monitoring, DMT, pressuremeter, and geophysical data; derives parameters and statistics; exports to design tools (Plaxis, D-Sheet, GeoStudio).

Built for solo development — Electron + React desktop first, SaaS later.

## Scope

The platform's job is to deliver a clean, validated **ground model + derived parameters + statistics**. Design checks happen elsewhere using this output as input.

| | |
|---|---|
| **In scope** | data ingest, storage, spatial queries, visualisation, derived parameters, statistics, exports |
| **Out of scope (forever)** | Eurocode (EC7) design calculations, bearing capacity, settlement, slope/pile/wall design — those belong in the downstream tools we export to |
| **Deferred to the final phase** | Robertson Ic, auto soil profiling, per-layer unit weights, geotech-judgement validation. Preview implementations exist today but production lives in Phase 5. |

---

## Tech Stack

| Layer | Choice |
|---|---|
| API | FastAPI (async, HTTP/2 via httpx) |
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
- **Node 20+** + **npm** (for the desktop app)

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
uv run pytest tests/unit                # fast, no Docker
uv run pytest tests/integration         # needs docker compose up
uv run pytest                           # all
uv run pytest tests/benchmarks --benchmark-enable -v   # perf benchmarks
```

### Lint / format / type-check

```bash
uv run ruff format src tests
uv run ruff check --fix src tests
uv run mypy src
```

---

## Features Today (Phase 2)

- **CPT import** from local GEF files (multi-file selection)
- **DOV import** — draw a bounding box on the map; the backend queries Vlaanderen's WFS, downloads CPT XMLs in parallel (HTTP/2, semaphore-limited), and persists them. Persistent on-disk XML cache means re-imports of overlapping regions skip the network entirely.
- **Project system** — projects scope CPTs and dedupe imports.
- **Map view** — Leaflet basemap with CPT markers coloured by type (CPTU / CPTE / CPTM).
- **CPT chart** — DOV-standard depth plot: qc / fs / Rf for CPTU/CPTE; qc + Qt for CPTM. Includes a preview Robertson Ic panel (Phase 5 production).
- **Click marker → chart** with hover tooltips.

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
│   │   ├── exporters/   # Plaxis, D-Sheet, GeoStudio (Phase 4)
│   │   └── gis/         # PostGIS helpers
│   └── shared/          # logging, config, exceptions
├── desktop/             # Electron + React + TS frontend
├── tests/
│   ├── unit/            # no DB, no I/O, no network
│   ├── integration/     # real DB / real fixture files (Docker required)
│   ├── e2e/             # full HTTP round-trips (placeholder — not yet populated)
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
| GEF (.gef) | CPT (CPTU / CPTE / CPTM) | Phase 0 — implemented |
| DOV WFS / XML | CPT (Belgian public dataset) | Phase 2 — implemented |
| AGS | CPT + borehole + lab | Phase 3 |
| LAS | CPT / borehole logs | Phase 3 |
| Borehole + lab + monitoring + DMT + pressuremeter | mixed | Phase 3 |

---

## Build Phases

| Phase | Focus | Status |
|---|---|---|
| 0 | Parse real GEF files; data reality doc; first-draft schema | ✓ done |
| 1 | Thin slice: import GEF → parse → store → FastAPI CPT routes | ✓ done |
| 2 | Electron + React desktop; project system; map; DOV chart; multi-file GEF + DOV bbox import + persistent XML cache | ✓ done |
| 3 | Data sources expansion: borehole + samples + lab; monitoring (piezometer, inclinometer); DMT; pressuremeter | next |
| 4 | Exports (Plaxis, D-Sheet, GeoStudio); PDF reports; multi-project; accounts; map / 3D model viz enhancements | future |
| 5 (final / engineering layer) | Robertson Ic (production), auto soil profiling, per-layer unit weights, derived parameters, statistics, Rust hotspots | future |

Engineering interpretation is intentionally pushed to the final phase. Earlier phases focus on getting the data plumbing rock-solid.

---

## Contributing

Private solo-development project. Conventions enforced (full details in [CLAUDE.md](CLAUDE.md)):

- **Conventional Commits** — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`. Lowercase, no trailing period, ≤ 72 chars on the first line.
- **One file per commit** — stage and commit files individually.
- **Definition of Done** for every Python module: comprehensive logging (entry/exit/null-paths/HTTP bodies), numpy-style docstrings, unit tests covering happy + error paths.
- **English only** for every identifier, comment, and docstring. Dutch DOV/GEF spec field names are allowed only as string literals or in comments alongside their English translation.
