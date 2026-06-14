# Geology-bounded lens-in-lens litho builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the implicit stratigraphic 3D litho builder build the real (non-conformable) `test.strix` model, by ordering only the conformable **matrix backbone**, carving the enclosed minorities in as **lenses (recursively → lens-in-lens)**, bounding the whole thing by the **geological model's bands**, and hardening watertightness with a **monotone clamp**.

**Architecture:** The shipped implicit-field engine (`strat_field/`) is unchanged at its core. We add (A) a shared **enclosure classifier** that splits bodies into matrix vs lens; (B) a **Stage-1 change** to order only the matrix; (C) **geological per-band blocks** (the field is fit within each geological band, surfaces are hard bounds); (D) a **lens-carving stage** (matrix-with-void + lens-fills-void); (E) a one-line **monotone height clamp**. Build order: E (quick win) → A,B,D + wiring so `test.strix` builds with a single field (the milestone) → C (the geological frame) → real-data eval.

**Tech Stack:** Python 3.11, NumPy, SciPy, scikit-image, pytest, networkx (already used by the diagnostics). Async SQLAlchemy for the wiring + integration tests.

**Spec:** `docs/superpowers/specs/2026-06-14-geology-bounded-lens-builder-design.md` — READ IT FIRST. It has the why, the math, the owner decisions, and the per-component contracts.

**Base / branch:** Continue on `feat-litho-3d-strat-field` (the implicit builder — all 11 prior tasks shipped + reviewed, UNPUSHED off `develop`). Do NOT branch again. Do NOT push (`memory/feedback_git_workflow`).

**Gates per task:** `uv run pytest tests/unit -q` + `uv run ruff check src tests` + `uv run mypy src/groundmodel/domain/services/strat_field/` (no NEW errors in your files; repo baseline ~160 elsewhere). Integration ONLY via `.\scripts\run-integration-tests.ps1` (bare pytest WIPES the dev DB — `memory/feedback_dev_db_no_truncate`). The pre-commit hook runs the unit suite (~5 min); never `--no-verify`.

**⚠ CRITICAL GIT RULE (a reviewer broke this last session):** subagents share the controller's working-tree HEAD. NEVER run `git checkout`, `git switch`, or any branch-switch in ANY subagent (implementer OR reviewer). Inspect history with `git log` / `git diff` / `git show <sha>:<path>` ONLY.

**The load-bearing lesson (why the loft AND the first strat cut failed):** invariant tests on **layer-cake fixtures** passed while the real interbedded model broke. EVERY validation here uses **real-data-shaped fixtures** — interbedded, with an *enclosed lens*, a *lens-in-lens*, geology bands, dips. A test that only checks a flat stack is a plan failure.

**Real-data target + diagnostics (the truth, already instrumented):** `test.strix` in the dev DB (Docker `strix-db-1`, host port 5433, DB `groundmodel`; litho model `019e934c-70fd-7d11-a44a-b2073f4063a2`; parent geo model `019e932e-41d1-7213-aa32-08fac692684a`, 4 bands). The cycles are 2 SCCs (8/102 instances); `eval_lens_out.py` proved the 96-body matrix backbone is a DAG. Re-run any time:
```
uv run python scripts/eval_strat_cycles.py        # per-instance cycle dump
uv run python scripts/eval_geo_bounded_cycles.py  # cycles survive within geo bands
uv run python scripts/eval_lens_out.py            # lens-out -> 96-body DAG (the proof)
```

---

## File structure

New files (all under `src/groundmodel/domain/services/strat_field/` unless noted):
- `lens_types.py` — frozen value objects: `Lens(body_id, host_body_id, nesting_depth)`, `LensPartition(matrix_body_ids, lenses)`. No logic.
- `lens_classification.py` — `classify_lenses(columns) -> LensPartition` (the enclosure criterion).
- `lens_carving.py` — `carve_lenses(matrix_meshes, lens_solids, partition) -> list[LithoBodyMesh]` (host voids + lens fills, recursive).
- `geo_blocks.py` — `partition_picks_by_geology(...)` + the band-`Block` construction (surface-bounded blocks).

