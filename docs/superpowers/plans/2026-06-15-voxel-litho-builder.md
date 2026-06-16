# Voxel litho builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit-field 3D litho builder (watertight but 0/48 truthful, 7.2 M triangles) with a **voxel builder** that labels the 3D volume from the validated `computeSectionFill` partition and extracts each body's watertight, greedy-meshed boundary — faithful + watertight by construction.

**Architecture:** Label space, then extract boundaries. The frontend computes the ground-truth partition (`computeSectionFill` = "Fill bands") and POSTs it; the backend (Python) labels a 3D grid from it, extracts per-`body_id` watertight cell-boundaries, greedy-meshes them, and persists `LithoBodyMesh` → `litho_body_solid` (existing persistence/render/export, no schema change). The builder **consumes** the partition, never re-derives it → it cannot drift from the truth.

**Tech Stack:** Python 3.11, NumPy, SciPy, pytest; TypeScript/React (Vitest) for the frontend assembler; async SQLAlchemy for the build endpoint + integration tests.

**Spec (READ FIRST):** `docs/superpowers/specs/2026-06-15-voxel-litho-builder-design.md` — the why, the ground truth, the per-component contracts, the deferred scope (smoothing / tet / export-wiring), and the risks.

**Base / branch:** continue on `feat-litho-3d-strat-field` (the implicit builder ships here; this replaces it as the active builder). Do NOT branch again. Do NOT push (`memory/feedback_git_workflow`).

**Gates per task:** `uv run pytest tests/unit -q` + `uv run ruff check src tests` + `uv run mypy src/groundmodel/domain/services/voxel_litho/` (no NEW errors in your files; repo baseline elsewhere). Frontend: `cd desktop && npm test` + `npx tsc --noEmit -p tsconfig.web.json` on changed files. Integration ONLY via `.\scripts\run-integration-tests.ps1` (bare pytest WIPES the dev DB — `memory/feedback_dev_db_no_truncate`). The pre-commit hook runs the unit suite (~5 min); never `--no-verify`.

**⚠ CRITICAL GIT RULE:** subagents share the controller's working-tree HEAD. NEVER run `git checkout`, `git switch`, or any branch-switch in ANY subagent. Inspect history with `git log` / `git diff` / `git show <sha>:<path>` ONLY.

**⚠ THE LOAD-BEARING RULE (owner directive): REAL-DATA VALIDATION PER FUNCTION.** Synthetic/layer-cake fixtures hid every prior 3D bug (the loft AND the implicit field both passed synthetic tests and failed on real data). So **every function is validated on the real `test.strix` model against the ground truth (contacts → correlations → fill bands), and a deviation FLAGS + changes the path — never relax the check.** Each task below has an explicit "Real-data validation on test.strix" step that is a HARD GATE. The oracle is `computeSectionFill` (the partition) + `scripts/eval_strat_fidelity.py` (model vs accepted lithos). Dev DB: Docker `strix-db-1` host port 5433, DB `groundmodel`, litho model `019e934c-70fd-7d11-a44a-b2073f4063a2`.

**Note on code completeness:** this builds a research-flavoured geometry engine; the plan specifies the **interfaces, the test shapes, the algorithm outline, and the real-data gate** per task — the implementer fills the geometry guided by the spec. Where a contract/type is given, match it exactly across tasks.

---

## File structure

New (backend, all under `src/groundmodel/domain/services/voxel_litho/` unless noted):
- `voxel_types.py` — frozen value objects: `SectionPartitionInput`, `RegionInput`, `LabelGrid`.
- `label_voxels.py` — `label_voxels(domain, grid_spacing_m, sections) -> LabelGrid`.
- `extract_body_solids.py` — `extract_body_solids(grid) -> list[LithoBodyMesh]` (3-D cell-boundary).
- `greedy_mesh.py` — `greedy_merge(quads) -> quads` (coplanar face merge).
- `application/build_voxel_litho_model.py` — `BuildVoxelLithoModel` use case.
- API: a `POST /litho/models/{model_id}/build-voxel` route (place per `docs/api.md`).

