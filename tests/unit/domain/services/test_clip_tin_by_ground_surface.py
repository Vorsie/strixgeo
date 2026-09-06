"""Unit tests for the crossing-line ground-surface clip (owner ruling 2026-09-06).

The owner's rule, in his words:

    "You need to see where a polygon crossed the mTAW model. Take that line
    (or 2 or more points, that is a line) and give them as input to the TIN."

    "a formation surface ends where it crosses the ground surface; the crossing
    line is part of the TIN; nothing above the ground remains; a surface below
    it, like Merelbeke, keeps its own top."

The old behaviour clamped every vertex to ``min(z, ground_z)`` point by point,
which flattened a crossing surface to a plateau at the ground level. The new
rule cuts the surface along the crossing line instead: the part above ground is
dropped, the crossing polyline becomes new TIN vertices, and a surface entirely
below ground is returned unchanged (never flattened).
"""

from __future__ import annotations

from groundmodel.domain.services.clip_tin_by_ground_surface import (
    clip_tin_by_ground_surface,
)
from groundmodel.domain.value_objects.tin_surface import TinSurface


def _flat_ground(z: float):
    """A ground sampler at a constant elevation everywhere."""

    def ground(x: float, y: float) -> float | None:
        return z

    return ground


def _no_ground():
    """A ground sampler that has no data anywhere (NoData / over water)."""

    def ground(x: float, y: float) -> float | None:
        return None

    return ground


# A single triangle straddling a flat ground at z = 0: vertex B pokes 2 m above
# the ground, vertices A and C sit 2 m below it. The crossing line runs through
# the two edge midpoints (5, 0, 0) and (5, 5, 0).
_STRADDLING = TinSurface(
    vertices=[(0.0, 0.0, -2.0), (10.0, 0.0, 2.0), (0.0, 10.0, -2.0)],
    triangles=[(0, 1, 2)],
)


def test_a_formation_surface_ends_where_it_crosses_the_ground_surface() -> None:
    """The surface stops at the crossing line; nothing reaches past it.

    Vertex B at x = 10 pokes above the ground; the crossing sits at x = 5.
    After the cut the surface must end at the crossing — no part of it may
    reach out to x = 10 any more.
    """
    result = clip_tin_by_ground_surface(_STRADDLING, _flat_ground(0.0))
    assert result.vertices, "the whole surface was dropped"
    max_x = max(v[0] for v in result.vertices)
    assert max_x <= 5.0 + 1e-9, f"the surface still reaches past the crossing to x={max_x}"
    # The above-ground vertex B is gone.
    assert (10.0, 0.0, 2.0) not in result.vertices


def test_the_crossing_line_is_part_of_the_tin() -> None:
    """The crossing points become vertices of the clipped TIN, sitting on ground.

    The two crossing points (5, 0, 0) and (5, 5, 0) are new vertices that were
    not in the input; each sits exactly on the ground surface (z == ground z).
    """
    result = clip_tin_by_ground_surface(_STRADDLING, _flat_ground(0.0))
    on_ground = [v for v in result.vertices if abs(v[2] - 0.0) <= 1e-9]
    # Both crossing vertices are present and neither existed in the input.
    assert len(on_ground) >= 2
    for v in on_ground:
        assert v not in _STRADDLING.vertices


def test_nothing_above_the_ground_remains() -> None:
    """Every vertex of the clipped surface sits on or below the ground."""
    ground = _flat_ground(0.0)
    result = clip_tin_by_ground_surface(_STRADDLING, ground)
    for x, y, z in result.vertices:
        gz = ground(x, y)
        assert gz is not None
        assert z <= gz + 1e-9, f"vertex ({x}, {y}, {z}) is above the ground {gz}"


