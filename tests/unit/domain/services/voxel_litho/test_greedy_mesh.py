"""Tests for greedy meshing of the voxel boundaries — primitive + manifold + geometry.

Two layers:

(1) The rectangle-cover PRIMITIVE (:func:`maximal_rectangles`) in isolation — a
    full mask collapses to one rectangle, an L-shape to two, a hole splits the
    ring, a checkerboard cannot merge.  These pin the heart of greedy meshing
    independent of the 3-D mesher.

(2) The wired mesher: a flat 10x10x1 slab's top face must drop from 200 triangles
    to 2 after merging, the total triangle count must fall sharply, the merged
    mesh must still be a closed 2-manifold, and its ``vertical_ray_intervals`` at a
    dense sample grid must be IDENTICAL (within 1e-9) to the un-merged output —
    the merge reduces triangles WITHOUT moving any surface.  A STEPPED body
    exercises the T-junction repair in pytest (not only the real-data gate).
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.greedy_mesh import (
    _maximal_rectangles_compiled,
    maximal_rectangles,
    subdivision_nodes,
    triangulate_subdivided_rect,
)
from groundmodel.domain.services.voxel_litho.voxel_types import LabelGrid
from tests.unit.domain.services.voxel_litho.strat_invariants import (
    assert_closed_manifold,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

_BODY = 0


def _regular_axes(n: int, start: float, h: float) -> np.ndarray:
    """Return ``n`` ascending grid-node coordinates from ``start`` at spacing ``h``."""
    return start + h * np.arange(n, dtype=float)


# ---------------------------------------------------------------------------
# (1) The rectangle-cover primitive, in isolation
# ---------------------------------------------------------------------------


def _covers_exactly(mask: np.ndarray, rects: list[tuple[int, int, int, int]]) -> bool:
    """Return True iff the rectangles exactly partition the mask's True cells."""
    painted = np.zeros_like(mask, dtype=int)
    for u0, v0, u1, v1 in rects:
        painted[u0:u1, v0:v1] += 1
    # Every True cell painted exactly once; every False cell never.
    return bool(np.array_equal(painted, mask.astype(int)))


def test_kernel_compiles_in_numba_nopython_mode() -> None:
    """The greedy-mesh kernel must JIT-compile in Numba NOPYTHON mode.

    An object-mode fallback (or an accidentally-removed ``@njit``) would
    silently regress the voxel-build hotspot — 38.6x on the real 113k-mask
    workload (CLAUDE.local.md) — while every geometric test in this file still
    passes on the slow pure-Python path. Pin the perf-critical compilation:
    after a real call the Numba dispatcher must register a nopython signature.
    """
    mask = np.array([[True, True], [True, False]], dtype=np.bool_)
    maximal_rectangles(mask)  # triggers JIT compilation of the kernel
    # A plain Python function has no ``nopython_signatures``; a nopython @njit
    # dispatcher registers the compiled signature here. An object-mode fallback
    # would leave this list empty.
    assert hasattr(_maximal_rectangles_compiled(), "nopython_signatures"), (
        "kernel is not a Numba dispatcher — was @njit removed?"
    )
    assert len(_maximal_rectangles_compiled().nopython_signatures) > 0, (
        "greedy-mesh kernel did not compile in nopython mode (object-mode fallback?)"
    )


def test_full_mask_is_one_rectangle() -> None:
    """A solid 10x10 mask greedy-merges to a SINGLE maximal rectangle."""
    mask = np.ones((10, 10), dtype=bool)
    rects = maximal_rectangles(mask)
    assert rects == [(0, 0, 10, 10)], f"a full mask is one rectangle; got {rects}"
    assert _covers_exactly(mask, rects)


def test_l_shape_is_two_rectangles() -> None:
    """An L-shape covers with exactly two rectangles, exactly tiling the True cells."""
    # A 3x3 mask with the top-right 2x... corner removed → an L.
    mask = np.ones((3, 3), dtype=bool)
    mask[0, 1:] = False  # remove the top row's right two cells → L-shape.
    rects = maximal_rectangles(mask)
    assert len(rects) == 2, f"an L-shape covers in two rectangles; got {rects}"
    assert _covers_exactly(mask, rects)


