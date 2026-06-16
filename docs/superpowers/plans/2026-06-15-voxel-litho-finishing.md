# Voxel litho builder — finishing plan (geo-band bounding + anisotropic + Build wiring)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task — fresh subagent per task + two-stage review (spec compliance, then code quality). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the voxel 3-D litho builder so it is geologically correct and usable: (1) bound the voxel labelling by the geological layers (fill the empty deeper bands sideways from the deep tests), (2) make the voxel size anisotropic + user-settable (horizontal X/Y + vertical Z), (3) wire the "Build model" button to the voxel endpoint with the Settings knobs, (4) confirm the fidelity gate, dogfeed, and record it.

**Architecture:** The voxel builder labels a 3-D grid from the validated 2-D `computeSectionFill` partition, extracts watertight per-body meshes (greedy-meshed), and persists to `litho_body_solid` (reuse). This plan adds geological-band bounding to the labelling, splits the single grid spacing into horizontal+vertical, and wires the frontend. The 2-D Fill bands are the ground truth and are NEVER modified.

**Tech Stack:** Python 3.11 (numpy, scipy, async SQLAlchemy), TypeScript/React (Vitest), the existing Strix layer model (API → Application → Domain ← Infrastructure).

---

## ✅ STATUS 2026-06-16 — Tasks 1–6 COMPLETE (Task 7 = this record). Owner dogfeed + merge pending.

Executed via `superpowers:subagent-driven-development` (fresh subagent per task + spec-compliance then code-quality review). All on `feat-litho-3d-strat-field` (UNPUSHED, NOT merged).

- **Task 1** geo-band helpers (`geo_bands.py`) ✅ · **Task 2** shared geo-surface loader + use-case wiring ✅ (strat regression green) · **Task 3** band-scoped voxel fill ✅ (real-data geo-band gate PASS, deepest-band fill 2.57×, given real teeth) · **Task 4** anisotropic voxels ✅ (a real on-seam *sampler* degeneracy surfaced + fixed + independently verified legitimate) · **Task 5** frontend Build wiring + Settings "Voxel size" knobs ✅ · **Task 6** honor-borehole retro-review + gapped-log fix + acceptance gate ✅.

**FINAL acceptance (`test.strix`, dev model `019e934c…`, 2 m horizontal / 0.5 m vertical, PERSISTED):** watertight **89 bodies, 0 flagged, 0 overlap, 538,534 tris**; `eval_strat_fidelity.py` over 58 boreholes = **exact 35 · subsequence 6 · wrong 6 · uncovered 11**, contact-depth **median 0.13 m** (≤ 0.5 m vertical), mean 0.91 m. **0 GENUINE fidelity defects** (`diag_voxel_fidelity_categorize.py`: category-5 = 0, 0 interior uncovered). The 6 "wrong" = geo-band **sideways fill** continuing the deeper band below borehole TD (the feature) + 1–2 honor-cell **2 m collisions**; the 11 uncovered = alpha-hull **edge** no-data (pre-existing Stage-3 limit).

