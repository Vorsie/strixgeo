"""Behavioural tests for ``smooth_body_solids`` — the non-blocky prototype (debt #220).

The voxel mesher is faithful and watertight by construction but **blocky**: a
contact that dips across the model is drawn as a staircase of axis-aligned cell
faces.  The smoother relaxes that staircase toward the ramp it approximates
WITHOUT moving the ground: it is a post-process on the extracted meshes, so the
production mesher is untouched.

The rules pinned here are the ones the owner's #220 entry states, phrased in the
entry's own vocabulary rather than in implementation terms:

* **a contact that is already right must not move** — the voxel face between two
  stacked bodies IS the midpoint between the two cell centres it separates, so
  the flat contact of a layer-cake is already the best estimate and smoothing
  must leave it exactly where it is (SM1);
* **a staircase must relax toward its ramp** — the whole point (SM2);
* **no ground moves further than the quantisation error being corrected** — every
  vertex is displacement-clamped to half a voxel per axis, which is the stated
  faithfulness bound (SM3);
* **bodies stay welded to each other** — a position shared by two bodies before
  is still shared after, so no crack can open at a contact (SM4);
* **topology is untouched** — the triangle lists come back identical and every
  body is still a closed 2-manifold (SM5);
* **bodies still do not interpenetrate** (SM6);
* **the smoother is opt-in** — zero iterations returns the mesher's own output,
  vertex for vertex (SM7); and
* **an honoured column can be held exactly** (SM8).
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.smooth_body_solids import (
    boundary_area_m2,
    signed_volume_m3,
    smooth_body_solids,
)
from groundmodel.domain.services.voxel_litho.voxel_types import LabelGrid
from tests.unit.domain.services.voxel_litho.strat_invariants import (
    assert_closed_manifold,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

_LOWER = 0  # the deeper body (e.g. the clay below the contact)
_UPPER = 1  # the shallower body (e.g. the sand above it)

# Every fixture grid below is 1 m cubic, so the half-voxel displacement bound is
# 0.5 m on each axis — a number the assertions can name directly.
_SPACING = (1.0, 1.0, 1.0)


def _axes(n: int, h: float = 1.0) -> np.ndarray:
    """Return ``n`` ascending cell-centre coordinates from the origin at spacing ``h``."""
    return h * np.arange(n, dtype=float)


def _grid(labels: np.ndarray) -> LabelGrid:
    """Wrap a hand-authored label array in a two-body :class:`LabelGrid` on 1 m cubes."""
    nx, ny, nz = labels.shape
    return LabelGrid(
        gx=_axes(nx),
        gy=_axes(ny),
        gz=_axes(nz),
        labels=labels,
        body_id_by_index=("lower", "upper"),
        formation_by_body={"lower": "clay", "upper": "sand"},
    )


def _layer_cake_grid() -> LabelGrid:
    """Two stacked slabs with a FLAT contact: the deeper body fills ``k < 3``.

    The contact sits on the cell face at elevation 2.5 m, which is exactly the
    midpoint between the cell centres at 2.0 m and 3.0 m — i.e. the voxel model
    already places this contact at the owner's own best estimate.
    """
    labels = np.full((7, 7, 6), _UPPER, dtype=np.int32)
    labels[:, :, :3] = _LOWER
    return _grid(labels)


def _staircase_grid() -> LabelGrid:
    """Two bodies split by a contact that DIPS across the model — the blocky case.

    The deeper body's top rises one cell per cell of easting, so the contact the
    mesher draws is a staircase of alternating horizontal treads and vertical
    risers.  The ramp it approximates runs from the bottom-west corner to the
    top-east corner.
    """
    nx, ny, nz = 8, 5, 9
    labels = np.full((nx, ny, nz), _UPPER, dtype=np.int32)
    for i in range(nx):
        labels[i, :, : i + 1] = _LOWER
    return _grid(labels)


def _meshes(grid: LabelGrid) -> list:
    """Extract the production (greedy) solids of a grid, dropping empty bodies."""
    return [m for m in extract_body_solids(grid) if m.vertices and m.triangles]


def _positions(mesh) -> set[tuple[float, float, float]]:
    """The set of distinct world positions a mesh's vertices occupy."""
    return {(round(x, 9), round(y, 9), round(z, 9)) for x, y, z in mesh.vertices}


def _top_of_lower_body(meshes: list, x: float, y: float) -> float:
    """Elevation of the deeper body's highest solid interval at a map position."""
    lower = next(m for m in meshes if m.body_id == "lower")
    intervals = vertical_ray_intervals(lower.vertices, lower.triangles, x, y)
    assert intervals, f"the deeper body is missing at ({x}, {y})"
    return max(top for _base, top in intervals)


# ---------------------------------------------------------------------------
# SM1 — a contact that is already right must not move
# ---------------------------------------------------------------------------


