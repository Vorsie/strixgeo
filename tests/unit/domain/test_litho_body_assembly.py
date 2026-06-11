"""Unit tests for litho body assembly (shared surfaces, lens void). No DB, no I/O."""

from __future__ import annotations

from groundmodel.domain.services.litho_body_assembly import assemble_body
from groundmodel.domain.services.litho_contact_surfaces import (
    build_columns,
    enumerate_contacts,
    fit_patch_surfaces,
)
from groundmodel.domain.services.tin_surface import compute_tin, evaluate_tin_at
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from tests.unit.domain.mesh_test_helpers import (
    inside,
)
from tests.unit.domain.mesh_test_helpers import (
    is_closed_manifold as closed_manifold,
)
from tests.unit.domain.mesh_test_helpers import (
    is_consistently_wound as consistently_wound,
)
from tests.unit.domain.mesh_test_helpers import (
    make_pick as _pick,
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


def test_detect_enclosed_lenses_excludes_body_through_going_somewhere():
    """SILT bracketed by CLAY at inner holes but surface-reaching at one outer hole
    must NOT be reported as an enclosed lens.

    Layout:
    - Inner holes E/F/G/H: CLAY / SILT / CLAY  (SILT is bracketed — above==below==CLAY)
    - Outer hole A:        SILT / CLAY          (SILT is at the surface, above==None,
                                                  below==CLAY → above != below)

    Because SILT touches the ground surface at hole A, it is through-going there.
    detect_enclosed_lenses must return {} — SILT is disqualified.
    """
    from groundmodel.domain.services.litho_body_assembly import detect_enclosed_lenses
    from groundmodel.domain.services.litho_contact_surfaces import LayerSpan

    # Outer hole A: SILT at surface (no body above), CLAY below.
    # Elevations are arbitrary; the function only reads body_id and list order.
    col_a = [
        LayerSpan(body_id="SILT", formation_id="silt", top_elev=0.0, base_elev=-4.0),
        LayerSpan(body_id="CLAY", formation_id="clay", top_elev=-4.0, base_elev=-14.0),
    ]
    # Inner holes E–H: CLAY / SILT / CLAY — SILT fully bracketed by the same matrix.
    col_inner = [
        LayerSpan(body_id="CLAY", formation_id="clay", top_elev=0.0, base_elev=-4.0),
        LayerSpan(body_id="SILT", formation_id="silt", top_elev=-4.0, base_elev=-6.0),
        LayerSpan(body_id="CLAY", formation_id="clay", top_elev=-6.0, base_elev=-14.0),
    ]
    columns = {
        "A": col_a,
        "E": col_inner,
        "F": col_inner,
        "G": col_inner,
        "H": col_inner,
    }
    # SILT is surface-reaching at hole A → it is NOT an enclosed lens.
    assert detect_enclosed_lenses(columns) == {}


# ---------------------------------------------------------------------------
# Task 6: build_extent_solid + append_void
# ---------------------------------------------------------------------------


def test_matrix_with_void_is_watertight_and_excludes_the_lens():
    """A matrix solid + reversed lens = watertight; parity is matrix-minus-lens."""
    from groundmodel.domain.services.litho_body_assembly import (
        append_void,
        build_extent_solid,
    )

    # CLAY matrix over a 20x20 square + interior holes; SILT lens on the 4
    # interior holes only, strictly inside the clay slab (-8..-10 within -4..-14).
    coords = {
        "A": (0.0, 0.0),
        "B": (20.0, 0.0),
        "C": (20.0, 20.0),
        "D": (0.0, 20.0),
        "E": (8.0, 10.0),
        "F": (12.0, 10.0),
        "G": (10.0, 8.0),
        "H": (10.0, 12.0),
    }
    clay_extent = {i: (-4.0, -14.0) for i in coords}
    lens_extent = {i: (-8.0, -10.0) for i in ("E", "F", "G", "H")}
    clay = build_extent_solid("CLAY", "f2", clay_extent, coords)
    lens = build_extent_solid("SILT", "f3", lens_extent, coords)
    assert clay is not None and lens is not None
    assert closed_manifold(lens.triangles) and consistently_wound(lens.triangles)
    voided = append_void(clay, lens)
    # Closed 2-manifold = outer shell + inner (void) shell.
    assert closed_manifold(voided.triangles) and consistently_wound(voided.triangles)
    # Parity is exactly "matrix minus lens".
    assert not inside(voided.vertices, voided.triangles, (10.0, 10.0, -9.0))  # in the void
    assert inside(voided.vertices, voided.triangles, (2.0, 2.0, -9.0))  # in the clay
    assert not inside(voided.vertices, voided.triangles, (2.0, 2.0, -20.0))  # below all
    # append_void is pure concatenation — no stitching geometry added.
    assert len(voided.triangles) == len(clay.triangles) + len(lens.triangles)


def test_build_extent_solid_returns_none_for_under_constrained():
    """Fewer than 3 investigations cannot form a TIN -> None."""
    from groundmodel.domain.services.litho_body_assembly import build_extent_solid

    assert (
        build_extent_solid(
            "X",
            "f",
            {"A": (0.0, -1.0), "B": (1.0, -1.0)},
            {"A": (0.0, 0.0), "B": (1.0, 0.0)},
        )
        is None
    )


# ---------------------------------------------------------------------------
# build_prism
# ---------------------------------------------------------------------------


def test_build_prism_is_watertight_over_a_region():
    """A region of plan triangles closes into a watertight prism between two fields."""
    from groundmodel.domain.services.litho_body_assembly import build_prism

    verts2d = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
    tris = [(0, 1, 2), (0, 2, 3)]
    top = {i: -2.0 for i in range(4)}
    base = {i: -6.0 for i in range(4)}
    mesh = build_prism("X", "f", verts2d, tris, top, base)
    assert closed_manifold(mesh.triangles) and consistently_wound(mesh.triangles)
    assert inside(mesh.vertices, mesh.triangles, (5.0, 5.0, -4.0))
    assert not inside(mesh.vertices, mesh.triangles, (5.0, 5.0, 0.0))


# ---------------------------------------------------------------------------
# Task 6 — assemble_facies_competitors (3-way watertight gate)
# ---------------------------------------------------------------------------


def test_facies_competitors_3way_tile_watertight():
    """CLAY/SILT/PEAT competing above a SAND tile watertight, no overlap, tops meet.

    Six investigations on a hexagonal ring, each carrying one of three upper bodies
    (CLAY, SILT, PEAT) directly above a shared SAND body.  The gate checks:
    - all three competitors are present in the result,
    - every competitor mesh is watertight and consistently wound,
    - no point in a grid of samples is claimed by two competitors simultaneously.
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
        ("A", 0, 0, "CLAY"),
        ("B", 6, 1, "CLAY"),
        ("C", 10, 6, "SILT"),
        ("D", 7, 11, "SILT"),
        ("E", 1, 10, "PEAT"),
        ("F", -3, 5, "PEAT"),
    ]
    picks = []
    for inv, x, y, up in ring:
        picks.append(_pick(inv, x, y, up, 0.0, 2.0))  # competitor above
        picks.append(_pick(inv, x, y, "SAND", 2.0, 9.0))  # shared SAND below
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    comps = assemble_facies_competitors("SAND", "above", columns, coords, surfaces)
    assert set(comps) == {"CLAY", "SILT", "PEAT"}
    meshes = list(comps.values())
    for m in meshes:
        assert closed_manifold(m.triangles), f"{m.body_id} not closed manifold"
        assert consistently_wound(m.triangles), f"{m.body_id} not consistently wound"
    for x in (0, 3, 5, 7):
        for y in (2, 5, 8):
            hits = [
                m.body_id
                for m in meshes
                if inside(m.vertices, m.triangles, (float(x), float(y), -3.0))
            ]
            assert len(hits) <= 1, f"overlap at ({x},{y},-3.0): {hits}"

    # Floor-continuity: the shared SAND top (at depth -2.0 = elevation 0 - 2.0)
    # must be single-valued at every labelled hole — i.e. the base_tin used by
    # assemble_facies_competitors interpolates exactly the hole's floor elevation.
    # Rebuild base_tin the same way assemble_facies_competitors does: from each
    # labelled hole's shared-body top_elev (SAND.top_elev = elevation at depth 2.0).
    shared_top_elev = -2.0  # SAND starts at depth 2.0 → elevation = -2.0
    holes = sorted(coords)
    base_tin = compute_tin(
        [
            ContactPoint3D(
                contact_id=h,
                x_m=coords[h][0],
                y_m=coords[h][1],
                elevation_m=shared_top_elev,
            )
            for h in holes
        ]
    )
    for h in holes:
        hx, hy = coords[h]
        z = evaluate_tin_at(base_tin, hx, hy)
        assert z is not None, f"base_tin gave None at labelled hole {h}"
        assert abs(z - shared_top_elev) < 1e-6, (
            f"floor not single-valued at hole {h}: got {z}, expected {shared_top_elev}"
        )


def test_facies_competitors_2way_watertight_no_overlap():
    """CLAY and PEAT competing above SAND on a 4-hole square: both watertight, no overlap.

    Two competitors on a minimal (4-investigation) ring that still triangulates.
    Verifies the 2-way midpoint path in assemble_facies_competitors.
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
        ("A", 0, 0, "CLAY"),
        ("B", 8, 0, "CLAY"),
        ("C", 8, 10, "PEAT"),
        ("D", 0, 10, "PEAT"),
    ]
    picks = []
    for inv, x, y, up in ring:
        picks.append(_pick(inv, x, y, up, 0.0, 3.0))
        picks.append(_pick(inv, x, y, "SAND", 3.0, 10.0))
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    comps = assemble_facies_competitors("SAND", "above", columns, coords, surfaces)
    assert set(comps) == {"CLAY", "PEAT"}
    meshes = list(comps.values())
    for m in meshes:
        assert closed_manifold(m.triangles), f"{m.body_id} not closed manifold"
        assert consistently_wound(m.triangles), f"{m.body_id} not consistently wound"
    for x in (1, 4, 7):
        for y in (2, 5, 8):
            hits = [
                m.body_id
                for m in meshes
                if inside(m.vertices, m.triangles, (float(x), float(y), -5.0))
            ]
            assert len(hits) <= 1, f"overlap at ({x},{y},-5.0): {hits}"