**The load-bearing rule paid off:** the first acceptance run had **33 wrong**; a systematic diagnosis proved 0 genuine defects + pinpointed an **above-surface blend sliver**, and the fix (clamp a honored column to the borehole's own surface — void above `obs_top`) dropped **wrong 33→6, exact 11→35** while being more truthful.

**Residual (owner judgment):** (a) the clamp dips the model top to each borehole's surface (truthful but slightly ragged); (b) 11 hull-edge boreholes get no body (pre-existing); (c) 1–2 honor-cell 2 m collisions (a centre-distance tie-break / finer horizontal would recover them — deferred as marginal); (d) literal "wrong→0" is unreachable because the geo-band sideways fill correctly extends the model below borehole TDs. Dogfeed via `voxel_viewer/` (regenerate `model.json` with `scripts/dump_voxel_viewer_model.py`).

---

## ⚠ READ FIRST — context the fresh session needs

**Branch:** `feat-litho-3d-strat-field` (UNPUSHED, off `develop`, NOT merged). Stay on it. Do NOT push (`memory/feedback_git_workflow`). Do NOT merge.

**⚠ GIT RULE for subagents:** subagents share the controller's working-tree HEAD. NEVER run `git checkout` / `git switch` / `git branch` / any branch switch in ANY subagent. Inspect history with `git log` / `git diff` / `git show <sha>:<path>` ONLY. Never `git push`. Never `git commit --no-verify` (the pre-commit hook runs the full unit suite ~5 min/commit and the desktop Vitest when `desktop/*.{ts,tsx}` is staged — let it run).

**⚠ DB SAFETY:** integration tests run ONLY via `.\scripts\run-integration-tests.ps1` (points DATABASE_URL at the sibling `groundmodel_integration` DB). A bare `uv run pytest tests/integration` against the dev DB WIPES it. Unit tests (`uv run pytest tests/unit`) are safe.

**Dev DB (for the real-data gates):** Docker `strix-db-1`, host port **5433**, DB `groundmodel`.
- Litho model: `019e934c-70fd-7d11-a44a-b2073f4063a2`
- Parent geological model: `019e932e-41d1-7213-aa32-08fac692684a` (4 built band surfaces; deepest = "Paleogeen: Formatie van Kortrijk - Lid van Orchies", mean elev ≈ −4.7 m)
- Project: `019e932e-30bb-7967-8dee-e6a4f1b25378`
- **The dev litho model currently holds a PERSISTED 2 m voxel build (74 bodies, watertight)** from `scripts/eval_voxel_build.py --persist`. The owner is dogfeeding it. Re-persist with that script (it has a DB-target guard) after changes when the owner wants to re-dogfeed.

**⚠ THE LOAD-BEARING RULE (owner directive): REAL-DATA VALIDATION PER FUNCTION.** Synthetic/layer-cake fixtures hid every prior 3-D bug. Every function is validated on the real `test.strix` model against the ground truth (contacts → correlations → Fill bands), and a deviation FLAGS the step + CHANGES the path — never relax the check. Each task below has a HARD `test.strix` gate.

**Gates per task:** `uv run pytest tests/unit -q` + `uv run ruff check src tests` + `uv run mypy src` (no NEW errors in your files). Frontend: `cd desktop && npm test` + `npx tsc --noEmit -p tsconfig.web.json` on changed files. Integration ONLY via the wrapper script.

### Specs to read first
- `docs/superpowers/specs/2026-06-15-geo-band-bounded-voxel-labelling-design.md` — the geo-band feature (Tasks 1–4). READ IT; it has the algorithm, the rule, the snap-or-divide, and the 5 real-data checks.
- `docs/superpowers/specs/2026-06-15-voxel-litho-builder-design.md` — the overall voxel builder (background).

### What is ALREADY DONE on this branch (do not redo)
Voxel builder Tasks 1–6 (all two-stage reviewed): value objects (`voxel_types.py`), the captured real oracle (`tests/fixtures/voxel/teststrix_partitions.json` — 14 sections, 617 regions), `label_voxels.py` (loft-blend port → rasterised; on-section rule fidelity 99.8 %), `extract_body_solids.py` (watertight 3-D XOR boundary + 3-stage manifold weld; 74 bodies, 0 overlaps, ON-LABEL 100 %), `greedy_mesh.py` (692K→211K tris at 2 m), `application/build_voxel_litho_model.py` + `litho_solid_persistence.py` (`LithoSolidPersistenceMixin`) + `POST /models/{id}/litho-solids/build-voxel` + `api/schemas/project/voxel_build_request.py`. Plus **honor-borehole** (`InvestigationColumn` in `voxel_types.py`; `label_voxels(..., investigation_columns=())`; the use case loads `load_body_picks` and passes them) — **⚠ honor-borehole shipped WITHOUT the two-stage review; Task 7 reviews it.**

### Eval scripts (read-only diagnostics; reuse them as gates)
`scripts/eval_voxel_label.py` (on-section rule fidelity + `_load_sections`), `scripts/eval_voxel_solids.py` (manifold/overlap/on-label + greedy counts), `scripts/eval_voxel_build.py` (full build on dev DB, `--persist` to keep), `scripts/eval_voxel_honor_borehole.py` (honor before/after), `scripts/eval_strat_fidelity.py` (model vs accepted lithos — the acceptance gate), `scripts/dump_voxel_oracle_inputs.py` (regenerate the oracle raw inputs).

### Dev viewer (optional, for dogfeed)
`voxel_viewer/index.html` is a self-contained Three.js viewer of the built model (lithology colours, vertical exaggeration, clay-only isolation, top/bottom view, the wrong-borehole panel). Regenerate its `model.json` from the dev DB (a small python dump that reads `litho_body_solid` + formation names; see the conversation that created it, or re-derive: dump each unflagged solid's `body_id`/`formation_id`/`vertices`/`triangles`, centre on the model centroid, map world `(x,y,z)`→three `(x−cx, z, −(y−cy))`, colour by formation name KLEI `#7d8da0` / ZAND `#f5e0a4` / SILT `#c9b88d` / VEEN `#3d2a18`). Serve with `python -m http.server 8799 --bind 127.0.0.1` from `voxel_viewer/`.

---

## File structure (this plan)

New (backend): `src/groundmodel/domain/services/voxel_litho/geo_bands.py` (band helpers); a shared geo-surface loader (extracted from `application/assemble_strat_inputs.py`).
Modified (backend): `label_voxels.py` (geo-band branch + anisotropic spacing), `voxel_types.py` (anisotropic `VoxelBuildRequest`/`LabelGrid` already has separate `gx/gy/gz`), `build_domain_from_sections.py` (z-range from vertical spacing), `application/build_voxel_litho_model.py` (load+pass geo surfaces; anisotropic), `api/schemas/project/voxel_build_request.py` (horizontal+vertical fields).
Modified (frontend): `desktop/src/renderer/src/utils/buildVoxelRequest.ts` (anisotropic spacings), `hooks/useLithoSolids.ts` (Build → voxel endpoint), `api/clients/geology.ts` (`buildVoxelLithoModel` client method), the Settings panel + `utils/lithoSegmenterPrefs.ts` (voxel size knobs), `shell/stages/lithology/LithologyCanvas.tsx` (thread the payload to Build).
Tests: one `test_*.py` per new/changed backend module; `test_build_voxel.py` extended; Vitest for the frontend.

---

## Task 1: Geo-band helpers (`geo_bands.py`)

**Files:** Create `src/groundmodel/domain/services/voxel_litho/geo_bands.py`; Test `tests/unit/domain/services/voxel_litho/test_geo_bands.py`.

Read `src/groundmodel/domain/services/strat_field/geo_blocks.py` (`_band_index`) + `src/groundmodel/domain/value_objects/` for `SurfaceBound`/`TinSurface` + `domain/services/tin_surface.py` (`evaluate_tin_at`). The geo surfaces are `TinSurface`-like (vertices `(x,y,z)` + triangles); `evaluate_tin_at(surface, x, y)` returns the surface elevation (nearest-vertex fallback when off-footprint).

- [ ] **Step 1 — failing tests.** Hand-build 2 horizontal geo surfaces (e.g. z=−2 and z=−8 planes as small TINs). Assert:
  - `band_of(surfaces, x, y, z)` returns 0 above the top surface, 1 between, 2 below the bottom (the `_band_index` count-surfaces-above rule).
  - `band_extent(surfaces, x, y, band)` returns the `(base, top)` elevation bounds of that band at `(x,y)` (outermost bands open to ±inf, represented as a large sentinel or `None`).
  - `section_reaches_band(stack, surfaces, x, y, band)` returns True iff the section's stack (a list of `(body_id, formation_id, top_elev, base_elev)` intervals) has any interval overlapping the band's extent at `(x,y)`.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — implement** the three pure functions (numpy docstrings, `from __future__ import annotations`, no logger). Reuse the `_band_index` count rule. Deterministic.
- [ ] **Step 4 — run → PASS.** `ruff` + `mypy` + the voxel_litho unit subset.
- [ ] **Step 5 — commit** `feat(voxel-litho): geological-band helpers (band index/extent/reaches)`.

---

## Task 2: Shared geo-surface loader + the use case loads it

**Files:** Modify `application/assemble_strat_inputs.py` (extract its `_load_geo_surfaces`); Create `application/load_geo_surfaces.py` (or place in an existing shared module — match the repo); Modify `application/build_voxel_litho_model.py`; Test `tests/unit/.../test_build_voxel_litho_model.py` (or extend).

`AssembleStratInputs` already loads the parent geo model's built, non-stale `formation_surface` rows into `SurfaceBound` objects (read it). It now has a SECOND consumer (the voxel use case), so extract that load into a shared importable helper `load_geo_surfaces(session, parent_geo_model_id) -> tuple[SurfaceBound, ...]` and have BOTH callers use it (keep `assemble_with_geo` behaviour identical — the strat regression test `tests/integration/api/test_recompute_strat_solids.py` must stay green).

- [ ] **Step 1 — extract the loader** into the shared helper; refactor `assemble_with_geo` to call it. Run the strat unit tests (`uv run pytest tests/unit -q -k "strat or geo or recompute"`) → green.
- [ ] **Step 2 — use case loads + passes surfaces.** In `BuildVoxelLithoModel.execute`: read the litho model's `parent_geological_model_id`; if set, `load_geo_surfaces(...)`; pass to `label_voxels(..., geo_surfaces=...)` (param added in Task 3) AND read the project's `litho_snap_tolerance_m` (see `recompute_litho_solids.py` for how it's read) and pass `litho_snap_tolerance_m=`. When no parent model / no built surfaces → pass `geo_surfaces=()` (un-bounded) + log a WARNING. Fold the geo-surface geometry digest into the build checksum (mirror `_digest_surfaces` from `recompute_litho_solids.py`).
- [ ] **Step 3 — unit test** that the use case passes the loaded surfaces through (mock the loader or use a tiny in-memory case). `mypy`/`ruff` clean.
- [ ] **Step 4 — commit** (split): `refactor(voxel-litho): extract shared geo-surface loader` + `feat(voxel-litho): build-voxel loads + passes parent geo surfaces`.

---

## Task 3: Band-scoped fill in `label_voxels` (the core)

**Files:** Modify `src/groundmodel/domain/services/voxel_litho/label_voxels.py`; Test `tests/unit/domain/services/voxel_litho/test_label_voxels.py` (add cases).

Read the geo-band spec § "Approach — band-scoped 2-nearest-section fill". Add params `*, geo_surfaces: tuple[SurfaceBound, ...] = (), litho_snap_tolerance_m: float = 0.20`. When `geo_surfaces` is empty → behaviour byte-identical to today (existing tests pin this). When present, the per-voxel labelling becomes band-aware:

For each voxel `(x, y, z)`:
1. `band = band_of(geo_surfaces, x, y, z)` (Task 1).
2. Among all sections, select the **two nearest (by perpendicular distance) that REACH that band** at `(x, y)` — `section_reaches_band(stack_at_section(x,y), geo_surfaces, x, y, band)`. A shallow section that does not reach the band is skipped; the next nearest reaching section is used (the sideways fill). Reuse the existing `_project_to_section_fence` / `_section_stack_at` to get each section's stack.
3. Blend the two reaching sections with the existing `_blend_stacks` midline-pinch, but on the band-scoped stacks (each stack clipped to `band_extent(...)`).
4. **Snap-or-divide** a litho contact within `litho_snap_tolerance_m` of a band surface: snap the contact to the surface; otherwise divide cleanly at the surface (so a litho contact near a geo surface does not spawn a thin sliver across it).
5. Label the voxel with the covering interval's `body_id` (preserve the resolver body identity); if NO section reaches the band within reach → void (−1), counted.

The honor-borehole override (Task already shipped) still applies at borehole columns, but within the band rules (a borehole's own log is honoured within its observed range; below its TD the band-scoped sideways fill applies). Keep determinism.

- [ ] **Step 1 — failing unit test (real-data-shaped synthetic).** A 2-section fixture: a SHALLOW test (stops at z=−1, in the upper band) + a DEEP test (reaches z=−15, through both bands) + one geo surface at z=−5. Assert: (a) below the shallow test's TD, the LOWER band at the shallow test's `(x,y)` fills with the DEEP section's lower-band litho (NOT void, NOT the shallow unit pushed down); (b) no litho crosses the z=−5 surface (sample just above/below → correct band litho); (c) snap-or-divide at a litho contact placed within tolerance of the surface; (d) `geo_surfaces=()` default is byte-identical to the current blend (assert against the existing label output). Phrase comments in geological terms.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — implement** the band-scoped branch. Keep the no-surfaces path untouched.
- [ ] **Step 4 — run → PASS.** ruff + mypy + `uv run pytest tests/unit/domain/services/voxel_litho/ -q` (Tasks 1+3+4 stay green; existing label/extract tests stay green).
- [ ] **Step 5 — ⚠ REAL-DATA GATE on test.strix.** Add `scripts/eval_voxel_geo_bands.py` (read-only): load the oracle fixture + the parent geo surfaces from the dev DB, run `label_voxels(..., geo_surfaces=...)`, and assert the spec's 5 checks: (1) no column has a populated geo band left VOID below a shallow test (the ~985 sand/silt-bottom-with-void-below columns now fill the deeper band); (2) 0 litho voxels on the wrong side of a geo surface; (3) on-section rule fidelity unchanged vs `eval_voxel_label.py` (still 99.8 %); (4) `extract_body_solids` still all closed-manifold + STRICT no-overlap (`eval_voxel_solids.py` logic); (5) report the deepest-band substrate composition before vs after. RUN IT, paste the numbers. **A deviation → STOP, flag the step, fix the path; do not relax.**
- [ ] **Step 6 — commit** (split): `feat(voxel-litho): geological-band-scoped voxel fill` + `chore(voxel-litho): real-data geo-band gate on test.strix`.

---

## Task 4: Anisotropic voxels (horizontal X/Y + vertical Z)

**Files:** Modify `voxel_types.py` (`VoxelBuildRequest`), `label_voxels.py`, `build_domain_from_sections.py`, `application/build_voxel_litho_model.py`, `api/schemas/project/voxel_build_request.py`; Tests for each. `extract_body_solids._corner_coords` already derives spacing per axis (`g[1]-g[0]`) — confirm it needs NO change.

Split the single cubic `grid_spacing_m` into **`horizontal_spacing_m`** (X and Y) and **`vertical_spacing_m`** (Z). Geology is thin-layered vertically, so fine Z + coarse X/Y catches thin layers without exploding voxel count.

- [ ] **Step 1 — value object + label_voxels.** `label_voxels(domain, horizontal_spacing_m, vertical_spacing_m, sections, *, ...)`: build `gx`/`gy` at `horizontal_spacing_m`, `gz` at `vertical_spacing_m`. Keep a thin back-compat shim: a single `grid_spacing_m` maps to both equal. Unit test: gx/gy step == horizontal, gz step == vertical; the cubic case (`h==v`) is byte-identical to the old `grid_spacing_m` build.
- [ ] **Step 2 — request schema + use case.** `VoxelBuildRequest` carries `horizontal_spacing_m` + `vertical_spacing_m` (default both to a fallback `grid_spacing_m` when only that is present, so the existing fixture + integration test keep working). The use case reads the two from the request (or from the project view-state `litho_segmenter` prefs — see Task 6). `eval_voxel_*` scripts + the fixture loader default vertical=horizontal when only `grid_spacing_m` present. Update the integration test `test_build_voxel.py` to exercise an anisotropic payload.
- [ ] **Step 3 — ⚠ REAL-DATA GATE.** Rebuild test.strix at **2 m horizontal / 0.5 m vertical** (extend `eval_voxel_build.py` with `--horizontal`/`--vertical`, default both to the fixture's value). Assert: builds, 0 flagged, watertight, no overlap; record body count + triangle count + wall-clock (note: ~4× the voxels of 2 m cubic → minutes; flag the perf, profile before optimising). Confirm thin layers resolve better (run `eval_strat_fidelity.py` — contact-depth median should drop toward the vertical spacing).
- [ ] **Step 4 — commit** (split): `feat(voxel-litho): anisotropic horizontal+vertical voxel spacing` (+ schema/use-case/eval commits).

---

## Task 5: Frontend — wire the Build button + Settings voxel-size knobs

**Files:** Modify `desktop/src/renderer/src/utils/buildVoxelRequest.ts` (anisotropic), `api/clients/geology.ts` (+`buildVoxelLithoModel`), `hooks/useLithoSolids.ts` (Build → voxel), `shell/stages/lithology/LithologyCanvas.tsx` (thread the payload), `utils/lithoSegmenterPrefs.ts` (+voxel size prefs), the Settings → Litho segmenter panel; Tests (Vitest).

Read `hooks/useLithoSolids.ts` (`buildLithoSolids` currently calls `api.geology.rebuildLithoSolids` — the strat path) and `LithologyCanvas.tsx` lines ~297–365 (`fenceSectionInputs` is the `FenceSectionInput[]` already assembled there; `buildVoxelRequest(fenceSectionInputs, ...)` from Task-2-of-the-builder produces the payload).

- [ ] **Step 1 — client method.** Add `api.geology.buildVoxelLithoModel(projectId, modelId, request)` → `POST /models/{id}/litho-solids/build-voxel`. Vitest the client call shape.
- [ ] **Step 2 — Settings knobs.** Add `horizontal_spacing_m` (default 2.0) + `vertical_spacing_m` (default 1.0; the user may set 0.5 for fine — note the perf cost in the hint) to `view_state.litho_segmenter` via `lithoSegmenterPrefs.ts` + a Settings → Litho segmenter "Voxel size" section (two NumberRows: "Horizontal cell (X/Y) m" + "Vertical cell (Z) m"). Vitest the read/write of the prefs.
- [ ] **Step 3 — wire Build.** Route the litho "Build model" button to the voxel path: assemble `buildVoxelRequest(fenceSectionInputs, horizontalM, verticalM)` (the section/layer data lives in `LithologyCanvas`; thread the request — or a request-builder callback — into `useLithoSolids.buildLithoSolids`, OR move the assembly to where `buildLithoSolids` is invoked). Send the two spacings. Keep the implicit `RecomputeLithoSolids` path in code (dormant) — just don't call it from Build. Vitest: clicking Build assembles the payload + calls `buildVoxelLithoModel`. `tsc --noEmit -p tsconfig.web.json` clean on changed files.
- [ ] **Step 4 — commit** (split per file): client method, prefs, Settings UI, Build wiring.

---

## Task 6: Review honor-borehole + the combined fidelity acceptance gate + dogfeed

**Files:** none new (validation + review). Reuse `scripts/eval_strat_fidelity.py`, `scripts/eval_voxel_build.py --persist`, the dev viewer.

- [ ] **Step 1 — two-stage review of honor-borehole** (commits `a0f862c6`..`cf17b3c6`). It shipped without the spec+quality review. Dispatch a spec-compliance reviewer then a code-quality reviewer (read `InvestigationColumn`, the `label_voxels` honor branch, the use-case pick load). Fix any findings.
- [ ] **Step 2 — build test.strix at the chosen anisotropic spacing** (e.g. 2 m / 0.5 m) WITH geo-band bounding + honor-borehole, persisted: `uv run python scripts/eval_voxel_build.py --persist --horizontal 2 --vertical 0.5`.
- [ ] **Step 3 — ⚠ THE ACCEPTANCE GATE.** `uv run python scripts/eval_strat_fidelity.py`. Assert vs the accepted lithos: the **2 "wrong" columns drop to 0** (honor-borehole + fine vertical resolves `019e932e-7c3d`; the `019e932e-7c50` below-TD false-positive should also resolve once the deeper band fills with the correct band litho instead of void); the deepest-band substrate now matches the geology (no sand-bottomed columns where a deeper geo band exists); contact-depth median ≤ the vertical voxel size; coverage gaps explained (hull edge); triangle count ≪ 7.2 M; record exact/subsequence/wrong + mean/median/p90/max. **Any residual "wrong" must be explained (resolution/edge), not silently accepted.**
- [ ] **Step 4 — dogfeed handoff.** Regenerate `voxel_viewer/model.json`, serve, and have the owner orbit + slice: confirm the deeper bands are filled (no clay/substrate gaps), interfingering stays within geological layers, the 2 wrong are gone, fast zoom.
- [ ] **Step 5 — commit** `chore(voxel-litho): combined geo-band + anisotropic + honor fidelity gate`.

---

## Task 7: Docs + memory

**Files:** `CLAUDE.local.md` (Active Focus / the voxel-builder section), `CLAUDE.md` if a debt/scope line changes, `memory/project_strat_field_3d_builder.md` (+ a new `memory/project_voxel_litho_builder.md`), `docs/superpowers/`.

- [ ] **Step 1 — record** the voxel builder shipped + the final fidelity numbers (0/48 → the new exact/subsequence/wrong), the geo-band bounding, anisotropic voxels, honor-borehole, the Build wiring, the dogfeed result, the dev viewer, and any residual concerns. Note the implicit `strat_field/` code stays dormant. Update the memory index line.
- [ ] **Step 2 — commit** `docs(voxel-litho): record geo-band-bounded anisotropic voxel builder ship`.

---

## Self-review

**Spec coverage (geo-band spec):** rule + 2D-untouched → Task 3 ✓; band helpers (§Components `geo_bands.py`) → Task 1 ✓; geo-surface load + use-case pass-through → Task 2 ✓; band-scoped 2-nearest-reaching fill + snap-or-divide + body_id preserve → Task 3 ✓; fallback when no geo model → Task 2 ✓; the 5 real-data checks → Task 3 Step 5 + Task 6 ✓; out-of-scope anisotropic + Build-wiring → Tasks 4 + 5 (the owner asked for them in the same effort) ✓.

**Beyond the spec (owner-requested, not to forget):** anisotropic voxels → Task 4 ✓; Build-button + Settings wiring → Task 5 ✓; review honor-borehole (shipped un-reviewed) → Task 6 Step 1 ✓; confirm the 2 wrong are fixed by honor + fine-Z → Task 6 Step 3 ✓; dogfeed → Task 6 Step 4 ✓; docs/memory → Task 7 ✓.

**Placeholder scan:** the geometry algorithm is specified by interface + test shape + the spec reference (appropriate for a research-flavoured engine); every task has concrete files, a concrete failing test, and a concrete real-data gate. No "TBD"/"similar to Task N".

**Type consistency:** `band_of`/`band_extent`/`section_reaches_band` (Task 1) consumed in Task 3; `load_geo_surfaces` (Task 2) → `label_voxels(geo_surfaces=...)` (Task 3); `horizontal_spacing_m`/`vertical_spacing_m` consistent across `VoxelBuildRequest` (Task 4), the use case (Task 4), `buildVoxelRequest` + the prefs (Task 5). `InvestigationColumn` (honor-borehole, already shipped) reused.

**Risk notes:** Task 3 (band-scoped fill correctness on real data — the truthfulness lever) and Task 4 (anisotropic perf at fine Z) are the heaviest; both have HARD `test.strix` gates so a deviation surfaces immediately. The "2-nearest reaching sections" search is the most likely real-data surprise (does it fill every populated band without artefacts) — Task 3 Step 5 is where it surfaces; flag + refine, don't hide.
