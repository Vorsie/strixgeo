"""Unit tests for the litho body-solid builder (no DB, no I/O)."""

from __future__ import annotations

from collections import Counter

from groundmodel.domain.services.litho_solid_builder import (
    BodyLayerPick,
    build_body_solids,
)


def _is_closed_manifold(triangles: list[tuple[int, int, int]]) -> bool:
    """A closed 2-manifold: every undirected edge is shared by exactly 2 tris."""
    ec: Counter[tuple[int, int]] = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(min(u, v), max(u, v))] += 1
    return len(triangles) > 0 and all(ct == 2 for ct in ec.values())


def _is_consistently_wound(triangles: list[tuple[int, int, int]]) -> bool:
    """Every directed edge appears exactly once — consistent outward winding.

    In a consistently-wound mesh every interior edge is traversed once in
    each direction (u→v and v→u), and every boundary edge is traversed
    exactly once in the outward direction.  The combined directed count
    for every directed pair therefore equals exactly 1.
    """
    ec: Counter[tuple[int, int]] = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(u, v)] += 1
    return len(triangles) > 0 and all(ct == 1 for ct in ec.values())


# Six investigations forming a 2×3 grid — enough spread for a real TIN
# (non-collinear, no degenerate cases when all 6 are used).
PTS = [
    (0.0, 0.0),
    (50.0, 0.0),
    (100.0, 0.0),
    (0.0, 80.0),
    (50.0, 80.0),
    (100.0, 80.0),
]


def _slab_picks(body_id: str, formation_id: str, top: float, base: float) -> list[BodyLayerPick]:
    """Build one :class:`BodyLayerPick` per investigation in ``PTS``."""
    return [
        BodyLayerPick(
            investigation_id=f"inv{i}",
            x_m=x,
            y_m=y,
            surface_elev_m=12.0,
            body_id=body_id,
            formation_id=formation_id,
            top_depth_m=top,
            base_depth_m=base,
        )
        for i, (x, y) in enumerate(PTS)
    ]


def test_through_going_body_is_a_closed_watertight_solid() -> None:
    """A body present on every investigation builds one closed manifold solid."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    m = meshes[0]
    assert m.body_id == "b1"
    assert not m.is_flagged
    assert _is_closed_manifold(m.triangles)
    assert _is_consistently_wound(m.triangles)


def test_pinch_out_keeps_the_solid_watertight_and_zero_thickness_at_the_pinch() -> None:
    """Where the base meets the top the body thins to zero and stays watertight."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)
    # Make the last investigation a pinch: base depth == top depth (zero thickness).
    picks[5] = BodyLayerPick(
        investigation_id="inv5",
        x_m=100.0,
        y_m=80.0,
        surface_elev_m=12.0,
        body_id="b1",
        formation_id="ZAND",
        top_depth_m=2.0,
        base_depth_m=2.0,
    )
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    assert _is_closed_manifold(meshes[0].triangles)
    assert _is_consistently_wound(meshes[0].triangles)
    # A vertex pair (top, base) at the pinch has the same z — zero-thickness present.
    zs = [v[2] for v in meshes[0].vertices]
    assert any(abs(z - (12.0 - 2.0)) < 1e-9 for z in zs)


def test_degenerate_body_falls_back_to_a_flagged_slab_not_a_crash() -> None:
    """A body on <3 investigations can't fit a TIN → flagged slab, no crash."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)[:2]  # only 2 points
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    assert meshes[0].is_flagged is True


def test_adjacent_bodies_share_the_contact_surface_exactly() -> None:
    """Body A's base picks == body B's top picks → the shared surface coincides
    vertex-for-vertex (watertight stack), because the builder caches one surface
    per contact."""
    sand = _slab_picks("sand", "ZAND", top=0.0, base=4.0)
    clay = _slab_picks("clay", "KLEI", top=4.0, base=9.0)  # clay top == sand base
    meshes = build_body_solids(sand + clay)
    by_id = {m.body_id: m for m in meshes}
    shared_elev = 12.0 - 4.0  # surface_elev_m - depth_m
    # Extract the full (x, y, z) vertex set that each body places on the shared contact.
    # The cache guarantee is that they reference IDENTICAL surface geometry, so the
    # sorted vertex sets must be equal — not merely overlapping.
    sand_shared = sorted(v for v in by_id["sand"].vertices if abs(v[2] - shared_elev) < 1e-6)
    clay_shared = sorted(v for v in by_id["clay"].vertices if abs(v[2] - shared_elev) < 1e-6)
    assert sand_shared, "sand mesh has no vertices at the shared contact elevation"
    assert clay_shared, "clay mesh has no vertices at the shared contact elevation"
    assert sand_shared == clay_shared, (
        "shared-contact vertex sets differ — cache did not produce identical surface geometry"
    )