def test_sm1_flat_contact_of_a_layer_cake_does_not_move() -> None:
    """A flat contact already sits at the midpoint between cell centres — leave it.

    The voxel face between the two slabs is at 2.5 m, halfway between the cell
    centres at 2.0 and 3.0 m.  That is the exact estimate the smoothing exists to
    recover, so smoothing a layer cake must be a no-op away from the model's own
    outer rim (where the contact meets the free edge of the block and there is no
    further ground to average against).
    """
    voxel = _meshes(_layer_cake_grid())
    smooth = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=12)

    # Read the contact where the block is deep in its own interior.
    assert _top_of_lower_body(voxel, 3.0, 3.0) == pytest.approx(2.5)
    assert _top_of_lower_body(smooth, 3.0, 3.0) == pytest.approx(2.5, abs=1e-9)


# ---------------------------------------------------------------------------
# SM2 — a staircase must relax toward its ramp
# ---------------------------------------------------------------------------


def test_sm2_a_dipping_contact_relaxes_off_its_staircase() -> None:
    """The staircase of a dipping contact gives way to something closer to the ramp.

    A staircase covers strictly more surface than the ramp between the same two
    points — every tread and riser is a detour.  Relaxing the contact toward the
    ramp must therefore shed boundary area, and must not shed so much that the
    surface has collapsed past the ramp it is chasing.
    """
    voxel = _meshes(_staircase_grid())
    smooth = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=12)

    before = sum(boundary_area_m2(m) for m in voxel)
    after = sum(boundary_area_m2(m) for m in smooth)
    assert after < before, "the staircase kept every square metre of its detour"
    assert after < 0.95 * before, f"barely moved: {before:.1f} m2 -> {after:.1f} m2"
    # The ramp is the floor, not a target to undershoot: a body cannot have less
    # boundary than the convex-ish shape it is relaxing toward.
    assert after > 0.5 * before, f"collapsed rather than relaxed: {after:.1f} m2"


def test_sm2b_the_contact_stays_between_the_cells_it_separates() -> None:
    """Relaxing a dipping contact never carries it out of the pair of cells it splits.

    At every sampled column of the staircase the smoothed contact stays inside
    the one-voxel band centred on the voxel contact.  That is what makes the
    result an ESTIMATE of the same contact rather than a different contact.
    """
    voxel = _meshes(_staircase_grid())
    smooth = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=12)

    for i in range(1, 7):
        x = float(i) + 0.3
        blocky = _top_of_lower_body(voxel, x, 2.0)
        relaxed = _top_of_lower_body(smooth, x, 2.0)
        assert abs(relaxed - blocky) <= 0.5 + 1e-9, (
            f"the contact at x={x} left its own voxel: {blocky} -> {relaxed}"
        )


# ---------------------------------------------------------------------------
# SM3 — the stated faithfulness bound: half a voxel per axis
# ---------------------------------------------------------------------------


def test_sm3_no_vertex_moves_further_than_half_a_voxel_on_any_axis() -> None:
    """The displacement budget binds even when the smoother is run far past sense.

    Half a voxel per axis is the quantisation error the voxelisation introduced,
    so it is also the most a correction may claim.  Two hundred iterations is
    deliberately absurd — the point is that the bound holds regardless.
    """
    voxel = _meshes(_staircase_grid())
    smooth = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=200)

    for before, after in zip(voxel, smooth):
        moved = np.abs(np.asarray(after.vertices) - np.asarray(before.vertices))
        assert moved[:, 0].max() <= 0.5 + 1e-12
        assert moved[:, 1].max() <= 0.5 + 1e-12
        assert moved[:, 2].max() <= 0.5 + 1e-12


def test_sm3b_the_bound_follows_an_anisotropic_voxel() -> None:
    """A tall-and-thin voxel budgets its axes separately — 0.5 x, 0.5 y, 0.125 z.

    The real grid is 2 m horizontal by 0.25 m vertical, so a single scalar budget
    would license a vertical move eight times the vertical quantisation error.
    """
    grid = _staircase_grid()
    spacing = (2.0, 2.0, 0.25)
    grid = LabelGrid(
        gx=_axes(len(grid.gx), spacing[0]),
        gy=_axes(len(grid.gy), spacing[1]),
        gz=_axes(len(grid.gz), spacing[2]),
        labels=grid.labels,
        body_id_by_index=grid.body_id_by_index,
        formation_by_body=grid.formation_by_body,
    )
    voxel = _meshes(grid)
    smooth = smooth_body_solids(voxel, spacing_m=spacing, iterations=200)

    for before, after in zip(voxel, smooth):
        moved = np.abs(np.asarray(after.vertices) - np.asarray(before.vertices))
        assert moved[:, 0].max() <= 1.0 + 1e-12
        assert moved[:, 1].max() <= 1.0 + 1e-12
        assert moved[:, 2].max() <= 0.125 + 1e-12


# ---------------------------------------------------------------------------
# SM4 / SM5 / SM6 — the invariants the voxel mesher already guarantees
# ---------------------------------------------------------------------------