def test_ring_with_hole_splits() -> None:
    """A square ring (centre hole) cannot be one rectangle; it tiles exactly."""
    mask = np.ones((5, 5), dtype=bool)
    mask[2, 2] = False  # punch a one-cell hole.
    rects = maximal_rectangles(mask)
    assert len(rects) >= 2, f"a holed mask needs >1 rectangle; got {rects}"
    assert _covers_exactly(mask, rects)


def test_checkerboard_cannot_merge() -> None:
    """A checkerboard's isolated True cells each become their own 1x1 rectangle."""
    mask = np.zeros((4, 4), dtype=bool)
    mask[::2, ::2] = True
    mask[1::2, 1::2] = True
    rects = maximal_rectangles(mask)
    # No two diagonally-adjacent True cells can share a rectangle → one per cell.
    assert len(rects) == int(mask.sum()), f"checkerboard is all 1x1; got {len(rects)}"
    assert _covers_exactly(mask, rects)
    assert all((u1 - u0) * (v1 - v0) == 1 for u0, v0, u1, v1 in rects)


def test_empty_mask_is_no_rectangles() -> None:
    """An all-False mask covers with zero rectangles."""
    assert maximal_rectangles(np.zeros((3, 3), dtype=bool)) == []


def test_single_row_grows_right() -> None:
    """A 1x6 strip of True cells merges into one wide rectangle."""
    mask = np.zeros((3, 6), dtype=bool)
    mask[1, :] = True
    rects = maximal_rectangles(mask)
    assert rects == [(1, 0, 2, 6)], f"a row is one wide rectangle; got {rects}"
    assert _covers_exactly(mask, rects)


# ---------------------------------------------------------------------------
# (1c) Byte-identity pin: the vectorized `maximal_rectangles` must return the
#      EXACT same rectangles (same tuples, same raster-scan order) as the
#      original scalar greedy logic, over a large battery of masks.  The
#      downstream weld + triangulation depend on this, so the mesh output must
#      not change.  This is the strongest guard on the speed refactor.
# ---------------------------------------------------------------------------


