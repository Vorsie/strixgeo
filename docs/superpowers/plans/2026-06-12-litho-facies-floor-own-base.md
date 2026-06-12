# Litho-3D facies-competitor own-base floor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop facies-competitor body solids from dipping below their own deepest pick by flooring each "below"-side competitor at its OWN base surface instead of one shared blended base TIN.

**Architecture:** Pure-domain change confined to `assemble_facies_competitors` in `litho_body_assembly.py`. For the `side="below"` path, replace the single shared `base_tin` (blended across all competitors) with a per-competitor base TIN sampled only over that competitor's own holes (nearest-own-hole fallback outside the hull), plus a clamp that keeps each floor at/above the competitor's own deepest base. The `side="above"` path (tops-meet, owner-confirmed) and the `LithoBodyMesh` contract are untouched, so no schema/API/Cesium change.

**Tech Stack:** Python 3.11, SciPy Delaunay via `compute_tin`/`evaluate_tin_at`, pytest. Run with `uv run`.

**Spec:** `docs/superpowers/specs/2026-06-12-litho-facies-floor-own-base-design.md`.

**Branch / worktree:** `fix-litho-3d-overshoot` at `C:/Users/robin/Documents/strix-fix-litho-3d-overshoot` (off `develop@6b9bbf9e`). Do NOT push (`feedback_git_workflow`). The pre-commit hook runs `tests/unit`, so each TDD test+impl pair commits together (a lone red test cannot pass the hook).

---

## File structure

- **Modify:** `src/groundmodel/domain/services/litho_body_assembly.py` — `assemble_facies_competitors` (per-competitor floor for the "below" side) + its docstring. The nested `_sample` helper gains an optional fallback-restriction arg.
- **Modify (tests):** `tests/unit/domain/test_litho_body_assembly.py` — add the failing red test for the below-side own-base floor.
- **Modify (tests):** `tests/unit/domain/test_litho_solid_builder.py` — add the builder-level overshoot invariant regression test.
- **Read-only verification (not committed):** `tmp_diag_overshoot.py` (worktree root) — the in-memory dev-DB replay; re-run after the fix, then delete.

No other files change. `recompute_litho_solids.py`, ORM, API, and the frontend are untouched (mesh contract unchanged).

---

### Task 1: Floor each "below" competitor at its own base (TDD)

**Files:**
- Test: `tests/unit/domain/test_litho_body_assembly.py`
- Modify: `src/groundmodel/domain/services/litho_body_assembly.py:341-474` (`assemble_facies_competitors`)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/domain/test_litho_body_assembly.py`:

```python
def test_facies_below_competitor_floors_at_own_base():
    """A shallow SILT competitor below SAND must NOT sag toward a deep CLAY sibling.

    Six holes on a hexagonal ring share a SAND body; below it, A/B/C carry a
    shallow SILT (own base at elevation -4) and D/E/F a deep CLAY (own base at
    elevation -12).  The SILT prism's deepest vertex must stay at SILT's own base
    (-4), not interpolate down toward CLAY.  Pre-fix the shared blended base TIN
    drags SILT's boundary floor to roughly -8 (the silt-below-clay overshoot).
    """
    from groundmodel.domain.services.litho_body_assembly import (
        assemble_facies_competitors,
    )
    from groundmodel.domain.services.litho_contact_surfaces import (
        build_columns,
        enumerate_contacts,
        fit_patch_surfaces,
    )

    ring = [
        ("A", 0, 0, "SILT", 2.0, 4.0),
        ("B", 6, 1, "SILT", 2.0, 4.0),
        ("C", 10, 6, "SILT", 2.0, 4.0),
        ("D", 7, 11, "CLAY", 2.0, 12.0),
        ("E", 1, 10, "CLAY", 2.0, 12.0),
        ("F", -3, 5, "CLAY", 2.0, 12.0),
    ]
    picks = []
    for inv, x, y, lo, top_d, base_d in ring:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 2.0))  # shared SAND above
        picks.append(_pick(inv, x, y, lo, top_d, base_d))  # competitor below
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    comps = assemble_facies_competitors("SAND", "below", columns, coords, surfaces)
    assert set(comps) == {"SILT", "CLAY"}

    # Behavioural guards: each prism stays a watertight, consistently-wound solid.
    for m in comps.values():
        assert closed_manifold(m.triangles), f"{m.body_id} not closed manifold"
        assert consistently_wound(m.triangles), f"{m.body_id} not consistently wound"

    # The fix: SILT never dips below its OWN deepest base (elevation -4).
    silt_min_z = min(z for (_x, _y, z) in comps["SILT"].vertices)
    assert silt_min_z >= -4.0 - 1e-6, f"SILT floor overshot to {silt_min_z} (own base is -4)"
    # CLAY is the deep competitor and DOES reach its own base (-12), unchanged.
    clay_min_z = min(z for (_x, _y, z) in comps["CLAY"].vertices)
    assert abs(clay_min_z - (-12.0)) < 1e-6, f"CLAY floor should reach -12, got {clay_min_z}"
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `uv run pytest "tests/unit/domain/test_litho_body_assembly.py::test_facies_below_competitor_floors_at_own_base" -q`
Expected: FAIL on `SILT floor overshot to ~-8.x (own base is -4)` (the shared blended base TIN). The watertight/CLAY assertions pass; the SILT overshoot assertion fails.

