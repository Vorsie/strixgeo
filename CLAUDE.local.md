# Ground Model Platform — local notes (gitignored, not committed)

## Current Phase

**Phase 2** — Electron + React desktop; project system; DOV chart; EC7 Ic.

### Phase 0 — Complete
- GEF parser implemented and bug-fixed against 5 real DOV files (CPTE, CPTU, CPTM TM1/TM2/TM4)
- 52 unit tests (`tests/unit/infrastructure/parsers/cpt/test_gef_parser.py`)
- 50 integration tests against real DOV files (`tests/integration/parsers/cpt/test_gef_parser_dov.py`)
- HYBRID_METHOD warning: step-size change (p90/p10 > 10) — catches electric→mechanical mid-test (TM2)
- PARTIAL_U2 warning: CPTU with leading void u2 transitioning to real values — CPTE→CPTU mid-test

### Phase 1 — Complete

- ORM schema: `CptOrm` (metadata + summary) + `CptSeriesOrm` (raw arrays) — hybrid two-table design
- `CptRepository` — async CRUD (`save`, `get_by_id`, `list_all`, `delete`)
- `ImportCpt` use case — GEF parse → ORM mapping → commit in one transaction
- Alembic migrations: initial schema + drop `avg_qc_mpa` + add `app_project_id` + add `qt_mpa`
- 46 DB integration tests (`tests/integration/db/test_import_cpt.py`) — all 5 DOV files, all pass
- FastAPI CPT routes: `POST /cpt/import`, `GET /cpt/`, `GET /cpt/{id}`, `GET /cpt/{id}/plot`, `DELETE /cpt/{id}`
- Pydantic schemas: `ImportCptResponse`, `CptResponse`, `CptListItem`, `CptPlotResponse`, `ValidationIssueSchema`

### Phase 2 — In Progress (visual-first)

**Complete:**
- Electron + React desktop shell: CPT list sidebar, file import dialog, map view, DOV-standard chart
- `CptChart`: type-aware panels (CPTU = u2 + qcfs + Rf; CPTM = qc + Qt on same axis), ghost axis alignment (`Y_W=52`), Level (mTAW) left / Length (m) right, pink grid, surface elevation reference line
- All chart labels in English (Level, Length, Depth, surface — no Dutch)
- Project system: `useProject` hook + localStorage UUID scoping, `WelcomeScreen` gate (no data loads until project created)
- Delete CPT: `DELETE /cpt/{id}` API + trash button in sidebar
- Duplicate detection: project-scoped (same file allowed in different projects), 409 → auto-load existing from DB with success toast
- Shared `Button` component (`variant`: primary/secondary/danger/ghost, `size`: sm/md)
- `fs_mpa` required for CPTE and CPTU in parser validation (`MISSING_COLUMN` ERROR)
- `ParseError` → HTTP 400 in import router (was falling through to 500)
- `qt_mpa` (GEF qty 128 totaalweerstand) stored in `cpt_series` and plotted as blue Qt line for CPTM
- Integration test pre-truncation: `cpt` table truncated BEFORE each test to prevent stale-state failures

**Remaining:**
- EC7 Ic classification (Robertson 1990) — soil behaviour type index, overlays on chart
- Job system wiring (SynchronousQueue → ImportCpt)

Borehole + samples + lab tests deferred to Phase 3.

---

## Infrastructure Notes

### Database
- Docker image: `postgis/postgis:16-3.4` — PostGIS pre-installed, no extra setup needed
- **Port: 5433** (local Windows PostgreSQL 18 owns 5432)
- Connection string: `postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel`
- Start DB: `docker compose up -d`
- Apply migrations: `uv run alembic upgrade head`
- Generate migration after model change: `uv run alembic revision --autogenerate -m "description"`

### Integration test isolation
- Each test gets a fresh `NullPool` engine (no connection reuse across pytest event loops)
- `cpt` table is truncated after every test — no persistent state between tests

---

## Local Python Environment

- Package manager: **UV** v0.11.9 (installed via winget)
- Miniforge3 at `C:\Users\robin\miniforge3\` — kept for non-project conda envs
- **Project env managed by UV.** First-time setup (or after pulling):
  ```
  uv sync --group dev
  ```
- Run commands without activating the venv:
  ```
  uv run pytest tests/unit
  uv run pytest tests/integration   # requires docker compose up -d
  uv run ruff check src tests
  uv run mypy src
  ```
- Lock file: `uv.lock` — committed to git, never edit manually.

---

## Real Data Files

Location: `data/cpt/` (gitignored). Five real GEF files from the DOV (Databank Ondergrond Vlaanderen) database:

| File | Type | Notes |
|---|---|---|
| 1778054387093.gef | CPTE (TE1) | Has both qty-1 depth and qty-11 length columns |
| 1778056765226.gef | CPTU (TE2) | u2 present, pre-drill 1.5m, void u2 in top rows |
| 1778056769825.gef | CPTM (TM4) | 34 rows only, qty-128 → qt_mpa |
| 1778056773736.gef | CPTM (TM1) | Deep (>26m), data gap noted in comment |
| 1778056778310.gef | CPTM (TM2) | Pre-drill 2.2m, hybrid electric/mechanical |

All use EPSG 32000 (Belgian Lambert 72) and semicolon column separator.

---

## Commit Scopes for This Project

`domain`, `api`, `application`, `infrastructure`, `parser`, `db`, `cpt`, `borehole`, `lab`, `shared`