def _reference_maximal_rectangles(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Reference: the ORIGINAL scalar greedy logic, verbatim.

    Kept here as the oracle for the byte-identity property test below.  This is
    the pre-vectorization implementation copied exactly (per-row ``.all()`` down-
    growth + per-cell right-growth), so the vectorized production version is
    compared cell-for-cell against the behaviour it must preserve.
    """
    remaining = np.array(mask, dtype=bool, copy=True)
    nu, nv = remaining.shape
    rectangles: list[tuple[int, int, int, int]] = []
    for u0 in range(nu):
        row = remaining[u0]
        v0 = 0
        while v0 < nv:
            if not row[v0]:
                v0 += 1
                continue
            v1 = v0
            while v1 < nv and remaining[u0, v1]:
                v1 += 1
            u1 = u0 + 1
            while u1 < nu and remaining[u1, v0:v1].all():
                u1 += 1
            rectangles.append((u0, v0, u1, v1))
            remaining[u0:u1, v0:v1] = False
            v0 = v1
    return rectangles


def _structured_masks() -> list[np.ndarray]:
    """A battery of hand-built structured masks (edge shapes + degenerate cases)."""
    masks: list[np.ndarray] = []
    # All-True / all-False over varied shapes (incl. the real z-face aspect ratios).
    for shape in [(1, 1), (1, 31), (31, 1), (5, 5), (297, 31), (31, 297), (97, 97)]:
        masks.append(np.ones(shape, dtype=bool))
        masks.append(np.zeros(shape, dtype=bool))
    # Checkerboard (no merge possible) — even and odd parities.
    cb = np.zeros((8, 8), dtype=bool)
    cb[::2, ::2] = True
    cb[1::2, 1::2] = True
    masks.append(cb)
    masks.append(~cb)
    # L-shape, ring-with-hole, single cells, stripes.
    el = np.ones((6, 6), dtype=bool)
    el[:2, 3:] = False
    masks.append(el)
    ring = np.ones((7, 7), dtype=bool)
    ring[2:5, 2:5] = False
    masks.append(ring)
    single = np.zeros((9, 9), dtype=bool)
    single[4, 4] = True
    masks.append(single)
    hstripes = np.zeros((10, 10), dtype=bool)
    hstripes[::2, :] = True  # full rows → wide rectangles, down-grow blocked
    masks.append(hstripes)
    vstripes = np.zeros((10, 10), dtype=bool)
    vstripes[:, ::2] = True  # full columns → tall rectangles, right-grow blocked
    masks.append(vstripes)
    # A 1xN and Nx1 with interior gaps (multiple anchors per row / column).
    gapped_row = np.zeros((3, 12), dtype=bool)
    gapped_row[1, [0, 1, 2, 5, 6, 9, 10, 11]] = True
    masks.append(gapped_row)
    gapped_col = np.zeros((12, 3), dtype=bool)
    gapped_col[[0, 1, 2, 5, 6, 9, 10, 11], 1] = True
    masks.append(gapped_col)
    return masks


def test_maximal_rectangles_matches_reference_on_structured_masks() -> None:
    """The vectorized cover equals the scalar reference on every structured case."""
    for mask in _structured_masks():
        got = maximal_rectangles(mask)
        want = _reference_maximal_rectangles(mask)
        assert got == want, f"diverged on {mask.shape} mask:\n got {got}\n want {want}"
        assert _covers_exactly(mask, got)


def test_maximal_rectangles_matches_reference_on_random_battery() -> None:
    """The vectorized cover equals the scalar reference on a large random battery.

    Hundreds of random boolean masks across varied shapes (tall, wide, square,
    1xN, Nx1) and densities.  A fixed seed keeps the battery deterministic.  This
    is the load-bearing byte-identity pin: if the vectorization changes ANY
    rectangle or its order, this fails and the meshes would change downstream.
    """
    rng = np.random.default_rng(20260616)
    shapes = [
        (1, 1),
        (1, 17),
        (17, 1),
        (3, 3),
        (8, 8),
        (12, 5),
        (5, 12),
        (31, 7),
        (7, 31),
        (40, 40),
        (60, 13),
        (13, 60),
    ]
    checked = 0
    for shape in shapes:
        for density in (0.15, 0.35, 0.5, 0.65, 0.85):
            for _ in range(6):  # 12 shapes x 5 densities x 6 draws = 360 random masks
                mask = rng.random(shape) < density
                got = maximal_rectangles(mask)
                want = _reference_maximal_rectangles(mask)
                assert got == want, (
                    f"diverged on {shape} mask (density {density}):\n got {got}\n want {want}"
                )
                assert _covers_exactly(mask, got)
                checked += 1
    assert checked == 360, f"expected 360 random masks checked; got {checked}"


# ---------------------------------------------------------------------------
# (1b) The Strategy-A perimeter-subdivision primitives, in isolation
# ---------------------------------------------------------------------------


def test_subdivision_nodes_is_the_union_of_rectangle_corners() -> None:
    """``subdivision_nodes`` collects exactly the distinct corners of all faces."""
    faces = [
        ((0, 0, 0), (4, 0, 0), (4, 2, 0), (0, 2, 0)),  # a wide cap
        ((2, 0, 0), (2, 2, 0), (2, 2, 3), (2, 0, 3)),  # a wall whose corner (2,0,0) lands
    ]  # mid the cap's bottom edge (0,0,0)->(4,0,0) → a T-junction site.
    nodes = subdivision_nodes(faces)
    assert (2, 0, 0) in nodes, "the wall's corner on the cap's edge must be a subdivision node"
    assert (4, 2, 0) in nodes and (0, 0, 0) in nodes
    # No node that is not a corner of some face.
    assert (1, 1, 1) not in nodes


def test_triangulate_subdivided_rect_inserts_collinear_corner() -> None:
    """A merged edge with a subdivision node mid-span gains that node as a perimeter vertex.

    The wide cap's bottom edge ``(0,0,0)->(4,0,0)`` has the wall corner
    ``(2,0,0)`` strictly on it; the subdivided fan must include ``(2,0,0)`` as a
    perimeter vertex so the merged edge is split into the unit sub-edges
    ``(0,0,0)-(2,0,0)`` and ``(2,0,0)-(4,0,0)`` that pair with the wall.  Every
    emitted vertex is one of the rectangle's lattice nodes (collinear on the
    rectangle), so no surface moves.
    """
    face = ((0, 0, 0), (4, 0, 0), (4, 2, 0), (0, 2, 0))
    subdiv = {(0, 0, 0), (4, 0, 0), (4, 2, 0), (0, 2, 0), (2, 0, 0)}
    tris = triangulate_subdivided_rect(face, subdiv)
    used = {n for tri in tris for n in tri}
    assert (2, 0, 0) in used, "the mid-edge subdivision node must appear in the fan"
    # The split unit sub-edges both appear as triangle edges (so they can pair with
    # the perpendicular wall), which is what removes the T-junction.
    edges = {frozenset((tri[i], tri[(i + 1) % 3])) for tri in tris for i in range(3)}
    assert frozenset(((0, 0, 0), (2, 0, 0))) in edges
    assert frozenset(((2, 0, 0), (4, 0, 0))) in edges


def test_triangulate_subdivided_rect_no_subdiv_is_two_triangles() -> None:
    """With no interior subdivision node a rectangle is the usual two triangles."""
    face = ((0, 0, 0), (3, 0, 0), (3, 2, 0), (0, 2, 0))
    subdiv = set(face)  # only the corners → no mid-edge insertion
    tris = triangulate_subdivided_rect(face, subdiv)
    assert len(tris) == 2, f"a corner-only rectangle is two triangles; got {len(tris)}"


# ---------------------------------------------------------------------------
# (2) The wired mesher — slab, geometry preservation, manifold, T-junctions
# ---------------------------------------------------------------------------


def _flat_slab_grid(nx: int, ny: int, nz: int) -> LabelGrid:
    """A solid ``nx x ny x nz`` box of one body — a clean slab (no concavities)."""
    h = 1.0
    return LabelGrid(
        gx=_regular_axes(nx, 0.0, h),
        gy=_regular_axes(ny, 0.0, h),
        gz=_regular_axes(nz, 0.0, h),
        labels=np.full((nx, ny, nz), _BODY, dtype=np.int32),
        body_id_by_index=("slab",),
        formation_by_body={"slab": "ZAND"},
    )


def _count_top_face_triangles(mesh: object) -> int:
    """Count triangles whose three vertices share the maximum z (the +z top face)."""
    verts = mesh.vertices  # type: ignore[attr-defined]
    zmax = max(v[2] for v in verts)
    return sum(
        1
        for a, b, c in mesh.triangles  # type: ignore[attr-defined]
        if verts[a][2] == zmax and verts[b][2] == zmax and verts[c][2] == zmax
    )


def _dense_samples(grid: LabelGrid) -> list[tuple[float, float]]:
    """Return a dense (x, y) sample grid at the centre of every voxel column."""
    return [(float(x), float(y)) for x in grid.gx for y in grid.gy]


def test_flat_slab_top_face_merges_to_two_triangles() -> None:
    """A 10x10x1 slab's top face drops from 200 triangles to 2 after greedy meshing.

    The flat slab is a clean box (no concavities), so the top boundary is a single
    coplanar 10x10 same-body face → one maximal rectangle → 2 triangles, down from
    200 (one quad / two triangles per cell).
    """
    grid = _flat_slab_grid(10, 10, 1)
    bodies = extract_body_solids(grid)
    assert [b.body_id for b in bodies] == ["slab"]
    slab = bodies[0]

    # The top (+z) face is now two triangles, not 2 * 100.
    assert _count_top_face_triangles(slab) == 2, "the 10x10 top face is one merged quad"

    # Total triangle count falls sharply: a clean box is ~12 triangles (6 faces x 2),
    # not the ~440 of the un-merged per-cell mesh.
    assert len(slab.triangles) <= 20, f"merged slab is a near-box; got {len(slab.triangles)}"

    assert_closed_manifold(slab.vertices, slab.triangles)


def test_merge_preserves_geometry_against_unmerged() -> None:
    """The merged mesh's ray intervals match the un-merged output within 1e-9 everywhere.

    Builds the SAME slab with and without greedy meshing and compares
    ``vertical_ray_intervals`` at a dense (x, y) sample grid: the merge reduces
    triangles WITHOUT moving any surface, so every interval must be identical.
    """
    grid = _flat_slab_grid(10, 10, 3)

    merged = extract_body_solids(grid)[0]
    unmerged = extract_body_solids(grid, greedy=False)[0]

    # The merge must actually reduce triangles (otherwise the test is vacuous).
    assert len(merged.triangles) < len(unmerged.triangles)

    for x, y in _dense_samples(grid):
        iv_m = vertical_ray_intervals(merged.vertices, merged.triangles, x, y)
        iv_u = vertical_ray_intervals(unmerged.vertices, unmerged.triangles, x, y)
        assert len(iv_m) == len(iv_u), f"interval count differs at ({x}, {y})"
        for (bm, tm), (bu, tu) in zip(sorted(iv_m), sorted(iv_u)):
            assert abs(bm - bu) < 1e-9 and abs(tm - tu) < 1e-9, (
                f"interval moved at ({x}, {y}): merged ({bm}, {tm}) vs unmerged ({bu}, {tu})"
            )


def _stepped_body_grid() -> LabelGrid:
    """An L-shaped (stepped) body in plan — the step abuts a merged face → T-junction.

    A 4x4x2 grid where one body fills an L-shaped footprint: the full bottom half
    plus a tall column on one side.  After greedy merging, the large top face of
    the low part and the side wall of the tall column produce collinear corner
    vertices on a merged edge — the T-junction the repair pass must resolve to
    keep the mesh a closed 2-manifold.
    """
    h = 1.0
    nx, ny, nz = 4, 4, 3
    labels = np.full((nx, ny, nz), -1, dtype=np.int32)
    # Bottom layer (k=0): full 4x4 footprint.
    labels[:, :, 0] = _BODY
    # Middle + top layers (k=1, 2): only the left half (i < 2) → a step.
    labels[:2, :, 1] = _BODY
    labels[:2, :, 2] = _BODY
    return LabelGrid(
        gx=_regular_axes(nx, 0.0, h),
        gy=_regular_axes(ny, 0.0, h),
        gz=_regular_axes(nz, 0.0, h),
        labels=labels,
        body_id_by_index=("stepped",),
        formation_by_body={"stepped": "KLEI"},
    )


def test_stepped_body_stays_manifold_after_merge() -> None:
    """A stepped body (the T-junction case) stays a closed 2-manifold after merging.

    This is the unit-test arbiter for the T-junction repair: a merged face's long
    edge abuts perpendicular walls whose corners land mid-edge, which would leave
    one-triangle edges if not split.  The repair must restore a closed manifold,
    and the geometry must match the un-merged mesh exactly.
    """
    grid = _stepped_body_grid()
    merged = extract_body_solids(grid)[0]
    unmerged = extract_body_solids(grid, greedy=False)[0]

    # The merge reduced triangles AND kept the mesh a closed 2-manifold.
    assert len(merged.triangles) < len(unmerged.triangles)
    assert_closed_manifold(merged.vertices, merged.triangles)

    # Geometry preserved: identical ray intervals at every column.
    for x in grid.gx:
        for y in grid.gy:
            iv_m = sorted(vertical_ray_intervals(merged.vertices, merged.triangles, x, y))
            iv_u = sorted(vertical_ray_intervals(unmerged.vertices, unmerged.triangles, x, y))
            assert len(iv_m) == len(iv_u), f"interval count differs at ({x}, {y})"
            for (bm, tm), (bu, tu) in zip(iv_m, iv_u):
                assert abs(bm - bu) < 1e-9 and abs(tm - tu) < 1e-9


def test_stepped_body_no_overlap_after_merge() -> None:
    """The stepped body's merged mesh still ray-samples to a single non-overlapping solid."""
    grid = _stepped_body_grid()
    merged = extract_body_solids(grid)
    assert_no_overlap_sampled(merged, _dense_samples(grid))