def test_a_surface_below_the_ground_keeps_its_own_top_byte_identical() -> None:
    """Merelbeke: a surface entirely below ground is returned unchanged.

    Not clamped, not flattened to the ground, not re-triangulated — byte for
    byte the same surface it went in as. This is the property the owner asked
    to be compared against the old clamp for a below-ground surface.
    """
    merelbeke = TinSurface(
        vertices=[(0.0, 0.0, -8.0), (10.0, 0.0, -6.5), (0.0, 10.0, -7.2)],
        triangles=[(0, 1, 2)],
    )
    result = clip_tin_by_ground_surface(merelbeke, _flat_ground(0.0))
    assert result.vertices == merelbeke.vertices
    assert result.triangles == merelbeke.triangles


def test_a_surface_entirely_above_the_ground_becomes_empty() -> None:
    """A surface wholly above the ground is cut away to nothing."""
    above = TinSurface(
        vertices=[(0.0, 0.0, 3.0), (10.0, 0.0, 4.0), (0.0, 10.0, 5.0)],
        triangles=[(0, 1, 2)],
    )
    result = clip_tin_by_ground_surface(above, _flat_ground(0.0))
    assert result.vertices == []
    assert result.triangles == []


def test_a_nodata_ground_leaves_the_surface_unchanged() -> None:
    """Where the ground has no data there is no reliable cut — leave it alone."""
    result = clip_tin_by_ground_surface(_STRADDLING, _no_ground())
    assert result.vertices == _STRADDLING.vertices
    assert result.triangles == _STRADDLING.triangles


def test_an_empty_surface_passes_through() -> None:
    """An empty TIN clips to an empty TIN without error."""
    empty = TinSurface(vertices=[], triangles=[])
    result = clip_tin_by_ground_surface(empty, _flat_ground(0.0))
    assert result.vertices == []
    assert result.triangles == []


def test_the_kept_part_of_a_crossing_surface_still_covers_the_below_ground_area() -> None:
    """The below-ground corner of a straddling triangle survives the cut.

    The two below-ground input vertices A and C must still be present — only
    the above-ground part is removed, and the surface keeps real area (at
    least one triangle) rather than collapsing to a line.
    """
    result = clip_tin_by_ground_surface(_STRADDLING, _flat_ground(0.0))
    assert (0.0, 0.0, -2.0) in result.vertices
    assert (0.0, 10.0, -2.0) in result.vertices
    assert len(result.triangles) >= 1


def test_a_gentle_dredge_cut_matches_the_owners_canal_case() -> None:
    """Two tests keep a unit; between them a dredged canal removes it.

    A formation top runs at -1 m on the left and right but the ground (the
    dredged canal bed) dips to -4 m across the middle. The formation pokes
    above the bed only in the middle strip, so the cut removes the middle and
    leaves the two flanks — the unit is present on either side and gone under
    the canal, which is exactly the owner's worked example.
    """

    def canal_bed(x: float, y: float) -> float | None:
        # Ground is high (0 m) on the flanks, dredged to -4 m in the middle
        # strip 40 <= x <= 60 where the formation top (-1 m) pokes above it.
        return -4.0 if 40.0 <= x <= 60.0 else 0.0

    formation = TinSurface(
        vertices=[
            (0.0, 0.0, -1.0),
            (100.0, 0.0, -1.0),
            (0.0, 20.0, -1.0),
            (100.0, 20.0, -1.0),
            (50.0, 0.0, -1.0),
            (50.0, 20.0, -1.0),
        ],
        triangles=[(0, 4, 2), (4, 5, 2), (4, 1, 5), (1, 3, 5)],
    )
    result = clip_tin_by_ground_surface(formation, canal_bed)
    # Under the canal (x == 50) the formation is above the bed (-1 > -4): gone.
    assert not any(x == 50.0 for x, _y, _z in result.vertices)
    # On the flanks the formation is below ground (-1 < 0): still there.
    assert (0.0, 0.0, -1.0) in result.vertices
    assert (100.0, 0.0, -1.0) in result.vertices
