"""Negative-case coverage for the strat-builder invariant helpers.

The watertightness contract of the strat builder is *proved* by the assertions
in ``strat_invariants.py`` — but an assertion that never fires proves nothing.
These tests feed each helper a deliberately-BROKEN input and assert it raises,
so a future refactor that silently disarms an invariant is caught here.

The ``assert_model_matches_columns`` tests are built around REAL-DATA-SHAPED
fixtures (interbedded ZAND/SILT/ZAND/SILT, dipping contacts, genuine pinch-out
corridors) because the loft builder's failure mode — 50 m-scale overlaps that
passed because the layer-cake test fixtures could never trigger them — must not
repeat.  The overlap test is named explicitly: it is the EXACT class of defect
the old loft builder had.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh

from .strat_invariants import (
    AuthoredColumn,
    AuthoredUnit,
    assert_closed_manifold,
    assert_model_matches_columns,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

# ---------------------------------------------------------------------------
# Shared box builder
# ---------------------------------------------------------------------------

# Outward winding (CCW seen from outside) for each of the 6 faces of an
# axis-aligned box whose vertices are indexed as:
#   0=(x0,y0,z0)  1=(x1,y0,z0)  2=(x1,y1,z0)  3=(x0,y1,z0)
#   4=(x0,y0,z1)  5=(x1,y0,z1)  6=(x1,y1,z1)  7=(x0,y1,z1)
_BOX_TRIS: list[tuple[int, int, int]] = [
    (0, 2, 1),
    (0, 3, 2),  # bottom (-z)
    (4, 5, 6),
    (4, 6, 7),  # top (+z)
    (0, 1, 5),
    (0, 5, 4),  # front (-y)
    (3, 7, 6),
    (3, 6, 2),  # back (+y)
    (0, 4, 7),
    (0, 7, 3),  # left (-x)
    (1, 2, 6),
    (1, 6, 5),  # right (+x)
]


def _box_mesh(
    body_id: str,
    formation_id: str,
    x0: float,
    x1: float,
    y0: float,
    y1: float,
    z_base: float,
    z_top: float,
) -> LithoBodyMesh:
    """Build a closed outward-wound 12-triangle axis-aligned box mesh.

    The box spans ``[x0, x1] × [y0, y1] × [z_base, z_top]``.  A vertical ray
    through any interior ``(x, y)`` returns exactly one interval
    ``(z_base, z_top)`` via :func:`vertical_ray_intervals`.

    The winding is consistent outward (CCW from outside), so
    :func:`assert_closed_manifold` passes on the result.

    Parameters
    ----------
    body_id : str
        The body identifier.
    formation_id : str
        The formation (soil type) identifier.
    x0, x1 : float
        Horizontal extent in the x-direction.
    y0, y1 : float
        Horizontal extent in the y-direction.
    z_base, z_top : float
        Vertical extent; ``z_base < z_top`` (base is lower, top is higher in
        elevation).

    Returns
    -------
    LithoBodyMesh
        A closed, winding-consistent 12-triangle box.
    """
    verts = [
        (x0, y0, z_base),  # 0
        (x1, y0, z_base),  # 1
        (x1, y1, z_base),  # 2
        (x0, y1, z_base),  # 3
        (x0, y0, z_top),  # 4
        (x1, y0, z_top),  # 5
        (x1, y1, z_top),  # 6
        (x0, y1, z_top),  # 7
    ]
    return LithoBodyMesh(
        body_id=body_id,
        formation_id=formation_id,
        vertices=verts,
        triangles=list(_BOX_TRIS),
        is_flagged=False,
    )


# A standard 10 × 10 m footprint shared by most tests, centred at (5, 5).
_X0, _X1 = 0.0, 10.0
_Y0, _Y1 = 0.0, 10.0
# Interior sample point used for ray-casting (inside the 10 × 10 footprint).
_MID_X, _MID_Y = 5.0, 5.0


# ---------------------------------------------------------------------------
# assert_closed_manifold
# ---------------------------------------------------------------------------


def test_closed_manifold_passes_on_a_well_formed_box():
    """A correctly-wound closed box satisfies the manifold contract."""
    mesh = _box_mesh("b", "F", _X0, _X1, _Y0, _Y1, -10.0, 0.0)
    assert_closed_manifold(mesh.vertices, mesh.triangles)  # must NOT raise


def test_open_box_missing_one_face_fails_closed_manifold():
    """Removing one triangle leaves boundary edges shared by only 1 triangle."""
    mesh = _box_mesh("b", "F", _X0, _X1, _Y0, _Y1, -10.0, 0.0)
    open_tris = mesh.triangles[:-1]  # drop the last right-face triangle
    with pytest.raises(AssertionError, match="closed manifold"):
        assert_closed_manifold(mesh.vertices, open_tris)


def test_inconsistent_winding_fails_closed_manifold():
    """Flipping one triangle's winding makes a directed edge appear twice."""
    mesh = _box_mesh("b", "F", _X0, _X1, _Y0, _Y1, -10.0, 0.0)
    bad = list(mesh.triangles)
    a, b, c = bad[0]
    bad[0] = (a, c, b)  # reverse just the first triangle
    with pytest.raises(AssertionError, match="winding"):
        assert_closed_manifold(mesh.vertices, bad)


