# Ground Model Platform — CLAUDE.md

## Project Overview

Commercial **ground model platform** — builds and manages the unified subsurface dataset for a project. Ingests CPT, borehole, lab, monitoring, DMT, pressuremeter, and geophysical data; derives parameters and statistics; exports to design tools (Plaxis, D-Stability, D-Sheet, GeoStudio, ...). Built for solo development; targets Electron + React desktop first, SaaS later.

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
- Anything that produces a value used directly in a design check — those calculations belong in the downstream design tool (Plaxis, D-Stability, D-Sheet, GeoStudio, ...)
- EC7 / Eurocode design rule application (we do not target EC7 design conformance)

**Deferred to the final phase (preview implementations may exist earlier):**
- Robertson Ic / Soil Behaviour Type classification — **as a fully
  automated produced parameter.** Carve-out extended (owner directive
  2026-05-18): Robertson SBT zone is now committed as a **per-unit
  summary** in the MVP (Ic zone label, relative density Dr for sand
  units, NAD packing class 1–31, γ-estimate from SBT lookup) — these
  are characterisation outputs, not design inputs. The boundary: any
  value used directly in a design calculation (φ′, c′, cu, E50, OCR,
  Vs, G0, M) stays Phase 5. The full Robertson/Mayne parameter port
  and the NAD-NEN xlsx table (38×313) stay Phase 5. See
  `memory/project_litho_geotech_three_level_model.md`.
- Auto soil profiling (merging Ic into layers) — as an *automatic*
  model. The litho segmenter's assisted-manual suggestion flow
  (user-accepted ghost nodes, not auto-correlation) is Phase 4 per
  the original carve-out; unchanged.
- Per-layer design parameters from Robertson correlation (φ′, c′, cu,
  E50, OCR, Vs, G0, M) — Phase 5. Dr and NAD class are MVP (above);
  the design-ready values derived from them are not.
- Per-CPT validation that requires geotech judgement (RF range checks, qc spike detection, hybrid-method detection)

---

## Core Philosophy

- **Data correctness first** — clean ingestion + storage before any interpretation
- **Clean architecture** — dependencies flow one way: API → Application → Domain ← Infrastructure
- **Queue-ready, not queue-first** — abstract the queue from day one, add a broker when needed
- **No premature optimisation** — Python + Polars first; Rust only where profiling proves it is needed
- **Never design a layer you haven't needed yet** — build, feel the pain, then abstract
- **Engineering interpretation is a characterisation output, not a design output** — soil behaviour type, layer detection, and packing-class indicators (Ic zone, Dr, NAD class, γ-estimate) are MVP outputs. Design-ready parameters (φ′, c′, cu, E50, OCR, Vs) that feed directly into ULS/SLS calculations are Phase 5. The boundary is: anything the engineer pastes into a design check without intermediate judgement stays out of the MVP. *(Carve-out history: Robertson SBT was segmentation-only in Phase 4 as of 2026-05-17; extended to committed per-unit characterisation indicators on 2026-05-18 by owner directive. See Scope.)*
- **Backwards compatibility, always** — see the dedicated section below; the short version is: a .gmproj file written by yesterday's build must open in tomorrow's build, forever.

---

## Commercial Direction

See [docs/commercial-direction.md](docs/commercial-direction.md) — Distribution model, the **three-level modelling hierarchy** (geological→litho→geotech), cross-sections as the editing surface, the **explicit-content invariant**, stratigraphic-order / `display_order`, **on-click build**, the v1.0 MVP gate, and open commercial concerns. **Load before any geology / litho / section / cross-section work.**

---

## Backwards Compatibility — non-negotiable from now on

See [docs/backwards-compat.md](docs/backwards-compat.md) — ⚠ **SUSPENDED pre-ship** (owner directive 2026-05-16) — schema / API / `.gmproj` shapes may change cleanly until the first external distribution. The full contract, the `format_version = 4` floor, the upgrade-chain steps, and the **re-arm trigger** live in the doc. Load before any `.gmproj` / bundle / format-version change.

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

See [docs/domain-model.md](docs/domain-model.md) — Full entity tree (InSituTest / Borehole / LabTest / Monitoring), the catch-all-vs-typed-family rule, and the **interpretation primitives by model kind** (FormationContact / LithoLayer / correlation edges / **BodyOrm** + A2 geo-decoupling). Load before domain-model or litho / body work.

---

## Project Structure

See [docs/architecture.md](docs/architecture.md) — Full `src/groundmodel/` package tree (domain / application / infrastructure / api / shared) + tests layout. Load when placing a new module.

---

## Development Workflow

Package manager: **UV** (installed globally via winget). The `.venv` and `uv.lock` live in the repo root; `.venv` is gitignored, `uv.lock` is committed.

```
uv sync --group dev              # first-time setup or after pulling
uv run pytest tests/unit         # fast, no Docker needed
.\scripts\run-integration-tests.ps1   # integration suite (sets DATABASE_URL + runs alembic)
uv run pytest tests/e2e          # requires full stack running
uv run ruff check src tests      # lint
uv run ruff format src tests     # format
uv run mypy src                  # type check
```

**Integration tests run against a sibling DB, never the dev DB.**
``tests/integration/conftest.py`` TRUNCATEs every project-scoped
table at the start and end of every test, so running it against
``groundmodel`` (the dev DB) wipes whatever is imported. The repo
ships a separate ``groundmodel_integration`` DB on the same
dockerised Postgres instance + a wrapper script at
``scripts/run-integration-tests.ps1`` that points ``DATABASE_URL``
at it and runs ``alembic upgrade head`` first. A
``pytest_collection_modifyitems`` guard in the integration conftest
refuses to run if ``DATABASE_URL`` does not end in ``_integration``
or ``_test``, so a forgotten env var fails loudly instead of
silently destroying state. Usage:

```
.\scripts\run-integration-tests.ps1                     # full suite
.\scripts\run-integration-tests.ps1 -q                  # quiet
.\scripts\run-integration-tests.ps1 tests/integration/api/test_cross_section.py
```

One-time bootstrap (already done; recreate after a docker volume
wipe with these three commands):

```
docker exec strix-db-1 psql -U groundmodel -d groundmodel `
  -c "CREATE DATABASE groundmodel_integration;"
docker exec strix-db-1 psql -U groundmodel -d groundmodel_integration `
  -c "CREATE EXTENSION IF NOT EXISTS postgis;"
.\scripts\run-integration-tests.ps1 --collect-only       # triggers migrations
```

Alembic honours ``DATABASE_URL`` when set (see
``src/groundmodel/infrastructure/db/migrations/env.py``), so the
wrapper script's env override carries through to migrations cleanly.

