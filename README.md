# Ground Model Platform

Commercial geotechnical data platform targeting EC7 Gen2 compliance. Supports CPT, borehole, lab tests, monitoring, DMT, pressuremeter, and geophysical data.

Built for solo development — Electron + React desktop first, SaaS later.

---

## Tech Stack

| Layer | Choice |
|---|---|
| API | FastAPI (async) |
| Database | PostgreSQL + PostGIS |
| ORM | SQLAlchemy + Alembic |
| Data processing | Polars |
| Testing | pytest + pytest-asyncio + factory-boy |
| Frontend | Electron + React (Phase 3) |
| 3D | CesiumJS |

---

## Getting Started

### Prerequisites

- Python 3.11+
- Docker + Docker Compose
- [GitHub CLI](https://cli.github.com/) (optional, for issue/PR workflows)

### Setup

```bash
# Clone and enter the repo
git clone https://github.com/Vorsie/Strix.git
cd Strix

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# Install dependencies
pip install -e ".[dev]"

# Copy and configure environment
cp .env.example .env

# Start PostgreSQL + PostGIS
docker compose up -d

# Run migrations
alembic upgrade head
```

### Running Tests

```bash
# Unit tests (no DB required)
pytest tests/unit

# Integration tests (requires Docker Compose running)
pytest tests/integration

# All tests
pytest
```

---

## Project Structure

```
src/groundmodel/
├── domain/          # pure geotechnical logic — no frameworks
├── application/     # use cases and orchestration
├── infrastructure/  # DB, parsers, exporters, GIS
│   └── parsers/
│       └── cpt/     # GEF, AGS, LAS parsers
├── api/             # FastAPI routers and schemas
└── shared/          # logging, config, exceptions
```

See [CLAUDE.md](CLAUDE.md) for full architecture, domain model, build sequence, and conventions.

---

## Supported Data Formats

| Format | Type | Status |
|---|---|---|
| GEF | CPT (CPTU / CPTE / CPTM) | Phase 0 — implemented |
| AGS | CPT + borehole + lab | Phase 1 |
| LAS | CPT / borehole logs | Phase 1 |

---

## Build Phases

| Phase | Focus | Weeks |
|---|---|---|
| 0 | Parse real GEF files; validate parser against production data | 1–2 |
| 1 | Import GEF → parse → store → plot qc/fs vs depth | 3–6 |
| 2 | Borehole, samples, lab tests; EC7 Ic classification | 7–12 |
| 3 | Electron + React frontend; map; consulting-ready EC7 | 13–20 |
| 4 | Multi-project, accounts, exports, PDF reports, Rust hotspots | ongoing |

---

## Contributing

This is a private solo-development project. Conventional Commits format is enforced — one file per commit. See [CLAUDE.md](CLAUDE.md) for commit format, issue templates, and branch conventions.