# ---------------------------------------------------------------------------
# vertical_ray_intervals
# ---------------------------------------------------------------------------


def test_vertical_ray_returns_the_box_interval():
    """A ray through the interior of a box returns exactly one (base, top) interval."""
    mesh = _box_mesh("b", "F", _X0, _X1, _Y0, _Y1, -8.0, -2.0)
    intervals = vertical_ray_intervals(mesh.vertices, mesh.triangles, _MID_X, _MID_Y)
    assert len(intervals) == 1
    base, top = intervals[0]
    assert base == pytest.approx(-8.0)
    assert top == pytest.approx(-2.0)


def test_vertical_ray_misses_outside_the_footprint():
    """A ray outside the box footprint returns no intervals."""
    mesh = _box_mesh("b", "F", _X0, _X1, _Y0, _Y1, -8.0, -2.0)
    assert vertical_ray_intervals(mesh.vertices, mesh.triangles, 50.0, 50.0) == []


# ---------------------------------------------------------------------------
# assert_no_overlap_sampled
# ---------------------------------------------------------------------------


def test_no_overlap_passes_for_stacked_disjoint_bodies():
    """Two vertically disjoint bodies (touching faces) do not overlap."""
    upper = _box_mesh("b-up", "ZAND", _X0, _X1, _Y0, _Y1, -5.0, 0.0)
    lower = _box_mesh("b-lo", "KLEI", _X0, _X1, _Y0, _Y1, -10.0, -5.0)
    assert_no_overlap_sampled([upper, lower], [(_MID_X, _MID_Y)])  # must NOT raise


def test_no_overlap_fires_on_interpenetrating_bodies():
    """Two bodies sharing a vertical span fire the no-overlap assertion.

    This is the EXACT class of defect the old loft builder had — bodies were
    assigned to wrong z-stacks, producing overlaps of 50 m or more.  This test
    would have caught it immediately.
    """
    a = _box_mesh("b-a", "ZAND", _X0, _X1, _Y0, _Y1, -6.0, 0.0)
    b = _box_mesh("b-b", "KLEI", _X0, _X1, _Y0, _Y1, -10.0, -3.0)  # overlaps a on [-6, -3]
    with pytest.raises(AssertionError, match="overlap"):
        assert_no_overlap_sampled([a, b], [(_MID_X, _MID_Y)])


# ---------------------------------------------------------------------------
# _box_mesh winding sanity
# ---------------------------------------------------------------------------