Modified files:
- `strat_types.py` — extend `Block` with optional curved bounds `top_surface` / `base_surface`.
- `body_assembly.py` — the monotone clamp (E); host-void support (a body whose cell-complex has interior holes); surface caps.
- `stratigraphic_order.py` — order over the matrix set only.
- `strat_builder.py` — per-band loop; matrix build + lens carve.
- `application/assemble_strat_inputs.py` — geology band partition + `classify_lenses` + `LensPartition` on the assembly result.
- `application/recompute_litho_solids.py` — per-band loop, lens upsert, checksum extension.

Tests: one `tests/unit/domain/services/strat_field/test_<module>.py` per new module; extend `fixtures.py` with the enclosed-lens / lens-in-lens / geology-band builders; integration `tests/integration/api/test_recompute_strat_solids.py` extended.

---

### Task 1: Monotone height clamp (watertight hardening + VEEN fix)

**Why first:** tiny, independent, makes per-body non-overlap a construction theorem and removes the VEEN −1.17 m overshoot the owner saw. No dependency on the lens/geology work.

**Files:**
- Modify: `src/groundmodel/domain/services/strat_field/body_assembly.py` (`_sample_height_fields`)
- Test: `tests/unit/domain/services/strat_field/test_body_assembly.py`

- [ ] **Step 1 — Failing test.** Add a fixture field that BUBBLES (a deliberately non-monotone analytic field where, at some (x,y), a deeper contact iso is crossed *above* a shallower one). Assert that after `assemble_bodies` the per-column body stack is monotone (no negative-thickness inversion) and no two bodies overlap on a dense sample set:
```python
def test_bubbled_field_is_clamped_monotone():
    field, order, domain = _bubbled_nested_field()   # analytic, non-monotone in a band
    bodies = assemble_bodies(field, order, domain, grid_spacing_m=1.0)
    assert_no_overlap_sampled(bodies, _grid_samples(domain, n=30))   # STRICT, would FAIL pre-clamp
    for b in bodies:
        assert_closed_manifold(b.vertices, b.triangles)
```
- [ ] **Step 2 — Run → FAIL** (`uv run pytest .../test_body_assembly.py::test_bubbled_field_is_clamped_monotone -v`); expected: an overlap fires (the inversion).
- [ ] **Step 3 — Implement.** In `_sample_height_fields`, after the per-node contact-height array is built (rank-ordered, NaN for absent contacts), clamp it non-increasing in rank. NaN-aware: forward-fill the running min over present ranks only, leave NaN where absent. Concretely (heights shape `(n_ranks, nx, ny)`, ascending rank axis 0):
```python
# Make the stack provably monotone: each contact sits no higher than the one
# above it. A field bubble that inverted a contact is pinched to its neighbour
# (zero-thickness body) instead of overshooting -> watertight non-overlap by
# construction (math review 2026-06-14). NaN (absent contact) is skipped.
clamped = heights.copy()
running = np.full((nx, ny), np.inf)
for r in range(n_ranks):
    layer = clamped[r]
    present = ~np.isnan(layer)
    running[present] = np.minimum(running[present], layer[present])
    clamped[r][present] = running[present]
heights = clamped
```
Add a `# WHY` comment; keep the existing behaviour for already-monotone fields (a monotone stack is a fixed point of this clamp).
- [ ] **Step 4 — Run → PASS.** Confirm the existing watertight tests still pass (`uv run pytest tests/unit/domain/services/strat_field -q`).
- [ ] **Step 5 — Commit** `fix(strat-3d): clamp the contact-height stack monotone (watertight theorem + VEEN fix)`.

---

