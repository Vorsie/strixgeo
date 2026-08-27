"""Behavioural tests for ``canonicalise_shared_diagonals`` — the weld smoothing needs.

Two bodies that abut share a voxel face.  The mesher emits that face into BOTH
bodies, and while every vertex sits on the lattice the two copies are the same
flat square, so nobody notices that each body cut its square into two triangles
along the OPPOSITE diagonal.  The moment a smoother moves the four corners the
square stops being flat, and the two bodies' diagonals describe two different
surfaces — the bodies separate along every contact and interpenetrate by up to a
quarter of a voxel.

This pass makes both bodies choose the SAME diagonal, decided from the lattice
positions the face occupies rather than from whose face it is.  It moves no
vertex, so on the un-smoothed model it is invisible; it exists purely so the
smoothed model stays a partition.

Rules pinned:

* two abutting bodies cut their shared face the same way (CD1);
* not one vertex moves, and each body keeps its volume exactly (CD2);
* every body is still a closed 2-manifold (CD3);
* a face that is nobody's shared face is left alone rather than churned (CD4);
* and the pass is idempotent — running it twice changes nothing (CD5).
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.smooth_body_solids import (
    canonicalise_shared_diagonals,
    signed_volume_m3,
    smooth_body_solids,
)
from groundmodel.domain.services.voxel_litho.voxel_types import LabelGrid
from tests.unit.domain.services.voxel_litho.strat_invariants import (
    assert_closed_manifold,
    assert_no_overlap_sampled,
)


def _abutting_grid() -> LabelGrid:
    """Three bodies: a west block, and two stacked east blocks facing it.

    The west block's east wall faces BOTH east bodies, so the wall is a genuine
    shared surface with more than one partner — the arrangement that makes a
    per-body triangulation choice visible.
    """
    labels = np.zeros((6, 4, 8), dtype=np.int32)
    labels[3:, :, :4] = 1
    labels[3:, :, 4:] = 2
    return LabelGrid(
        gx=np.arange(6.0),
        gy=np.arange(4.0),
        gz=np.arange(8.0),
        labels=labels,
        body_id_by_index=("west", "east_lower", "east_upper"),
        formation_by_body={"west": "f", "east_lower": "f", "east_upper": "f"},
    )


def _meshes(grid: LabelGrid, *, greedy: bool = False) -> list:
    """Extract the solids of a grid, dropping empty bodies."""
    return [m for m in extract_body_solids(grid, greedy=greedy) if m.vertices and m.triangles]


def _diagonals_on_plane(mesh, axis: int, value: float) -> set[frozenset[tuple[float, ...]]]:
    """The triangle edges lying on one axis plane that cross BOTH free axes.

    On an axis plane every triangle edge either runs along one of the two free
    axes (a square side) or crosses both (a square diagonal).  Only the diagonals
    are collected, so the set answers "how did this body cut its squares here".
    """
    free = [k for k in range(3) if k != axis]
    out: set[frozenset[tuple[float, ...]]] = set()
    for tri in mesh.triangles:
        pts = [tuple(round(c, 9) for c in mesh.vertices[i]) for i in tri]
        if any(abs(p[axis] - value) > 1e-9 for p in pts):
            continue
        for u, v in ((0, 1), (1, 2), (2, 0)):
            a, b = pts[u], pts[v]
            if a[free[0]] != b[free[0]] and a[free[1]] != b[free[1]]:
                out.add(frozenset((a, b)))
    return out


# ---------------------------------------------------------------------------
# CD1 — the rule the whole pass exists for
# ---------------------------------------------------------------------------


def test_cd1_abutting_bodies_cut_their_shared_face_the_same_way() -> None:
    """Before the pass the two bodies disagree on every shared square; after, they agree."""
    meshes = {m.body_id: m for m in _meshes(_abutting_grid())}
    wall_x = 2.5  # the plane where the west block meets both east blocks

    before_west = _diagonals_on_plane(meshes["west"], 0, wall_x)
    before_east = _diagonals_on_plane(meshes["east_lower"], 0, wall_x)
    assert before_west and before_east, "fixture problem: no shared wall was found"
    assert not (before_west & before_east), (
        "fixture problem: the mesher already agreed, so there is nothing to pin"
    )

    fixed = {m.body_id: m for m in canonicalise_shared_diagonals(list(meshes.values()))}
    after_west = _diagonals_on_plane(fixed["west"], 0, wall_x)
    after_east = _diagonals_on_plane(fixed["east_lower"], 0, wall_x)
    assert after_east, "the east body lost its wall"
    assert after_east <= after_west, (
        "the two bodies still cut the shared wall along different diagonals"
    )


# ---------------------------------------------------------------------------
# CD2 / CD3 / CD4 / CD5 — what the pass must NOT disturb
# ---------------------------------------------------------------------------


def test_cd2_no_vertex_moves_and_no_body_changes_volume() -> None:
    """Re-cutting a flat square is a change of bookkeeping, not of ground."""
    before = _meshes(_abutting_grid())
    after = canonicalise_shared_diagonals(before)

    for was, now in zip(before, after):
        assert now.vertices == was.vertices
        assert len(now.triangles) == len(was.triangles)
        assert signed_volume_m3(now) == signed_volume_m3(was)


def test_cd3_every_body_is_still_a_closed_manifold() -> None:
    """A re-cut square must not open a hole or double an edge."""
    for mesh in canonicalise_shared_diagonals(_meshes(_abutting_grid())):
        assert_closed_manifold(mesh.vertices, mesh.triangles)


def test_cd4_the_pass_cannot_reconcile_a_greedy_merged_wall_and_does_not_pretend_to() -> None:
    """On merged faces the disagreement survives — which is why the smoother needs un-merged.

    Greedy meshing collapses coplanar faces PER BODY, so the west block's east
    wall is one tall rectangle while the east blocks each carry a short one.  The
    two sides no longer describe the same set of squares at all, and agreeing on
    a diagonal per square cannot make the surfaces coincide once they move.  This
    is pinned so nobody wires the pass into the greedy path and believes the
    contact is now safe to smooth.
    """
    fixed = {
        m.body_id: m for m in canonicalise_shared_diagonals(_meshes(_abutting_grid(), greedy=True))
    }
    wall_x = 2.5
    west = _diagonals_on_plane(fixed["west"], 0, wall_x)
    east = _diagonals_on_plane(fixed["east_lower"], 0, wall_x)
    assert west and east, "fixture problem: no shared wall was found"
    assert not (east <= west), "the greedy walls agreed, so this limit no longer holds"

    # The un-merged extraction of the same grid is the one that CAN be reconciled.
    fine = {m.body_id: m for m in canonicalise_shared_diagonals(_meshes(_abutting_grid()))}
    assert _diagonals_on_plane(fine["east_lower"], 0, wall_x) <= _diagonals_on_plane(
        fine["west"], 0, wall_x
    )


def test_cd5_running_the_pass_twice_changes_nothing() -> None:
    """The choice is a property of the lattice, so it cannot oscillate."""
    once = canonicalise_shared_diagonals(_meshes(_abutting_grid()))
    twice = canonicalise_shared_diagonals(once)
    for a, b in zip(once, twice):
        assert b.triangles == a.triangles


# ---------------------------------------------------------------------------
# The payoff: with the diagonals agreed, smoothing keeps the partition
# ---------------------------------------------------------------------------


def test_cd6_smoothing_agreed_diagonals_keeps_bodies_out_of_each_other() -> None:
    """The reason the pass exists: a smoothed contact stays ONE surface.

    Without it, the two bodies' halves of every shared square tilt in opposite
    directions and each claims ground the other already holds.
    """
    meshes = canonicalise_shared_diagonals(_meshes(_abutting_grid()))
    smooth = smooth_body_solids(meshes, spacing_m=(1.0, 1.0, 1.0), iterations=6)
    samples = [(x + 0.13, y + 0.29) for x in (0.0, 1.0, 2.0, 3.0, 4.0) for y in (0.0, 1.0, 2.0)]
    assert_no_overlap_sampled(smooth, samples)
