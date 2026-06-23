"""Tests for the geotech NAD subdivision suggester (spec §4 Step B)."""

import pytest

from groundmodel.domain.services.geotech_subdivision import suggest_geotech_subdivision


def _depths(top: float, base: float, step: float = 0.5) -> list[float]:
    """Build a depth list from top to base at step-metre intervals (inclusive of base)."""
    out, d = [], top
    while d <= base + 1e-9:
        out.append(round(d, 3))
        d += step
    return out


def test_uniform_qc_yields_single_unit():
    """Constant-qc clean sand → ONE NAD unit spanning the whole segment."""
    # A constant-qc clean sand segment → ONE NAD unit, no internal split.
    depths = _depths(2.0, 8.0)
    qc = [8.0] * len(depths)
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=2.0,
        segment_base_m=8.0,
        min_thickness_m=0.5,
    )
    assert [s.nad_class for s in splits] == [6]
    assert splits[0].depth_top_m == 2.0 and splits[0].depth_base_m == 8.0


def test_band_change_splits_into_two_units():
    """A sustained qc shift crossing a NAD band boundary → two sub-units."""
    # qc 8 (matig, NAD 6) over the top half, qc 18 (zeer dicht, NAD 8) below.
    depths = _depths(0.0, 10.0)
    qc = [8.0 if d < 5.0 else 18.0 for d in depths]
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=10.0,
        min_thickness_m=0.5,
    )
    assert [s.nad_class for s in splits] == [6, 8]
    assert (
        abs(splits[0].depth_base_m - 5.0) <= 0.5
    )  # boundary within one min-thickness step of the true split at 5.0 m


def test_min_thickness_merges_thin_spike():
    """A single-sample spike below min_thickness is smoothed/merged away."""
    # A 1-sample dense spike thinner than min_thickness must NOT create a unit.
    depths = _depths(0.0, 10.0)
    qc = [8.0] * len(depths)
    qc[len(qc) // 2] = 30.0  # single spike
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=10.0,
        min_thickness_m=1.0,
    )
    assert [s.nad_class for s in splits] == [6]  # spike smoothed/merged away


def test_non_monotonic_dense_shallow_loose_deep():
    """Dense-over-loose ordering (non-monotonic qc) → two units, dense on top."""
    # dense (18) shallow → loose (8) deep: two units, dense on top.
    depths = _depths(0.0, 10.0)
    qc = [18.0 if d < 5.0 else 8.0 for d in depths]
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=10.0,
        min_thickness_m=0.5,
    )
    assert [s.nad_class for s in splits] == [8, 6]


def test_no_cpt_coverage_returns_fallback_single_unit():
    """A litho segment with no CPT samples → one fallback unit spanning the segment.

    The result list is never empty.
    """
    splits = suggest_geotech_subdivision("ZAND", (), [], [], 5.0, 10.0, 0.5)
    assert len(splits) == 1
    assert splits[0].depth_top_m == 5.0
    assert splits[0].depth_base_m == 10.0


def test_mismatched_depths_and_qc_raises():
    """depth_m and qc_mpa must be parallel series — a length mismatch is a programming error."""
    with pytest.raises(
        ValueError,
        match=r"depth_m \(2\) and qc_mpa \(1\) must have equal length\.",
    ):
        suggest_geotech_subdivision("ZAND", (), [1.0, 2.0], [5.0], 1.0, 2.0, 0.5)