**Playwright (Electron) e2e suite — `scripts/run-e2e.ps1`.** Self-contained
runner that TRUNCATEs the integration DB (clean slate — the fixture restore
is idempotent and can't repair a half-deleted project), starts a standalone
uvicorn on :8765, seeds the synthetic fixture, runs Playwright, and stops the
backend. **Close the dev desktop app first** — both use :8765, and the script
ABORTS (never kills) if the port is busy, so it can't point a live dogfeed
session at the integration DB (see ``memory/feedback_e2e_port_8765_conflicts_dev_app.md``).
A full green run is offline and deterministic.

```
.\scripts\run-e2e.ps1                                  # full suite
.\scripts\run-e2e.ps1 flow_auto_correlate              # one spec (filter)
.\scripts\run-e2e.ps1 --reporter=line                  # pass-through flags
```

**DOV cassettes — the `flow_dov_bbox_*` specs never touch the network.** The
runner sets ``STRIX_DOV_FIXTURE_MODE=1``, which makes ``make_dov_async_client``
(``dov_http.py``) back the client with an ``httpx.MockTransport``
(``dov_fixture_transport.py``) that serves every DOV call — WFS count/features
+ per-permkey CPT/borehole/interpretation/observation XML — from on-disk
fixture files under ``desktop/tests/e2e/fixtures/dov/``. The full URL→file
route table is the module docstring of ``dov_fixture_transport.py``.

The fixtures are **hand-authored synthetic DOV-format files** (permkeys like
``2024-E2E-001``, not real DOV ids) — there is no record-from-live step, so a
refresh is a pure file edit, no network. To refresh / extend them:

1. **Add or change a record** — drop the per-permkey XML under the matching
   subdir (``cpt/<permkey>``, ``borehole/<permkey>``, …) in DOV's export XML
   shape, and add the permkey to the relevant ``wfs/<layer>_features.json``.
2. **Keep the count file in sync** — the specs assert exact counts
   (``imported=3``), so bump ``wfs/<layer>_count.xml`` (the WFS
   ``numberMatched``/``numberReturned``) to match the feature list, and update
   the spec's expected count.
3. **Stay inside the fixture bbox** — a WFS request whose BBOX doesn't overlap
   ``_FIXTURE_BBOX_L72_*`` in ``dov_fixture_transport.py`` gets the *empty*
   fixture (the imported=0 rejection path). New records must sit inside that
   box, or widen the box + the spec's bbox together.
4. **New endpoint / layer** — add a route branch in the transport's ``handler``
   + a slug mapping, then the fixture file. An unmatched URL returns 404 by
   design (a missing fixture surfaces as a test failure, not a silent skip).
5. Verify with ``.\scripts\run-e2e.ps1 flow_dov_bbox_cpt_import flow_dov_bbox_borehole_import``.

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

See [docs/subagents.md](docs/subagents.md) — The 6 project-scoped subagents (senior-code-reviewer, system-architect, staff-engineer, security-reviewer, product-strategy-advisor, ux-reviewer) and when to reach for each.

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

See [docs/data-integrity.md](docs/data-integrity.md) — The 6 rules: (1) tag provenance on derived values, (2) pass-through ≠ derived, (3) don't auto-convert independently-measured quantities, (4) denormalised-summary discipline, (5) validation invariants live in the parse result, (6) committed boundaries are an audit point. Load before storing a computed value or adding a summary column.

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

See [docs/parsers-gef.md](docs/parsers-gef.md) for the full reference: parsing flow, unit normalisation, quantity→column mappings (incl. the qty 15 vs qty 128 split that keeps `qt_mpa` and `q_total_mpa` in separate columns), validation enum, MEASUREMENTVAR indices, and the `ImportCpt.persist()` contract reused by every CPT importer.

---

## DOV Import

See [docs/parsers-dov.md](docs/parsers-dov.md) for the full reference: 5-phase pipeline, frontend bbox-draw flow, `ImportCptDov` backend (HTTP/2 streaming + cache-first + single-commit batching), DOV WFS / XML schema quirks (namespaces, units, `<diepte>` vs `<lengte>`), `DovXmlCache` semantics, and the httpx error→HTTP-status mapping.

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
| **4 (v1.0 commercial MVP gate)** | **Geological model** (formations + surfaces ✓); **lithostratigraphic model** (refines geological → lithology + admixture units; borehole `ObservationLayer` + assisted-manual CPT Robertson-SBT segmenter; Lithology peer-stage scaffolding ✓ #55 resolved 2026-05-18; Phase-1 accept flow ✓ 2026-05-19; Phase-1.5 manual composition picker ✓ 2026-05-19 — two-tab `LithoCompositionPickerDialog`, `axisMode` + `handleManualLithoUnitCreate` wired through SectionPanel → SectionsCanvas, source-parameterised `_find_or_create_contact`; Phase-2 Slice 2+3 ✓ 2026-05-19 — `ResolveLithoInstances` use case + `POST /correlations/resolve` + `GET /correlations` endpoints + `GeologicalFormationUpdateRequest.instance_ordinal_locked` PATCH extension + `client.ts` `LithoCorrelationEdge`/`ResolveInstancesResponse` types + `resolveLithoInstances`/`listCorrelations` API calls + LithologyInspector ordinal badge + lock toggle + Resolve action + RO-3 inline amber stale-ordinal badge; Slice 4 (connect gesture) shipped 2026-05-19 — see Tier E resolved; Slice 5 (parent_formation_name server-side enrichment) ✓ 2026-05-19 — debt #67 fully resolved); **geotechnical subdivision** (lithostratigraphic unit → NAD packing class 1–31, driven by CPT qc/Dr; per-unit CPT-derived indicators: Robertson Ic SBT zone, Dr for sand, NAD class label, γ-estimate from SBT lookup — all labelled "CPT-derived estimate"; design-ready values φ′/c′/cu/E50 stay blank, Phase 5); **cross-sections** as the edit/view surface for all three model levels; **DXF + Plaxis exports** of the three-level geometry with unit identifiers. **G3Dv3 Flanders import** lands alongside or just after launch. The product is sellable here. Commercial-readiness work (license keys, signed installer, auto-update, marketing site) ships alongside, tracked as Tier B debt. |
| 5 (post-v1.0) | Engineering interpretation **as design-ready parameters**: the full Robertson/Mayne port (φ′ from Uzielli 2013, c′, cu, E50, OCR, Vs, G0, M per NAD class), the complete NAD-NEN xlsx parameter table (38×313), per-layer statistics (mean/std/percentiles of qc across CPTs in a corridor), Rust hotspots for batch compute. Sedimentological feature-shapes (true interfingering lenses between control points — DISTINCT from the user-invoked pinch-out wedge tool shipped 2026-05-18: that does deterministic dip-extrapolation-to-crossing for a single terminal wedge edge [explicit, ghost-previewed, commits provenance-tagged `source='pinch_out_extrapolation'` synthetic contacts via `ExtrapolatePinchOut` + `POST .../contacts/pinch-out`]; interfingering is the harder facies-geometry-between-points problem and stays Phase 5). Additional data sources: monitoring (piezometer / inclinometer), DMT, pressuremeter. Additional exports: D-Stability (`.stix` via GEOLib), D-Sheet, GeoStudio, IFC. PDF reports. Optional SaaS layer with cloud sync over the .gmproj bundle. |

**Out of scope at every phase:** Eurocode (EC7) design calculations, bearing capacity, settlement, slope stability, pile/wall design. Those belong in the downstream tools we export to.

---

## Performance Escape Hatches

See [docs/performance.md](docs/performance.md) — Phases 1–4 stay pure Python + Polars; Phase-5 escape order Numba → Cython → Rust+PyO3 (CUDA excluded); free-threaded-Python is tracked-not-adopted. Load only when profiling proves a hotspot.

---

## Export System

See [docs/exports.md](docs/exports.md) — `BaseExporter` ABC; Plaxis 2D/3D (emits a runnable `plxscripting` script), D-Series via GEOLib, and the geometry contract. Load before touching an exporter.

---

## API Endpoints

See [docs/api.md](docs/api.md) for the full endpoint catalogue (CPT, borehole, project, geology models / formations / units / contacts / surfaces, sections + DXF export, reviews, view-state). Two load-bearing rules stay here:

* **Additive only.** New fields default to optional / null. Removing or repurposing existing fields needs a deprecation cycle — see "Backwards Compatibility" above.
* **The frontend always goes through the API** — never directly to domain or DB.

Conflict semantics worth knowing without opening the catalogue:

* `409 Conflict` on duplicate import (same GEF project_id + test_id within the same app project) — response body includes `cpt_id` of the existing record so the client can auto-load it.


---

## Project files (`.gmproj`)

See [docs/gmproj-format.md](docs/gmproj-format.md) — The `.gmproj` on-disk JSON shape (`format_version` 4), what the bundle carries, open / restore semantics, and the recent-projects list. Load before bundle / save / restore work. (Pairs with `backwards-compat.md`.)

---

## Desktop Frontend

See [docs/desktop.md](docs/desktop.md) for the full reference: directory tree (`main/` / `preload/` / `renderer/src/{api,components,utils,hooks,App.tsx}`), per-component contracts (CptChart panel layouts, ElevationEditor, BoreholeLog, MapView, Sidebar, WelcomeScreen), the Sidebar / CptChart conventions block (sort persistence, Y_W=52 ghost axes, CPTU vs CPTM layout, color constants).

---
## UX Conventions

See [docs/ux.md](docs/ux.md) for the full reference: layered guide stack (WCAG 2.2 AA → Apple HIG → GitHub Primer → Tailwind UI / Catalyst → domain conventions), the override rule, selection model, the section-editor keyboard-shortcut table (incl. Shift-marquee, Alt-drag MOVE vs plain-drag COPY, ESC peel), detail-panel rules, map / borelog conventions, dark-mode strategy, translation + persistence, loading + error feedback. Two load-bearing rules stay here:

* **Translate at the presentation boundary, never at ingest** — domain stores raw upstream tokens; UI lookup tables live in `desktop/src/renderer/src/utils/`.
* **Reversible vs irreversible actions** — reversible (project-local hide, sort, theme): fire immediately + provide undo. Irreversible (DB delete, file delete, sending external requests): confirmation dialog, default-focus on Cancel, action-named button (never "OK").

---

## Known Architectural Debt

See [docs/debt.md](docs/debt.md) for the full backlog. Format conventions stay here so debt items written in the future match the existing shape:

* Items are bigger than a quick fix, smaller than a phase.
* When an item is resolved, **delete it from this list** — implementation history lives in commits on `develop`, not in the debt file.
* Numbers stay stable through a debt-fixing campaign (do not renumber after each fix); explicit cleanup passes compact them (last done 2026-05-14 — renumbered + priority-sorted, 21 open items, 1 resolved anchor moved out of the numbered list).
* Each open item carries three fields: **What** / **Why deferred** / **When to revisit**. The trigger condition ("when 5000 samples per borehole becomes typical", "before any non-solo user", "day-1 of debt #3") is the most important field — without it, debt items live forever.

Priority is **milestone-gated** — the next build milestone is the
**Geotech-subdivision stage**, which cannot start until the litho stage
is finished. So the litho-finishing items are **Tier G, above an
explicit gate**; everything else waits. Full entries in
[docs/debt.md](docs/debt.md). Currently open, in priority order:

**Tier G — Before the Geotech stage (finish the litho stage).**

*Currently open:* #131 (#131-c lithology-coloured gradient seam ribbon SHIPPED 2026-05-28 [contactStripeColors helper + two-stripe gradient render replacing the edge line; edge-to-edge anchoring + ±6 px; 33 vitest + tsc; dogfeed-confirmed — the one "wrong colour" was the ribbon faithfully colouring a #157 sliver, not a defect]; #131-a lens_id-FK opacity/dash variant + #131-b pinch-out terminus SUPERSEDED by body-with-extent refactor 2026-05-31 — the `lens_id` FK on `LithoCorrelationEdgeOrm` and the `formation_absence` thread are structurally moot; the ``BodyOrm`` entity owns per-side extents; see "Recently resolved" below), #123 (clay→silt correlation suggestion bug — needs owner reproduction C; diagnostic SQL documented in debt entry), #99 (litho drag-clamp through rejected layers — awaiting owner reproduction C; code investigated and confirmed correct via G34b), #138 (drag-lock after litho merge — handle becomes immovable, intermittent; needs deterministic repro; candidate paths: zero-thickness rejected stub OR stale edits Map post-absorb; filed dogfeed 2026-05-26), #149 (double SAND/SILT units after Accept-litho — v1 merge-on-accept reverted, v2 no-merge shipped, v3 straddle-retired reverted; doubling persists and is NOT straddle/segmenter-merge drift; likely admixture-sig drift across investigations or auto-populate↔Suggest aggregation mismatch — needs future dogfeed repro; **2026-05-28 dogfeed strongly suggests #157 [straddle-split slivers] is the same root cause** — a merged ghost straddling a geo boundary is re-split into two units; **A2 2026-06-04 removes straddle-split entirely so that path is gone — re-verify post-A2; any residual doubling is the admixture-sig-drift hypothesis**), #134-C-bulk (extend the post-accept litho-geo snap check to accept-all-focused + bulk-one + bulk-all paths; blocked on a per-suggestion → created_contact_id mapping in the API response + a queue UI to surface N candidates without flooding the user; owner decision needed before code), #162 (couple coincident litho↔geo contacts — SHIPPED 2026-05-28 Slice 1: `formation_contact.parent_geo_contact_id` self-FK [SET NULL]; accept couple-step links + snaps geo→litho; auto-rebuild on geo move; bidirectional propagation w/ loop guard [litho→geo marks-stale, not auto-rebuild]; UnlinkLithoFromGeo + unlink-geo endpoint + context-menu item + glyph; reads the existing litho_snap_tolerance_m knob, Settings row relabelled "Litho↔geology snap". Subsumes #157 for the coincident case. mark-stale-vs-rebuild on propagation RESOLVED 2026-05-28 [owner: drags/manual edits don't auto-rebuild — mark stale; only accept auto-rebuilds]; Slice 2 [manual "Link to geology" — LinkLithoToGeo use case + link-geo endpoint + "Link to geology" menu item on uncoupled contacts] SHIPPED 2026-05-28; the coupled-contact drag/menu regression FIXED 2026-05-28 [060436ea — reference hit-strip suppressed where a litho contact is coupled to that geo contact, so the litho strip wins drag + shows the litho menu w/ Unlink]. link-geo endpoint integration tests SHIPPED 2026-05-29 [CP5 link-uncoupled+snap, CP6 no-geo-within-tolerance null body] — caught + fixed a real 500: the endpoint declared `response_model=FormationContactResponse` but the use case returns None when nothing is within tolerance, so FastAPI raised ResponseValidationError; fixed to `FormationContactResponse | None`. See docs/superpowers/specs+plans/2026-05-28-litho-geo-contact-coupling), #163 (auto-correlate refinements — adjacent-tests-only [headline], depth-band widening, post-correlate refresh bug, easier endpoint grab, right-click-edge-to-delete, split-suggestion-into-2-for-lenses; all pre-existing #127/#133 behaviour; (a) adjacent-only SHIPPED 2026-05-28 [RNG adjacency gate `_relative_neighbourhood_adjacency` over model-participant investigations — drops a pair if a third test lies in the lune between them; collinear → consecutive chain; kills spaghetti model-wide per owner "do all and delete all spaghetties"]; (b) depth-match window SHIPPED 2026-05-28 [Settings "Auto-correlate depth window" NumberRow → `view_state.litho_segmenter.auto_correlate_depth_window_m` → endpoint `base_depth_threshold_m`]; (c) refresh bug SHIPPED 2026-05-28 [coordinator `correlationEdgesRefetchNonce` bumped by `handleAutoCorrelate` → SectionsCanvas refetches edges; the edge state lives in the canvas not the hook]; (d)+(e) edge grab + right-click-delete SHIPPED 2026-05-28, then REDESIGNED 2026-05-29 [task #31, supersedes the 22px `unapproved-grab-a/b` endpoint handles]: the whole seam is now grabbable as two transparent midpoint-split `edge-grab-a/b` zones [`EDGE_DRAG_HIT_WIDTH`], each half dragging its nearer endpoint — plain left-drag retargets that end, Ctrl/Cmd-drag leaves the original + creates another from the anchor to the drop [→ wedge when it spans the layer's other boundary, 1↔2 → DetectLithoLenses]; right-click opens the delete menu on the grab zones [unapproved] or the ribbon `edge-hit-<id>` band [approved, CE-E3]; only (f) split-into-2 remains — a lens-authoring feature needing design [pair with #131-a/#101], though the new Ctrl-drag now offers a complementary drag-based lens path; owner dogfeed 2026-05-28/29).

*Recently resolved (do NOT re-add):* **2026-05-31 dogfeed batch** (lens auto-fire + ribbon weight + bulk count + lens-save race + bilateral pinch-out): (a) `bulk-suggest "investigations in this section" count` — SectionsToolbar bulkAnchors iterated project-wide visibleCpts/visibleBoreholes minus exclusion sets, so a section with 8 in-corridor tests reported "will run for 68". Routed through `investigationsOnSection(section, …)` to match every other section consumer; newTestAnchors + disabled-state gates inherit the fix; (b) `correlation ribbon thickness` — `RIBBON_HALF_HEIGHT_PX` halved 6 → 3 px (CorrelationEdgesOverlay.tsx); the band stopped fighting the lithology stripes for visual weight, 47 overlay tests pin the new size; (c) **lens detection is now an EXPLICIT verb** (owner directive 2026-05-31) — every site that used to auto-fire `DetectLithoLenses` stripped: CorrelateLithoContacts + UncorrelateLithoContacts + AcceptContactCorrelations + DeleteFormationContact + DeleteLithoLayer + UpdateFormationContact cross-merge. ResolveLithoInstances still runs inline on all six to keep instance ordinals coherent. New `POST .../geology/models/{mid}/lenses/detect` endpoint + `DetectLensesResponse` schema + `api.geology.detectLithoLenses` client method + toolbar "Detect lenses" verb (ScanSearch icon, sibling of "Materialise lens companions"). `AcceptResult.lenses_created` / `lenses_removed` stay on the response shape for client compatibility but are ALWAYS 0 from accept now. Trigger: a single manual correlate that incidentally closed a #135 topology was silently spawning a lens row, violating "no side-effects beyond the gesture". Stale `LithoLensOrm` rows survive destructive ops until the user clicks Detect lenses; the renderer tolerates dangling rows; (d) `SaveLensBoundary concurrent-PUT race` — the lens-shape editor fires PUTs ~1 ms apart while the user drags nodes; two concurrent transactions both passed the "shape exists" SELECT, both DELETEd existing nodes, both INSERTed → second commit died on `uq_litho_lens_boundary_node_order`. Serialised with `pg_advisory_xact_lock(hashtext(model_id || ':' || content_key))` at the top of `SaveLensBoundary.execute`; concurrent PUTs queue, lock auto-releases at commit, read paths (GetLensBoundary) untouched. 8 lens-boundary integration tests still pass. 1105 unit + 23 lens/correlation integration + 140 sections-stage + overlay vitest all green; (e) `lens fires prematurely on unilateral pinch-out` — `detect_lenses_from_graph` accepted a single-target #135 closure (one neighbour pinches to a point) as a lens, so a user who correlated "1 left ↔ top+base right" got a lens row even though the body's other side was unresolved. Tightened to require **bilateral closure** — a candidate body must pinch out on ≥2 distinct target investigations to fire. Algorithm rewritten to accumulate-then-filter; LensCandidate still records ONE primary target (smallest UUID) so the existing content_key triple stays stable. New unit test `test_unilateral_pinch_out_does_not_create_lens` pins the negative case; the 4 existing happy-path tests + 3 integration tests (test_detect_litho_lenses Tests 1+2+4, test_accept_contact_correlations Test 3) all reworked to a 3-investigation bilateral setup. 1106 unit + 23 integration green; (f) `stale lens rows from pre-bilateral bundles` — bundles saved under the old unilateral rule carry `LithoLensOrm` rows that the bilateral rule would no longer materialise; without intervention they survive every open + save cycle. DetectLithoLenses step 7 gained a `preserve-named` guard (skips rows where `name IS NOT NULL` — user-named lenses are intentional and only removable via `DELETE /lenses/{lens_id}`), then the project-restore endpoint (`/projects/{pid}/bundle` POST) now runs ResolveLithoInstances + DetectLithoLenses per litho model inside the same transaction as the restore, so legacy bundles self-clean on open. Named lens rows ride through untouched. New integration test `test_named_lens_survives_stale_topology_reconcile` pins the guard. 1106 unit + 38 integration green; (h) `lens shape ignored column-spacing nudge` — LensWedgeOverlay rendered its `along_m` geometry through raw `xToScreen` while every other section overlay uses `warpedXToScreen` (the post-nudge transform). At 100% spacing the two matched; at any other value the lens floated metres to the right of its parent columns (dogfeed 2026-05-31). Swapped to `warpedXToScreen` + new `warpedScreenXToAlongCb` for the drag-commit inverse (reads `warpAnchorsRef.current` at call time, same pattern as wheel-zoom). Third instance of the section-view-spacing-modifier-matters-for-ALL-geometry trap — the feedback memory is load-bearing. (i) `lens rendering not coworker-ready` — two presentation fixes (owner directive 2026-05-31, "i can't show it to my coworkers like this"): (1) source + pinch endpoints anchored at the column EDGE facing the other end of the wedge instead of column centre; the screen-edge X is converted back to world `along_m` via the warp-aware inverse so spacing stays correct. (2) Bilateral closure now renders BOTH sides — the overlay scans the approved-edge graph for every common pinch-out target of the (above, below) source pair and renders a secondary straight wedge to each one. Stored boundary shape nodes apply to the primary wedge only (data model carries one set per lens until Phase 5 two-sided authoring); secondaries render as straight pinches. Right-click → dissolve works symmetrically on both wedges. New tests LW8 (edge anchor), LW9 (secondary wedge present), LW10 (secondary has no draggable nodes). 10 lens-overlay tests + 450 sections-stage tests green. Phase 5 carve-out for two-sided authoring stays in place; we shipped the read-side without the data-model rework. (g) `stale lenses survive open-without-restore` — the restore-time reconcile (f) only fires on `POST /projects/{pid}/bundle`, but the desktop open path does `GET /projects/{id}` first and skips the restore when the project already exists in the DB, so legacy stale lens rows sat in the DB indefinitely until the user clicked `Detect lenses` manually. Added `_sweep_stale_lenses` to the FastAPI lifespan hook: after the DB probe, iterates every lithostratigraphic model in the DB and runs ResolveLithoInstances + DetectLithoLenses per model. Each model commits independently so a single bad model doesn't abort the rest; sweep failures log a warning and don't block startup. Preserve-named guard makes the sweep safe for user-named rows. Confirmed on the dogfeed DB — swept 4 models, removed 4 stale unnamed lens rows including the test2.strix one. **2026-05-29 dogfeed batch** (section + auto-correlate + lens cleanup — see docs/debt.md "2026-05-29 dogfeed batch" for detail): (a) section surface renders as a chord through the user's PLACED contacts not a TIN slice along the line (`surfaceThroughPicks`); (b) auto-correlate adjacency is SECTION-ALONG-ORDER not map-plane RNG (`AutoCorrelateContactEdges.section_id` + domain `adjacency=` override — supersedes #163a's RNG gate, which crossed columns on a section); (c) correlation grouping is LITHOLOGY-ONLY (dropped the `(parent, above, below)` triple that blocked obvious matches on boundary-edge parent mis-assignment or an extra interbed); (d) full-band correlate hit-target + void-click clears the armed source; (e) lens DEGENERACY GUARD `detect_lenses_from_graph(max_lens_thickness_m)` read from `view_state.litho_segmenter.max_lens_thickness_m` (0=off, default 5 m, Settings → Litho segmenter "Lens max thickness") — rejects near-whole-column spurious lenses + reconciles existing ones away on next correlate; (f) right-click a lens wedge DISSOLVES it via its two defining edges (the metadata-only DELETE left the body in the graph); (g) enclosed contacts correlating to NEITHER neighbour get an amber lens-candidate diamond in correlate mode (pinch-out-not-correlate cue; conversion flow + two-sided lens geometry stay future work). #159 (drag-lock after deleting an accepted litho unit — RESOLVED 2026-05-29. NOT the #152 clamp [a live-repro diagnostic never fired]; the real cause was a hit-strip overlap: `referenceContactHitStrips` suppressed the geo reference strip only when a litho contact was COUPLED [`parent_geo_contact_id`], but the #134 snap dialog leaves litho+geo coincident WITHOUT coupling, so the reference strip [painted on top, pointer-events all] ate the litho drag-strip's hover+mousedown → no drag cursor, locked. Fix: suppress the reference strip when a litho contact on the same anchor is coincident within `REFERENCE_COINCIDENCE_EPSILON_M`=1cm, not only coupled. RS3 pins it, GD5 reworked [old Slice-D z-order assertion encoded the bug]. Commits 58236f87/1466bac8/049915df. Milder near-coincident pixel-overlap variant intentionally not covered), #144 (litho accept flows now mark the project dirty — shipped 2026-05-28. The dogfeed title was a misdiagnosis: every contact mutation already writes to the DB immediately by design; the real defect was that the four accept handlers [handleAcceptLithoSuggestion, handleAcceptAllLithoSuggestions, handleAcceptBulkLitho, handleAcceptAllBulkLitho] skipped the session-imports manifest that handleCreateContact/seed/pinch-out all populate, so accepting layers left the amber flag dark + the .gmproj silently stale on close. Fix: feed each accept's created_contact_ids / created_formation_ids into addToSessionImports, guarded on non-empty so found-only accepts stay clean; bulk-all aggregates across anchors into one call per kind. No staged-commit refactor needed — the DB-is-source-of-truth architecture was never the problem. D1/D2/D3 pin it), #153 (accept-all-bulk wall-clock — shipped 2026-05-28: seeded-array leak #154 fixed + recompute-all-absences optimised [batched UPSERTs + per-section cache, 1015→377 ms] + batch accept endpoint [`POST .../contacts/batch-accept-litho-suggestions` + `BatchAcceptLithoSuggestions` use case + frontend one-call rewire of handleAcceptAllBulkLitho] — N-anchor bulk accept now 1 call / 3 commits instead of N+2 / ~2N+1; needs backend restart; see docs/debt.md), #154 (seeded-array leak — delete + Clear now prune `seeded_formation_contact_ids`; `remove_seeded_contact_ids` + `prune_orphan_seeded_ids` on CrossSectionRepository), #134-A (litho-geo snap tolerance moved from a `SectionsCanvas.tsx` constant onto `view_state.litho_segmenter.litho_snap_tolerance_m`, default 0.20 m, range 0.01-5.0 m; Settings → Litho segmenter exposes a NumberRow with hint copy on both directions; reads via `useMemo(readLithoSegmenterPrefs(project?.view_state).lithoSnapToleranceM)`. Shipped 2026-05-27), #134-B (in-flight drag-readout snap indicator — ContactsLayer's `geoSnapToleranceM` prop lights up an extra amber "↦ snap on release: 12.34 m" line + a small amber dot at the cursor anchor when the cursor is within ±tolerance of a geo contact on the same investigation; telegraphs the post-release prompt. Shipped 2026-05-27), #134-C single-path (handleAcceptLithoSuggestion now returns `Promise<AcceptLithoSuggestionsResponse | null>`; sectionAwareAcceptLithoSuggestion runs the same find-geo-snap-candidates check the drag uses and opens the existing LithoGeoSnapDialog for the new contact id when an accept lands within tolerance. Bulk paths [accept-all-focused + bulk-one + bulk-all] tracked as #134-C-bulk — they accept N suggestions with a flat created_contact_ids list and would need a queue UI to surface multiple matches. Shipped 2026-05-27), #141 (correlation triad collapsed into one SplitToolbarButton — shipped 2026-05-27: Correlate as primary verb [amber-tinted when mode is on], Auto-correlate + Accept correlations as caret items; preserves CT4/CT5 single-click toggle ergonomics; SplitToolbarButton gained `amber` prop + smarter primary-as-caret fallback that requires ≥1 enabled item so the shared-gate case fully disables the button), #148 (Clear leaves one unit + misleading "already empty" toast — resolved 2026-05-27 by today's #147 follow-up: pill unit count is model-scoped via `new Set(lithoContacts.map(c => c.formation_id)).size` and the LithologyInspector roster filters `lithoFormations` to those referenced by `lithoContacts`, so a Clear that leaves shared-sibling units in the project vocabulary now correctly reads "0 contacts, 0 units" + empty roster on the cleared model — the "1 unit retained" symptom can no longer render. `ClearLithoModel`'s orphan-aware backend sweep was correct all along; the bug was consumer-side), #147 (delete litho model + create new showed the OLD model's 823 contacts — shipped 2026-05-27, the `[project, activeLithoModel]` effect now clears `lithoContacts` + `lithoSurfacesByFormationId` SYNCHRONOUSLY at the top before the async fetch fires; previously only cleared when the new model was null, so A→B direct transitions left stale state in the fetch window. Inspector pill unit count also re-scoped to `new Set(lithoContacts.map(c => c.formation_id)).size` so a freshly-created empty model shows "0 contacts, 0 units" instead of "0 contacts, 30 units" from the project-scoped lithoFormations vocabulary), #151 (right-click menu on litho band + empty space — shipped 2026-05-27, single portalled menu with mode-branched item: band-rclick → Remove this litho unit → existing DeleteContactConfirmDialog; empty-rclick on a transparent per-column capture rect → Add new suggestion here → opens the LithoCompositionPickerDialog via useContactPicker's handlePickCpt/handlePickBorehole; LB1-LB4 pin the gesture surface), #152 (litho contact drag clamp at 10 cm + popup — shipped 2026-05-27, `contactDragClampMinThicknessM` prop on ContactsLayer, soft bounds respect the dragger's start-depth so legacy overlaps don't auto-jerk; portalled `contact-drag-clamp-popup` near the cursor when the cursor would commit past a peer's near-edge with the "right-click → delete adjacent layer first" wording; CL1-CL4 pin clamp + popup), litho cross-merge disabled (commit 9d4a01db, 2026-05-27 owner directive — `UpdateFormationContact` gates the cross-merge block on `model.kind != 'lithostratigraphic'`; geological cross-merge unchanged; Case 9 of `test_update_formation_contact_cross_merge.py` reworked to pin the new behaviour), #142 (accepted litho-ghost stayed at OLD suggestion depth after committed contact was dragged — shipped 2026-05-27, `LithoSuggestionGhostColumns` early-returns null for accepted indices so the committed contact stands alone; pending layers get a 45°-diagonal hatching overlay so the user reads "still suggestion" at a glance; G14 reworked + G14b/G14c pin the new visibility rules), #134 drag-path MVP (litho-geo snap prompt — shipped 2026-05-27 by owner-approved scope split: pure `findGeoSnapCandidates` helper sorts nearer-first / deeper-tie-break, `LithoGeoSnapDialog` modal with three actions [Snap-litho default-focused, Move-geo with rebuild+sync cascade, Cancel keep-separate] + radio group for two candidates, snap-aware wrapper around `handleUpdateContactDepth` in SectionsCanvas commits the raw drag first then opens the prompt when geo candidates exist; GS1-GS8 + SD1-SD9 pin helper + dialog; tolerance hard-coded at 0.20 m; remaining slices filed as #134-A/B/C), #136 (manual contact drag now snaps to other committed contacts on the same anchor — shipped 2026-05-27, `snapDepthsByAnchorId` carries `SnapCandidate { depth, contactId? }` and merges stratigraphy + committed contacts; ContactsLayer's `snapDepth` accepts `excludeContactId` and skips the dragger's own row so small drags no longer pull back to start; S-SC1/SC2 pin contact-snap + self-snap suppression), #139 (correlate mode unclickable when section has 0 litho contacts — shipped 2026-05-27, CanvasHints third-line hint pill `correlate-blocked-hint` + SectionsToolbar gate that intersects `lithoContacts` with `section.seeded_formation_contact_ids`; CT7/CT7b/CT8 + CH-CR1/CR2 pin the gate and hint; button stays clickable while correlateMode is on so the user can always exit), #133 Phase 2+3 (contact-level auto-correlate + lens detection + lens companions + formation-level removal — shipped 2026-05-26; user_approved column + AcceptContactCorrelations + DetectLithoLenses + MaterialiseLensCompanions; resolver + admixture propagation rewritten to consume contact edges; litho_correlation_edge table dropped; formation-level body-click gesture + ribbon + Resolve button removed), #135 (lens-pinch-out gesture — shipped 2026-05-26, lens-aware contact-correlate state machine with `lastTargetTestId` sticky window; first edge keeps source armed, second click on same target test fires another edge from same source; conservative branches for source-test re-arm + third-test re-arm; also fixed Phase 1's missing api/client wiring for the contact-correlation endpoints; CC1–CC7 pin the seven branches), #119 (same-lithology auto-merge — shipped 2026-05-25; merge_adjacent_same_lithology + Settings toggle + nad_class_range range tooltip; owner directive 2026-05-25 supersedes 2026-05-20), #122 (correlation edge opacity fade + body-hover spike — shipped 2026-05-25, always-on 20% ambient + 80% spike on body-hover; CE-O1/O2/O3 pin it), #121 (correlation polygon-ribbon rendering — shipped 2026-05-25, continuous ribbon per body ordinal replacing per-edge dashed lines; CE-R1/R2/R3/R4 pin it; lens_id variant + pinch-out terminus deferred, lens_id FK not in schema), #120 (band-rect clamp to investigation depth — shipped 2026-05-25, CE-B1/B2/B3 pin it), #76 (straddle split toast after accept-all — shipped 2026-05-25, S1-S4 + wired in useGeologicalModel), #101 (lens entity — shipped via Position 4 R1-R7 + fix-up #2 + #129 batch), #118 (pinch-out wired for Litho — shipped), #98 (right-click Split layer — shipped commit 060c6f41), #102 (same-lithology boundary merge button — shipped commit 3950385b), #127 (auto-correlate — shipped 2026-05-25), #128 (Playwright e2e harness — shipped 2026-05-25), #129a/b/c (post-Position-4 dogfeed batch — all shipped), #130 (Playwright coverage expansion convention — filed 2026-05-25, ongoing).

**═══ GEOTECH-STAGE GATE — everything below waits ═══**

**Tier B — Commercial launch gates + pre-distribution hardening:** #2 (bundled Postgres), #3 (license keys), #4 (auth on by-id endpoints; sub of #3), #5 (tamper hardening; sub of #3), #6 (installer + code signing + auto-update), #7 (marketing site + market-facing name), #47 (bundle column auto-enumeration → silent .gmproj format drift; fires at backwards-compat re-arm), #112 (bundle/restore + API input bounds — series-row cap, TIN-payload validation, PDF query-param caps), #113 (security pattern-risk cleanup — secret_key default, CQL quoting, regex anchors, IPC title cap), #200 (Electron pre-distribution hardening — F5 backend-stdout→DevTools DB-DSN leak RESOLVED [packaged builds log to `<logs>/backend.log`]; remaining: `file://` wildcard in `isInAppNavigation`).

**Tier D — Phase-4 export step + post-launch / Phase 5:** #104 (three-level export gap — snapshots carry geological-level data only; Phase-4 MVP export step), #13 (geotech units in section editor), #106 (application layer welded to the ORM — clean-architecture leak), #107 (schema integrity hardening — CHECK constraints / FKs / partial-unique + missing indexes), #108 (documentation refresh — docs/ + CLAUDE.md drifted from the shell + Phase-4), #109 (BaseExporter ABC split — ProjectExporter vs SectionExporter), #110 (export-path duplication — Plaxis exporters + section-export boilerplate), #111 (useGeologicalModel duplication — litho-accept block + bypassed _updateGhostEntry), #116 (test coverage gaps — RebuildModelSurfaces + SectionPdfReportExporter), #44 (cross-stage selection — per-stage consumers deferred; v1 footer shipped 2026-05-21), #52 (PDF report export — slice 1 shipped 2026-05-21; B/C/D slices pending), #56 (manual-lump cross-project reuse + standalone group editor), #60 (SeedLithoFromGeologicalModel orphaned — 4-layer chain), #70 (decision-log table for ML training — owner-audited), #71 (ML training pipeline that consumes the log — owner-audited), #79 (DOV Phase-2 import wall ~54 s decomposes as parse-bound not network-bound — instrument the offload path before any further speed work), **#93** (first-use tutorial + per-stage 'next step' hinting — onboarding; content authoring is the load-bearing piece; pre-coworker-binary trigger), **#95** (gesture cheatsheet + Help→Cheatsheet — the litho gestures landed in the section hint pill 2026-05-22; the all-stage cheatsheet half is still open), #11 (NL / multilingual stratigraphy catalog), #100b (Correlate inspector-select sticky reveal — hover half shipped 2026-05-23; sticky-select needs shared selectedFormationId).

**Tier E — Lower technical debt:** #16 (telemetry / crash reporting), #17 (legacy NULL-permkey — recovery runbook documented, no backfill code per 2026-05-17 architect review), #27 (bathymetry / water-surface DEM cells), #41 (Geology3DViewer component-mount smoke — needs a Cesium mock harness; pure-geometry math netted by `cesiumGeometry.test.ts`), #62 (pinch-out ghost-UX residual — full target+direction picker), #64 (litho 3D viewer split-viewport mode — revisit when user asks for side-by-side litho view or Phase 5 interfingering), #65 (excluded-boreholes UI for litho inspector), #68 (CorrelationEdgesOverlay menu robustness), #82 (drag-from-ghost-edge → correlation — variants B+C of #78), #201 (god-component file-size split — useGeologicalModel/ContactsLayer/SectionPanel/client.ts [backend project_bundle split done 2026-06-06]; plan at `docs/superpowers/plans/2026-06-04-god-component-decomposition.md`; post-dogfeed), #156 ("Edit in Geology stage" deep-link lands on the 3D viewer + "contact not found" ×2 — should open the cross-section; owner dogfeed 2026-05-28), #158 (thin litho bands/slivers hard to click — expand the hit target for thin bands; owner dogfeed 2026-05-28; lower priority once #157 reduces sliver count), #155 (litho bulk flow ~4 s on a real project — ROOT-CAUSED 2026-05-28: `RecomputeAllAbsencesForModel` re-processes the ENTIRE litho model on every bulk accept, so it scales O(model size): recompute 0.36 s on a clean 553-contact model vs 3.09 s on a 1331-contact model [backend total 4.15 s]. accept/seed/auto-correlate are all ≤0.2 s. PRIMARY LEVER SHIPPED 2026-05-28: incremental recompute [`RecomputeAllAbsencesForModel(only_formation_ids=...)` wired through the batch endpoint] re-infers only the formations the accept touched — synthetic 30-formation model: full 301 ms vs incremental 50 ms for 5 touched (6×, proportional). Secondary levers still open: frontend per-anchor setState fan-out in handleSuggestAllLitho [N renders], section-scoping, and the suggest phase. See docs/debt.md).

**body-with-extent refactor (2026-05-31, ~50 commits on develop, 8 slices):** supersedes the ``LithoLensOrm``-based lens entity family (#101, #129, #131). The unilateral lens rule (bilateral closure required, but stored as one primary target) is replaced by a ``BodyOrm`` entity with independently addressable left + right extents. Four extent kinds: ``to_target`` (detector-set), ``pinch_out_halfway``, ``extrapolated``, ``open`` (user-claimed). Provenance rule (revised 2026-06-04): detector never overwrites user-claimed extents (enforced in ``DetectBodies``); a user claim overwrites a detector ``to_target`` directly — no ``ClearBodyExtent`` step (the old refuse-and-409 blocked manual interpretation, dogfeed 2026-06-04; ``ProvenanceConflictDialog`` is now vestigial). New verb: ``POST .../bodies/suggest-pinch-outs`` (ephemeral candidates, no DB writes). Frontend: ``BodyExtentOverlay`` replaces ``LensWedgeOverlay``; ``BodyContextMenu`` + ``ProvenanceConflictDialog`` + ``ClaimExtentKindDialog`` add the user-claim gesture surface. Bundle v4 gains a top-level ``bodies[]`` array per model (pre-ship amnesty — no version bump). Spec: ``docs/superpowers/specs/2026-05-31-body-with-extent-design.md``. Plan: ``docs/superpowers/plans/2026-05-31-body-with-extent.md``. Items #131-a + #131-b are structurally moot (the ``lens_id`` FK and ``formation_absence`` thread lived on ``LithoCorrelationEdgeOrm`` which is now retired). **Lens-aware suggest (2026-06-02):** ``SuggestBodyPinchOuts`` now suppresses the host-half candidates of an enclosed lens — a thin unit bracketed by the same ``formation_id`` above and below (e.g. SAND·SILT·SAND, both sands one formation row) suggests only the lens, not the two host halves (pure helper ``domain/services/classify_enclosed_lenses.py``; exact same-formation bracket + recurring-formation-is-matrix tiebreak, ties stay normal candidates). body-level admixture editing deferred to the geotech stage. Spec: ``docs/superpowers/specs/2026-06-02-lens-aware-pinch-out-suggestions-design.md``; plan: ``docs/superpowers/plans/2026-06-02-lens-aware-pinch-out-suggestions.md``. **Body band fill — the "closed loop" render (owner directive 2026-06-03, supersedes the earlier "continuity stays emergent, no continuous-body primitive" line):** a body is a single-lithology unit traced across the section and FILLED. The resolver already makes one body per correlated-unit component + stamps ``litho_layer.body_id`` on every member; ``BodyBandOverlay`` (``components/sections/BodyBandOverlay.tsx`` + pure helper ``utils/bodyBands.ts``) renders each body that spans ≥2 on-section columns as the filled polygon bounded by its member units' ``depth_top_m`` chain (over) and ``depth_base_m`` chain (under), coloured by the formation's lithology colour, rendered BENEATH ``BodyExtentOverlay`` with the spacing-aware ``warpedXToScreen``. A band and a wedge are the same primitive — a wedge is the loop where the top/base chains converge to a point. The one-internal-lithology invariant is enforced upstream (lithology-only correlation + adjacent-contact framing). The extent system (``to_target`` / ``pinch_out_halfway`` / ``extrapolated`` / ``open``) demotes to the lateral END-CAPS past the band's leftmost/rightmost member, and ``DetectBodies`` is now section-scoped (closes each cap to the NEAREST target along the active section, fed via the ``section_id`` query param; the startup sweep + bundle restore run the resolver only so they never overwrite section-set extents). MVP shipped = the read-only member-chain band fill; end-caps + single-member lenses + lenses-in-lenses (a sub-body of a different lithology inside a body) are follow-ups. **Open-extent refinements (2026-06-02 dogfeed):** (a) an ``open`` extent (committed or ghost) draws a fixed length past the source column rather than to the section endpoint/DEM edge — configurable via Settings → Litho segmenter → "Open extent length" (``view_state.litho_segmenter.open_extent_length_m``, default 3 m, range 0.5–50). (b) the DEEPEST formation (top contact, no base contact → never framed as a body) now gets an ``open`` candidate at section EDGE tests only (substrate continues past the section; no interior pinch-out). Its base aligns with the litho band (``columnMaxDepthM`` → ``plotBottom`` fallback); the candidate carries ``below_contact_id=null`` + ``below_depth_m``, and ``BodyExtentOverlay`` derives the base from the source column's bottom for both ghost + committed render. **R1 — lithology-continuity suggestion rule (owner directive 2026-06-04, SUPERSEDES the lens-aware host-half suppression above AND the deepest-formation-opens-only-at-edge rule):** ``SuggestBodyPinchOuts`` decides each unit-side by whether the LITHOLOGY continues across, not whether the bounding contacts merely correlate. **BAND** (no candidate) when the unit's top contact has an approved edge to a SAME-soil contact on the nearest neighbour and that neighbour is deep enough to carry the unit; **PINCH** for an interior unit whose lithology does not continue to an EXISTING neighbour (different lithology / no correlation / neighbour too shallow to reach the depth); **OPEN** at the section's first/last column (no neighbour) or for the bottom substrate (the deepest unit — it never pinches) wherever it does not continue. This fixes the dogfeed bug where the lithology-blind "both bounding contacts correlate → band" wrongly suppressed real pinch-outs (a sand correlating to a clay across the shared 0.05 m surface boundary read as continuous). The enclosed-lens host-half suppression (``classify_enclosed_lenses`` use inside the suggester) is REMOVED — identifying a thin host as continuous is now the engineer's call (correlate the host across and R1 reads it as a band). Thin-lens pinches (a thin layer that correlates same-lithology across but the engineer still wants to wedge out) are NOT auto-suggested — that is a lens/judgement call, validated against the real ``test2.strix`` Cross-section 1: R1 matches 39/42 explicit user marks, the 3 misses being exactly the thin-lens picks. ``_section_along_positions`` already projects ALL in-corridor tests (not just litho participants) so "section edge" means first/last *visible* column. Tests: ``test_lithology_continues_across_correlation_is_band`` + ``test_lithology_changes_across_correlation_is_pinch`` pin the core distinction.

**Recent resolutions:** see [docs/debt.md](docs/debt.md) for full RESOLVED entries with owner directives + design rationale on each shipped item. Architectural debt history lives there; this section carries only what is currently open.

**Resolved anchor (outside numbered list):** Contact selection toolbox — kept for design rationale only.