def test_box_mesh_winding_is_consistent():
    """The _box_mesh helper produces a closed outward-wound mesh.

    This is a meta-test: it verifies the fixture builder itself before we rely
    on it in the assert_model_matches_columns tests below.  A wrong winding in
    _box_mesh would make vertical_ray_intervals return [] everywhere, silently
    passing all column-diff tests.
    """
    mesh = _box_mesh("b", "ZAND", _X0, _X1, _Y0, _Y1, -5.0, 0.0)
    assert_closed_manifold(mesh.vertices, mesh.triangles)
    ivs = vertical_ray_intervals(mesh.vertices, mesh.triangles, _MID_X, _MID_Y)
    assert len(ivs) == 1
    assert ivs[0] == pytest.approx((-5.0, 0.0))


# ---------------------------------------------------------------------------
# assert_model_matches_columns — helpers for building columns
# ---------------------------------------------------------------------------


def _col(
    x: float,
    y: float,
    *units: tuple[str, float, float],
) -> AuthoredColumn:
    """Build an :class:`AuthoredColumn` from (formation_id, top_elev, base_elev) tuples."""
    return AuthoredColumn(
        x=x,
        y=y,
        units=tuple(
            AuthoredUnit(formation_id=fid, top_elev_m=top, base_elev_m=base)
            for fid, top, base in units
        ),
    )


# ---------------------------------------------------------------------------
# assert_model_matches_columns — PASSES (correct models)
# ---------------------------------------------------------------------------


def test_column_diff_passes_for_simple_two_layer_model():
    """A simple ZAND-over-KLEI two-body model matches its authored column exactly."""
    zand = _box_mesh("b-zand", "ZAND", _X0, _X1, _Y0, _Y1, -5.0, 0.0)
    klei = _box_mesh("b-klei", "KLEI", _X0, _X1, _Y0, _Y1, -10.0, -5.0)
    col = _col(_MID_X, _MID_Y, ("ZAND", 0.0, -5.0), ("KLEI", -5.0, -10.0))
    assert_model_matches_columns([zand, klei], [col], tol_m=0.01)  # must NOT raise


def test_column_diff_passes_for_interbedded_sequence():
    """An interbedded ZAND/SILT/ZAND/SILT model (real-data-shaped) passes the diff.

    This is the canonical real-data fixture: four bodies with alternating soil
    types, each a hand-built box at known z-intervals.  The authored column
    lists them top→bottom with the exact base elevations the boxes have.
    """
    z_top = _box_mesh("b-z1", "ZAND", _X0, _X1, _Y0, _Y1, -2.0, 0.0)
    s_top = _box_mesh("b-s1", "SILT", _X0, _X1, _Y0, _Y1, -4.0, -2.0)
    z_bot = _box_mesh("b-z2", "ZAND", _X0, _X1, _Y0, _Y1, -7.0, -4.0)
    s_bot = _box_mesh("b-s2", "SILT", _X0, _X1, _Y0, _Y1, -10.0, -7.0)
    col = _col(
        _MID_X,
        _MID_Y,
        ("ZAND", 0.0, -2.0),
        ("SILT", -2.0, -4.0),
        ("ZAND", -4.0, -7.0),
        ("SILT", -7.0, -10.0),
    )
    assert_model_matches_columns([z_top, s_top, z_bot, s_bot], [col], tol_m=0.01)


