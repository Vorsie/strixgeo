# Ground Model Platform — CLAUDE.md

## Project Overview

Commercial **ground model platform** — builds and manages the unified subsurface dataset for a project. Ingests CPT, borehole, lab, monitoring, DMT, pressuremeter, and geophysical data; derives parameters and statistics; exports to design tools (Plaxis, D-Stability, D-Sheet, GeoStudio, ...). Built for solo development; targets Electron + React desktop first, SaaS later.

---

## Maintaining this file — what belongs here

This file is **normative, not narrative**: it describes how to work on the codebase, never what happened to it. It auto-loads into every session, so every byte here is paid for on every conversation. Hard rules:

* **Never append session logs, shipped-feature retrospectives, perf journeys, or resolved-debt history here.** Route them instead:
  * Debt status changes → [docs/debt.md](docs/debt.md) (the single canonical backlog).
  * Design decisions / current-state descriptions of a subsystem → the matching `docs/design/*.md` note (current state ONLY — superseded designs are deleted, git has the history).
  * Session-scoped status, dogfeed-pending items, owner decisions → `CLAUDE.local.md`.
  * Transferable engineering lessons → [docs/lessons-learned.md](docs/lessons-learned.md).
  * Timings / baselines → [docs/benchmarks-journal.md](docs/benchmarks-journal.md).
* When something here becomes history (a rule is superseded, a milestone ships), **rewrite the section to the new current state** — do not stack "SUPERSEDES the above" paragraphs.
* **Size budget: 40 KB.** If an edit would exceed it, extract to a doc + pointer instead. (Pruned from 86 KB on 2026-07-12; do not let it regrow.)
* Pointer sections follow the existing pattern: one line of summary + "Load before X" trigger.

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
- Robertson Ic / Soil Behaviour Type classification — **as a fully automated produced parameter.** Carve-out (owner directive 2026-05-18): Robertson SBT zone is committed as a **per-unit summary** in the MVP (Ic zone label, relative density Dr for sand units, NAD packing class 1–31, γ-estimate from SBT lookup) — characterisation outputs, not design inputs. The boundary: any value used directly in a design calculation (φ′, c′, cu, E50, OCR, Vs, G0, M) stays Phase 5, as does the full Robertson/Mayne parameter port and the NAD-NEN xlsx table (38×313). See `memory/project_litho_geotech_three_level_model.md`.
- Auto soil profiling (merging Ic into layers) — as an *automatic* model. The litho segmenter's assisted-manual suggestion flow (user-accepted ghost nodes, not auto-correlation) is Phase 4 per the original carve-out; unchanged.
- Per-layer design parameters from Robertson correlation (φ′, c′, cu, E50, OCR, Vs, G0, M) — Phase 5. Dr and NAD class are MVP (above); the design-ready values derived from them are not.
- Per-CPT validation that requires geotech judgement (RF range checks, qc spike detection, hybrid-method detection)

---

## Core Philosophy

- **Data correctness first** — clean ingestion + storage before any interpretation
- **Clean architecture** — dependencies flow one way: API → Application → Domain ← Infrastructure
- **Queue-ready, not queue-first** — abstract the queue from day one, add a broker when needed
- **No premature optimisation** — Python + Polars first; Rust only where profiling proves it is needed
- **Never design a layer you haven't needed yet** — build, feel the pain, then abstract
- **Engineering interpretation is a characterisation output, not a design output** — Ic zone, Dr, NAD class, γ-estimate are MVP outputs; design-ready parameters (φ′, c′, cu, E50, OCR, Vs) that feed ULS/SLS calculations are Phase 5. The boundary: anything the engineer pastes into a design check without intermediate judgement stays out of the MVP. *(Boundary reconsidered 2026-06-29 — a provenance-stamped parameter **suggestion** slice [φ′/γ/K₀ from CPT, formula + source + confidence + accept/override] is a noted future MVP candidate, revisited AFTER the geotech stage; any shipped correlation MUST carry a verification test against a hand-worked/paper example. Full rationale in `CLAUDE.local.md` → Active Focus and [[project_mvp_rescope_litho_nad_cpt_indicators]].)*
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
silently destroying state.

