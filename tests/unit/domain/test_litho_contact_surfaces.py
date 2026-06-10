"""Unit tests for build_columns / LayerSpan (no DB, no I/O)."""

from __future__ import annotations

from groundmodel.domain.services.litho_contact_surfaces import (
    ContactKey,
    build_columns,
    enumerate_contacts,
    fit_patch_surfaces,
)
from tests.unit.domain.mesh_test_helpers import make_pick as _pick


def test_build_columns_sorts_shallow_to_deep_and_keeps_coords():
    """Single investigation: spans sorted shallowest-first; coords and elevations correct."""
    picks = [
        _pick("A", 1.0, 2.0, "CLAY", 4.0, 14.0),
        _pick("A", 1.0, 2.0, "SAND", 0.0, 4.0),  # shallower, given out of order
    ]
    columns, coords = build_columns(picks)
    assert coords["A"] == (1.0, 2.0)
    spans = columns["A"]
    assert [s.body_id for s in spans] == ["SAND", "CLAY"]  # shallow first
    # elevation = surface_elev - depth
    assert spans[0].top_elev == 0.0 and spans[0].base_elev == -4.0
    assert spans[1].top_elev == -4.0 and spans[1].base_elev == -14.0


def test_build_columns_groups_multiple_investigations_independently():
    """Two investigations produce two separate, correctly-sorted column lists."""
    picks = [
        _pick("A", 1.0, 2.0, "CLAY", 4.0, 14.0),
        _pick("A", 1.0, 2.0, "SAND", 0.0, 4.0),
        _pick("B", 5.0, 6.0, "PEAT", 2.0, 5.0),
        _pick("B", 5.0, 6.0, "SAND", 0.0, 2.0),
    ]
    columns, coords = build_columns(picks)

    # Both investigations present with correct coords
    assert set(columns.keys()) == {"A", "B"}
    assert coords["A"] == (1.0, 2.0)
    assert coords["B"] == (5.0, 6.0)

    # Investigation A: SAND (shallower) before CLAY (deeper)
    a_bodies = [s.body_id for s in columns["A"]]
    assert a_bodies == ["SAND", "CLAY"]

    # Investigation B: SAND (0–2 m) before PEAT (2–5 m), shallowest first
    b_bodies = [s.body_id for s in columns["B"]]
    assert b_bodies == ["SAND", "PEAT"]
    assert columns["B"][0].top_elev == 0.0 and columns["B"][0].base_elev == -2.0
    assert columns["B"][1].top_elev == -2.0 and columns["B"][1].base_elev == -5.0


def test_enumerate_contacts_keys_by_ordered_pair_and_free_surfaces():
    """Internal interfaces key by (upper, lower); free ground/base use ''."""

    picks = [
        _pick("A", 0.0, 0.0, "SAND", 0.0, 4.0),
        _pick("A", 0.0, 0.0, "CLAY", 4.0, 14.0),
    ]
    columns, coords = build_columns(picks)
    contacts = enumerate_contacts(columns, coords)
    # internal SAND/CLAY interface at elev -4
    pts = contacts[ContactKey("SAND", "CLAY")]
    assert len(pts) == 1 and pts[0].elev == -4.0 and pts[0].x == 0.0
    # free ground above SAND at elev 0, free base below CLAY at elev -14
    assert contacts[ContactKey("", "SAND")][0].elev == 0.0
    assert contacts[ContactKey("CLAY", "")][0].elev == -14.0


def test_enumerate_contacts_same_key_accumulates_across_investigations():
    """Two investigations both with SAND-over-CLAY → ContactKey("SAND","CLAY") has 2 points.

    This proves setdefault accumulates rather than overwrites; the shared-surface
    design depends on collecting one point per investigation into a single patch.
    """
    picks = [
        _pick("A", 0.0, 0.0, "SAND", 0.0, 5.0),
        _pick("A", 0.0, 0.0, "CLAY", 5.0, 15.0),
        _pick("B", 10.0, 0.0, "SAND", 0.0, 5.0),
        _pick("B", 10.0, 0.0, "CLAY", 5.0, 15.0),
    ]
    columns, coords = build_columns(picks)
    contacts = enumerate_contacts(columns, coords)

    pts = contacts[ContactKey("SAND", "CLAY")]
    assert len(pts) == 2, "Both investigations must contribute a point to the shared patch"
    inv_ids = {p.inv_id for p in pts}
    assert inv_ids == {"A", "B"}


def test_enumerate_contacts_three_layer_stack_produces_correct_internal_keys():
    """One column SAND/SILT/CLAY → two distinct internal keys at the correct elevations.

    Also verifies the ground cap ("", "SAND") and base cap ("CLAY", "") are present.
    """
    picks = [
        _pick("A", 1.0, 2.0, "SAND", 0.0, 3.0),
        _pick("A", 1.0, 2.0, "SILT", 3.0, 8.0),
        _pick("A", 1.0, 2.0, "CLAY", 8.0, 20.0),
    ]
    columns, coords = build_columns(picks)
    contacts = enumerate_contacts(columns, coords)

    # Two internal interfaces at the expected elevations
    sand_silt = contacts[ContactKey("SAND", "SILT")]
    assert len(sand_silt) == 1 and sand_silt[0].elev == -3.0  # surface 0 - depth 3

    silt_clay = contacts[ContactKey("SILT", "CLAY")]
    assert len(silt_clay) == 1 and silt_clay[0].elev == -8.0  # surface 0 - depth 8

    # Free caps
    assert contacts[ContactKey("", "SAND")][0].elev == 0.0
    assert contacts[ContactKey("CLAY", "")][0].elev == -20.0

    # No spurious short-circuit key (SAND directly above CLAY should not exist)
    assert ContactKey("SAND", "CLAY") not in contacts


def test_fit_patch_surfaces_skips_under_constrained_patches():
    """A contact patch with only 2 investigation points is absent from the result.

    Under-constrained patches (< 3 holes) cannot form a TIN triangle; the
    assembler treats them as disk-marker fallback bodies and must not receive a
    surface.  Regression guard: lowering the threshold to < 2 would silently
    pass a collinear/degenerate surface to the assembler.
    """
    # Two investigations, each with SAND-over-CLAY → the SAND/CLAY patch has
    # exactly 2 points and must be skipped.
    picks = [
        _pick("A", 0.0, 0.0, "SAND", 0.0, 5.0),
        _pick("A", 0.0, 0.0, "CLAY", 5.0, 15.0),
        _pick("B", 10.0, 0.0, "SAND", 0.0, 5.0),
        _pick("B", 10.0, 0.0, "CLAY", 5.0, 15.0),
    ]
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))

    # The shared SAND/CLAY interior patch has 2 points → must not appear
    assert ContactKey("SAND", "CLAY") not in surfaces, (
        "Under-constrained patch (2 points) must be absent from fit_patch_surfaces result"
    )


def test_fit_patch_surfaces_uses_only_patch_holes_and_sorts_by_inv():
    """Each patch is a TIN over only its own (inv-sorted) holes."""
    # SAND over CLAY on a non-collinear quad.
    quad = [("A", 0, 0), ("B", 10, 0), ("C", 10, 10), ("D", 0, 10)]
    picks = []
    for inv, x, y in quad:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 4.0))
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    verts, tris = surfaces[ContactKey("SAND", "CLAY")]
    assert len(verts) == 4 and len(tris) >= 2
    # the contact sits at elev -4 everywhere
    assert [round(v[2], 3) for v in verts] == [-4.0, -4.0, -4.0, -4.0]
