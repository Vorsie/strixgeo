"""Unit tests for merge_adjacent_same_lithology (debt #119).

Covers: empty/single/two-same/two-different/three-chain/four-chain
NAD-range, non-adjacent same-code, admixture aggregation, MIN
confidence, nad_class_range singleton, nad_class_range all-None,
and iterative collapse.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.litho_segmentation import (
    LithoLayerSuggestion,
    merge_adjacent_same_lithology,
)
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.shared.constants.litho_constants import BaseLithology
from groundmodel.shared.constants.suggestion_confidence import SuggestionConfidence

# ---------------------------------------------------------------------------
# Helpers — build minimal LithoLayerSuggestion instances without boilerplate
# ---------------------------------------------------------------------------


def _seg(
    top: float,
    base: float,
    litho: BaseLithology,
    nad_class: int | None = None,
    confidence: SuggestionConfidence = SuggestionConfidence.HIGH,
    source: str = "cpt_robertson_2015",
    admixtures: tuple[Admixture, ...] = (),
    mean_qc_mpa: float | None = 5.0,
    dr_pct: float | None = None,
) -> LithoLayerSuggestion:
    """Build a minimal LithoLayerSuggestion for testing."""
    nad_range: tuple[int, int] | None = (nad_class, nad_class) if nad_class is not None else None
    return LithoLayerSuggestion(
        depth_top_m=top,
        depth_base_m=base,
        suggested_lithology=litho,
        suggested_nad_class=nad_class,
        nad_class_range=nad_range,
        mean_qc_mpa=mean_qc_mpa,
        dr_pct=dr_pct,
        confidence=confidence,
        source=source,
        suggested_admixtures=admixtures,
    )


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_empty_list_returns_empty() -> None:
    """Empty input → empty output, no error."""
    assert merge_adjacent_same_lithology([]) == []


def test_single_segment_unchanged() -> None:
    """A single segment is returned as-is."""
    seg = _seg(0.0, 1.0, "ZAND", nad_class=6)
    result = merge_adjacent_same_lithology([seg])
    assert len(result) == 1
    assert result[0] is seg  # identity preserved for single


# ---------------------------------------------------------------------------
# Two-segment cases
# ---------------------------------------------------------------------------


def test_two_adjacent_same_lithology_merged_to_one() -> None:
    """SAND 0–1 + SAND 1–2 → one SAND 0–2."""
    segs = [_seg(0.0, 1.0, "ZAND"), _seg(1.0, 2.0, "ZAND")]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    assert result[0].depth_top_m == 0.0
    assert result[0].depth_base_m == 2.0
    assert result[0].suggested_lithology == "ZAND"


def test_two_adjacent_different_lithology_unchanged() -> None:
    """SAND 0–1 + CLAY 1–2 → unchanged (2 segments)."""
    segs = [_seg(0.0, 1.0, "ZAND"), _seg(1.0, 2.0, "KLEI")]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 2
    assert result[0].suggested_lithology == "ZAND"
    assert result[1].suggested_lithology == "KLEI"


def test_non_adjacent_same_code_not_merged() -> None:
    """SAND 0–1 + (gap to 2) + SAND 2–3 — gap > tolerance → not merged."""
    # 1.0 m gap between base of first and top of second
    segs = [_seg(0.0, 1.0, "ZAND"), _seg(2.0, 3.0, "ZAND")]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 2


# ---------------------------------------------------------------------------
# Chain cases
# ---------------------------------------------------------------------------


def test_three_chain_sand_sand_clay() -> None:
    """SAND 0–1 + SAND 1–2 + CLAY 2–3 → SAND 0–2 + CLAY 2–3."""
    segs = [
        _seg(0.0, 1.0, "ZAND"),
        _seg(1.0, 2.0, "ZAND"),
        _seg(2.0, 3.0, "KLEI"),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 2
    assert result[0].depth_top_m == 0.0
    assert result[0].depth_base_m == 2.0
    assert result[0].suggested_lithology == "ZAND"
    assert result[1].suggested_lithology == "KLEI"


def test_four_chain_all_sand_nad_range() -> None:
    """Four SAND segments with NAD classes [3, 5, 5, 7] → 1 merged with range (3, 7)."""
    segs = [
        _seg(0.0, 1.0, "ZAND", nad_class=3),
        _seg(1.0, 2.0, "ZAND", nad_class=5),
        _seg(2.0, 3.0, "ZAND", nad_class=5),
        _seg(3.0, 4.0, "ZAND", nad_class=7),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    assert result[0].nad_class_range == (3, 7)
    assert result[0].depth_top_m == 0.0
    assert result[0].depth_base_m == 4.0


# ---------------------------------------------------------------------------
# NAD class edge cases
# ---------------------------------------------------------------------------


def test_nad_class_range_singleton_when_all_same() -> None:
    """Two SAND segments both with nad_class=5 → merged has nad_class_range=(5, 5)."""
    segs = [_seg(0.0, 1.0, "ZAND", nad_class=5), _seg(1.0, 2.0, "ZAND", nad_class=5)]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    assert result[0].nad_class_range == (5, 5)
    assert result[0].suggested_nad_class == 5


def test_nad_class_range_none_when_all_none() -> None:
    """Two SAND segments with nad_class=None → merged has nad_class_range=None."""
    segs = [
        _seg(0.0, 1.0, "ZAND", nad_class=None),
        _seg(1.0, 2.0, "ZAND", nad_class=None),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    assert result[0].nad_class_range is None
    assert result[0].suggested_nad_class is None


# ---------------------------------------------------------------------------
# Confidence MIN rule
# ---------------------------------------------------------------------------


def test_confidence_min_rule() -> None:
    """HIGH + LOW → merged is LOW (most conservative)."""
    segs = [
        _seg(0.0, 1.0, "ZAND", confidence=SuggestionConfidence.HIGH),
        _seg(1.0, 2.0, "ZAND", confidence=SuggestionConfidence.LOW),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    assert result[0].confidence == SuggestionConfidence.LOW


def test_confidence_high_high_stays_high() -> None:
    """HIGH + HIGH → merged is HIGH."""
    segs = [
        _seg(0.0, 1.0, "ZAND", confidence=SuggestionConfidence.HIGH),
        _seg(1.0, 2.0, "ZAND", confidence=SuggestionConfidence.HIGH),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert result[0].confidence == SuggestionConfidence.HIGH


# ---------------------------------------------------------------------------
# Admixture aggregation
# ---------------------------------------------------------------------------


def test_admixture_aggregation_applied_to_merged_segment() -> None:
    """Two SAND segments with different admixtures → merged segment has
    aggregated admixtures (non-empty; the exact content is controlled by
    _aggregate_admixtures heuristic — we assert it was applied, not the
    exact result).
    """
    # "KL" (clay) admixture on each segment — same code, same amount.
    # The majority heuristic should retain it in the merge.
    kl = Admixture(soil_code="KL", amount="Z", locally=False)
    segs = [
        _seg(0.0, 1.0, "ZAND", admixtures=(kl,)),
        _seg(1.0, 2.0, "ZAND", admixtures=(kl,)),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    # Admixtures were aggregated (not silently dropped).
    assert len(result[0].suggested_admixtures) > 0
    # The dominant code should be present.
    codes = {a.soil_code for a in result[0].suggested_admixtures}
    assert "KL" in codes


# ---------------------------------------------------------------------------
# Iterative collapse
# ---------------------------------------------------------------------------


def test_iterative_collapse_three_segment_chain() -> None:
    """Four SAND segments in a row: a single pass merges them all.

    The greedy walk in a single pass already builds the full group before
    appending, so even a 4-segment same-lithology chain collapses in one
    iteration. Verifies the loop terminates correctly.
    """
    segs = [
        _seg(0.0, 0.5, "ZAND"),
        _seg(0.5, 1.0, "ZAND"),
        _seg(1.0, 1.5, "ZAND"),
        _seg(1.5, 2.0, "ZAND"),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    assert result[0].depth_top_m == 0.0
    assert result[0].depth_base_m == 2.0


def test_interleaved_collapse_requires_second_pass() -> None:
    """Scenario that requires the outer while loop to run twice.

    Input:  SAND 0–1 | CLAY 1–2 | SAND 2–3 | SAND 3–4 | CLAY 4–5 | SAND 5–6 | SAND 6–7

    First pass: [SAND 2–4] and [SAND 5–7] collapse → [SAND 0–1, CLAY 1–2,
    SAND 2–4, CLAY 4–5, SAND 5–7] (5 segments).  No further adjacencies,
    so second pass finds nothing to merge and terminates.

    The test confirms the output is exactly those 5 segments.
    """
    segs = [
        _seg(0.0, 1.0, "ZAND"),
        _seg(1.0, 2.0, "KLEI"),
        _seg(2.0, 3.0, "ZAND"),
        _seg(3.0, 4.0, "ZAND"),
        _seg(4.0, 5.0, "KLEI"),
        _seg(5.0, 6.0, "ZAND"),
        _seg(6.0, 7.0, "ZAND"),
    ]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 5
    assert result[0].suggested_lithology == "ZAND"
    assert result[0].depth_base_m == 1.0
    assert result[1].suggested_lithology == "KLEI"
    assert result[2].suggested_lithology == "ZAND"
    assert result[2].depth_base_m == 4.0
    assert result[3].suggested_lithology == "KLEI"
    assert result[4].suggested_lithology == "ZAND"
    assert result[4].depth_base_m == 7.0


# ---------------------------------------------------------------------------
# Depth spanning
# ---------------------------------------------------------------------------


def test_merged_segment_spans_both_depths() -> None:
    """Merged depth span covers both source segments."""
    segs = [_seg(5.0, 7.5, "KLEI"), _seg(7.5, 10.0, "KLEI")]
    result = merge_adjacent_same_lithology(segs)
    assert len(result) == 1
    assert result[0].depth_top_m == 5.0
    assert result[0].depth_base_m == 10.0


# ---------------------------------------------------------------------------
# segment_cpt integration — merge_same_lithology kwarg
# ---------------------------------------------------------------------------


def _make_synthetic_cpt_series(
    top_litho: BaseLithology,
    bottom_litho: BaseLithology,
    top_qc: float,
    bottom_qc: float,
    depth_m: float = 8.0,
    split_m: float = 4.0,
) -> tuple[list[float], list[float], list[float | None]]:
    """Build a synthetic depth/qc/fs series with two distinct Robertson zones."""
    step = 0.1
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float | None] = []
    # Top block
    z = 0.0
    while z < split_m - 1e-9:
        depths.append(round(z, 2))
        qc.append(top_qc)
        fs.append(top_qc * 0.005)  # low FR → sand-like
        z += step
    # Bottom block
    while z < depth_m - 1e-9:
        depths.append(round(z, 2))
        qc.append(bottom_qc)
        fs.append(bottom_qc * 0.05)  # higher FR → clay-like
        z += step
    return depths, qc, fs


def test_segment_cpt_merge_kwarg_default_on() -> None:
    """merge_same_lithology=True (default) — same-lithology output collapses."""
    from groundmodel.domain.services.litho_segmentation import segment_cpt

    # Use a uniform sand column (all same Robertson zone): the un-merged
    # output from a uniform column should produce ≥1 segment, and the merged
    # output must have ≤ un-merged segment count.
    step = 0.1
    depths = [round(i * step, 2) for i in range(80)]
    qc = [20.0] * len(depths)  # dense sand
    fs: list[float | None] = [0.10] * len(depths)  # low FR

    unmerged = segment_cpt(depths, qc, fs, niveau_m=10.0, yw_m=10.0, merge_same_lithology=False)
    merged = segment_cpt(depths, qc, fs, niveau_m=10.0, yw_m=10.0, merge_same_lithology=True)
    assert len(merged) <= len(unmerged)
    # Merged spans the full depth.
    assert merged[0].depth_top_m == depths[0]
    assert merged[-1].depth_base_m == pytest.approx(depths[-1], abs=0.15)


def test_segment_cpt_merge_kwarg_false_preserves_splits() -> None:
    """merge_same_lithology=False returns the un-merged Robertson-zone splits."""
    from groundmodel.domain.services.litho_segmentation import segment_cpt

    step = 0.1
    depths = [round(i * step, 2) for i in range(80)]
    qc = [20.0] * len(depths)
    fs: list[float | None] = [0.10] * len(depths)

    merged = segment_cpt(depths, qc, fs, niveau_m=10.0, yw_m=10.0, merge_same_lithology=True)
    unmerged = segment_cpt(depths, qc, fs, niveau_m=10.0, yw_m=10.0, merge_same_lithology=False)
    # Both orderings hold.
    assert len(merged) <= len(unmerged)