- [ ] **Step 3: Implement the per-competitor "below" floor**

In `litho_body_assembly.py`, replace the body of `assemble_facies_competitors` from the `holes = sorted(labels)` line through `return out` (currently `:414-474`) with:

```python
    holes = sorted(labels)
    hole_index = {h: i for i, h in enumerate(holes)}
    hole_xy = [coords[h] for h in holes]

    # The CONTINUOUS surface shared by every competitor — built once over all
    # labelled holes:
    #   "above" -> competitor tops (blended so tops meet, owner-confirmed)
    #   "below" -> the shared body's base (the common ceiling)
    top_tin = compute_tin(
        [
            ContactPoint3D(contact_id=h, x_m=coords[h][0], y_m=coords[h][1], elevation_m=top_h[h])
            for h in holes
        ]
    )

    def _sample(tin, hole_z: dict[str, float], x: float, y: float, candidate_idx=None) -> float:
        """Sample elevation from TIN; nearest-hole fallback outside the hull.

        ``candidate_idx`` restricts the fallback pool to a subset of hole indices
        (used to floor a "below" competitor at its OWN nearest hole, so a vertex
        outside that competitor's hull never snaps to a deeper sibling's base).
        """
        z = evaluate_tin_at(tin, x, y)
        if z is not None:
            return z
        pool = candidate_idx if candidate_idx is not None else range(len(hole_xy))
        nearest = min(pool, key=lambda k: (hole_xy[k][0] - x) ** 2 + (hole_xy[k][1] - y) ** 2)
        return hole_z[holes[nearest]]

    top_field: dict[int, float] = {}
    for idx, (vx, vy) in enumerate(part.vertices):
        top_field[idx] = _sample(top_tin, top_h, vx, vy)

    # "above": the floor is the shared body's top — one continuous surface shared
    # by all competitors, built once.  "below": each competitor floors at its OWN
    # base surface (built per competitor in the loop) so a shallow competitor
    # never sags toward a deeper sibling at the facies boundary.
    shared_base_field: dict[int, float] | None = None
    if side == "above":
        base_tin = compute_tin(
            [
                ContactPoint3D(
                    contact_id=h, x_m=coords[h][0], y_m=coords[h][1], elevation_m=base_h[h]
                )
                for h in holes
            ]
        )
        shared_base_field = {
            idx: _sample(base_tin, base_h, vx, vy) for idx, (vx, vy) in enumerate(part.vertices)
        }

    # One scan of the columns gives every body's formation id; avoids a full
    # column scan per competitor (defaults to the body id if a span is missing).
    formation_by_body = {s.body_id: s.formation_id for spans in columns.values() for s in spans}

    out: dict[str, LithoBodyMesh] = {}
    for comp, tris in part.regions.items():
        if side == "above":
            assert shared_base_field is not None  # built in the "above" branch above
            base_field = shared_base_field
        else:
            # Per-competitor floor: fit this competitor's OWN base TIN over its own
            # holes and sample the region's vertices from it.  The final clamp keeps
            # the floor at or above the competitor's own deepest base — a guard rail
            # that holds the invariant even if the sampling strategy changes later.
            own = [h for h in holes if labels[h] == comp]
            own_idx = [hole_index[h] for h in own]
            own_deepest_base = min(base_h[h] for h in own)
            comp_tin = (
                compute_tin(
                    [
                        ContactPoint3D(
                            contact_id=h,
                            x_m=coords[h][0],
                            y_m=coords[h][1],
                            elevation_m=base_h[h],
                        )
                        for h in own
                    ]
                )
                if len(own) >= 3
                else None
            )
            base_field = {}
            for v in {p for t in tris for p in t}:
                vx, vy = part.vertices[v]
                z = evaluate_tin_at(comp_tin, vx, vy) if comp_tin is not None else None
                if z is None:
                    nearest = min(
                        own_idx,
                        key=lambda k, _x=vx, _y=vy: (hole_xy[k][0] - _x) ** 2
                        + (hole_xy[k][1] - _y) ** 2,
                    )
                    z = base_h[holes[nearest]]
                # Clamp UP to the competitor's own deepest base (own_deepest_base is
                # the most-negative elevation, so max() never lets the floor go below it).
                base_field[v] = max(z, own_deepest_base)
        mesh = build_prism(
            comp, formation_by_body.get(comp, comp), part.vertices, tris, top_field, base_field
        )
        if mesh.triangles:
            out[comp] = mesh
    return out
```