### Task 2: Lens value objects + the shared enclosure classifier

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/lens_types.py`, `lens_classification.py`
- Test: `tests/unit/domain/services/strat_field/test_lens_classification.py`; extend `fixtures.py`

- [ ] **Step 1 — Value objects (no TDD needed, but write a shape test).** `lens_types.py`: frozen dataclasses
  - `Lens(body_id: str, host_body_id: str, nesting_depth: int)` — `nesting_depth` 1 = lens-in-matrix, 2 = lens-in-lens, …; `host_body_id` is the matrix body for depth 1, the enclosing lens for deeper.
  - `LensPartition(matrix_body_ids: frozenset[str], lenses: tuple[Lens, ...])`.
  Numpy docstrings; no logger.
- [ ] **Step 2 — Failing tests** (`test_lens_classification.py`). The input is the per-investigation ordered unit stacks (reuse the `OrderInputUnit`-shaped columns Stage 1 already consumes, but each unit must carry its `body_id` as `instance_key` — it already does). Tests, real-data-shaped:
```python
from groundmodel.domain.services.strat_field.lens_classification import classify_lenses

def test_enclosed_minority_is_a_lens():
    # KLEI / SILT / KLEI in a column: SILT enclosed by the SAME klei body -> lens.
    part = classify_lenses(_klei_silt_klei_columns())
    assert "silt_body" not in part.matrix_body_ids
    assert any(L.body_id == "silt_body" and L.host_body_id == "klei_body" and L.nesting_depth == 1
               for L in part.lenses)

def test_lens_in_lens():
    # KLEI / SILT / ZAND / SILT / KLEI: SILT enclosed by KLEI, ZAND enclosed by SILT.
    part = classify_lenses(_klei_silt_zand_silt_klei_columns())
    assert {L.body_id: L.nesting_depth for L in part.lenses} == {"silt_body": 1, "zand_body": 2}

def test_lens_out_yields_a_dag():
    # After removing the lenses, the matrix precedence graph is acyclic.
    cols = _klei_silt_klei_columns()
    part = classify_lenses(cols)
    assert _matrix_order_is_acyclic(cols, part.matrix_body_ids)   # helper builds the DAG, asserts nx.is_dag

def test_true_reversal_is_not_a_lens():
    # body A above B in column 1, B above A in column 2 (DIFFERENT columns, no
    # M/B/M sandwich) -> genuine interfingering, NOT classified as a lens.
    part = classify_lenses(_reversed_pair_columns())
    assert part.lenses == ()      # nothing enclosed; the cycle stays (Stage 1 will raise)
```
- [ ] **Step 3 — Run → FAIL.**
- [ ] **Step 4 — Implement `classify_lenses`.** The enclosure criterion: a body `B` is a lens of `M` iff in some column `B` is *directly bracketed above and below by the same body* `M` (`M / B / M`). Algorithm:
  1. For each column, scan consecutive triples `(above, mid, below)`; if `above.body_id == below.body_id != mid.body_id`, record `mid.body_id` enclosed-by `above.body_id`.
  2. A body recorded as enclosed (in any column) is a lens; its host = the bracketing body. (If bracketed by different bodies in different columns, keep the most frequent / document the tie rule.)
  3. **Recurse for lens-in-lens:** after the first pass marks lenses, re-run the bracket scan *treating already-found lenses as their host's material* — i.e. a body bracketed by a lens `L` (above and below) is a lens-in-`L` (`nesting_depth = L.nesting_depth + 1`). Repeat to a fixpoint.
  4. `matrix_body_ids` = all bodies − all lens body_ids.
  5. **Cross-check (assert):** building the precedence DAG over `matrix_body_ids` must be acyclic; if not, raise (a lens classification that doesn't break the cycles is a bug — surfaces a true-interfingering case the criterion missed).
  Numpy docstrings; comment the WHY (enclosure = geological lens; recursion = nesting). Pure function, no logger.
- [ ] **Step 5 — Run → PASS.** ruff + full unit suite + mypy.
- [ ] **Step 6 — Shared-helper note.** Grep `rg "classify_enclosed_lenses|enclosed" src/groundmodel/domain/services` — the existing Python `classify_enclosed_lenses.py` (used by pinch-out suggestions). If its core criterion is the same M/B/M enclosure, extract the shared predicate into `lens_classification.py` and have the old module call it (the project's "extract on the second copy" rule); if it differs materially, leave it and note why in the commit. Do NOT change 2D-render behaviour.
- [ ] **Step 7 — Commit** `feat(strat-3d): shared enclosure classifier -> matrix/lens partition (lens-in-lens)`.

---

### Task 3: Stage 1 — order the matrix backbone only

**Files:**
- Modify: `src/groundmodel/domain/services/strat_field/stratigraphic_order.py`
- Modify: `src/groundmodel/application/assemble_strat_inputs.py` (produce the partition + pass the matrix columns)
- Test: `tests/unit/domain/services/strat_field/test_stratigraphic_order.py`

- [ ] **Step 1 — Failing test.** `build_stratigraphic_order` must order only the matrix bodies; lens bodies are excluded from the order. Add an optional `matrix_body_ids: frozenset[str] | None = None` param (None = all bodies, current behaviour). When given, drop any unit whose `instance_key` is not in the set BEFORE building the DAG:
```python
def test_order_excludes_lenses_and_is_conformable():
    cols = _klei_silt_klei_columns()                 # cycles if SILT is in the order
    part = classify_lenses(cols)
    col = build_stratigraphic_order(cols, matrix_body_ids=part.matrix_body_ids)
    # the SILT lens is not a horizon; KLEI orders cleanly (no NonConformableError)
    assert all(h.below_formation != "SILT" or h.above_formation is None for h in col.horizons) is False or True
    # the real assertion: it did not raise, and KLEI appears as a single matrix unit
