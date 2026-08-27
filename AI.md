# AI.md — entry point for AI coding agents

Read this first, whatever tool you are (Claude Code, Cursor, Codex, Copilot,
other). **`CLAUDE.md` is the authoritative rulebook** — this file is the short
digest plus the architecture map. If the two ever disagree, `CLAUDE.md` wins;
fix the drift here in the same commit. When code structure changes, update the
map below in the same commit (same discipline as `CLAUDE.md`).

## Hard rules (non-negotiable)

1. **Architecture.** The backend follows Clean Architecture. Dependencies
   point inward: `api → application → domain ← infrastructure`. The domain
   layer knows NOTHING of FastAPI, Postgres, SQLAlchemy, or Polars. The
   frontend always goes through the HTTP API — never to domain or DB.
2. **God files.** Do not grow `useGeologicalModel.ts` (~5.1k lines),
   `SectionPanel.tsx`, `ContactsLayer.tsx`, or `SectionsCanvas.tsx` for small
   changes. Extend behaviour through smaller dedicated hooks or pure util
   functions in `desktop/src/renderer/src/utils/` and wire them in with a
   minimal diff. Decomposition is tracked as debt #201 — do not make it worse.
3. **Data contract.** The DB is the live store; the `.strix` file is the save
   bundle. Every schema change ships as a hand-written Alembic migration + the
   ORM change + a bundle round-trip test in the same slice. New ORM columns
   ride the `.strix` bundle automatically (generic column serialisation);
   older builds drop unknown keys.
4. **Never run `pytest tests/integration` directly.** It TRUNCATEs whatever
   `DATABASE_URL` points at — including the dev database. Only
   `.\scripts\run-integration-tests.ps1` (takes a lock; ABORTS if busy —
   wait, never kill). One run at a time, ever.
5. **Toolchain pins.** Node 22 LTS (Node 24 segfaults vitest). Bare `python`
   is not on PATH — use `uv run python` (or `py`). Run vitest from
   `desktop/`, never the repo root. Port 8765 is shared by the dev app and
   the e2e runner — never kill it blind.
6. **Git.** One file per commit, Conventional Commits
   (`type(scope): lowercase description`, ≤ 72 chars). NEVER push — pushing
   is the owner's call. Enable hooks once per clone:
   `git config core.hooksPath .githooks` (pre-commit runs the unit suites,
   pre-push runs the integration wrapper). English-only identifiers,
   comments, and docstrings.
7. **Not running under Claude Code?** Its write-hooks do not fire for you:
   run `uv run ruff format <file>` and `uv run ruff check --fix <file>` by
   hand after every Python edit, and keep renderer files under review for
   the 500-line pressure warning.

## Architecture map (verified against the tree, 2026-08-27)

### System shape

Electron desktop app (React renderer) ⟷ local FastAPI backend ⟷ PostgreSQL +
PostGIS. Dev: backend on :8765, dockerised Postgres (:5433 dev DB / sibling
`_integration` DB). Packaged: NSIS installer bundles PostgreSQL 16 + PostGIS
3.6 and a relocated CPython running the backend from source; per-install
secrets; profile at `%APPDATA%\StrixGeo`. Persistence contract: the DB is the
live store; the `.strix` file is the save artefact (bundle of every
project-scoped row, columns serialised generically; solids never ride).

### Backend — `src/groundmodel/` (clean architecture, dependencies point inward)

```
api/            FastAPI layer — HTTP only
  routers/        cpt, borehole, project, geology (models/formations/contacts/
                  litho-layers/bodies/solids/exports), cross_section (+D-Series
                  POST routes), reviews, view-state
  schemas/        Pydantic request/response models (additive-only evolution)
application/    use cases, one verb per file — orchestration, no HTTP, no SQL
                  import_cpt, import_cpt_dov, accept_litho_suggestions,
                  subdivide_all_bodies, divide_boreholes, split/merge/set-class
                  band verbs, correlate_litho_contacts, resolve_litho_instances
                  (body resolver), merge_bodies_across_sections,
                  build_voxel_litho_model, build_section_polygons,
                  thin_export_units, gapless_build_report_assembler,
                  litho_generation_payload, task_queue (SynchronousQueue)
domain/         pure geotechnical logic — zero framework knowledge
  models/         Job, entities
  services/       gef parsing helpers, robertson_2015, nad_classifier (family
                  clamp), litho_column_digest, dem_clip (G7 ground TIN),
                  voxel_litho/ (label_voxels, greedy_mesh [Numba hotspot],
                  smooth_body_solids [prototype, off default path],
                  section_reconciliation, footprint_tolerance),
                  body_fact_translation
  value_objects/
infrastructure/ everything that touches the outside world
  db/             SQLAlchemy ORM (one class per file), Alembic migrations
                  (hand-written), repositories/ incl. project_bundle/ (.strix
                  build/restore), database_migrator (embedded stack)
  parsers/        GEF (CPT), DOV WFS/XML (cassette-cached), borehole/lab
  exporters/      three ABCs (Project/Section/SectionGeometry): DXF section +
                  fence, Plaxis 2D/3D scripts, D-Stability .stix + D-Sheet .shi
                  (d-geolib), PDF report, unit_identifier (NAD-06_ZAND scheme)
  gis/ dem/ codelists/
shared/         constants (NAD classes, litho), logging (GroundModelLogger:
                TRACE..SUCCESS)
```