Then update the `assemble_facies_competitors` docstring's `Returns`/notes to state: "above" floors all competitors on the shared body's top (tops meet); "below" floors each competitor on its OWN base surface (per-competitor TIN, nearest-own-hole fallback, clamped to the competitor's own deepest base) so a shallow competitor never overshoots toward a deeper sibling.

Also delete the now-unused old `_sample` / `base_tin` / `base_field` / `top_field` construction lines that this block replaces (the whole `top_tin = ...` through the old `for comp, tris ...` loop must be the new block — no leftover duplicate `_sample` or `base_tin`).

- [ ] **Step 4: Run the new test, verify it PASSES**

Run: `uv run pytest "tests/unit/domain/test_litho_body_assembly.py::test_facies_below_competitor_floors_at_own_base" -q`
Expected: PASS.

- [ ] **Step 5: Run the full litho-builder unit suite, verify all green**

Run:
```
uv run pytest tests/unit/domain/test_litho_body_assembly.py \
  tests/unit/domain/test_litho_facies_partition.py \
  tests/unit/domain/test_litho_solid_builder.py \
  tests/unit/domain/test_litho_contact_surfaces.py -q
```
Expected: all PASS (existing below-side tests have flat/equal competitor bases, so the per-competitor floor reproduces their geometry exactly; "above" path is behaviourally unchanged).

If anything fails: STOP and diagnose (`superpowers:systematic-debugging`) — do not edit assertions to fit. A failing existing test means the refactor changed behaviour it shouldn't have.

- [ ] **Step 6: Commit (test + impl together)**

```bash
git add src/groundmodel/domain/services/litho_body_assembly.py tests/unit/domain/test_litho_body_assembly.py
git commit -m "fix(litho-3d): floor below-side facies competitors at their own base"
```

---

### Task 2: Builder-level overshoot invariant (regression guard)

**Files:**
- Test: `tests/unit/domain/test_litho_solid_builder.py`

- [ ] **Step 1: Write the invariant test**

Append to `tests/unit/domain/test_litho_solid_builder.py` (it already imports `build_body_solids` and `_pick` via the shared helpers; if `make_pick`/`build_body_solids` are not yet imported there, add `from tests.unit.domain.mesh_test_helpers import make_pick as _pick` and `from groundmodel.domain.services.litho_solid_builder import build_body_solids` at the top — check the existing imports first and reuse them):

```python
def test_no_body_solid_dips_below_its_own_deepest_pick():
    """Builder invariant: every body mesh stays at or above its own deepest pick.

    A facies fixture (shallow SILT + deep CLAY competing below a shared SAND,
    on a non-collinear ring) is exactly the configuration that used to make the
    silt mesh sink below the clay.  For every returned body, the deepest mesh
    vertex must be no deeper than that body's own deepest member-pick base.
    """
    ring = [
        ("A", 0, 0, "SILT", 2.0, 4.0),
        ("B", 6, 1, "SILT", 2.0, 4.0),
        ("C", 10, 6, "SILT", 2.0, 4.0),
        ("D", 7, 11, "CLAY", 2.0, 12.0),
        ("E", 1, 10, "CLAY", 2.0, 12.0),
        ("F", -3, 5, "CLAY", 2.0, 12.0),
    ]
    picks = []
    for inv, x, y, lo, top_d, base_d in ring:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 2.0))
        picks.append(_pick(inv, x, y, lo, top_d, base_d))

    deepest_pick = {}
    for p in picks:
        elev = p.surface_elev_m - p.base_depth_m
        deepest_pick[p.body_id] = min(deepest_pick.get(p.body_id, elev), elev)

    for mesh in build_body_solids(picks):
        if not mesh.vertices:
            continue
        mesh_min = min(z for (_x, _y, z) in mesh.vertices)
        assert mesh_min >= deepest_pick[mesh.body_id] - 1e-6, (
            f"body {mesh.body_id} mesh dips to {mesh_min}, "
            f"below its own deepest pick {deepest_pick[mesh.body_id]}"
        )
```

- [ ] **Step 2: Run the invariant test, verify it PASSES**

Run: `uv run pytest "tests/unit/domain/test_litho_solid_builder.py::test_no_body_solid_dips_below_its_own_deepest_pick" -q`
Expected: PASS — the Task-1 fix removes the only path (facies "below") that violated the invariant; this test is the standing regression guard.

If it FAILS: a body still overshoots — investigate which path (`superpowers:systematic-debugging` + the `tmp_diag_overshoot.py` path attribution), do NOT relax the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/domain/test_litho_solid_builder.py
git commit -m "test(litho-3d): guard every body solid against dipping below its own deepest pick"
```

---

### Task 3: Full-suite + dev-DB verification, then cleanup

**Files:** none committed beyond Tasks 1–2; deletes the throwaway diagnostic.

- [ ] **Step 1: Run the whole unit suite**

Run: `uv run pytest tests/unit -q`
Expected: 1226 passed (1224 baseline + the 2 new tests), 0 failed.

- [ ] **Step 2: Re-run the read-only dev-DB replay; confirm zero overshoot**

Run: `uv run python tmp_diag_overshoot.py 2>&1 | grep -v -E "INFO|DEBUG|TRACE|SUCCESS|WARNING" | tail -30`
Expected: in the `per (path, lithology)` table, the `facies` rows now show `max_overshoot ≈ 0.00` and `>5cm = 0` for SILT/ZAND/KLEI/VEEN (the other paths were already 0). This proves the fix on the owner's real `test.strix` picks without writing to the DB.

If any facies row still shows overshoot: STOP, do not proceed to cleanup — re-attribute via the diagnostic and re-open Task 1.

- [ ] **Step 3: Delete the throwaway diagnostic (must never be committed)**

```bash
git status --porcelain   # confirm tmp_diag_overshoot.py is the only stray untracked file
rm tmp_diag_overshoot.py
```

- [ ] **Step 4: (owner-gated, manual) dogfeed the real 3-D Build**

The stored `litho_body_solid` rows only change when the owner runs Build (force=True) in the app. Hand off: owner clicks Build on `test.strix`, then the SQL diagnostic from the handoff doc (solid-min vs deepest-pick per lithology) should show ~0 overshoot and silt/sand no longer rendering below the basal clay.

---

## Self-review

**Spec coverage:**
- "Floor each below-competitor at its own base surface (per-competitor TIN)" → Task 1, Step 3. ✓
- "Nearest-own-hole fallback" → Task 1 `_sample(..., candidate_idx=own_idx)` via the per-vertex `own_idx` fallback. ✓
- "Ceiling stays shared/continuous" → `top_field` (below ceiling = shared body base) unchanged. ✓
- "Above side untouched" → `if side == "above": shared_base_field` keeps prior behaviour. ✓
- "Under-constrained competitor (<3 holes)" → `comp_tin = ... if len(own) >= 3 else None` + nearest-own-hole fallback. ✓
- "Invariant clamp (defense-in-depth)" → `base_field[v] = max(z, own_deepest_base)`. ✓
- "Regression test: every body mesh_min ≥ own deepest pick" → Task 2. ✓
- "Keep facies tests green; behavioural assertions" → Task 1 Step 5 + new test's watertight/wound assertions. ✓
- "Final proof: dev-DB diagnostic ~0 overshoot" → Task 3 Step 2 (+ owner dogfeed Step 4). ✓

**Placeholder scan:** none — all steps have concrete code/commands/expected output.

**Type consistency:** `assemble_facies_competitors(body_id, side, columns, coords, surfaces)` signature unchanged; `_sample` gains keyword `candidate_idx`; `build_prism(comp, formation_id, vertices_2d, region_tris, top_elev, base_elev)` call shape unchanged (per-region `base_field` dict satisfies its "every region-tri vertex present" contract). `_pick` / `closed_manifold` / `consistently_wound` reused from `mesh_test_helpers` exactly as the existing tests import them.

**Scope:** single subsystem (the 3-D solid builder), one plan. Issue B is a separate spec/plan.