```
(Author a precise assertion: the order has no horizon whose below-instance is a lens body, and it does not raise.)
- [ ] **Step 2 — Run → FAIL** (param doesn't exist).
- [ ] **Step 3 — Implement.** Add the param; filter the columns to matrix units (per column, keep only units whose `instance_key ∈ matrix_body_ids`, preserving order) before the existing DAG build. Everything downstream (horizon emission, cycle detection) is unchanged — but a residual cycle now means a TRUE non-conformable matrix (real interfingering) → the existing `NonConformableError` is correct.
- [ ] **Step 4 — Run → PASS.** Confirm the existing Stage-1 tests still pass (the default `None` path is unchanged).
- [ ] **Step 5 — Commit** `feat(strat-3d): Stage 1 orders the matrix backbone (lenses excluded)`.

---

### Task 4: Lens carving — matrix-with-void + lens-fills-void (recursive)

> This is the hardest, research-flavoured task (the 3D geometry). The INTERFACE + the invariants are fixed here; the void-carve geometry is implemented against them. If you cannot make a carved host pass `assert_closed_manifold`, report DONE_WITH_CONCERNS describing exactly what failed — do NOT ship a non-watertight host.

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/lens_carving.py`
- Modify: `src/groundmodel/domain/services/strat_field/body_assembly.py` (host-void support: a body whose present-cell complex has an interior hole stays a closed manifold — the mod-2 boundary already handles this; the lens occupies the hole)
- Test: `tests/unit/domain/services/strat_field/test_lens_carving.py`