def test_facies_competitors_below_watertight_no_overlap():
    """SILT and GRAVEL competing below SAND: both watertight, no overlap.

    Exercises the ``side="below"`` path: competitors are directly below the shared
    SAND body.  Sanity-checks the per-hole index walk uses ``i + 1`` correctly.
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
        ("A", 0, 0, "SILT"),
        ("B", 8, 0, "SILT"),
        ("C", 8, 10, "GRAVEL"),
        ("D", 0, 10, "GRAVEL"),
    ]
    picks = []
    for inv, x, y, lo in ring:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 4.0))  # shared SAND above
        picks.append(_pick(inv, x, y, lo, 4.0, 12.0))  # competitor below
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    comps = assemble_facies_competitors("SAND", "below", columns, coords, surfaces)
    assert set(comps) == {"SILT", "GRAVEL"}
    meshes = list(comps.values())
    for m in meshes:
        assert closed_manifold(m.triangles), f"{m.body_id} not closed manifold"
        assert consistently_wound(m.triangles), f"{m.body_id} not consistently wound"
    for x in (1, 4, 7):
        for y in (2, 5, 8):
            hits = [
                m.body_id
                for m in meshes
                if inside(m.vertices, m.triangles, (float(x), float(y), -8.0))
            ]
            assert len(hits) <= 1, f"overlap at ({x},{y},-8.0): {hits}"


def test_facies_competitors_above_and_below_shared_body():
    """A shared MID body has 2 competitors above AND 2 below: both sides tile, no overlap.

    Six investigations on a hexagonal ring.  Each hole carries a three-layer stack:
    - Upper competitor (CLAY on A/B/C, SILT on D/E/F), depth 0–2
    - Shared MID body, depth 2–7
    - Lower competitor (ZAND on A/B/C, VEEN on D/E/F), depth 7–12

    Both ``assemble_facies_competitors("MID", "above", ...)`` and ``("MID", "below", ...)``
    must return ≥2 competitors each; every mesh must be watertight + consistently wound;
    within each side no sampled point may be claimed by two competitors simultaneously.
    """
    from groundmodel.domain.services.litho_body_assembly import (
        assemble_facies_competitors,
    )
    from groundmodel.domain.services.litho_contact_surfaces import (
        build_columns,
        enumerate_contacts,
        fit_patch_surfaces,
    )

    # Hexagonal ring — 6 holes, non-collinear, split in half for the two competitors.
    ring = [
        ("A", 0, 0),
        ("B", 6, 1),
        ("C", 10, 6),
        ("D", 7, 11),
        ("E", 1, 10),
        ("F", -3, 5),
    ]
    # A/B/C → CLAY above, ZAND below; D/E/F → SILT above, VEEN below.
    picks = []
    for inv, x, y in ring:
        upper = "CLAY" if inv in ("A", "B", "C") else "SILT"
        lower = "ZAND" if inv in ("A", "B", "C") else "VEEN"
        picks.append(_pick(inv, x, y, upper, 0.0, 2.0))  # upper competitor
        picks.append(_pick(inv, x, y, "MID", 2.0, 7.0))  # shared MID body
        picks.append(_pick(inv, x, y, lower, 7.0, 12.0))  # lower competitor

    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))

    above = assemble_facies_competitors("MID", "above", columns, coords, surfaces)
    below = assemble_facies_competitors("MID", "below", columns, coords, surfaces)

    # Each side must return 2 distinct competitors.
    assert len(above) >= 2, f"expected ≥2 above competitors, got {set(above)}"
    assert len(below) >= 2, f"expected ≥2 below competitors, got {set(below)}"
    assert set(above) == {"CLAY", "SILT"}
    assert set(below) == {"ZAND", "VEEN"}

    # Every mesh is watertight and consistently wound.
    for side_name, comp_dict in (("above", above), ("below", below)):
        for comp_id, m in comp_dict.items():
            assert closed_manifold(m.triangles), (
                f"{side_name} competitor {comp_id} is not a closed manifold"
            )
            assert consistently_wound(m.triangles), (
                f"{side_name} competitor {comp_id} is not consistently wound"
            )

    # Within each side: no sampled point is inside two competitors.
    # Sample at z = -1.0 (inside the upper competitor slab, depth 0–2 → elev 0..-2)
    above_meshes = list(above.values())
    for x in (0, 3, 5, 7):
        for y in (2, 5, 8):
            hits = [
                m.body_id
                for m in above_meshes
                if inside(m.vertices, m.triangles, (float(x), float(y), -1.0))
            ]
            assert len(hits) <= 1, f"above overlap at ({x},{y},-1.0): {hits}"

    # Sample at z = -9.0 (inside the lower competitor slab, depth 7–12 → elev -7..-12)
    below_meshes = list(below.values())
    for x in (0, 3, 5, 7):
        for y in (2, 5, 8):
            hits = [
                m.body_id
                for m in below_meshes
                if inside(m.vertices, m.triangles, (float(x), float(y), -9.0))
            ]
            assert len(hits) <= 1, f"below overlap at ({x},{y},-9.0): {hits}"


def test_facies_competitors_obtuse_triangle_junction_stays_watertight():
    """A 3-way facies competition over a strongly-obtuse footprint triangle stays watertight.

    Three of the footprint holes are placed nearly collinear so at least one
    Delaunay triangle is strongly obtuse — its circumcenter falls OUTSIDE the
    triangle and ``circumcenter`` must clamp it back inside via barycentric
    coordinates.  This exercises the clamp path that a well-shaped (acute) ring
    never hits.  The gate: every competitor mesh is watertight + consistently
    wound, and no sampled point is claimed by two competitors at once.
    """
    from groundmodel.domain.services.litho_body_assembly import (
        assemble_facies_competitors,
    )
    from groundmodel.domain.services.litho_contact_surfaces import (
        build_columns,
        enumerate_contacts,
        fit_patch_surfaces,
    )

    # A very flat, wide footprint with a central hole forces Delaunay to emit
    # strongly-obtuse triangles whose circumcenter lies OUTSIDE the triangle
    # (verified: triangles B·E·A and D·E·C each have a raw circumcenter at
    # barycentric min ≈ -49 → the clamp fires).  Labels are chosen so each obtuse
    # triangle carries three DISTINCT competitor labels, so the 3-way Voronoi
    # circumcenter junction (the clamped point) is actually computed:
    #   B·E·A = SILT·PEAT·CLAY  and  D·E·C = SILT·PEAT·CLAY.
    ring = [
        ("A", 0.0, 0.0, "CLAY"),
        ("B", 30.0, 0.0, "SILT"),
        ("C", 30.0, 3.0, "CLAY"),
        ("D", 0.0, 3.0, "SILT"),
        ("E", 15.0, 1.5, "PEAT"),
    ]
    picks = []
    for inv, x, y, up in ring:
        picks.append(_pick(inv, x, y, up, 0.0, 2.0))  # competitor above
        picks.append(_pick(inv, x, y, "SAND", 2.0, 9.0))  # shared SAND below
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    comps = assemble_facies_competitors("SAND", "above", columns, coords, surfaces)
    assert set(comps) == {"CLAY", "SILT", "PEAT"}
    meshes = list(comps.values())
    for m in meshes:
        assert closed_manifold(m.triangles), f"{m.body_id} not closed manifold"
        assert consistently_wound(m.triangles), f"{m.body_id} not consistently wound"
    # No sampled point inside two competitors at once (z = -1.0 is inside the
    # competitor slab, depth 0–2 → elevation 0..-2).
    for x in (3, 9, 15, 21, 27):
        for y in (0.5, 1.5, 2.5):
            hits = [
                m.body_id
                for m in meshes
                if inside(m.vertices, m.triangles, (float(x), float(y), -1.0))
            ]
            assert len(hits) <= 1, f"overlap at ({x},{y},-1.0): {hits}"