**Only ONE integration run at a time.** The same per-test TRUNCATE
means two concurrent runs wipe each other's rows mid-test, and the
resulting failures look like logic bugs, not a race (FK violation on
a row just created; ``StaleDataError: expected to update 1 row(s); 0
were matched``; a 422 for a model the log shows being created 201).
The wrapper takes a lock at ``.integration-test.lock`` (repo root,
gitignored) and **ABORTS** — never waits, never kills — naming the
holder's pid, its liveness, and the ``Remove-Item`` line for a lock
left behind by a crash. Usage:

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

**DOV cassettes — the `flow_dov_bbox_*` specs never touch the network.**
`STRIXGEO_DOV_FIXTURE_MODE=1` backs the DOV client with an `httpx.MockTransport`
(`dov_fixture_transport.py`) serving hand-authored synthetic fixtures from
`desktop/tests/e2e/fixtures/dov/`. See [docs/e2e-fixtures.md](docs/e2e-fixtures.md)
for the fixture-refresh procedure + route table pointer. Load before touching
DOV e2e specs or fixtures.

**Pre-commit rules — apply to every Python file before staging:**

1. `uv run ruff format <file>` — auto-format
2. `uv run ruff check --fix <file>` — auto-fix lint issues
3. Add complete numpy style docstrings to all public modules, classes, methods, and functions that lack one

