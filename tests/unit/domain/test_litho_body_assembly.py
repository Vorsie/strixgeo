"""Unit tests for litho body assembly (shared surfaces, lens void). No DB, no I/O."""

from __future__ import annotations

from collections import Counter

from groundmodel.domain.services.litho_body_assembly import assemble_body
from groundmodel.domain.services.litho_contact_surfaces import (
    build_columns,
    enumerate_contacts,
    fit_patch_surfaces,
)
from groundmodel.domain.services.litho_solid_builder import BodyLayerPick


def closed_manifold(triangles) -> bool:
    """Every undirected edge appears in exactly 2 triangles."""
    ec: Counter = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[frozenset((u, v))] += 1
    return len(triangles) > 0 and all(ct == 2 for ct in ec.values())


def consistently_wound(triangles) -> bool:
    """Every directed edge appears exactly once (consistent outward winding).

    Use together with closed_manifold; this check alone does not detect
    boundary (open) edges.
    """
    ec: Counter = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(u, v)] += 1
    return len(triangles) > 0 and all(ct == 1 for ct in ec.values())


def ray_hits(vertices, triangles, p) -> int:
    """Count ray / triangle intersections from p (Moller-Trumbore)."""
    ox, oy, oz = p
    # Generic (non-axis-aligned, incommensurate) ray direction so the ray almost
    # never passes exactly through a triangle shared-edge/vertex (which would
    # double-count and flip the inside/outside parity). General-position trick.
    d = (1.0, 0.4142135623730951, 0.7320508075688772)
    eps = 1e-9
    hits = 0
    for a, b, c in triangles:
        v0, v1, v2 = vertices[a], vertices[b], vertices[c]
        e1 = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
        e2 = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])
        h = (d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0])
        det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
        if -eps < det < eps:
            continue
        inv = 1.0 / det
        s = (ox - v0[0], oy - v0[1], oz - v0[2])
        u = inv * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2])
        if u < -eps or u > 1 + eps:
            continue
        q = (s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0])
        v = inv * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2])
        if v < -eps or u + v > 1 + eps:
            continue
        t = inv * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2])
        if t > eps:
            hits += 1
    return hits


def inside(vertices, triangles, p) -> bool:
    """True iff point p is inside the closed mesh (odd crossing parity)."""
    return ray_hits(vertices, triangles, p) % 2 == 1


def _pick(inv, x, y, body, top_d, base_d, surf=0.0, fm="f"):
    return BodyLayerPick(
        investigation_id=inv,
        x_m=x,
        y_m=y,
        surface_elev_m=surf,
        body_id=body,
        formation_id=fm,
        top_depth_m=top_d,
        base_depth_m=base_d,
    )


def _two_body_stack():
    quad = [("A", 0, 0), ("B", 10, 0), ("C", 10, 10), ("D", 0, 10)]
    picks = []
    for inv, x, y in quad:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 4.0))
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    return columns, surfaces


def test_single_patch_body_is_watertight_and_shares_its_interface():
    """Stacked SAND/CLAY: each body watertight; SAND's base == CLAY's top (gap 0)."""
    columns, surfaces = _two_body_stack()
    sand = assemble_body("SAND", "f", columns, surfaces)
    clay = assemble_body("CLAY", "f", columns, surfaces)
    assert closed_manifold(sand.triangles) and consistently_wound(sand.triangles)
    assert closed_manifold(clay.triangles) and consistently_wound(clay.triangles)
    sand_base = {
        (round(x, 6), round(y, 6), round(z, 6))
        for (x, y, z) in sand.vertices
        if abs(z + 4.0) < 1e-6
    }
    clay_top = {
        (round(x, 6), round(y, 6), round(z, 6))
        for (x, y, z) in clay.vertices
        if abs(z + 4.0) < 1e-6
    }
    assert sand_base and sand_base == clay_top