- [ ] **Step 1 — Failing tests** (use the Task-7 invariant helpers, real-data-shaped):
```python
from groundmodel.domain.services.strat_field.lens_carving import carve_lenses
from tests.unit.domain.services.strat_field.strat_invariants import (
    assert_closed_manifold, assert_no_overlap_sampled, assert_model_matches_columns)

def test_lens_sits_inside_host_no_overlap_no_gap():
    bodies = _build_enclosed_lens_model()    # KLEI matrix host + a SILT lens carved in
    klei = next(b for b in bodies if b.formation_id == "KLEI")
    silt = next(b for b in bodies if b.formation_id == "SILT")
    assert_closed_manifold(klei.vertices, klei.triangles)   # host with a void is still closed
    assert_closed_manifold(silt.vertices, silt.triangles)   # lens is closed
    assert_no_overlap_sampled([klei, silt], _grid_samples(_domain(), n=30))  # STRICT
    # at a column through the lens, the stack is KLEI / SILT / KLEI (lens inside)
    assert_model_matches_columns(bodies, _enclosed_lens_columns(), tol_m=0.5)

def test_lens_in_lens_carves_recursively():
    bodies = _build_lens_in_lens_model()     # KLEI host, SILT lens, ZAND lens-in-the-SILT
    for b in bodies:
        assert_closed_manifold(b.vertices, b.triangles)
    assert_no_overlap_sampled(bodies, _grid_samples(_domain(), n=30))
```
- [ ] **Step 2 — Run → FAIL.**
- [ ] **Step 3 — Implement `carve_lenses(matrix_meshes, field, partition, domain, grid_spacing_m) -> list[LithoBodyMesh]`.** Approach (height-field-prism native, NO boolean-mesh CSG):
  - Build each lens as its own height-field-prism body over the SAME grid, bounded vertically by where its lithology is present in the field (the lens occupies a sub-volume of its host's interval). The lens is a normal `assemble`-style closed body confined to its enclosed extent.
  - **Carve the void:** the host matrix body is built as the present-cell complex MINUS the cells the lens occupies (a cell is "host" where the band is present AND not claimed by a deeper lens). Because the assembly is a mod-2 cell-complex boundary (see `body_assembly` docstring), removing the lens cells automatically opens a watertight interior wall around the void — no CSG needed. Pass the lens cell-mask into the host's `_present_cells`.
  - **Recursion:** carve deepest `nesting_depth` first; a lens-in-lens removes cells from its enclosing LENS, not the matrix. Process lenses in descending `nesting_depth`.
  - `body_id` for a lens: `f"lens:{host}:{body_id[-6:]}"` (deterministic; `_storage_body_id` already uuid5's non-UUID tokens — verify it accepts this form). `formation_id` = the lens lithology.
  - Deterministic vertex/triangle order.
- [ ] **Step 4 — Implement the `body_assembly` host-void hook** (the cell-mask exclusion) minimally — likely a `claimed_cells` param to `_present_cells` / `assemble_bodies`.
- [ ] **Step 5 — Run → PASS.** ruff + unit suite + mypy.
- [ ] **Step 6 — Commit** `feat(strat-3d): lens-in-lens carving (matrix void + lens fill)`.

---

### Task 5: Wire the lens path — `test.strix` builds (the milestone, single field, no geology yet)

**Files:**
- Modify: `src/groundmodel/domain/services/strat_field/strat_builder.py`, `application/assemble_strat_inputs.py`, `application/recompute_litho_solids.py`
- Test: integration `tests/integration/api/test_recompute_strat_solids.py`

- [ ] **Step 1 — Assemble.** In `AssembleStratInputs`, after building the columns, call `classify_lenses` and return the `LensPartition` on the `StratAssembly`. Feed `matrix_body_ids` to `build_stratigraphic_order`.
- [ ] **Step 2 — Build.** In `build_strat_model` (or `RecomputeLithoSolids`), after `assemble_bodies` produces the matrix meshes, call `carve_lenses(...)` and concatenate. Upsert matrix + lens bodies. Extend the checksum digest to cover the lens partition.
- [ ] **Step 3 — Integration test** (via the wrapper script): seed an interbedded model with an ENCLOSED LENS (KLEI/SILT/KLEI correlated so the resolver over-merges KLEI) across ≥3 investigations; POST rebuild; assert every solid `is_flagged=False`, non-empty geometry, `assert_model_matches_columns` (no overlap, lens inside host), coverage (every authored column has a body). Re-POST → checksum skip; mutate → rebuild.
- [ ] **Step 4 — Run** `.\scripts\run-integration-tests.ps1 tests/integration/api/test_recompute_strat_solids.py` → green. Then **the real-data milestone:** `uv run python scripts/eval_strat_builder.py` on `test.strix` → it now BUILDS (96 matrix bodies + 6 lenses, `bodies_flagged=0`), section-column overlaps ~0. Record the build time.
- [ ] **Step 5 — Commit** `feat(strat-3d): build the non-conformable model via matrix backbone + lenses`.

---

### Task 6: Geological blocks — surface-bounded `Block` + pick→band partition

**Files:**
- Modify: `src/groundmodel/domain/services/strat_field/strat_types.py` (`Block`)
- Create: `src/groundmodel/domain/services/strat_field/geo_blocks.py`
- Test: `tests/unit/domain/services/strat_field/test_geo_blocks.py`

- [ ] **Step 1 — Extend `Block`** with optional curved bounds: `top_surface: SurfaceBound | None = None`, `base_surface: SurfaceBound | None = None`, where `SurfaceBound` is a tiny callable/struct giving `z(x,y)` (wrap a `TinSurface` + nearest-vertex fallback, mirroring the old `_build_band_surfaces`). When None, the flat `z_min`/`z_max` apply (current behaviour). Add a shape test.
- [ ] **Step 2 — Failing tests** for `geo_blocks.partition_picks_by_geology(picks, surfaces, snap_tolerance_m) -> dict[int, list[Pick]]` + `band_blocks(surfaces, hull) -> list[Block]`:
```python
def test_pick_assigned_to_its_band():
    bands = partition_picks_by_geology(_picks(), _two_geo_surfaces(), snap_tolerance_m=0.2)
    assert _pick_at_2m in bands[0] and _pick_at_8m in bands[1]   # split at the boundary

def test_contact_within_tolerance_snaps_to_geo_surface():
    # a litho contact 0.1 m from a geo surface snaps to it (no spurious thin sliver)
    ...

def test_band_block_carries_surface_bounds():
    blocks = band_blocks(_two_geo_surfaces(), _hull())
    assert blocks[0].base_surface is not None and blocks[0].top_surface is not None
```
- [ ] **Step 3 — Run → FAIL.**
- [ ] **Step 4 — Implement** by porting the parked geo-bounding logic (`memory`: the old `divide_picks_by_geology` / `_build_band_surfaces` in the retired `assemble_loft_inputs` — recover from git history `git show <loft-sha>:src/groundmodel/application/assemble_loft_inputs.py`, do NOT `git checkout`). Band index = count of geo surfaces above the pick mid-elevation (as `scripts/eval_geo_bounded_cycles.py` does). Snap-or-divide at boundaries. `band_blocks` builds one `Block` per band with the bounding surfaces.
- [ ] **Step 5 — Run → PASS.** ruff + unit suite + mypy.
- [ ] **Step 6 — Commit** `feat(strat-3d): geological band blocks + snap-or-divide pick partition`.

---

### Task 7: Per-band build loop + geological-surface stitch

**Files:**
- Modify: `src/groundmodel/domain/services/strat_field/strat_builder.py`, `body_assembly.py` (surface caps)
- Test: `tests/unit/domain/services/strat_field/test_strat_builder.py`

- [ ] **Step 1 — Surface caps in `body_assembly`.** When a `Block` carries `top_surface`/`base_surface`, the top/bottom caps follow the surface `z(x,y)` instead of flat `z_max`/`z_min`. Failing test: two stacked bands sharing a (sloped) geological surface produce bodies that meet exactly on it (no overlap/gap across the seam) — `assert_no_overlap_sampled` + a seam-continuity check.
- [ ] **Step 2 — Per-band loop in `build_strat_model`.** Accept `blocks: list[Block]` (the band blocks) + the per-band matrix columns; for each band: order (matrix only) → fit field → assemble bodies (surface-capped) → carve lenses. Concatenate. Adjacent bands share the geological surface (the cap), so they stitch watertight. Failing test: a 2-band interbedded model with a lens in the lower band builds; all bodies closed; no overlap; `assert_model_matches_columns`.
- [ ] **Step 3 — Run → FAIL → implement → PASS.** ruff + unit suite + mypy.
- [ ] **Step 4 — Commit** `feat(strat-3d): per-geological-band field build + surface stitch`.

---

### Task 8: Wire geology into RecomputeLithoSolids + checksum + integration

**Files:**
- Modify: `src/groundmodel/application/assemble_strat_inputs.py`, `recompute_litho_solids.py`
- Test: integration `tests/integration/api/test_recompute_strat_solids.py`

- [ ] **Step 1 — Assemble per-band.** `AssembleStratInputs` loads the parent geo model's surfaces (`GeologyRepository.list_surfaces(parent_id)`), partitions picks into bands, classifies lenses per band, and returns per-band control + band blocks. No parent geo model → single flat block (current behaviour, a clean fallback — log it).
- [ ] **Step 2 — Build per-band** in `RecomputeLithoSolids` via the Task-7 loop. Extend the checksum to cover the geo surfaces. Keep the outcome shape, upsert, orphan-delete, `force`.
- [ ] **Step 3 — Integration test:** seed an interbedded litho model WITH a parent geological model (2 bands) + an enclosed lens; rebuild; assert per-band bodies + the lens, no overlap, coverage, and that a body does not cross a geological band boundary (sample the band surface and assert no body spans it). Checksum skip + mutate-rebuild.
- [ ] **Step 4 — Run** `.\scripts\run-integration-tests.ps1 tests/integration/api/test_recompute_strat_solids.py` → green. Unit suite green.
- [ ] **Step 5 — Commit** `feat(strat-3d): RecomputeLithoSolids builds geology-bounded per band`.

---

### Task 9: Real-data eval + docs + memory

**Files:**
- Modify: CLAUDE.md / `docs/debt.md` / CLAUDE.local.md / memory `project_strat_field_3d_builder.md`

- [ ] **Step 1 — Real-data eval.** `uv run python scripts/eval_strat_builder.py` on `test.strix` (now geology-bounded). Assert: builds, `bodies_flagged=0`, section-column overlaps ~0, no body crosses a geological band, the 6 lenses sit inside their hosts. Record the per-band build time + grid-spacing tradeoff in CLAUDE.local.md.
- [ ] **Step 2 — Owner dogfeed (handoff):** orbit the smooth geology-bounded model; slice a cross-section and confirm the lenses sit inside their KLEI/ZAND hosts and the bands match the geology.
- [ ] **Step 3 — Update CLAUDE.md + debt + memory** in the same effort (maintenance rule): record the geology-bounded lens builder shipped; remove the "non-conformable, owner-decision-pending" note from the memory; note any residual concerns.
- [ ] **Step 4 — Commit** `docs(strat-3d): record the geology-bounded lens-in-lens builder ship`.

---

## Self-review

**Spec coverage:** (A) shared enclosure classifier → Task 2 ✓; (B) matrix-backbone order → Task 3 ✓; (C) geological blocks → Tasks 6+7+8 ✓; (D) lens-in-lens carving → Task 4 ✓; (E) monotone clamp → Task 1 ✓; (F) wiring + checksum → Tasks 5+8 ✓; real-data acceptance → Tasks 5 (single-field milestone) + 9 (geology-bounded) ✓; shared 2D/3D criterion → Task 2 Step 6 ✓; true-interfingering-still-errors → Task 2 (`test_true_reversal_is_not_a_lens`) + Task 3 ✓.

**Placeholder scan:** the one research-flavoured task is Task 4's void-carve geometry — bounded by the closed-manifold + no-overlap invariants (the gate), flagged DONE_WITH_CONCERNS-if-it-diverges, not a vague "carve it". Task 2's `_klei_silt_klei_columns` etc. are fixtures the implementer authors from the existing `fixtures.py` builders; the assertions are concrete. No other TBDs.

**Type consistency:** `Lens`/`LensPartition` defined T2, consumed T3/T4/T5; `classify_lenses` defined T2; `carve_lenses` defined T4, consumed T5/T7; `Block` extended T6, consumed T7/T8; `matrix_body_ids` threaded T2→T3→T5; the Task-7 invariant helpers (`assert_closed_manifold`/`assert_no_overlap_sampled`/`assert_model_matches_columns`) reused throughout.

**Risk notes:** Task 4 (3D void carving) is the heavyweight — the cell-mask exclusion in the mod-2 cell complex is the watertight lever (no CSG). Task 6/7 (geological surface-bounded blocks + stitch) is the second-heaviest — the surface caps must share the geological surface exactly across bands. Tasks 1–5 alone make `test.strix` build (the milestone); 6–8 add the geological frame; do them in order and keep each green + committed.
