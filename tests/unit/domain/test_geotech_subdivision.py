"""Tests for the geotech NAD subdivision suggester (spec §4 Step B)."""

import pytest

from groundmodel.domain.services.geotech_subdivision import (
    _conservative_merge,
    _gradient_snap,
    _persistence_filter,
    _sustained_threshold_cuts,
    _weld_same_class_bands,
    suggest_geotech_subdivision,
)


def _depths(top: float, base: float, step: float = 0.5) -> list[float]:
    """Build a depth list from top to base at step-metre intervals (inclusive of base)."""
    out, d = [], top
    while d <= base + 1e-9:
        out.append(round(d, 3))
        d += step
    return out


def test_mismatched_depths_and_qc_raises():
    """depth_m and qc_mpa must be parallel series — a length mismatch is a programming error."""
    with pytest.raises(
        ValueError,
        match=r"depth_m \(2\) and qc_mpa \(1\) must have equal length\.",
    ):
        suggest_geotech_subdivision("ZAND", (), [1.0, 2.0], [5.0], 1.0, 2.0, 0.5)


# --- pipeline tests ---------------------------------------------------------


def test_densifying_ramp_recovers_middle_band():
    """matig -> dicht -> zeer-dicht: the dicht band is NOT erased (the core bug)."""
    depths = [round(0.1 * i, 2) for i in range(31)]  # 0..3 m
    qc = [8.0 if d < 1.0 else (12.0 if d < 2.0 else 18.0) for d in depths]
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=3.0,
        min_thickness_m=0.35,
        gradient_snap=False,
    )
    assert [s.nad_class for s in splits] == [6, 7, 8]


def test_conservative_holds_weaker_class_through_oscillation():
    """qc oscillating across 15 keeps the WEAKER (dicht) class until it sustains."""
    depths = [round(0.1 * i, 2) for i in range(31)]
    qc = []
    for d in depths:
        if 1.0 <= d < 1.2:
            qc.append(18.0)  # transient spike (<0.35 m) — must be ignored
        elif d >= 2.0:
            qc.append(18.0)  # sustained zeer-dicht
        else:
            qc.append(12.0)  # dicht
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=3.0,
        min_thickness_m=0.35,
        gradient_snap=False,
    )
    assert [s.nad_class for s in splits] == [7, 8]
    boundary = splits[0].depth_base_m
    assert abs(boundary - 2.0) <= 0.2


def test_uniform_segment_one_band():
    """Constant-qc segment → a single band spanning the whole segment, edges clamped."""
    depths = [round(0.1 * i, 2) for i in range(21)]
    qc = [8.0] * 21
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=2.0,
        min_thickness_m=0.35,
        gradient_snap=False,
    )
    assert [s.nad_class for s in splits] == [6]
    assert splits[0].depth_top_m == 0.0 and splits[0].depth_base_m == 2.0


def test_no_samples_returns_fallback_band():
    """A segment with no CPT samples (borehole-only) → one fallback band, never empty."""
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=[],
        qc_mpa=[],
        segment_top_m=5.0,
        segment_base_m=10.0,
        min_thickness_m=0.35,
    )
    assert len(splits) == 1
    assert splits[0].depth_top_m == 5.0 and splits[0].depth_base_m == 10.0


# --- bad / missing qc handling (P0-1) ---------------------------------------
# Owner rule (2026-07-25):
#   1. Drop only the invalid samples (void/None, NaN, negative); classify the
#      unit from the good ones.
#   2. One isolated bad point never flags a unit.
#   3. A unit "needs review" (nad_class None — NOT a guessed class) if EITHER
#      more than ~40% of its thickness lacks valid qc OR there is a >=5 cm
#      continuous gap with no valid qc.
#   4. No CPT at all (borehole-only) → loosest class, conservative default.


def test_no_cpt_at_all_falls_back_to_loosest_class():
    """No CPT samples at all (borehole-only) → the loosest NAD class (los = 5 for sand),
    the conservative default. Guards the existing branch against regression."""
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=[],
        qc_mpa=[],
        segment_top_m=5.0,
        segment_base_m=10.0,
        min_thickness_m=0.35,
    )
    assert [s.nad_class for s in splits] == [5]


def test_isolated_void_sample_is_dropped_and_unit_still_classifies():
    """A single void (None) qc sample among good qc is irrelevant — drop it and classify
    from the good ones. Reproduces P0-1: today a None sample raises TypeError deep in the
    pipeline and fails the whole model-wide Subdivide.

    Spacing is CPT-density (2 cm), so one missing point is ~2 cm — genuinely irrelevant,
    which is the case the owner's 'one point is irrelevant' rule describes."""
    depths = _depths(0.0, 2.0, 0.02)  # ~101 samples over 2 m at CPT density
    qc: list = [8.0] * len(depths)
    qc[50] = None  # one void reading in the middle (~2 cm of profile)
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=2.0,
        min_thickness_m=0.35,
        gradient_snap=False,
    )
    assert [s.nad_class for s in splits] == [6]  # one bad point ignored, classifies normally


def test_isolated_nan_sample_is_dropped_and_unit_still_classifies():
    """A single NaN qc sample is irrelevant — drop it and classify from the good ones.
    Today NaN silently drags the median to NaN → densest class; the unit should read matig."""
    depths = _depths(0.0, 2.0, 0.02)  # CPT density — one bad point is ~2 cm
    qc: list = [8.0] * len(depths)
    qc[50] = float("nan")
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=2.0,
        min_thickness_m=0.35,
        gradient_snap=False,
    )
    assert [s.nad_class for s in splits] == [6]