A PostToolUse hook auto-runs steps 1–2 after every file write. Step 3 is enforced by code review. A second PostToolUse hook (`desktop_ts_check.py`) fires on `desktop/**/*.ts(x)` writes: runs `eslint --fix` if an eslint install ever lands in `desktop/` (none today), and warns when the edited file exceeds 500 lines (god-component pressure, debt #201). The git pre-commit hook also blocks any staged CLAUDE.md over the 40 KB budget.

**Git pre-commit hook:** the repo ships a pre-commit hook in
`.githooks/pre-commit` that runs `uv run pytest tests/unit -q` whenever
any `.py` file is staged, plus the desktop `npm test` (Vitest) suite
when any `desktop/*.{ts,tsx}` is staged. Doc-only / config-only commits
skip the test layer.

**Git pre-push hook:** `.githooks/pre-push` fires when the commits being
pushed touch `src/groundmodel/**` or `tests/integration/**`.  It invokes
`.\scripts\run-integration-tests.ps1` and blocks the push on any pytest
failure.  Doc-only, desktop-only, and config-only pushes skip the gate
automatically.  The hook was added after a RED integration test (`BH1-2`)
shipped undetected — the structural reason was that integration tests ran
nowhere automatically.

Enable both hooks once per clone:

```
git config core.hooksPath .githooks
```

Skip in emergencies with `git commit --no-verify` / `git push --no-verify`
— treat either as a flag that something needs a follow-up commit/fix.

---

## Distribution build (Windows installer)

See [docs/distribution-build.md](docs/distribution-build.md) — `cd desktop &&
npm run dist` produces an unsigned NSIS installer carrying a bundled
PostgreSQL 16 + PostGIS 3.6 and a relocated CPython running the backend from
source. **The dev workflow is untouched — every mechanism is gated on
`app.isPackaged` or on running a staging script deliberately.** Load before
packaging / installer / bundled-DB work. (Pairs with `distribution-db-decision.md`.)

---

## Subagents

See [docs/subagents.md](docs/subagents.md) — The 9 project-scoped subagents (senior-code-reviewer, system-architect, staff-engineer, security-reviewer, product-strategy-advisor, ux-reviewer, **logging-reviewer**, **testing-reviewer**, **debugging-scientist**) and when to reach for each. The last three (added 2026-06-30) run the observability/testing/scientific-debugging gates — use the Combined Workflow (implement → logging-review → testing-review → revise) on substantive changes.

**Engineering lessons:** [docs/lessons-learned.md](docs/lessons-learned.md) — transferable, hard-won rules (all-or-nothing matching fails on real data; never trust a truncated UUID; integration tests need an automated trigger; the real-data gate must assert the invariant the feature protects; verify a regression test goes RED on old code; load-bearing logs belong at INFO not DEBUG; establish WHERE before HOW — name the render surface / owning layer first). Read before repeating a class of mistake; append when a bug teaches a new one.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| API | FastAPI | async, Pydantic validation |
| Database | PostgreSQL + PostGIS | spatial queries, depth series |
| ORM | SQLAlchemy + Alembic | migrations |
| Data | Polars | fast series processing; PostGIS for spatial |
| Performance | Numba (`@njit`) | adopted Phase 4 for the voxel mesh hotspot; Cython / Rust+PyO3 still deferred |
| D-Series export | `d-geolib` 2.9.1 | writes D-Stability `.stix` + D-Sheet Piling `.shi` in-process; no D-Series install needed. Quirk table in [docs/exports.md](docs/exports.md) |
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

Every `// eslint-disable-next-line react-hooks/exhaustive-deps` site MUST be preceded by a `// reason: ...` block comment explaining *why* the linter is wrong here (born from the S7 infinite-render-loop incident, commit `15fb2cb`). Reason-less suppressions erase the linter's signal on the entire `useEffect` body.

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

See `domain/models/job.py` (Job, JobStatus), `application/task_queue.py` (TaskQueue ABC), and `application/synchronous_queue.py` (SynchronousQueue).

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

- **Add `bench_<thing>.py` when a CPU-bound function is introduced** that processes per-row or per-element work in process — parsers, interpretation services, batch transforms. These are the only things `pytest-benchmark` measures meaningfully.
- **Don't add a benchmark just because a phase finished.** A phase that introduces only ORM models, repositories, or thin async-DB plumbing has nothing CPU-bound to benchmark — wall-clock there is dominated by Postgres round-trips and TCP. The "performance" property that matters at that layer (e.g. "`flush=False` causes one round-trip not N") is verified by the integration test, not a wall-clock benchmark.
- **End-to-end import timings live in [docs/benchmarks-journal.md](docs/benchmarks-journal.md)**, not as benchmarks. They're real-network / real-model numbers recorded when something motivates re-measurement. They're documentation, not regression gates.

---

## Build Sequence

Engineering interpretation (Robertson Ic, soil profiling, derived per-layer parameters, statistics across the model) is intentionally pushed to the **final phase**. Earlier phases focus on data: ingest it, store it, visualise it, export it. A small "preview" Ic implementation already exists from earlier work — it's kept and visible in the chart, but not extended until the final phase.

| Phase | Focus |
|---|---|
| 0 | Parse real GEF files; data reality doc; first-draft schema ✓ |
| 1 | Thin slice: import GEF → parse → store → FastAPI CPT routes ✓ |
| 2 | Electron + React desktop; project system; map; DOV chart; multi-file GEF + DOV bbox import + persistent XML cache ✓ |
| 3 | Data sources expansion: borehole + samples + lab ✓ (monitoring / DMT / pressuremeter deferred to post-v1.0) |
| **4 (v1.0 commercial MVP gate)** | **Geological model** ✓; **lithostratigraphic model** ✓ (assisted-manual segmenter, accept flow, correlation, bodies, partition fill, 3D voxel build); **geotechnical subdivision** ✓ functionally complete, in daily dogfeed (litho unit → NAD packing class 1–31 with CPT-derived indicators — the norm, unbadged; only "No CPT" exceptions badge, owner 2026-08-27; design-ready values stay blank); **cross-sections** as the edit/view surface for all three model levels ✓. **v1.0 scope re-ruled by owner ballot 2026-08-26 — the authoritative list lives in [docs/commercial-direction.md](docs/commercial-direction.md) §v1.0 gate.** In brief it ADDS to the gate: D-Stability/GeoStudio/D-Sheet exports, PDF report slices (characterisation-level), export unit identifiers + completeness guard + same-NAD lens thinning, per-unit statistics plots + layer→parameters jump, smooth 3D (#220), footprint ring, G7 DEM surface, 3D split viewport, fence export, onboarding (#93), NL translation, bundled Postgres, installer + signing, **waterproof** subscription activation (beta builds expire), telemetry. **G3Dv3 import is a launch-window demo asset, not a gate.** |
| 5 (post-v1.0) | Engineering interpretation **as design-ready parameters**: the full Robertson/Mayne port (φ′ from Uzielli 2013, c′, cu, E50, OCR, Vs, G0, M per NAD class), the complete NAD-NEN xlsx parameter table (38×313), Rust hotspots for batch compute. Sedimentological feature-shapes (true interfingering between control points). Additional data sources: monitoring, DMT, pressuremeter, mechanical lab, AGS. IFC export. Parameter *suggestions* with provenance. Optional SaaS layer with cloud sync over the .gmproj bundle. |

**Out of scope at every phase:** Eurocode (EC7) design calculations, bearing capacity, settlement, slope stability, pile/wall design. Those belong in the downstream tools we export to.

---

## Performance Escape Hatches

See [docs/performance.md](docs/performance.md) — escape order Numba → Cython → Rust+PyO3 (CUDA excluded); free-threaded-Python is tracked-not-adopted. Load only when profiling proves a hotspot. **Numba is ADOPTED (2026-06-16, Phase 4):** `@njit(cache=True)` on `voxel_litho/greedy_mesh._maximal_rectangles_njit` — the profiled mesh-extraction hotspot (93.6 % of extraction; 38.6× on the real workload, byte-identical output). Hard dependency now (+119 MB llvmlite/LLVM), justified by on-click Build on lower-spec machines. The rest of the pipeline stays pure Python + Polars; reach for the next `@njit` only on a profiled hotspot (labelling is the next candidate).

---

## Export System

See [docs/exports.md](docs/exports.md) — the three exporter ABCs (`ProjectExporter` / `SectionExporter` / `SectionGeometryExporter`); Plaxis 2D/3D (a runnable `plxscripting` script); **D-Stability `.stix` + D-Sheet Piling `.shi` via GEOLib** — the CLOSED-geometry family, which consumes a renderer-POSTed partition (`SectionPolygonSet`), writes NO design parameter, and refuses rather than shipping an empty artefact; and the GEOLib quirk table. Load before touching an exporter.

---

## API Endpoints

See [docs/api.md](docs/api.md) for the full endpoint catalogue (CPT, borehole, project, geology models / formations / units / contacts / surfaces, sections + DXF export, reviews, view-state). Two load-bearing rules stay here:

* **Additive only.** New fields default to optional / null. Removing or repurposing existing fields needs a deprecation cycle — see "Backwards Compatibility" above.
* **The frontend always goes through the API** — never directly to domain or DB.

Conflict semantics worth knowing without opening the catalogue:

* **Re-importing a CPT refreshes it — but the overwrite is CONSENTED.** `POST /cpt/import` for a file already in the project (same GEF project_id + test_id) can update the EXISTING row in place — series + header replaced from the fresh parse, **same `cpt_id`**, manual elevation kept, derived 3-D caches staled — which is the "Idempotency on ingest" rule: a parser fix must reach a project the user already imported into without a delete + re-import that would destroy every interpretation anchored on the row. Because that write is irreversible it is never automatic: without `confirm_refresh=true` the endpoint answers `409` with `code = "cpt_refresh_confirmation_required"` + the old-vs-new diff and writes NOTHING; with it, `200` + `refreshed: true` (a genuinely new CPT still answers `201`). A fresh parse with 0 rows or ERROR-level issues is refused `422` (`code = "cpt_refresh_refused"`) even when confirmed — a broken file must never overwrite good data. The desktop shows the diff in a ConfirmDialog (Cancel default-focused, "Replace data"). The legacy `409` carrying only the existing `cpt_id` survives for callers that pass `refresh_existing=False`.

---

## Project files (`.gmproj`)

See [docs/gmproj-format.md](docs/gmproj-format.md) — The `.gmproj` on-disk JSON shape (`format_version` 4), what the bundle carries, open / restore semantics, and the recent-projects list. Load before bundle / save / restore work. (Pairs with `backwards-compat.md`.)

---

## Desktop Frontend

See [docs/desktop.md](docs/desktop.md) for the full reference: directory tree (`main/` / `preload/` / `renderer/src/{api,components,utils,hooks,App.tsx}`), per-component contracts (CptChart panel layouts, ElevationEditor, BoreholeLog, MapView, Sidebar, WelcomeScreen), the Sidebar / CptChart conventions block.

---

## UX Conventions

See [docs/ux.md](docs/ux.md) for the full reference: layered guide stack (WCAG 2.2 AA → Apple HIG → GitHub Primer → Tailwind UI / Catalyst → domain conventions), the override rule, selection model, the section-editor keyboard-shortcut table, detail-panel rules, map / borelog conventions, dark-mode strategy, translation + persistence, loading + error feedback. Two load-bearing rules stay here:

* **Translate at the presentation boundary, never at ingest** — domain stores raw upstream tokens; UI lookup tables live in `desktop/src/renderer/src/utils/`.
* **Reversible vs irreversible actions** — reversible (project-local hide, sort, theme): fire immediately + provide undo. Irreversible (DB delete, file delete, sending external requests): confirmation dialog, default-focus on Cancel, action-named button (never "OK").

---

## Design Notes — current-state subsystem references

Current-state design of the interpretation subsystems. Each doc describes ONLY the shipped model — superseded designs live in git history, never in the doc.

* [docs/design/section-fill.md](docs/design/section-fill.md) — the 2D section partition: the **contact-correlation model** (2→BAND / 1→ONLAP / 0→LENS), the deep-to-deep substrate pass, the **CS1 real-data gate**, dogfeed traps. **Load before touching `partitionFill.ts` / `PartitionFillOverlay` / `computeSectionFill` or the 3D voxel labelling.**
* [docs/design/body-model.md](docs/design/body-model.md) — bodies as resolver connected-components, the partition fill as single source of truth for body shape, the body-extent retirement summary, lens-detection behavioral rules, the Tier-D export note. **Load before body / correlation / lens work.**
* [docs/design/geotech-stage.md](docs/design/geotech-stage.md) — geotech subdivision + the **fraction-space refinement** render model + connecting geotech units. **Load before any geotech-stage work (the current milestone).**
* [docs/design/autosave-recovery.md](docs/design/autosave-recovery.md) — why a crash loses NO interpretation (Postgres outlives Electron; every gesture is an awaited call), the six renderer-only items that ARE lost, the lumping map's new columns + revision reconciliation, and the recovery-file mechanism. **Load before autosave / recovery / stratigraphy-lumping work.**
* [docs/design/beta-expiry.md](docs/design/beta-expiry.md) — the beta-build expiry primitive (build stamp, monotonic clock anchor, hard stop) every activation option reuses. **Load before licensing / activation / build-stamp work (debt #3/#5).**
* [docs/design/diagnostics-capture.md](docs/design/diagnostics-capture.md) — local diagnostics capture (NDJSON store, redaction, consent default-off, crash bundle); the transmit half deliberately sends nowhere pending the activation ruling. **Load before telemetry / crash-report work (debt #16).**
* 3D voxel litho builder — `memory/project_voxel_litho_builder.md` (geo-band-bounded voxel labelling from the 2D partition, honor-borehole, greedy meshing, Numba hotspot). **Load before 3D build work.**

---

## Known Architectural Debt

**The canonical backlog is [docs/debt.md](docs/debt.md)** — full entries (What / Why deferred / When to revisit), owner directives, and all RESOLVED history live there and ONLY there. Never record debt status changes in this file; this section carries only the format conventions and a compact open-items index so a session can see priorities without loading the backlog.

Format conventions for debt items:

* Items are bigger than a quick fix, smaller than a phase.
* When an item is resolved, move its entry to the RESOLVED section of docs/debt.md — implementation history lives in commits on `develop` and in docs/debt.md, never here.
* Numbers stay stable through a debt-fixing campaign; explicit cleanup passes compact them.
* Each open item carries three fields: **What** / **Why deferred** / **When to revisit**. The trigger condition is the most important field — without it, debt items live forever.

Priority is **milestone-gated** — the current milestone is the **Geotech-subdivision stage**. Open index (one-liners only; details in docs/debt.md):

**Tier G — finish the litho stage:** #123 clay→silt correlation suggestion bug (needs owner repro; diagnostic SQL in debt entry) · #149 double SAND/SILT units after Accept (narrowed 2026-06-22 to the find-or-create `(soil_code, sig)` key incl. admixture `amount`; next dogfeed = enable DEBUG + read the two `sig=` values) · #134-C-bulk SHELVED (owner: build nothing; revisit placement at geotech-inspector design) · #163(f) split-suggestion-into-2-for-lenses (needs design; Ctrl-drag offers a complementary path).

**═══ GEOTECH-STAGE GATE — everything below waits ═══**

**Tier B — commercial launch gates + pre-distribution hardening:** #2 bundled Postgres · #3 subscription activation (re-scoped from license keys, 2026-06-25) · #4 auth on by-id endpoints · #5 tamper hardening · #6 installer + code signing + auto-update · #7 marketing site + name · #47 bundle column auto-enumeration (fires at backwards-compat re-arm) · #200 Electron pre-distribution remainder (`file://` nav wildcard; Electron exact-pin + support-window verification — the DevTools/Reload gating landed 2026-08-03).

**Tier D — Phase-4 export step + post-launch:** #104 three-level export gap · #106 application layer welded to the ORM · #107 schema integrity hardening · #108 documentation refresh · #109 BaseExporter ABC split · #110 export-path duplication · #111 useGeologicalModel duplication · #116 test coverage gaps · #44 cross-stage selection · #52 PDF report slices B/C/D · #56 manual-lump reuse · #70/#71 decision-log + ML pipeline · #79 DOV Phase-2 import wall (instrument before speed work) · #93 first-use tutorial/onboarding (pre-coworker-binary) · #11 multilingual stratigraphy catalog · #100b Correlate sticky reveal · #220 smooth non-blocky litho 3D (Phase 5 visual).

**Tier E — lower debt:** #16 telemetry/crash reporting · #17 legacy NULL-permkey runbook-only · #27 bathymetry DEM cells · #62 pinch-out ghost-UX residual · #65 excluded-boreholes UI · #68 CorrelationEdgesOverlay menu robustness · #82 drag-from-ghost-edge correlation · #240 fence-panels alongM divergence (owner visual call; one-liner flagged in buildProjectFence) · #201 god-component decomposition (round 2 landed 2026-07-13: partitionFill/ pkg, geology.types, overlay trio, Geology3DViewer, 2 SectionsCanvas sub-hooks; remainder = SectionPanel #168 rerouting + 2 entangled SectionsCanvas clusters + #178 backend trio — see debt entry) · #156 "Edit in Geology" deep-link mis-lands · #155 litho bulk flow secondary levers · #227 manual geotech edits (SHIPPED 2026-08-08; dogfeed + 2 owner questions pending) · #228 litho engine slivers · #242 model floor shallower than the deepest investigations (owner call) · #269 borehole packing preview covers the first divide only (re-divide diff render undesigned) · #274 seam-stroke doubling = the pale helper lines · #275 codebase-wide simplification/deletion campaign (fresh session; owner fires it after the constructive-fill harvest) · #276 canvas module-refs never nulled on unmount (stale-closure hazard; fix pattern = the fence-export ref's cleanup effect).