def test_column_diff_passes_when_body_pinches_out_at_column():
    """A body absent at a column (pinch-out) does not trigger the diff.

    The SILT body exists only at x∈[0,10] and pinches out to the right.
    At the right column (x=15) only ZAND is present; the authored column there
    lists only ZAND, so the diff must pass.

    The ZAND body at the central column is split into upper (0→-3) and lower
    (-6→-10) halves framing the SILT, as the strat builder would produce it
    (a lens in a matrix is carved, leaving two ZAND intervals at that column).
    The ZAND to the right is a separate full-depth body that covers x∈[10,20].
    """
    # Left ZAND upper half (above SILT) — covers x∈[0,10].
    zand_upper = _box_mesh("b-zu", "ZAND", _X0, _X1, _Y0, _Y1, -3.0, 0.0)
    # Left ZAND lower half (below SILT) — covers x∈[0,10].
    zand_lower = _box_mesh("b-zl", "ZAND", _X0, _X1, _Y0, _Y1, -10.0, -6.0)
    # SILT lens exists only at x∈[0,10].
    silt = _box_mesh("b-silt", "SILT", _X0, _X1, _Y0, _Y1, -6.0, -3.0)
    # Right ZAND full-depth body — covers x∈[10,20].
    zand_right = _box_mesh("b-zr", "ZAND", 10.0, 20.0, _Y0, _Y1, -10.0, 0.0)

    # Column at x=5: ZAND(0→-3) / SILT(-3→-6) / ZAND(-6→-10).
    col_with_silt = _col(
        _MID_X, _MID_Y, ("ZAND", 0.0, -3.0), ("SILT", -3.0, -6.0), ("ZAND", -6.0, -10.0)
    )
    # Column at x=15: only ZAND in the authored stack (SILT body absent here).
    col_without_silt = _col(15.0, _MID_Y, ("ZAND", 0.0, -10.0))

    assert_model_matches_columns(
        [zand_upper, zand_lower, silt, zand_right],
        [col_with_silt, col_without_silt],
        tol_m=0.01,
    )  # must NOT raise


def test_column_diff_tolerates_same_formation_mesh_seam():
    """Two adjacent intervals of the same formation are collapsed before comparing.

    A lofter might emit two back-to-back ZAND intervals at a column (a seam
    between two section slices); the authored column shows one ZAND unit.  The
    collapse rule merges them so the sequence comparison is ZAND = ZAND.
    """
    # Two touching ZAND boxes that together cover the authored ZAND unit.
    zand_upper = _box_mesh("b-zu", "ZAND", _X0, _X1, _Y0, _Y1, -3.0, 0.0)
    zand_lower = _box_mesh("b-zl", "ZAND", _X0, _X1, _Y0, _Y1, -6.0, -3.0)
    klei = _box_mesh("b-k", "KLEI", _X0, _X1, _Y0, _Y1, -10.0, -6.0)
    # Authored column sees one ZAND unit (from 0 to -6) and one KLEI.
    col = _col(_MID_X, _MID_Y, ("ZAND", 0.0, -6.0), ("KLEI", -6.0, -10.0))
    assert_model_matches_columns([zand_upper, zand_lower, klei], [col], tol_m=0.01)


# ---------------------------------------------------------------------------
# assert_model_matches_columns — FIRES (broken models)
# ---------------------------------------------------------------------------


def test_column_diff_fires_on_overlap_between_bodies():
    """Two overlapping bodies at a column fire the section-column diff.

    This is the EXACT failure the old loft builder had: bodies were assigned
    to the wrong z-stacks, producing metre-scale (or tens-of-metres-scale)
    overlaps.  The assertion must fire with a diagnostic mentioning 'overlap'.
    """
    # ZAND spans -6 to 0; KLEI spans -10 to -3 — they overlap on [-6, -3].
    zand = _box_mesh("b-zand", "ZAND", _X0, _X1, _Y0, _Y1, -6.0, 0.0)
    klei = _box_mesh("b-klei", "KLEI", _X0, _X1, _Y0, _Y1, -10.0, -3.0)
    col = _col(_MID_X, _MID_Y, ("ZAND", 0.0, -6.0), ("KLEI", -6.0, -10.0))
    with pytest.raises(AssertionError, match="overlap"):
        assert_model_matches_columns([zand, klei], [col], tol_m=0.01)


def test_column_diff_fires_on_wrong_formation_order():
    """A model with KLEI above ZAND (reversed stratigraphy) fires the diff.

    The authored column has ZAND on top, KLEI below — the geologically expected
    sequence for a young sand over an older clay.  A body assembly bug that
    assigns the KLEI body to the upper interval and ZAND to the lower must fire
    this assertion, naming the sequence mismatch.
    """
    # The MESH positions are reversed — KLEI is at the top, ZAND at the bottom.
    klei_wrong_pos = _box_mesh("b-klei", "KLEI", _X0, _X1, _Y0, _Y1, -5.0, 0.0)
    zand_wrong_pos = _box_mesh("b-zand", "ZAND", _X0, _X1, _Y0, _Y1, -10.0, -5.0)
    # Authored column expects ZAND on top, KLEI below.
    col = _col(_MID_X, _MID_Y, ("ZAND", 0.0, -5.0), ("KLEI", -5.0, -10.0))
    with pytest.raises(AssertionError, match="sequence"):
        assert_model_matches_columns([klei_wrong_pos, zand_wrong_pos], [col], tol_m=0.01)