def test_sustained_missing_span_in_thin_unit_needs_review():
    """~10 cm of void qc inside a ~20 cm unit → 'needs review' (nad_class None), never a
    guessed class. Trips BOTH review rules: >40% of thickness missing AND a >=5 cm gap."""
    depths = _depths(0.0, 0.20, 0.01)  # 21 samples over 20 cm at 1 cm spacing
    qc: list = [8.0] * len(depths)
    for i in range(5, 16):  # samples at 5..15 cm → ~10 cm contiguous void
        qc[i] = None
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=0.20,
        min_thickness_m=0.02,
        gradient_snap=False,
    )
    assert len(splits) == 1
    assert splits[0].nad_class is None  # unresolved, not a guessed class


def test_cpt_present_but_all_qc_void_needs_review_not_loosest():
    """A unit whose CPT covers it but every qc is void → 'needs review' (None), NOT the
    loosest fallback. Distinguishes 'CPT present, data missing' from 'no CPT at all'."""
    depths = _depths(0.0, 0.5, 0.05)
    qc: list = [None] * len(depths)
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=0.5,
        min_thickness_m=0.1,
        gradient_snap=False,
    )
    assert len(splits) == 1
    assert splits[0].nad_class is None


# --- persistence filter -----------------------------------------------------


def test_persistence_filter_flips_short_interior_run():
    """A 1-sample True spike between long False runs is flipped to False."""
    mask = [False, False, False, True, False, False, False]
    assert _persistence_filter(mask, persist=3) == [False] * 7


def test_persistence_filter_keeps_runs_at_or_above_persist():
    """A run >= persist samples survives."""
    mask = [False, False, True, True, True, False, False]
    assert _persistence_filter(mask, persist=3) == mask


def test_persistence_filter_never_flips_edge_runs():
    """A short run at the very top/bottom is kept (no preceding/following anchor)."""
    mask = [True, False, False, False, False]
    assert _persistence_filter(mask, persist=3)[0] is True


def test_persistence_filter_empty():
    """An empty mask passes through unchanged."""
    assert _persistence_filter([], persist=2) == []


# --- sustained threshold cuts -----------------------------------------------


def test_sustained_threshold_cuts_one_crossing():
    """A clean rise across the sand 10 MPa bound yields a cut at the crossing depth."""
    depths = [round(0.1 * i, 2) for i in range(21)]  # 0.0..2.0
    qc = [8.0 if d < 1.0 else 12.0 for d in depths]
    cuts = _sustained_threshold_cuts(depths, qc, "ZAND", (), min_thickness_m=0.35)
    assert cuts[0] == 0.0 and cuts[-1] == 2.0
    interior = [c for c in cuts if 0.0 < c < 2.0]
    assert len(interior) == 1
    assert abs(interior[0] - 1.0) <= 0.15


def test_sustained_threshold_cuts_ignores_transient_spike():
    """A single-sample spike above a bound creates no cut (persistence filter)."""
    depths = [round(0.1 * i, 2) for i in range(21)]
    qc = [8.0] * 21
    qc[10] = 30.0  # 1-sample spike
    cuts = _sustained_threshold_cuts(depths, qc, "ZAND", (), min_thickness_m=0.35)
    assert cuts == [0.0, 2.0]


# --- conservative merge + same-class weld -----------------------------------


def test_conservative_merge_absorbs_thin_into_weaker_neighbour():
    """A thin band between a weaker (n6) and a denser (n8) band joins the WEAKER."""
    bands = [[0.0, 1.0, 6], [1.0, 1.2, 7], [1.2, 3.0, 8]]
    merged = _conservative_merge(bands, min_thickness_m=0.35)
    assert merged == [[0.0, 1.2, 6], [1.2, 3.0, 8]]


def test_conservative_merge_keeps_thick_bands():
    """Bands already >= min thickness are returned unchanged."""
    bands = [[0.0, 1.0, 6], [1.0, 2.0, 7], [2.0, 3.0, 8]]
    assert _conservative_merge(bands, min_thickness_m=0.35) == bands


def test_weld_same_class_bands():
    """Adjacent bands of equal NAD class weld into one contiguous band."""
    bands = [[0.0, 1.0, 6], [1.0, 1.5, 6], [1.5, 3.0, 8]]
    assert _weld_same_class_bands(bands) == [[0.0, 1.5, 6], [1.5, 3.0, 8]]


# --- gradient snap ----------------------------------------------------------


def test_gradient_snap_sharpens_toward_a_break_when_more_conservative():
    """A densifying boundary snaps DEEPER toward a sharp qc break (more conservative)."""
    depths = [round(0.1 * i, 2) for i in range(31)]
    qc = [8.0 if d < 1.5 else 20.0 for d in depths]
    bands = [[0.0, 1.3, 6], [1.3, 3.0, 8]]
    snapped = _gradient_snap(bands, depths, qc, window_m=0.5, min_thickness_m=0.35)
    assert abs(snapped[0][1] - 1.5) <= 0.15  # moved deeper to the break


def test_gradient_snap_refuses_less_conservative_move():
    """A snap that would move a densifying boundary SHALLOWER is rejected."""
    depths = [round(0.1 * i, 2) for i in range(31)]
    qc = [8.0 if d < 1.5 else 20.0 for d in depths]
    bands = [[0.0, 1.7, 6], [1.7, 3.0, 8]]  # boundary already deep
    snapped = _gradient_snap(bands, depths, qc, window_m=0.5, min_thickness_m=0.35)
    assert snapped[0][1] == 1.7  # peak at 1.5 is shallower -> not applied
