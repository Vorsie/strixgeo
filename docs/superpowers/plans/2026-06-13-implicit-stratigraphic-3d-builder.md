# Implicit Stratigraphic 3D Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the loft wedge-mesher (which interpenetrates by metres on real interbedded data) with a smooth, watertight 3D litho model built from a stratigraphic potential field — bodies are the volumes between nested isosurfaces of one smooth scalar field, so interbedding, lateral pinch-outs, and folds all work and the model tiles by construction.

**Architecture:** Six pure-domain stages (stratigraphic order → control data → potential field → isosurface extraction → body assembly → validation), each independently testable against real-data-shaped fixtures and each emitting a standalone HTML 3D preview. `RecomputeLithoSolids` keeps its full external contract; only the mesh-production internals change.

**Tech Stack:** Python 3.11, NumPy, SciPy (`RBFInterpolator`, `spatial`), scikit-image (`measure.marching_cubes`, BSD/commercial-OK — a NEW dependency to add), pytest. Frontend preview: a self-contained Three.js HTML writer (no build step). NO Rust (owner decision — the hot paths are already compiled in SciPy/scikit-image).

**Spec:** `docs/superpowers/specs/2026-06-13-implicit-stratigraphic-3d-builder-design.md` (read it first — it has the why, the owner decisions, and the per-stage contracts).

**Base / branch:** Task 1 resolves this. The reusable foundation (`model_domain`, `section_partition`, the `litho_body_solid` bundle carriage, the `RecomputeLithoSolids` wiring, the band-filler-off decision) is on `feat-litho-3d-watertight-loft`, NOT `develop`. Branch `feat-litho-3d-strat-field` off `feat-litho-3d-watertight-loft`. Do NOT push (`feedback_git_workflow`). The loft mesher must NOT reach `develop` as-is.

**Gates per task:** `uv run pytest tests/unit -q` + `uv run ruff check src tests` + `uv run mypy src` (baseline ~160 errors; introduce none new in your files). Integration ONLY via `.\scripts\run-integration-tests.ps1` (bare pytest wipes the dev DB — `feedback_dev_db_no_truncate`). Pre-commit hook runs the unit suite; never `--no-verify`.

**Dogfeed/verify against real data:** `test.strix` in the dev DB (Docker `strix-db-1`, host port 5433, DB `groundmodel`; litho model `019e934c-70fd-7d11-a44a-b2073f4063a2`), file at `C:\Users\robin\Downloads\test.strix`. The acceptance bar (Task 11): the section-slice ↔ authored-column diff overlaps drop from **50 (loft) to ~0**, and the owner orbits a smooth model.

**The load-bearing lesson from the loft failure:** the loft's invariant tests used only **layer-cake synthetic fields**, so they passed while the real interbedded model overlapped by metres. EVERY invariant/validation task in this plan MUST use **real-data-shaped fixtures** — interbedded (ZAND/SILT/ZAND/SILT), dipping, pinching, folded. A test that only checks a flat two-layer cake is a plan failure.

---

## File structure

New module `src/groundmodel/domain/services/strat_field/` (a cohesive from-scratch package; one responsibility per file):

- `strat_types.py` — frozen value objects shared across stages (`Horizon`, `StratColumn`, `ControlPoint`, `OrientationConstraint`, `StratControlData`, `Block`, `ContactSurface`). No logic.
- `stratigraphic_order.py` — Stage 1: `build_stratigraphic_order(columns) -> StratColumn` (topological sort + cycle detection).
- `control_data.py` — Stage 2: `build_control_data(columns, section_contacts, order) -> StratControlData`.
- `potential_field.py` — Stage 3: `PotentialField` class + `fit_potential_field(control, blocks) -> PotentialField`.
- `iso_surface.py` — Stage 4: `extract_isosurfaces(field, order, grid) -> list[ContactSurface]`.
- `body_assembly.py` — Stage 5: `assemble_bodies(surfaces, order, domain) -> list[LithoBodyMesh]`.
- `strat_builder.py` — orchestrator: `build_strat_model(control, domain, blocks) -> list[LithoBodyMesh]` (calls stages 1/3/4/5; stage 2 + the order feed it).
- `preview.py` — the shared HTML 3D preview writer (Three.js, self-contained) used by every stage's `--preview` path.