def test_inside_centroid_is_inside_and_far_point_is_outside():
    """inside() correctly classifies a centroid and a distant point on a real body.

    Exercises the robust-ray path (non-axis-aligned direction) on a mesh produced
    by the full assemble_body pipeline.  SAND spans depth 0–4 over the 0..10 quad,
    so its elevation range is [0, -4] and its centroid is at (5, 5, -2).
    """
    columns, surfaces = _two_body_stack()
    sand = assemble_body("SAND", "f", columns, surfaces)
    assert sand is not None, "SAND body must assemble from the two-body stack"
    # Centroid of the SAND slab — clearly inside.
    assert inside(sand.vertices, sand.triangles, (5.0, 5.0, -2.0))
    # Well above the slab — clearly outside.
    assert not inside(sand.vertices, sand.triangles, (5.0, 5.0, 10.0))


def test_assemble_body_returns_none_for_multi_patch_top():
    """assemble_body returns None when a body has more than one distinct top-contact key.

    CLAY has SAND above on investigations A/B and PEAT above on C/D, so it has
    2 top-contact keys — the multi-patch guard must fire.
    """
    # Build a 4-hole quad where the upper body differs between the two halves.
    picks = []
    for inv, x, y, upper in [
        ("A", 0, 0, "SAND"),
        ("B", 10, 0, "SAND"),
        ("C", 10, 10, "PEAT"),
        ("D", 0, 10, "PEAT"),
    ]:
        picks.append(_pick(inv, x, y, upper, 0.0, 4.0))
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    # CLAY has ContactKey("SAND","CLAY") AND ContactKey("PEAT","CLAY") as top keys.
    assert assemble_body("CLAY", "f", columns, surfaces) is None


def test_assemble_body_returns_none_for_missing_surface():
    """assemble_body returns None when a patch has fewer than 3 holes (no TIN fitted).

    A 2-investigation column cannot triangulate; fit_patch_surfaces skips it, so the
    surface is absent in the dict and assemble_body must return None.
    """
    # Only 2 investigations — every contact patch has 2 points → no TIN.
    picks = [
        _pick("A", 0, 0, "SAND", 0.0, 4.0),
        _pick("A", 0, 0, "CLAY", 4.0, 14.0),
        _pick("B", 10, 0, "SAND", 0.0, 4.0),
        _pick("B", 10, 0, "CLAY", 4.0, 14.0),
    ]
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    assert assemble_body("SAND", "f", columns, surfaces) is None


# ---------------------------------------------------------------------------
# Task 5: detect_enclosed_lenses + merged_body_extent
# ---------------------------------------------------------------------------


def _matrix_with_lens():
    """CLAY (matrix) over a 20x20 square; SILT lens at interior holes,
    bracketed by CLAY above and below.
    """
    outer = [("A", 0, 0), ("B", 20, 0), ("C", 20, 20), ("D", 0, 20)]
    inner = [("E", 8, 10), ("F", 12, 10), ("G", 10, 8), ("H", 10, 12)]
    picks = []
    for inv, x, y in outer:  # CLAY only, full thickness
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    for inv, x, y in inner:  # CLAY / SILT / CLAY
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 8.0))
        picks.append(_pick(inv, x, y, "SILT", 8.0, 10.0))
        picks.append(_pick(inv, x, y, "CLAY", 10.0, 14.0))
    columns, _ = build_columns(picks)
    return columns


def test_detect_enclosed_lenses_finds_silt_in_clay():
    """A SILT bracketed by CLAY above+below at every hole is enclosed in CLAY."""
    from groundmodel.domain.services.litho_body_assembly import detect_enclosed_lenses

    columns = _matrix_with_lens()
    enclosed = detect_enclosed_lenses(columns)
    assert enclosed == {"SILT": "CLAY"}


def test_merged_extent_spans_first_top_to_last_base():
    """The matrix's merged extent spans across the lens (top of first to base of last)."""
    from groundmodel.domain.services.litho_body_assembly import merged_body_extent

    columns = _matrix_with_lens()
    ext = merged_body_extent("CLAY", columns)  # inv -> (top_elev, base_elev)
    assert ext["E"] == (-4.0, -14.0)  # spans across the lens
    assert ext["A"] == (-4.0, -14.0)