New (frontend):
- `desktop/src/renderer/src/utils/buildVoxelRequest.ts` — gather `computeSectionFill` per section + section geometry → the build payload.
- wire the "Build model" button (`shell/stages/lithology/LithologyToolbar.tsx` or its handler) to call the new endpoint.

New (fixtures/tests):
- `tests/fixtures/voxel/teststrix_partitions.json` — the captured real `test.strix` partition payload (the backend's real-data oracle).
- one `tests/unit/domain/services/voxel_litho/test_<module>.py` per backend module; `tests/integration/api/test_build_voxel.py`.

Reused unchanged: `computeSectionFill`/`buildProjectFence` (truth), `build_model_domain` (domain), `LithoBodyMesh`/`litho_body_solid`/`_batch_upsert`/checksum/`Geology3DViewer`, the watertight invariants in `tests/unit/domain/services/strat_field/strat_invariants.py`.

---

### Task 1: The build-request contract (value objects)

**Files:** Create `src/groundmodel/domain/services/voxel_litho/voxel_types.py`; Test `tests/unit/domain/services/voxel_litho/test_voxel_types.py`. Also add the mirror TS type in `desktop/src/renderer/src/utils/buildVoxelRequest.ts` (stub, filled in Task 2).

- [ ] **Step 1 — define the value objects** (frozen dataclasses, numpy docstrings, no logger):
  - `RegionInput(formation_id: str, body_id: str | None, polygon: tuple[tuple[float, float], ...], gap_index: int)` — `polygon` points are `(fraction 0..1, elevation_m)`; `gap_index` is the 0-based left-column index of the gap this region fills (matches `SectionRegion`).
  - `SectionColumnInput(investigation_id: str, along_m: float, world_x: float, world_y: float)` — the canonical world position (from `buildProjectFence`).
  - `SectionPartitionInput(start_x, start_y, end_x, end_y: float, columns: tuple[SectionColumnInput, ...], regions: tuple[RegionInput, ...])` — one section.
  - `LabelGrid(gx: np.ndarray, gy: np.ndarray, gz: np.ndarray, labels: np.ndarray, formation_by_body: dict[str, str])` — `labels` is an `(nx, ny, nz)` int array of body indices (−1 = void); a companion `body_id_by_index: tuple[str, ...]`. Document the indexing.
- [ ] **Step 2 — shape test:** construct each, assert field round-trip + that `LabelGrid.labels.shape == (len(gx), len(gy), len(gz))`. Run → PASS.
- [ ] **Step 3 — TS mirror:** in `buildVoxelRequest.ts` add `interface VoxelBuildRequest { sections: SectionPartitionInput[]; grid_spacing_m: number }` with the same field names (snake_case to match the API). No logic yet.
- [ ] **Step 4 — gates + commit** `feat(voxel-litho): build-request value objects`.

---

### Task 2: Frontend partition-payload assembler + capture the real test.strix oracle

**Why second:** every backend task validates on the real `test.strix` partition; this task produces that payload (live for the build, and captured once as the test fixture).

**Files:** `desktop/src/renderer/src/utils/buildVoxelRequest.ts` (+ test); `tests/fixtures/voxel/teststrix_partitions.json` (captured).

- [ ] **Step 1 — failing Vitest:** `buildVoxelRequest(sections, lithoLayers, edges, gridSpacingM)` returns a `VoxelBuildRequest` where each section carries its `computeSectionFill` regions + line endpoints + ordered columns with canonical world XY. Test on a 2-section synthetic input (reuse the `partitionFill`/`fencePanels` test fixtures): assert region count/body_ids match `computeSectionFill` directly, and column world XY match `buildProjectFence`'s canonical reconciliation.
- [ ] **Step 2 — implement:** call the EXISTING `computeSectionFill` per section + reuse `buildProjectFence`'s canonical per-test world-XY pass (do NOT reimplement the partition). Map to `VoxelBuildRequest`. Run → PASS. `tsc` clean.
- [ ] **Step 3 — CAPTURE the real oracle:** add a temporary dev action (a button or a `window.__dumpVoxelRequest()` debug hook) that runs `buildVoxelRequest` for the loaded `test.strix` model (all 14 sections) and downloads the JSON. Run it against the dev app on `test.strix`; save the result to `tests/fixtures/voxel/teststrix_partitions.json`. (This is the real-data oracle the backend tasks validate against; it is the validated `computeSectionFill` output, so it IS the ground truth.) Commit the fixture.
- [ ] **Step 4 — Real-data validation on test.strix:** assert the captured fixture has 14 sections, every region tagged with a `formation_id`, and the `body_id`s present match the resolver bodies in the DB (a sanity that the payload reflects test.strix). Document the capture steps in the file header so it can be regenerated.
- [ ] **Step 5 — gates + commit** `feat(voxel-litho): frontend partition-payload assembler + test.strix oracle`.

---

### Task 3: `label_voxels` — label the 3D grid from the partition (the heart)

**Files:** Create `label_voxels.py`; Test `test_label_voxels.py`.

- [ ] **Step 1 — failing unit test (real-data-shaped synthetic):** build a 2-section fixture where section A has KLEI/SAND/KLEI and section B has KLEI/SAND (sand pinches out between). `grid = label_voxels(domain, 2.0, [secA, secB])`. Assert: (a) a voxel column ON section A's plane reproduces section A's partition exactly (KLEI/SAND/KLEI top→bottom); (b) a voxel ON section B reproduces B; (c) a voxel at the A-B midline where SAND is present on A and absent on B is labeled by the midline-pinch rule (SAND present up to the midline, then KLEI). Use a fixture with a real lens so interfingering is exercised — NOT a flat layer-cake.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — implement** per spec §"A. label_voxels": project each voxel `(x,y)` onto each section → `(along, offset)`; on a section map `along`→gap→`fraction` and point-in-polygon over that gap's regions for `z`=elevation → body; between sections blend the 2 nearest by offset with a midline pinch (the `loft_field` recipe — recover its blend via `git show 1259e30c^:src/groundmodel/domain/services/loft_field.py` for reference, do NOT checkout). Build `build_model_domain` for the grid extent. Deterministic. Vectorise the per-voxel work where cheap, but correctness first.
- [ ] **Step 4 — run → PASS.** ruff + mypy + unit suite.
- [ ] **Step 5 — ⚠ Real-data validation on test.strix (HARD GATE):** add `scripts/eval_voxel_label.py` (read-only) that loads `tests/fixtures/voxel/teststrix_partitions.json`, runs `label_voxels`, and **for every section asserts the labeled grid sampled on that section plane reproduces the section's `computeSectionFill` regions** (formation + body at each (along, elev) within voxel tolerance), and at every borehole reproduces the accepted contact sequence. Report match %. **If any section deviates from its fill bands, STOP, flag the deviating section + the labeling rule that broke, and fix the path — do not relax the assertion.** Record the numbers.
- [ ] **Step 6 — commit** `feat(voxel-litho): label the 3D grid from the section partition`.

---

### Task 4: `extract_body_solids` — watertight per-body boundary

**Files:** Create `extract_body_solids.py`; Test `test_extract_body_solids.py`.

- [ ] **Step 1 — failing test (use the strat_invariants helpers):** from a hand-built `LabelGrid` with ≥2 bodies INCLUDING an enclosed lens (a body fully surrounded by another in 3D), `bodies = extract_body_solids(grid)`. Assert every body `assert_closed_manifold(b.vertices, b.triangles)`, STRICT `assert_no_overlap_sampled(bodies, grid_samples)`, and that ray-sampling at a lens column reads HOST/LENS/HOST. Author a grid with genuine vertical interfingering (a body present in two disconnected z-spans at one (x,y)) — the thing the implicit field could not do.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — implement** per spec §"B": for each `body_id`, emit the voxel faces where `label == body` on one side and `!= body` on the other (6 directions); each interior face cancels, each boundary face appears once → closed 2-manifold by construction (the 3-D analogue of `body_assembly._build_component_mesh`'s XOR boundary). Deterministic vertex/triangle order. `formation_id` from `formation_by_body`.
- [ ] **Step 4 — run → PASS.** ruff + mypy + unit suite.
- [ ] **Step 5 — ⚠ Real-data validation on test.strix:** in `scripts/eval_voxel_label.py` (or a sibling) run `label_voxels` → `extract_body_solids` on the test.strix oracle; assert EVERY body is a closed manifold and STRICT no-overlap across all bodies, and the per-section ray-sample still matches `computeSectionFill` (the meshing must not move the boundary off the labels). **Deviation → flag + fix, don't relax.**
- [ ] **Step 6 — commit** `feat(voxel-litho): extract watertight per-body solids from labels`.

---

### Task 5: `greedy_mesh` — collapse the triangle count (perf)

**Files:** Create `greedy_mesh.py`; Test `test_greedy_mesh.py`. Wire into `extract_body_solids`.

- [ ] **Step 1 — failing test:** a flat 10×10-cell body face that naively emits 200 triangles greedy-merges to 2; assert triangle count drops AND the merged mesh is geometrically identical to the un-merged (same `vertical_ray_intervals` at a dense sample within 1e-9, still `assert_closed_manifold`).
- [ ] **Step 2 — run → FAIL → implement** coplanar same-body quad merge (standard greedy meshing: grow maximal rectangles per coplanar face plane). Watertight preserved (the merged faces are still the exact boundary). → PASS.
- [ ] **Step 3 — ⚠ Real-data validation on test.strix:** rebuild the test.strix bodies with greedy meshing; assert (a) total triangles ≪ the 7.2 M implicit baseline (record the number), (b) still all closed manifolds + STRICT no-overlap, (c) the per-section partition match is unchanged. **Deviation → flag + fix.**
- [ ] **Step 4 — commit** `perf(voxel-litho): greedy-mesh the voxel boundaries`.

---

### Task 6: `BuildVoxelLithoModel` use case + endpoint + checksum + integration

**Files:** Create `application/build_voxel_litho_model.py`; add the `POST /litho/models/{id}/build-voxel` route; Test `tests/integration/api/test_build_voxel.py`.

- [ ] **Step 1 — use case:** `BuildVoxelLithoModel(session).execute(model_id, request: VoxelBuildRequest, force) -> outcome`: resolve domain (`build_model_domain` from the model's picks) → `label_voxels` → `extract_body_solids` (greedy) → upsert `litho_body_solid` (reuse `_batch_upsert`, checksum over the partition payload + grid spacing, orphan-delete). Reuse `_storage_body_id` (uuid5 for non-UUID body_ids). Same outcome shape as `RecomputeLithoSolids`.
- [ ] **Step 2 — endpoint:** accept the `VoxelBuildRequest` JSON, call the use case, return the outcome. Additive route (per `docs/api.md`).
- [ ] **Step 3 — integration test (via the wrapper script):** seed an interbedded litho model + sections + a captured-shape partition payload; POST build-voxel; assert every solid `is_flagged=False`, non-empty, no inter-body overlap, coverage, and the per-section partition is reproduced (sample a section, assert the model matches the payload). Checksum-skip on re-POST; mutate the payload → rebuild. Run `.\scripts\run-integration-tests.ps1 tests/integration/api/test_build_voxel.py`.
- [ ] **Step 4 — ⚠ Real-data validation on test.strix:** POST the `teststrix_partitions.json` payload to a local backend (or call the use case directly in a script) on the dev `test.strix` model; assert it BUILDS (bodies_built > 0, flagged = 0), watertight (overlaps ~0), records the build time. **Deviation → flag + fix.**
- [ ] **Step 5 — commit** `feat(voxel-litho): BuildVoxelLithoModel use case + endpoint`.

---

### Task 7: Wire the "Build model" button + the fidelity acceptance gate

**Files:** `desktop/src/renderer/src/shell/stages/lithology/` (the Build-model handler + its API client call); `scripts/eval_strat_fidelity.py` (reuse as the acceptance gate).

- [ ] **Step 1 — frontend wiring:** the "Build model" button now calls `buildVoxelRequest(...)` → `POST build-voxel` (instead of the implicit `RecomputeLithoSolids` path). Vitest: clicking Build assembles the payload + calls the endpoint; tsc clean. (Leave the implicit path callable behind a dev flag if trivial; otherwise just route Build to voxel.)
- [ ] **Step 2 — build test.strix end-to-end** through the real button on the dev app (DOV/data already loaded), or via the captured payload + the use case.
- [ ] **Step 3 — ⚠ THE ACCEPTANCE GATE (the owner directive, operationalized):** run `uv run python scripts/eval_strat_fidelity.py` on the voxel-built test.strix. Assert, vs the accepted lithos:
  - sequence match goes from **0/48 → ≥ the large majority** (record the exact number; a residual mismatch must be explained, e.g. a known voxel-resolution rounding, not a silent wrong),
  - contact-depth error **≤ ~voxel size** (record mean/median/p90/max),
  - coverage gaps explained (hull edge) or fixed,
  - triangle count ≪ 7.2 M, and the 3D viewer zoom is interactive.
  **Any deviation from the ground truth (contacts/correlations/fill bands) flags + changes the path — do not loosen this gate.** This is the check that was never run before.
- [ ] **Step 4 — owner dogfeed (handoff):** orbit the model + slice a cross-section; confirm the solid matches the Fill bands and the boreholes. Fast zoom.
- [ ] **Step 5 — commit** `feat(voxel-litho): route Build to the voxel builder + fidelity gate`.

---

### Task 8: Docs + memory + retire-decision

**Files:** CLAUDE.md / CLAUDE.local.md / memory `project_strat_field_3d_builder.md` (+ a new `project_voxel_litho_builder.md`) / `docs/superpowers/`.

- [ ] **Step 1 — record** the voxel builder shipped + the fidelity numbers (vs the implicit field's 0/48 + 5.1 m). Note the implicit `strat_field/` code is dormant (not deleted), the deferred phases (smoothing, tet, export-wiring), and any residual concerns from the acceptance gate.
- [ ] **Step 2 — commit** `docs(voxel-litho): record the faithful voxel builder ship`.

---

## Self-review

**Spec coverage:** truth = `computeSectionFill` consumed not re-derived → T2 ✓; `label_voxels` (§A) → T3 ✓; `extract_body_solids` (§B) → T4 ✓; greedy mesh (perf) → T5 ✓; build use case + endpoint + checksum + reuse persistence (§C) → T6 ✓; frontend assembler (§D) + Build wiring → T2 + T7 ✓; the **real-data validation discipline** → a HARD-GATE step in T2–T7 ✓; watertight + faithful gates → T4/T7 ✓; deferred scope (smoothing/tet/export) → not tasked, documented ✓.

**Placeholder scan:** the geometry algorithms (label blend, XOR boundary, greedy merge) are specified by interface + test shape + spec reference, not line-by-line — appropriate for a research-flavoured engine; every task has concrete files, a concrete failing test, and a concrete real-data gate. No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `SectionPartitionInput`/`RegionInput`/`LabelGrid`/`VoxelBuildRequest` defined T1, consumed T2→T6; `label_voxels`→`extract_body_solids`→`greedy_merge`→`BuildVoxelLithoModel` chain consistent; the strat_invariants helpers (`assert_closed_manifold`/`assert_no_overlap_sampled`/`assert_model_matches_columns`) + `eval_strat_fidelity` reused as the gates throughout.

**Risk notes:** the heaviest tasks are T3 (the labeling correctness on real data — the truthfulness lever) and T4 (the 3-D watertight boundary). Both have a HARD real-data `test.strix` gate so a deviation surfaces immediately, per the owner directive. Between-section interpolation artifacts (the midline blend) are the most likely real-data surprise — T3 Step 5 is where they surface; flag + refine, don't hide.