Rule: domain knows nothing of FastAPI/Postgres/Polars. The frontend only ever
talks to `api/`.

### Desktop — `desktop/src/`

```
main/           Electron main process: window/security (CSP, authorised paths,
                single-instance), recovery store, beta expiry (build stamp +
                monotonic clock anchor), diagnostics capture (consent-gated
                NDJSON + crash bundle), packagedProfile (%APPDATA%\StrixGeo),
                embedded/ (bundled-Postgres boot: paths, secrets, cluster,
                migrator)
preload/        typed IPC bridge
renderer/src/
  api/clients/    typed HTTP clients per surface (geology, section, shared)
  shell/          AppShell + ShellContext (the one context bus) + stages/
    stages/         data | geology | lithology | geotechnical | sections |
                    parameters | export — each stage = Canvas + Toolbar +
                    Inspector triple; 3-D stages share Geology3DViewer/
                    CesiumViewport/useBody3DViewState
  components/     sections/ (SectionPanel + overlay stack: ContactsLayer,
                  PartitionFillOverlay, ModelFillOverlay,
                  GeotechBandEditOverlay, BodyContextMenu, portal menus),
                  borelog/, CptChart, SettingsDialog
  utils/          the engines: partitionFill (v1) & partitionFillV2 (default
                  2/1/0 closed-loop engine) selected in partitionEngineSelect;
                  geotechHierarchicalFill/ (litho-framed constructive fill:
                  fillGap, constructs, remainderLadder, coverWeld,
                  leastDenseLeftover, stackedSeamHalf, pocketFaces,
                  bothSidesClosed); buildVoxelRequest, buildProjectFence/
                  fencePanels, gaplessGate/, sectionClassification (corridor
                  membership), cptAxisScales, nadClasses (colours/labels
                  single source); *.diag.test.ts replay suites (env-gated,
                  read live dumps)
  hooks/          useGeologicalModel (litho+geotech state, 5k lines),
                  useLithoSolids, useShellContextValue
  i18n/           EN/NL catalogues (useSyncExternalStore, default EN)
```

### Data flow (the three-level model)

CPT/borehole import → geological model (formations/contacts/surfaces) → litho
model (accepted bands per column + section-scoped correlation ties → resolver
bodies as tie/fill connected components) → geotech subdivision (NAD packing
bands per litho band; band-level `parent_litho_layer_id` FK) → the renderer
computes the 2-D partition per section (engine v2 / hierarchical geotech
fill) → the SAME partition is POSTed for the 3-D voxel build (label → greedy
mesh → solids), the fence diagram, and the D-Series/DXF exports
("drawn = exported"). The Parameters stage pools statistics per unit/body from
the accepted bands. The gapless gate audits every geotech build.

### Test / gates topology

unit (pytest, no I/O) · integration (wrapper-only, sibling DB,
TRUNCATE-per-test) · Playwright e2e (real Electron, offline fixtures, Cesium
golden screenshots) · per-commit hook (ruff/tsc/vitest-related/pytest) ·
pre-push hook (integration wrapper) · GitHub CI · diag replay suites over live
dumps as regression tripwires · CS1 golden master as the real-data gate.

## Read more

| Need | File |
|---|---|
| Full project rules, conventions, Definition of Done | `CLAUDE.md` |
| Session state, owner decisions, open dogfeed items | `CLAUDE.local.md` (gitignored) |
| Canonical debt backlog | `docs/debt.md` |
| Current-state subsystem designs | `docs/design/*.md` |
| Backend package placement | `docs/architecture.md` |
| Desktop component contracts | `docs/desktop.md` |
| Transferable engineering lessons | `docs/lessons-learned.md` |
