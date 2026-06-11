"""Unit tests for litho body assembly (shared surfaces, lens void). No DB, no I/O."""

from __future__ import annotations

from groundmodel.domain.services.litho_body_assembly import assemble_body
from groundmodel.domain.services.litho_contact_surfaces import (
    build_columns,
    enumerate_contacts,
    fit_patch_surfaces,
)
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