Test + fixture support:
- `tests/unit/domain/services/strat_field/` — one test file per stage module + `fixtures.py` (the real-data-shaped synthetic builders: interbedded / dipping / pinch / fold).
- `tests/unit/domain/services/strat_field/strat_invariants.py` — closed-manifold / no-overlap / tiles helpers (port + strengthen the loft's `loft_invariants.py`; reuse the vertical-ray logic).

Application wiring (modify): `src/groundmodel/application/recompute_litho_solids.py`, `src/groundmodel/application/assemble_loft_inputs.py` (add a control-data assembly path; keep the layer/correlation/section loaders).

Retire (Task 10): `src/groundmodel/domain/services/loft_field.py`, `loft_mesher.py`, their tests, `bench_litho_solid_builder.py` repoint.

Order: branch + preview harness + types → stage 1 → 2 → 3 → 4 → 5 → invariants → wire + retire → real-data eval + docs. Each lands green + committed before the next.

---

### Task 1: Branch, dependency, preview harness, shared types

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/__init__.py`, `strat_types.py`, `preview.py`
- Modify: `pyproject.toml` (add `scikit-image`)
- Test: `tests/unit/domain/services/strat_field/test_preview.py`, `test_strat_types.py`

- [ ] **Step 1:** Resolve the base branch. Run `git log --oneline develop..feat-litho-3d-watertight-loft | head` to confirm the foundation commits. Branch: `git checkout -b feat-litho-3d-strat-field feat-litho-3d-watertight-loft`. (If the owner asked to land the reusable parts on develop first, do that cherry-pick first — but default is fork.)
- [ ] **Step 2:** Add scikit-image: `uv add scikit-image`. Confirm `uv run python -c "import skimage.measure; print(skimage.__version__)"` works.
- [ ] **Step 3: Failing test** for the value objects (`test_strat_types.py`) — pin the shapes the later stages consume:

```python
from groundmodel.domain.services.strat_field.strat_types import (
    Horizon, StratColumn, ControlPoint, OrientationConstraint, StratControlData,
    Block, ContactSurface,
)

def test_horizon_is_frozen_and_ordered():
    h = Horizon(rank=0, iso_value=0.0, above_formation="SAND", below_formation="CLAY",
                contact_ids=("c1",))
    assert h.rank == 0 and h.above_formation == "SAND"

def test_strat_column_exposes_horizons_top_down():
    col = StratColumn(horizons=(
        Horizon(0, 0.0, None, "SAND", ("c0",)),       # surface (no above)
        Horizon(1, 1.0, "SAND", "CLAY", ("c1",)),
    ))
    assert [h.rank for h in col.horizons] == [0, 1]

def test_control_point_carries_horizon_rank():
    p = ControlPoint(x=1.0, y=2.0, z=-3.0, horizon_rank=1)
    assert p.horizon_rank == 1
```

- [ ] **Step 4:** Run → FAIL (module missing). Implement `strat_types.py`: frozen dataclasses. `Horizon(rank:int, iso_value:float, above_formation:str|None, below_formation:str|None, contact_ids:tuple[str,...])`; `StratColumn(horizons:tuple[Horizon,...])`; `ControlPoint(x,y,z:float, horizon_rank:int)`; `OrientationConstraint(x,y,z:float, gx,gy,gz:float)` (gradient direction, unit); `StratControlData(points:tuple[ControlPoint,...], orientations:tuple[OrientationConstraint,...], column:StratColumn)`; `Block(polygon:tuple[tuple[float,float],...], z_min:float, z_max:float)` (v1: one block = the alpha-hull prism); `ContactSurface(horizon_rank:int, vertices:list[tuple[float,float,float]], triangles:list[tuple[int,int,int]])`. Numpy docstrings. No `GroundModelLogger` (value objects).
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6: Failing test** for the preview writer (`test_preview.py`) — it just needs to emit a valid standalone HTML file given points/triangles:

```python
from groundmodel.domain.services.strat_field.preview import write_scene_html

def test_write_scene_html_emits_standalone_file(tmp_path):
    out = tmp_path / "scene.html"
    write_scene_html(
        out,
        meshes=[{"name": "SAND", "color": "#fbbf24",
                 "vertices": [(0,0,0),(1,0,0),(0,1,0)], "triangles": [(0,1,2)]}],
        points=[{"x": 0.0, "y": 0.0, "z": 0.0, "color": "#000"}],
    )
    html = out.read_text()
    assert "<canvas" in html or "three" in html.lower()
    assert "0.5" not in html  # sanity: real coords embedded, not a placeholder
    assert out.stat().st_size > 500
```

- [ ] **Step 7:** Run → FAIL. Implement `preview.py`: `write_scene_html(path, meshes, points=(), surfaces=())` writes a self-contained HTML embedding the geometry as JSON + a CDN/inlined Three.js scene with orbit controls (mirror the existing `section_preview.html` style — find it at the repo root, read how it embeds + renders). Pure I/O helper; it is the ONLY file in this module that writes files. Keep it dependency-light (inline minimal Three.js via a pinned CDN URL is fine; the owner opens the file locally).
- [ ] **Step 8:** Run → PASS. `ruff format` + `ruff check --fix` the new files. Full unit suite green.
- [ ] **Step 9: Commit** `feat(strat-3d): branch, scikit-image dep, preview harness, shared types`.

---

### Task 2: Stage 1 — stratigraphic order (topological sort + cycle detection)

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/stratigraphic_order.py`
- Create: `tests/unit/domain/services/strat_field/fixtures.py` (the real-data-shaped builders — start here, extend per stage)
- Test: `tests/unit/domain/services/strat_field/test_stratigraphic_order.py`

- [ ] **Step 1:** Seed `fixtures.py` with column builders that RETURN the per-investigation ordered formation stacks the order-builder consumes (lists of `(formation_id, top_depth, base_depth)` per investigation). Provide: `interbedded_columns()` (ZAND/SILT/ZAND/SILT/KLEI, consistent order across 3 columns with dips), `pinch_columns()` (a SILT lens present in the middle column only), `conflicting_columns()` (column A says SAND-over-CLAY, column B says CLAY-over-SAND — a cycle).
- [ ] **Step 2: Failing tests:**

```python
from groundmodel.domain.services.strat_field.stratigraphic_order import (
    build_stratigraphic_order, NonConformableError,
)
from .fixtures import interbedded_columns, pinch_columns, conflicting_columns

def test_interbedded_sequence_sorts_top_to_bottom():
    col = build_stratigraphic_order(interbedded_columns())
    # 5 units → 6 horizons (surface + 4 contacts + floor); ranks ascend
    ranks = [h.rank for h in col.horizons]
    assert ranks == sorted(ranks)
    # the two ZAND occurrences get DISTINCT ranks (interbedding kept separate)
    zand_below = [h.rank for h in col.horizons if h.below_formation == "ZAND"]
    assert len(zand_below) == 2 and zand_below[0] != zand_below[1]

def test_pinch_unit_still_takes_one_rank():
    col = build_stratigraphic_order(pinch_columns())
    assert any(h.below_formation == "SILT" for h in col.horizons)

def test_non_conformable_order_raises_with_the_offending_pair():
    with pytest.raises(NonConformableError) as e:
        build_stratigraphic_order(conflicting_columns())
    assert "SAND" in str(e.value) and "CLAY" in str(e.value)
```

- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement. Each column gives a chain of "above → below" edges between its consecutive units (as distinct stratigraphic *instances* — use the resolver body identity / instance ordinal so the two ZANDs are different nodes; see `ResolveLithoInstances` and how `assemble_loft_inputs` keys units, reuse that identity). Build a DAG over instances; `graphlib.TopologicalSorter` (stdlib) gives the order, and raises `CycleError` on a non-conformable conflict → catch it and re-raise `NonConformableError(offending instances + their formations)`. Assign `iso_value = rank` (float). Emit `StratColumn`. Numpy docstrings; this is a service-shaped pure function (no I/O) — no logger needed.
- [ ] **Step 5:** Run → PASS. ruff + full unit suite.
- [ ] **Step 6: Preview** — add a tiny script step: `build_stratigraphic_order(...)` on the interbedded fixture, dump the horizon DAG to an HTML (nodes = units, edges = above/below) via `preview.write_scene_html` (or a 2D column diagram). Confirm the owner can read the order. (This preview is dev-only; gate it behind `if __name__ == "__main__"` in a `strat_field/_previews.py` scratch, or a `scripts/strat_preview.py` — keep it out of the package's importable surface.)
- [ ] **Step 7: Commit** `feat(strat-3d): stratigraphic order via topological sort + cycle detection`.

---

### Task 3: Stage 2 — control data (points + orientations)

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/control_data.py`
- Test: `tests/unit/domain/services/strat_field/test_control_data.py`

- [ ] **Step 1: Failing tests** — the control-data builder turns per-investigation contact observations + section-drawn contacts into tagged points + derived orientations:

```python
from groundmodel.domain.services.strat_field.control_data import build_control_data

def test_borehole_contacts_become_tagged_points():
    data = build_control_data(_interbedded_with_xyz(), section_contacts=[], order=_order())
    # every observed contact in every column is a ControlPoint with its horizon rank
    assert len(data.points) == _expected_contact_count()
    assert {p.horizon_rank for p in data.points} == set(range(1, _n_horizons()))

def test_orientation_points_up_section():
    data = build_control_data(_dipping_columns_with_xyz(), section_contacts=[], order=_order())
    # the derived gradient at a borehole points up-section (positive z component dominant)
    assert any(o.gz > 0.5 for o in data.orientations)

def test_section_contacts_add_along_line_points():
    data = build_control_data(_two_columns(), section_contacts=_one_section_contact(), order=_order())
    assert len(data.points) > _borehole_only_count()
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `build_control_data(columns_with_xyz, section_contacts, order) -> StratControlData`:
  - For each investigation's each contact (between consecutive units), emit `ControlPoint(x, y, z=surface_elev - contact_depth, horizon_rank=that horizon's rank)`.
  - For each section-drawn contact, sample points along the section line at the contact's (along, elevation) → (x, y, z, rank).
  - Orientations (v1 derivation): at each borehole, a vertical up-section gradient `(0,0,+1)` (F increases upward through the order); refine the in-plane component from the along-section slope of section contacts (Δelevation/Δalong → a dip vector). Normalise. Document the derivation clearly (the spec's Stage 2).
  - Pure function; numpy docstrings.
- [ ] **Step 4:** Run → PASS. ruff + unit suite.
- [ ] **Step 5: Preview** — the tagged point cloud coloured by horizon, via `preview.write_scene_html` (points only). Owner confirms the contacts land where the boreholes are.
- [ ] **Step 6: Commit** `feat(strat-3d): control data — tagged contact points + derived orientations`.

---

### Task 4: Stage 3 — potential-field interpolation (the research loop)

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/potential_field.py`
- Test: `tests/unit/domain/services/strat_field/test_potential_field.py`

> This is the heaviest task. The spec fixes the INTERFACE + the monotonicity test; the kernel/regularisation is tuned in-stage against the visual. Report DONE_WITH_CONCERNS if the field cannot pass the monotonicity invariant on the dipping/interbedded fixtures and describe what diverged — do NOT loosen the invariant to make it pass.

- [ ] **Step 1: Failing tests — the behavioural contract (the gate):**

```python
from groundmodel.domain.services.strat_field.potential_field import fit_potential_field

def test_field_is_monotonic_down_every_borehole():
    """F evaluated down a borehole strictly increases across the known contacts,
    and crosses each iso-value at (approx) the observed contact depth."""
    control, order, holes = _interbedded_control_with_holes()
    field = fit_potential_field(control, blocks=[_whole_block()])
    for hole in holes:                       # each hole: descending (x,y,z) samples
        vals = field.evaluate(hole.xyz_descending)
        assert all(b >= a - 1e-6 for a, b in zip(vals, vals[1:]))   # non-decreasing
        for rank, depth in hole.observed_contacts:
            z = hole.surface - depth
            assert abs(field.evaluate([(hole.x, hole.y, z)])[0] - order.iso_value(rank)) < 0.25

def test_dip_is_reproduced():
    control, order, _ = _dipping_control()
    field = fit_potential_field(control, blocks=[_whole_block()])
    # the c1 isosurface is deeper on the down-dip side than the up-dip side
    assert _isosurface_depth(field, order.iso_value(1), x_down) > _isosurface_depth(field, order.iso_value(1), x_up)
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `PotentialField` (`.evaluate(xyz: Sequence[tuple]) -> np.ndarray`) and `fit_potential_field(control, blocks)`:
  - v1: one block. Fit with `scipy.interpolate.RBFInterpolator` over the control points (value = iso-value), regularised (`smoothing>0`) and kernelled (start `thin_plate_spline`). Incorporate orientations as the increment/gradient formulation — concretely, add gradient pseudo-points (offset a small ε along the orientation and constrain the value difference), OR move to the Lajaunie co-kriging if RBF-with-gradient-points is unstable (the implementer picks against the monotonicity test).
  - The `blocks` param is honoured by masking control points + evaluation to each block and concatenating (v1: trivially one block).
  - TUNE the kernel/smoothing until the monotonicity test passes on the interbedded + dipping fixtures. Keep constants in a `potential_field_constants.py` with WHY comments.
- [ ] **Step 4:** Run → PASS on the fixtures. ruff + unit suite. mypy clean for the new file.
- [ ] **Step 5: Preview** — horizontal + vertical slices of F (a heatmap grid → coloured points/quads) + two raw isosurfaces (reuse Stage-4 extraction if ready, else a coarse marching-cubes), via `preview.write_scene_html`. The owner eyeballs that the field behaves (no bubbles, dips right).
- [ ] **Step 6: Commit** `feat(strat-3d): potential field interpolation pinned by the monotonicity invariant`.

---

### Task 5: Stage 4 — isosurface extraction (smooth, shared)

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/iso_surface.py`
- Test: `tests/unit/domain/services/strat_field/test_iso_surface.py`

- [ ] **Step 1: Failing tests:**

```python
from groundmodel.domain.services.strat_field.iso_surface import extract_isosurfaces

def test_each_horizon_yields_one_surface():
    field, order, domain = _interbedded_field()
    surfaces = extract_isosurfaces(field, order, grid_spacing_m=1.0, domain=domain)
    assert {s.horizon_rank for s in surfaces} >= {1, 2, 3}   # the interior contacts
    for s in surfaces:
        assert len(s.triangles) > 0

def test_surfaces_do_not_cross():
    """Nested isosurfaces: at any (x,y), the c1 surface is never below the c2 surface."""
    field, order, domain = _interbedded_field()
    surfaces = extract_isosurfaces(field, order, grid_spacing_m=1.0, domain=domain)
    for (x, y) in _grid_samples(domain, n=20):
        depths = {s.horizon_rank: _surface_z_at(s, x, y) for s in surfaces}
        ranks = sorted(d for d in depths if depths[d] is not None)
        zs = [depths[r] for r in ranks]
        assert all(a >= b - 1e-6 for a, b in zip(zs, zs[1:]))   # shallower rank = higher z

def test_pinched_surface_terminates():
    field, order, domain = _pinch_field()       # a lens present only mid-domain
    surfaces = extract_isosurfaces(field, order, grid_spacing_m=1.0, domain=domain)
    lens = next(s for s in surfaces if s.horizon_rank == _lens_rank())
    xs = [v[0] for v in lens.vertices]
    assert max(xs) - min(xs) < _domain_width() - 1.0    # does not span the whole domain
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `extract_isosurfaces(field, order, grid_spacing_m, domain) -> list[ContactSurface]`:
  - Evaluate F on a regular 3D grid spanning `domain` (x,y in the alpha-hull bbox, z in [deep_base, top]); cache the volume.
  - For each interior horizon rank, `skimage.measure.marching_cubes(volume, level=iso_value, spacing=...)` → vertices+triangles in grid coords; affine back to world coords.
  - Clip each surface to `domain.polygon` (drop triangles whose centroid is outside) and to [deep_base, top] (reuse `model_domain`).
  - Optional: one Laplacian smoothing pass (topology-preserving) — gate behind a constant; default on.
  - Each surface emitted ONCE (shared between the body above + below — Task 6 references the same surface for both). Numpy docstrings.
- [ ] **Step 4:** Run → PASS. ruff + unit suite.
- [ ] **Step 5: Preview** — the smooth contact surfaces coloured by horizon. Owner confirms smoothness + no crossings.
- [ ] **Step 6: Commit** `feat(strat-3d): smooth shared isosurface extraction via marching cubes`.

---

### Task 6: Stage 5 — body assembly (closed watertight solids)

**Files:**
- Create: `src/groundmodel/domain/services/strat_field/body_assembly.py`
- Create: `src/groundmodel/domain/services/strat_field/strat_builder.py` (orchestrator)
- Test: `tests/unit/domain/services/strat_field/test_body_assembly.py`, `test_strat_builder.py`

- [ ] **Step 1: Failing tests** (use `strat_invariants.py` from Task 7 — write that helper module first if doing this task before Task 7; the closed-manifold + no-overlap helpers are needed here):

```python
from groundmodel.domain.services.strat_field.body_assembly import assemble_bodies
from .strat_invariants import assert_closed_manifold, assert_no_overlap_sampled

def test_each_body_is_a_closed_manifold():
    surfaces, order, domain = _interbedded_surfaces()
    bodies = assemble_bodies(surfaces, order, domain)
    assert {b.formation_id for b in bodies} >= {"ZAND", "SILT", "KLEI"}
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)

