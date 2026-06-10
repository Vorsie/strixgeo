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
    """Every directed edge appears exactly once (consistent outward winding)."""
    ec: Counter = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(u, v)] += 1
    return len(triangles) > 0 and all(ct == 1 for ct in ec.values())


def ray_hits(vertices, triangles, p) -> int:
    """Count +x-ray / triangle intersections from p (Moller-Trumbore)."""
    ox, oy, oz = p
    d = (1.0, 0.0, 0.0)
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