def test_sm4_two_bodies_that_shared_a_contact_still_share_it() -> None:
    """No crack opens at a contact: a position on both bodies moves once, for both.

    The mesher welds abutting bodies by giving them coincident faces.  If the two
    bodies were relaxed independently their shared faces would drift apart and
    the model would gap along every contact, which is the failure this rule
    exists to forbid.
    """
    voxel = _meshes(_staircase_grid())
    smooth = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=12)

    shared_before = _positions(voxel[0]) & _positions(voxel[1])
    shared_after = _positions(smooth[0]) & _positions(smooth[1])
    assert shared_before, "fixture problem: the two bodies never touched"
    assert len(shared_after) == len(shared_before)


def test_sm5_topology_is_untouched_and_every_body_stays_closed() -> None:
    """Smoothing moves vertices and nothing else — same triangles, still watertight."""
    voxel = _meshes(_staircase_grid())
    smooth = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=12)

    assert [m.body_id for m in smooth] == [m.body_id for m in voxel]
    for before, after in zip(voxel, smooth):
        assert after.triangles == before.triangles
        assert len(after.vertices) == len(before.vertices)
        assert_closed_manifold(after.vertices, after.triangles)


def test_sm6_smoothed_bodies_still_do_not_interpenetrate() -> None:
    """Relaxing the contact must not push one body through the other."""
    smooth = smooth_body_solids(_meshes(_staircase_grid()), spacing_m=_SPACING, iterations=12)
    samples = [(float(i) + 0.37, 2.0 + 0.11) for i in range(1, 7)]
    assert_no_overlap_sampled(smooth, samples)


# ---------------------------------------------------------------------------
# SM7 / SM8 — the opt-in switch and the honoured column
# ---------------------------------------------------------------------------


def test_sm7_zero_iterations_returns_the_meshers_own_output() -> None:
    """The smoother is opt-in: asked for no smoothing, it hands back what it got."""
    voxel = _meshes(_staircase_grid())
    smooth = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=0)

    for before, after in zip(voxel, smooth):
        assert after.vertices == before.vertices
        assert after.triangles == before.triangles


def test_sm8_an_honoured_column_can_be_held_exactly() -> None:
    """Ground the model was TOLD about can be pinned, so the log is reproduced exactly.

    A borehole's own log is evidence, not an estimate, so the owner may want the
    contacts at its column left where the log put them even while the rest of the
    section relaxes.
    """
    voxel = _meshes(_staircase_grid())
    pin = (4.0, 4.0)
    smooth = smooth_body_solids(
        voxel, spacing_m=_SPACING, iterations=12, pin_columns=(pin,), pin_radius_m=1.2
    )

    pinned = 0
    for before, after in zip(voxel, smooth):
        for (bx, by, bz), (ax, ay, az) in zip(before.vertices, after.vertices):
            if (bx - pin[0]) ** 2 + (by - pin[1]) ** 2 <= 1.2**2:
                assert (ax, ay, az) == (bx, by, bz)
                pinned += 1
    assert pinned > 0, "fixture problem: the pin radius covered no vertex"


def test_sm8b_a_pin_can_only_hold_vertices_the_greedy_merge_left_behind() -> None:
    """Pinning is not a guarantee at an arbitrary map position — and must not pretend to be.

    The greedy merge collapses coplanar faces into maximal rectangles, so a
    surface that is flat across a stretch of ground carries NO vertex over that
    stretch: there is nothing there to hold.  A caller that pins a borehole
    sitting mid-rectangle silently holds nothing — pinned in name only.  The
    behaviour is pinned here so it stays a documented limit rather than a
    surprise, and so a future feature-preserving variant has to confront it.
    """
    voxel = _meshes(_staircase_grid())
    mid_of_a_merged_face = (4.0, 2.0)
    smooth = smooth_body_solids(
        voxel,
        spacing_m=_SPACING,
        iterations=12,
        pin_columns=(mid_of_a_merged_face,),
        pin_radius_m=1.2,
    )

    covered = [
        v for m in voxel for v in m.vertices if (v[0] - 4.0) ** 2 + (v[1] - 2.0) ** 2 <= 1.2**2
    ]
    assert covered == [], "fixture problem: this position was supposed to be mid-face"
    # Nothing was held, so the result is exactly the unpinned one.
    unpinned = smooth_body_solids(voxel, spacing_m=_SPACING, iterations=12)
    for held, free in zip(smooth, unpinned):
        assert held.vertices == free.vertices


# ---------------------------------------------------------------------------
# The measurement helpers the faithfulness report is built on
# ---------------------------------------------------------------------------


def test_signed_volume_of_the_voxel_mesh_equals_its_own_cell_count() -> None:
    """The volume metric is calibrated: a voxel mesh measures exactly its cells.

    Without this, a volume delta against the smoothed model would be measuring
    the metric's own error as much as the smoother's.
    """
    grid = _staircase_grid()
    meshes = _meshes(grid)
    for index, body_id in enumerate(grid.body_id_by_index):
        mesh = next(m for m in meshes if m.body_id == body_id)
        cells = int(np.count_nonzero(grid.labels == index))
        assert signed_volume_m3(mesh) == pytest.approx(float(cells), abs=1e-9)