def test_bodies_do_not_overlap():
    surfaces, order, domain = _interbedded_surfaces()
    bodies = assemble_bodies(surfaces, order, domain)
    assert_no_overlap_sampled(bodies, _grid_samples(domain, n=30))   # STRICT, real-data-shaped

def test_pinched_body_closes_to_a_tip():
    surfaces, order, domain = _pinch_surfaces()
    bodies = assemble_bodies(surfaces, order, domain)
    lens = next(b for b in bodies if b.formation_id == "SILT")
    assert_closed_manifold(lens.vertices, lens.triangles)
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `assemble_bodies(surfaces, order, domain) -> list[LithoBodyMesh]`:
  - Body *k* (between horizon ranks k and k+1) is closed by: its TOP surface = the shared `ContactSurface` for rank k+1; its BASE surface = the shared surface for rank k; the LATERAL alpha-hull wall between the two surfaces; the DEM-top cap (top body) / deep-base cap (bottom body) where they reach the domain bounds. Where a bounding surface pinched out (Task 5), the body closes there (top meets base → tip).
  - Stitch the two surfaces + walls into one closed `LithoBodyMesh` (the existing value object). Weld shared vertices on the contact surfaces EXACTLY (the two bodies sharing rank-k surface reference the same vertices) so neighbours share faces → watertight. Deterministic vertex/triangle order.
  - A body with empty volume (pinched everywhere) is omitted. Disconnected components → one mesh each (mirror the loft's component split).
  - `formation_id` = the body's litho formation (from `order`).
- [ ] **Step 4:** Implement `strat_builder.build_strat_model(control, domain, blocks, grid_spacing_m) -> list[LithoBodyMesh]`: order (already in control) → field → surfaces → bodies. The single public entry the application calls.
- [ ] **Step 5:** Run → PASS. ruff + unit suite. mypy clean.
- [ ] **Step 6: Preview** — the coloured solids (the model). Owner orbits it.
- [ ] **Step 7: Commit** `feat(strat-3d): watertight body assembly from shared isosurfaces`.

---

### Task 7: Strengthened invariants + the section-column diff test

**Files:**
- Create: `tests/unit/domain/services/strat_field/strat_invariants.py`
- Test: `tests/unit/domain/services/strat_field/test_strat_invariants.py` (negative coverage — the assertions must FIRE on broken input), `test_section_column_diff.py`

> Do Task 7 BEFORE or ALONGSIDE Task 6 — Task 6's tests import these helpers. Listed after only for narrative.

- [ ] **Step 1:** Port `loft_invariants.py` (from the loft branch) into `strat_invariants.py` and KEEP its negative-coverage tests (open-box fails closed-manifold; overlapping cubes fire no-overlap; interior-gap fires tiles). Add `assert_no_overlap_sampled` STRICT (no `extent_tol` relaxation — the strat model must truly tile).
- [ ] **Step 2: Failing test** — the section-column diff (the test that would have caught the loft's 50 overlaps):

```python
from .strat_invariants import assert_model_matches_columns

def test_model_reproduces_the_authored_columns():
    """Ray-sample the bodies at each authored test column; the model stack must
    match the authored litho stack (formation order, no overlap) within tol."""
    bodies, columns = _interbedded_model_and_columns()
    assert_model_matches_columns(bodies, columns, tol_m=0.5)   # raises on overlap/mismatch
```

- [ ] **Step 3:** Run → FAIL. Implement `assert_model_matches_columns(bodies, columns, tol_m)`: ray-sample each column (x,y), compare the model's body stack to the authored litho stack — assert NO overlap, same formation sequence, bases within tol. This is the formalised version of this session's diagnostic.
- [ ] **Step 4:** Run → PASS. Add the negative-coverage tests for the new strict no-overlap. ruff + unit suite.
- [ ] **Step 5: Commit** `test(strat-3d): strict invariants + section-column diff (real-data-shaped)`.

---

### Task 8: Wire RecomputeLithoSolids to the strat builder

**Files:**
- Modify: `src/groundmodel/application/recompute_litho_solids.py`, `src/groundmodel/application/assemble_loft_inputs.py`
- Test: integration `tests/integration/api/test_recompute_strat_solids.py`

- [ ] **Step 1:** Add a `build_control_data`-feeding assembly: reuse the existing litho-layer / correlation / cross-section loaders in `assemble_loft_inputs` to produce the `columns_with_xyz` + `section_contacts` the strat control-data builder needs (the data is already loaded for the loft; map it to the new shapes). Keep `model_domain` construction (alpha hull / DEM / deep base) — the strat builder needs the `domain`.
- [ ] **Step 2:** In `RecomputeLithoSolids._build_meshes` (or its replacement), call `build_strat_model(control, domain, blocks=[whole_block], grid_spacing_m=<pref>)` instead of `build_loft_meshes`. KEEP: the model-level checksum (extend the digest to cover the control data + grid spacing), the geometric section-presence flag (`on_section_investigation_ids` — bodies on no section stay flagged), the upsert + orphan-delete, the `RecomputeLithoSolidsOutcome` shape. `grid_spacing_m` reads from `view_state.litho_segmenter` (a new pref, default e.g. 1.0 m).
- [ ] **Step 3:** Handle `NonConformableError` from Stage 1: log a WARNING + return all bodies flagged with the actionable message (the model has a non-conformable conflict — v1 limitation), rather than crashing. (The owner sees "these contacts conflict — needs a fault/unconformity, not yet supported".)
- [ ] **Step 4:** Integration test (via the wrapper script): seed a project with interbedded layers + correlations across 2 sections; POST the rebuild; assert every solid `is_flagged=False`, `len(triangles)>0`, and (the key) `assert_model_matches_columns` passes (no overlaps). Re-POST → checksum skip. Mutate a layer → rebuilt.
- [ ] **Step 5:** Run integration via `.\scripts\run-integration-tests.ps1 tests/integration/api/test_recompute_strat_solids.py` → green. Unit suite green.
- [ ] **Step 6: Commit** `feat(strat-3d): RecomputeLithoSolids builds via the implicit strat field`.

---

### Task 9: Retire the loft mesher

**Files:**
- Delete: `src/groundmodel/domain/services/loft_field.py`, `loft_mesher.py` + their tests (`test_loft_field.py`, `test_loft_mesher.py`, `test_loft_invariants.py`).
- Modify: `assemble_loft_inputs.py` (drop the `SectionInput`/`stack_at` plumbing now unused; keep the loaders + `band_surfaces` machinery only if a consumer remains — grep first), `bench_litho_solid_builder.py` (repoint at `build_strat_model`).

- [ ] **Step 1:** `rg "LoftField|build_loft_meshes|loft_field|loft_mesher|stack_at|SectionInput|build_loft" src tests` — list every consumer BEFORE deleting. `model_domain`, `section_partition`, `compute_section_fill`, `LithoBodyMesh` STAY (the strat builder + the 2D render use them).
- [ ] **Step 2:** Delete/trim per the grep. Update imports. Delete the loft-specific tests (their watertight invariants are superseded by `strat_invariants`).
- [ ] **Step 3:** `uv run pytest tests/unit -q` green (no skips). `uv run ruff check src tests` clean. `uv run mypy src` — no new errors.
- [ ] **Step 4: Commit** `refactor(strat-3d): retire the loft wedge mesher`.

---

### Task 10: Bench + e2e

**Files:**
- Modify: `tests/benchmarks/bench_litho_solid_builder.py` (repoint at `build_strat_model`), `desktop/tests/e2e/flow_litho_solids.spec.ts` + `flow_litho_facies.spec.ts` (adjust build-wait + the VEEN assertion to the strat model; the model is now smooth + non-overlapping).

- [ ] **Step 1:** Rewrite the bench to build a synthetic interbedded `StratControlData` + domain and benchmark `build_strat_model` at small/medium/large grid resolutions. Run `uv run pytest tests/benchmarks/ --benchmark-enable -k strat -v`; record in CLAUDE.local.md.
- [ ] **Step 2:** Update the e2e build-wait (profile the real build first — target a few seconds). Keep the VEEN-builds-a-real-volume assertion; add a no-overlap spot-check if cheap.
- [ ] **Step 3:** Close the dev app, run `.\scripts\run-e2e.ps1 flow_litho_solids flow_litho_facies flow_lithology_stage_ui` then the full suite → green.
- [ ] **Step 4: Commit** (two commits: bench, e2e).

---

### Task 11: Real-data eval + docs + retire the loft branch handoff

**Files:**
- Modify: CLAUDE.md / `docs/debt.md` / memory `project_watertight_loft_builder.md` (mark the loft superseded by the strat field) + a new `project_strat_field_3d_builder.md`.

- [ ] **Step 1:** Rebuild `test.strix` on the dev DB (`uv run alembic upgrade head` first if a migration landed — a `grid_spacing_m` pref is view_state JSON, no migration). Run the section-column diff diagnostic (the same one this session used): **overlaps must be ~0** (vs. 50 on the loft), and no non-litho contamination.
- [ ] **Step 2:** Owner dogfeed: orbit the smooth model; slice a cross-section and confirm it matches the authored litho columns (the truthfulness bar). VEEN + interbedded sequences read correctly; pinch-outs taper smoothly.
- [ ] **Step 3:** Update CLAUDE.md + debt + memory in the same session (maintenance rule). Record the build time + grid-spacing tradeoff in CLAUDE.local.md.
- [ ] **Step 4: Commit** `docs(strat-3d): record the implicit strat builder ship`.

---

## Self-review

**Spec coverage:** Stage 1 order+cycle (T2) ✓; Stage 2 control data (T3) ✓; Stage 3 field+monotonicity (T4) ✓; Stage 4 smooth shared isosurfaces (T5) ✓; Stage 5 watertight bodies (T6) ✓; Stage 6 strict invariants + section-column diff on real-data-shaped fixtures (T7) ✓; per-block fault seam (`Block` type T1, `blocks` param T4/T6 — v1 one block) ✓; conformable cycle = actionable error (T2, surfaced T8) ✓; geology-out (no `_clip_to_bands` — new module never has it) ✓; Python-not-Rust (scipy/skimage) ✓; super-testable + per-stage HTML preview (every task has a preview step + `preview.py` T1) ✓; persistence + checksum + section-presence kept (T8) ✓; retire loft (T9) ✓; real-data eval overlaps→0 (T11) ✓.

**Placeholder scan:** the one intentional research-loop is Stage 3's kernel tuning — bounded by the monotonicity test (the gate) + the visual, with the interface fixed; flagged as DONE_WITH_CONCERNS-if-it-diverges, not a vague "tune it". No other TBDs.

**Type consistency:** `Horizon/StratColumn/ControlPoint/OrientationConstraint/StratControlData/Block/ContactSurface` defined T1, consumed T2–T6; `PotentialField` defined T4, consumed T5/T6; `build_strat_model` defined T6, consumed T8; `LithoBodyMesh` reused unchanged; `assert_model_matches_columns` defined T7, used T6/T8/T11.

**Risk notes:** T4 (the field) is the heavyweight + the only research loop — the monotonicity invariant on interbedded+dipping fixtures is the hard gate; do not loosen it. T6 body assembly (closing solids from shared surfaces + caps) is the second-hardest — the shared-vertex weld on the contact surfaces is the watertight lever. T7's `assert_model_matches_columns` is the test that would have caught the loft bug — it MUST run on real-data-shaped fixtures, never layer-cake.
