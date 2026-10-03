"""Unit tests for matching a lab test to a project borehole and sample.

Owner answers 2026-09-29:
* Borehole: the lab writes job ``GEO-25/022`` + borehole ``B17``; a project
  borehole whose name ENDS WITH ``<job>-<borehole>`` (case- and
  space-insensitive) is the match. Never the file name.
* Sample: "ask user, to double check, there should be a sample; if no, default
  create one; overlapping depths, yes same sample" — a sample on that borehole
  whose interval overlaps the lab's sampling interval IS the sample.
"""

from __future__ import annotations

from groundmodel.domain.services.lab_sample_matching import (
    SampleCandidate,
    match_borehole_ids,
    match_sample,
)

_BOREHOLES = [
    ("b17", "GEO-25/022-B17"),
    ("b17x", "1411-GEO-25/022-B17"),
    ("b18", "GEO-25/022-B18"),
    ("b7a", "GEO-19/122-B7A"),
    ("b1", "GEO-25/022-B1"),
]


def test_a_borehole_whose_name_ends_with_job_dash_borehole_matches() -> None:
    """``GEO-19/122`` + ``B7A`` → only ``GEO-19/122-B7A``."""
    assert match_borehole_ids("GEO-19/122", "B7A", _BOREHOLES) == ["b7a"]


def test_prefixed_names_match_too_and_several_hits_are_all_returned() -> None:
    """``1411-GEO-25/022-B17`` also ends with ``GEO-25/022-B17``: two hits,
    both returned (the preview asks)."""
    assert match_borehole_ids("GEO-25/022", "B17", _BOREHOLES) == ["b17", "b17x"]


def test_the_match_ignores_case_and_spaces() -> None:
    """``geo-25/022`` + `` b18 `` still names ``GEO-25/022-B18``."""
    assert match_borehole_ids("geo-25/022", " b18 ", _BOREHOLES) == ["b18"]


def test_a_near_miss_suffix_does_not_match() -> None:
    """``B1`` must not match ``...-B17`` or ``...-B18`` (the name must END
    with ``<job>-B1``)."""
    assert match_borehole_ids("GEO-25/022", "B1", _BOREHOLES) == ["b1"]


def test_without_a_borehole_name_the_job_narrows_the_candidates() -> None:
    """The newer oedometer export names no borehole: every borehole of the
    job is a candidate, none is picked for the user."""
    assert match_borehole_ids("GEO-25/022", None, _BOREHOLES) == ["b17", "b17x", "b18", "b1"]
    assert match_borehole_ids(None, None, _BOREHOLES) == []


def test_an_overlapping_sample_is_the_same_sample() -> None:
    """Lab interval 14,50-15,00 overlaps the sample at 14,40-14,90 → that sample."""
    samples = [
        SampleCandidate("s1", 10.0, 10.5, None),
        SampleCandidate("s2", 14.4, 14.9, None),
    ]
    assert match_sample(14.5, 15.0, "20/0568", samples) == ("s2", "overlap")


def test_the_largest_overlap_wins_when_two_samples_overlap() -> None:
    """Two overlapping samples → the one sharing the most depth."""
    samples = [SampleCandidate("a", 14.0, 14.6, None), SampleCandidate("b", 14.6, 15.2, None)]
    assert match_sample(14.5, 15.0, None, samples) == ("b", "overlap")


def test_touching_intervals_do_not_overlap() -> None:
    """Near miss: a sample ending exactly where the lab interval starts is not it."""
    samples = [SampleCandidate("s", 14.0, 14.5, None)]
    assert match_sample(14.5, 15.0, None, samples) == (None, "none")


def test_without_an_interval_the_lab_sample_number_matches() -> None:
    """The newer export has no depth: a sample carrying the lab's sample
    number is the match."""
    samples = [SampleCandidate("x", 1.0, 1.5, "24/1036"), SampleCandidate("y", 2.0, 2.5, "1")]
    assert match_sample(None, None, "24/1036", samples) == ("x", "sample_number")


def test_no_overlap_and_no_number_means_create_one() -> None:
    """Nothing matches → no sample (the preview proposes creating one)."""
    assert match_sample(3.0, 3.5, "9/9", [SampleCandidate("s", 1.0, 1.5, None)]) == (None, "none")


def test_the_dov_prefixed_name_of_the_dogfeed_project_matches_the_oedometer_listing() -> None:
    """Owner dogfeed 2026-10-03: job ``GEO-19/122`` + borehole ``B7A`` (listing 20/0568).

    The project holds DOV's own names, prefixed ``1411-``; the name that ends
    with ``GEO-19/122-B7A`` matches, its siblings (B7B, B8A, B3A) do not.
    """
    project = [
        ("b7a", "1411-GEO-19/122-B7A"),
        ("b7b", "1411-GEO-19/122-B7B"),
        ("b8a", "1411-GEO-19/122-B8A"),
        ("b3a", "1411-GEO-19/122-B3A"),
    ]
    assert match_borehole_ids("GEO-19/122", "B7A", project) == ["b7a"]