def test_column_diff_fires_on_interbedded_order_reversal():
    """A reversed interbedded sequence (SILT/ZAND instead of ZAND/SILT) fires.

    Real-data-shaped: the authored interbedded column is ZAND/SILT/ZAND/SILT
    (typical Holocene fill over Pleistocene sands).  Reversing the top two
    bodies (SILT above ZAND instead of ZAND above SILT) must fire the sequence
    check.
    """
    # Build the WRONG model: SILT above ZAND at the top.
    s_top_wrong = _box_mesh("b-s1", "SILT", _X0, _X1, _Y0, _Y1, -2.0, 0.0)  # SILT on top
    z_top_wrong = _box_mesh("b-z1", "ZAND", _X0, _X1, _Y0, _Y1, -4.0, -2.0)  # ZAND below
    z_bot = _box_mesh("b-z2", "ZAND", _X0, _X1, _Y0, _Y1, -7.0, -4.0)
    s_bot = _box_mesh("b-s2", "SILT", _X0, _X1, _Y0, _Y1, -10.0, -7.0)
    # Authored: ZAND should be on top, SILT below.
    col = _col(
        _MID_X,
        _MID_Y,
        ("ZAND", 0.0, -2.0),
        ("SILT", -2.0, -4.0),
        ("ZAND", -4.0, -7.0),
        ("SILT", -7.0, -10.0),
    )
    with pytest.raises(AssertionError, match="sequence"):
        assert_model_matches_columns([s_top_wrong, z_top_wrong, z_bot, s_bot], [col], tol_m=0.01)


def test_column_diff_fires_on_base_elevation_error():
    """A body whose base is 2 m off fires the base-elevation check.

    Even when the formation sequence is correct, a body that stops 2 m too
    shallow (the ZAND/KLEI boundary is at -7 instead of the authored -5) must
    fire the check with the actual error.
    """
    # ZAND stops at -7 instead of the authored -5 (2 m too deep).
    zand_wrong_base = _box_mesh("b-zand", "ZAND", _X0, _X1, _Y0, _Y1, -7.0, 0.0)
    klei = _box_mesh("b-klei", "KLEI", _X0, _X1, _Y0, _Y1, -10.0, -7.0)
    col = _col(_MID_X, _MID_Y, ("ZAND", 0.0, -5.0), ("KLEI", -5.0, -10.0))
    with pytest.raises(AssertionError, match="base elevation"):
        assert_model_matches_columns([zand_wrong_base, klei], [col], tol_m=0.5)


def test_column_diff_passes_within_tolerance_on_base_elevation():
    """A base that is off by less than tol_m does NOT fire the check.

    The tol_m gate is deliberately tested in both directions: the test above
    proves it fires at 2 m error with tol=0.5 m; this test proves a 0.05 m
    error with tol=0.1 m does NOT fire (the tolerance is respected).
    """
    # ZAND base is at -5.05 instead of authored -5.00 (error = 0.05 m < tol 0.1 m).
    zand = _box_mesh("b-zand", "ZAND", _X0, _X1, _Y0, _Y1, -5.05, 0.0)
    klei = _box_mesh("b-klei", "KLEI", _X0, _X1, _Y0, _Y1, -10.0, -5.05)
    col = _col(_MID_X, _MID_Y, ("ZAND", 0.0, -5.0), ("KLEI", -5.0, -10.0))
    assert_model_matches_columns([zand, klei], [col], tol_m=0.1)  # must NOT raise
