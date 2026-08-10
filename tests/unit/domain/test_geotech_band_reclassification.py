"""Tests for hand split/merge of packing sub-bands — the owner's rules, verbatim.

Owner spec 2026-08-01: "build both properly, the user needs to be able to
manually overrule everything, but of course if the qc is lower or higher then it
gets a warning that it will pull down or up the avg qc of the layer it is in."

Each test below paraphrases one ruling in the ruling's own words:

* the class is DERIVED from the CPT qc over the interval, not carried;
* the statistic is the MEDIAN — because that is what classifies a band today
  (``geotech_subdivision`` line 444), so a warning computed on the mean would
  promise a reclassification that never happens;
* a packing boundary moves freely INSIDE its litho body and clamps at the edge —
  the litho contact and the geological contact are hard walls;
* manual override always wins: a band thinner than the minimum is ALLOWED with a
  warning, never blocked;
* qc that cannot answer yields "cannot answer", never a plausible class.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geotech_band_reclassification import (
    KIND_MERGE,
    KIND_MOVE,
    WARNING_BELOW_MINIMUM_THICKNESS,
    WARNING_QC_PULL_DOWN,
    WARNING_QC_PULL_UP,
    GeotechBand,
    GeotechBandEditError,
    ProposedInterval,
    enclosing_litho_bounds,
    plan_merge,
    plan_merge_run,
    plan_move,
    plan_restated_contact_move,
    plan_split,
    reclassify_intervals,
)

# Two litho parents and two geological parents, so a hand edit can be pushed
# across each wall independently.
LITHO_A = "litho-a"
LITHO_B = "litho-b"
GEO_1 = "geo-1"
GEO_2 = "geo-2"


def _series(
    spans: list[tuple[float, float, float | None]],
    step: float = 0.02,
) -> tuple[list[float], list[float | None]]:
    """Build a parallel (depth, qc) CPT series from ``(top, base, qc)`` spans.

    Parameters
    ----------
    spans : list[tuple[float, float, float | None]]
        Contiguous depth spans and the constant qc within each. ``None`` models
        a void reading.
    step : float, optional
        Sample spacing in metres (0.02 m = typical CPT density).

    Returns
    -------
    tuple[list[float], list[float | None]]
        Depths (metres, positive down) and the matching qc values (MPa).
    """
    depths: list[float] = []
    qc: list[float | None] = []
    total_base = spans[-1][1]
    n = int(round(total_base / step))
    for i in range(n + 1):
        d = round(i * step, 4)
        value: float | None = None
        for top, base, q in spans:
            if top - 1e-9 <= d < base - 1e-9 or (d >= total_base - 1e-9 and base == total_base):
                value = q
                break
        depths.append(d)
        qc.append(value)
    return depths, qc


def _band(
    band_id: str,
    top: float,
    base: float,
    nad_class: int | None,
    *,
    litho: str = LITHO_A,
    geo: str | None = GEO_1,
) -> GeotechBand:
    """Build one materialised packing band on a column."""
    return GeotechBand(
        band_id=band_id,
        depth_top_m=top,
        depth_base_m=base,
        nad_class=nad_class,
        source_litho_formation_id=litho,
        source_geo_formation_id=geo,
    )


# ---------------------------------------------------------------------------
# The class is derived from the MEDIAN qc, not the mean
# ---------------------------------------------------------------------------


def test_the_class_is_derived_from_the_median_qc_not_the_mean() -> None:
    """The band's class comes from the median qc over the interval.

    The classifier reads the median today, so a warning (and a commit) computed
    on the mean would promise a class the build never produces. Here the median
    is 5 MPa (ZAND matig, class 6) while the mean is 16 MPa (zeer dicht, class 8)
    — the derived class must be the median's.
    """
    depths, qc = _series([(0.0, 1.6, 5.0), (1.6, 2.0, 60.0)])
    band = _band("b1", 0.0, 2.0, 6)
    outcomes = reclassify_intervals(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        intervals=[ProposedInterval(0.0, 2.0, (band,))],
    )
    assert outcomes[0].median_qc_mpa == pytest.approx(5.0)
    assert outcomes[0].nad_class == 6
    assert outcomes[0].nad_class != 8  # the mean's class — must not win


# ---------------------------------------------------------------------------
# Split / merge re-derive the class from the qc over the resulting interval
# ---------------------------------------------------------------------------


def test_a_split_re_derives_the_class_of_both_halves() -> None:
    """After a hand split, EACH half is reclassified from the qc over that half."""
    depths, qc = _series([(0.0, 2.0, 5.0), (2.0, 4.0, 12.0)])
    bands = [_band("b1", 0.0, 4.0, 6)]
    plan = plan_split(
        bands=bands,
        band_id="b1",
        split_depth_m=2.0,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert [iv.nad_class for iv in plan.intervals] == [6, 7]
    # Both halves came out of the same band, so "what it carries today" is 6.
    assert [iv.previous_nad_class for iv in plan.intervals] == [6, 6]
    assert [iv.class_changed for iv in plan.intervals] == [False, True]


def test_a_merge_re_derives_the_class_of_the_union() -> None:
    """After a hand merge, the merged interval is reclassified over the union."""
    depths, qc = _series([(0.0, 2.0, 5.0), (2.0, 4.0, 12.0)])
    bands = [_band("b1", 0.0, 2.0, 6), _band("b2", 2.0, 4.0, 7)]
    plan = plan_merge(
        bands=bands,
        upper_band_id="b1",
        lower_band_id="b2",
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert len(plan.intervals) == 1
    merged = plan.intervals[0]
    assert (merged.depth_top_m, merged.depth_base_m) == (0.0, 4.0)
    # Median over the union is 8.5 MPa → ZAND matig (class 6), derived, not carried.
    assert merged.median_qc_mpa == pytest.approx(8.5)
    assert merged.nad_class == 6


def test_the_merged_class_can_differ_from_either_input_class() -> None:
    """The union's class is its own answer — it need not equal either input."""
    depths, qc = _series([(0.0, 2.0, 3.0), (2.0, 4.0, 12.0)])
    bands = [_band("b1", 0.0, 2.0, 5), _band("b2", 2.0, 4.0, 7)]
    plan = plan_merge(
        bands=bands,
        upper_band_id="b1",
        lower_band_id="b2",
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    merged = plan.intervals[0]
    assert merged.median_qc_mpa == pytest.approx(7.5)
    assert merged.nad_class == 6
    assert merged.nad_class not in (5, 7)


# ---------------------------------------------------------------------------
# Hard bounds — the two levels above are walls
# ---------------------------------------------------------------------------


def test_a_split_outside_the_bands_own_litho_body_is_rejected() -> None:
    """A packing boundary clamps at the edge of its litho body; past it is refused."""
    depths, qc = _series([(0.0, 4.0, 5.0)])
    bands = [
        _band("b1", 0.0, 2.0, 6, litho=LITHO_A),
        _band("b2", 2.0, 4.0, 6, litho=LITHO_B),
    ]
    with pytest.raises(GeotechBandEditError, match="litho"):
        plan_split(
            bands=bands,
            band_id="b1",
            split_depth_m=3.0,  # inside b2's litho body, not b1's
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_a_merge_across_a_litho_boundary_is_rejected() -> None:
    """A packing band never swallows a litho contact."""
    depths, qc = _series([(0.0, 4.0, 5.0)])
    bands = [
        _band("b1", 0.0, 2.0, 6, litho=LITHO_A),
        _band("b2", 2.0, 4.0, 6, litho=LITHO_B),
    ]
    with pytest.raises(GeotechBandEditError, match="lithostratigraphic"):
        plan_merge(
            bands=bands,
            upper_band_id="b1",
            lower_band_id="b2",
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_a_merge_across_a_geological_boundary_is_rejected() -> None:
    """A packing band never crosses a geological contact either."""
    depths, qc = _series([(0.0, 4.0, 5.0)])
    bands = [
        _band("b1", 0.0, 2.0, 6, geo=GEO_1),
        _band("b2", 2.0, 4.0, 6, geo=GEO_2),
    ]
    with pytest.raises(GeotechBandEditError, match="geological"):
        plan_merge(
            bands=bands,
            upper_band_id="b1",
            lower_band_id="b2",
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_the_litho_body_is_the_contiguous_run_sharing_the_same_parents() -> None:
    """The hard walls are where the litho OR geological parent changes."""
    bands = [
        _band("b0", 0.0, 1.0, 6, litho=LITHO_B, geo=GEO_1),
        _band("b1", 1.0, 2.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("b2", 2.0, 3.0, 7, litho=LITHO_A, geo=GEO_1),
        _band("b3", 3.0, 4.0, 7, litho=LITHO_A, geo=GEO_2),
    ]
    assert enclosing_litho_bounds(bands, 1) == (1.0, 3.0)
    assert enclosing_litho_bounds(bands, 2) == (1.0, 3.0)
    assert enclosing_litho_bounds(bands, 3) == (3.0, 4.0)


# ---------------------------------------------------------------------------
# Manual override always wins — the minimum thickness only warns
# ---------------------------------------------------------------------------


def test_a_band_thinner_than_the_minimum_is_allowed_with_a_warning() -> None:
    """The owner may place a boundary the minimum-thickness rule dislikes."""
    depths, qc = _series([(0.0, 4.0, 5.0)])
    bands = [_band("b1", 0.0, 4.0, 6)]
    plan = plan_split(
        bands=bands,
        band_id="b1",
        split_depth_m=0.10,  # a 0.10 m band against a 0.35 m minimum
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert len(plan.intervals) == 2  # NOT blocked
    codes = [w.code for w in plan.warnings]
    assert WARNING_BELOW_MINIMUM_THICKNESS in codes


# ---------------------------------------------------------------------------
# qc that cannot answer must say so, never guess
# ---------------------------------------------------------------------------


def test_invalid_qc_yields_cannot_answer_rather_than_a_plausible_class() -> None:
    """``classify_nad`` rejects invalid qc by design — the preview reports it."""
    depths, qc = _series([(0.0, 2.0, None)])
    band = _band("b1", 0.0, 2.0, 6)
    outcomes = reclassify_intervals(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        intervals=[ProposedInterval(0.0, 2.0, (band,))],
    )
    assert outcomes[0].nad_class is None
    assert outcomes[0].unclassifiable_reason
    assert outcomes[0].median_qc_mpa is None


def test_a_column_with_no_qc_at_all_cannot_answer() -> None:
    """A borehole column has no cone resistance — the answer is "cannot", not 5."""
    band = _band("b1", 0.0, 2.0, 6)
    outcomes = reclassify_intervals(
        soil="ZAND",
        admixtures=(),
        depth_m=[],
        qc_mpa=[],
        intervals=[ProposedInterval(0.0, 2.0, (band,))],
    )
    assert outcomes[0].nad_class is None
    assert outcomes[0].unclassifiable_reason


# ---------------------------------------------------------------------------
# The warning: what the move costs, in the owner's terms
# ---------------------------------------------------------------------------


def test_a_merge_warns_that_it_pulls_the_receiving_layers_qc_down_and_names_the_class() -> None:
    """Lower-qc material entering a layer pulls its representative qc DOWN."""
    depths, qc = _series([(0.0, 2.0, 3.0), (2.0, 4.0, 12.0)])
    bands = [_band("b1", 0.0, 2.0, 5), _band("b2", 2.0, 4.0, 7)]
    plan = plan_merge(
        bands=bands,
        upper_band_id="b1",
        lower_band_id="b2",
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    down = [w for w in plan.warnings if w.code == WARNING_QC_PULL_DOWN]
    assert down, "the dense band is pulled down by the loose one"
    message = down[0].message
    assert "DOWN" in message
    assert "12.0" in message and "7.5" in message  # from 12.0 MPa to 7.5 MPa
    assert "7" in message and "6" in message  # class 7 becomes 6


def test_a_merge_warns_that_it_pulls_the_receiving_layers_qc_up() -> None:
    """Higher-qc material entering a layer pulls its representative qc UP."""
    depths, qc = _series([(0.0, 2.0, 3.0), (2.0, 4.0, 12.0)])
    bands = [_band("b1", 0.0, 2.0, 5), _band("b2", 2.0, 4.0, 7)]
    plan = plan_merge(
        bands=bands,
        upper_band_id="b1",
        lower_band_id="b2",
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    up = [w for w in plan.warnings if w.code == WARNING_QC_PULL_UP]
    assert up, "the loose band is pulled up by the dense one"
    assert "UP" in up[0].message


def test_no_qc_warning_when_the_representative_qc_does_not_move() -> None:
    """Uniform qc → nothing is pulled anywhere, so nothing is warned about."""
    depths, qc = _series([(0.0, 4.0, 5.0)])
    bands = [_band("b1", 0.0, 2.0, 6), _band("b2", 2.0, 4.0, 6)]
    plan = plan_merge(
        bands=bands,
        upper_band_id="b1",
        lower_band_id="b2",
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert plan.intervals[0].nad_class == 6
    assert [w.code for w in plan.warnings if w.code.startswith("qc_pull")] == []


# ---------------------------------------------------------------------------
# The warning may never contradict the class the commit writes
# ---------------------------------------------------------------------------


def test_every_class_change_is_reported_to_the_engineer() -> None:
    """If the commit changes a class, some warning must say so.

    Ruling 6 makes the warning advisory, not approximate: the engineer decides whether to
    overrule the qc on the strength of what he is told, so a warning that disagrees with
    the committed result is worse than none.

    It did disagree. Found 2026-08-01 by the adversarial pass, from the shipped build's own
    output: the warning reported qc MOVEMENT and never consulted the class, so a split
    whose halves landed on the same median as the parent went out as "class N is unchanged"
    while the commit wrote N+1. A split does not change the qc a band holds — it changes
    WHICH qc it holds — so the median can stand still while the class moves underneath it.
    """
    # UNIFORM qc, so both halves land on exactly the parent's median and there is no qc
    # movement to report. The band CARRIES class 6 while 12 MPa re-derives to 7 — which is
    # ordinary, since the persisted class came from the band's extent at build time and the
    # split changes that extent. This is the shape the old code dropped on the floor.
    depths, qc = _series([(0.0, 4.0, 12.0)])
    bands = [_band("b1", 0.0, 4.0, 6)]

    plan = plan_split(
        bands=bands,
        band_id="b1",
        split_depth_m=2.0,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )

    changed = [iv for iv in plan.intervals if iv.class_changed]
    assert changed, "fixture must actually move a class or it proves nothing"

    # Every moved class is named somewhere in the warnings. The wording is the planner's
    # business; that the engineer is TOLD is the invariant.
    spoken = " ".join(w.message for w in plan.warnings)
    for interval in changed:
        assert str(interval.nad_class) in spoken, (
            f"class moved {interval.previous_nad_class} -> {interval.nad_class} "
            f"over {interval.depth_top_m}-{interval.depth_base_m} m "
            f"but no warning says so: {[w.message for w in plan.warnings]}"
        )
    # And nothing claims the opposite.
    assert "is unchanged" not in spoken or len(changed) < len(plan.intervals)


# ---------------------------------------------------------------------------
# PM - plan_move: drag the shared boundary between two adjacent bands
# ---------------------------------------------------------------------------


def test_pm1_a_move_re_derives_both_bands_classes() -> None:
    """PM1 - both sides of the moved boundary re-classify from their new qc.

    Ruling 3: "you recalculate after drag merge, the qc". Moving the boundary
    from 1.0 m to 1.6 m hands the dense material below 1.0-1.6 m to the upper
    band, so BOTH intervals must be re-derived, not carried.
    """
    depths, qc = _series([(0.0, 1.0, 5.0), (1.0, 4.0, 18.0)])
    bands = [_band("u", 0.0, 1.0, 6), _band("l", 1.0, 4.0, 8)]
    plan = plan_move(
        bands=bands,
        upper_band_id="u",
        lower_band_id="l",
        new_depth_m=1.6,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert plan.kind == KIND_MOVE
    upper, lower = plan.intervals
    assert (upper.depth_top_m, upper.depth_base_m) == (0.0, 1.6)
    assert (lower.depth_top_m, lower.depth_base_m) == (1.6, 4.0)
    # The upper band swallowed 0.6 m of dense sand: its class re-derives.
    assert upper.nad_class is not None and lower.nad_class == 8


def test_pm2_the_boundary_moves_only_strictly_inside_the_pair() -> None:
    """PM2 - the pair envelope is the wall: at or past an outer edge is
    refused (the squeeze-to-collapse case belongs to the absorb gesture)."""
    depths, qc = _series([(0.0, 4.0, 12.0)])
    bands = [_band("u", 0.0, 1.0, 7), _band("l", 1.0, 4.0, 7)]
    with pytest.raises(GeotechBandEditError, match="[Mm]ove"):
        plan_move(
            bands=bands,
            upper_band_id="u",
            lower_band_id="l",
            new_depth_m=4.0,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_pm3_a_boundary_between_different_litho_parents_is_not_draggable() -> None:
    """PM3 - that boundary IS a litho contact; ruling 2 names the wall."""
    depths, qc = _series([(0.0, 4.0, 12.0)])
    bands = [_band("u", 0.0, 2.0, 7, litho=LITHO_A), _band("l", 2.0, 4.0, 7, litho=LITHO_B)]
    with pytest.raises(GeotechBandEditError, match="litho"):
        plan_move(
            bands=bands,
            upper_band_id="u",
            lower_band_id="l",
            new_depth_m=2.4,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_pm4_non_adjacent_bands_share_no_boundary_to_move() -> None:
    """PM4 - only the shared boundary of two NEIGHBOURS can be dragged."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [_band("a", 0.0, 2.0, 7), _band("b", 2.0, 4.0, 7), _band("c", 4.0, 6.0, 7)]
    with pytest.raises(GeotechBandEditError, match="[Aa]djacent|neighbour"):
        plan_move(
            bands=bands,
            upper_band_id="a",
            lower_band_id="c",
            new_depth_m=3.0,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_pm5_below_minimum_thickness_is_a_warning_never_a_block() -> None:
    """PM5 - ruling 5: a thin survivor WARNS; the move still plans."""
    depths, qc = _series([(0.0, 4.0, 12.0)])
    bands = [_band("u", 0.0, 1.0, 7), _band("l", 1.0, 4.0, 7)]
    plan = plan_move(
        bands=bands,
        upper_band_id="u",
        lower_band_id="l",
        new_depth_m=0.1,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert any(w.code == WARNING_BELOW_MINIMUM_THICKNESS for w in plan.warnings)


def test_pm6_the_move_honours_the_model_statistic() -> None:
    """PM6 - ruling 6: the plan derives under the model chosen statistic."""
    depths, qc = _series([(0.0, 0.5, 4.0), (0.5, 2.0, 14.0), (2.0, 4.0, 14.0)])
    bands = [_band("u", 0.0, 2.0, 7), _band("l", 2.0, 4.0, 7)]
    kwargs = dict(
        bands=bands,
        upper_band_id="u",
        lower_band_id="l",
        new_depth_m=2.5,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    median_plan = plan_move(**kwargs)
    harmonic_plan = plan_move(**kwargs, statistic="harmonic")
    assert harmonic_plan.statistic == "harmonic"
    upper_h = harmonic_plan.intervals[0]
    upper_m = median_plan.intervals[0]
    assert upper_h.nad_class is not None and upper_m.nad_class is not None
    assert upper_h.nad_class < upper_m.nad_class


# ---------------------------------------------------------------------------
# MR - the union planner takes an N-band contiguous run (small-lens absorb)
# ---------------------------------------------------------------------------


def test_mr1_a_three_band_run_merges_into_one_reclassified_interval() -> None:
    """MR1 - host + lens + host union in ONE plan: one honest preview, one undo."""
    depths, qc = _series([(0.0, 1.8, 14.0), (1.8, 2.2, 4.0), (2.2, 4.0, 14.0)])
    bands = [_band("h1", 0.0, 1.8, 7), _band("lens", 1.8, 2.2, 5), _band("h2", 2.2, 4.0, 7)]
    plan = plan_merge_run(
        bands=bands,
        band_ids=["h1", "lens", "h2"],
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert len(plan.intervals) == 1
    union = plan.intervals[0]
    assert (union.depth_top_m, union.depth_base_m) == (0.0, 4.0)
    assert len(union.sources) == 3
    assert union.nad_class is not None  # re-derived over the whole union


def test_mr2_a_non_contiguous_run_is_refused() -> None:
    """MR2 - the run must be consecutive neighbours; gaps refuse."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [_band("a", 0.0, 2.0, 7), _band("b", 2.0, 4.0, 7), _band("c", 4.0, 6.0, 7)]
    with pytest.raises(GeotechBandEditError):
        plan_merge_run(
            bands=bands,
            band_ids=["a", "c"],
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_mr3_a_run_crossing_a_litho_parent_is_refused() -> None:
    """MR3 - a union never swallows a litho or geological contact (ruling 2)."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [
        _band("a", 0.0, 2.0, 7, litho=LITHO_A),
        _band("b", 2.0, 4.0, 7, litho=LITHO_A),
        _band("c", 4.0, 6.0, 7, litho=LITHO_B),
    ]
    with pytest.raises(GeotechBandEditError, match="litho"):
        plan_merge_run(
            bands=bands,
            band_ids=["a", "b", "c"],
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_pm7_a_refused_drag_is_called_a_move_not_a_merge() -> None:
    """PM7 — the refusal must name the verb the engineer actually used.

    Dogfeed 2026-08-09: dragging a boundary across a litho contact answered
    "Merge rejected: ...". Nothing was being merged; he had dragged. The wall
    is correct (ruling 2), but a refusal that describes a different gesture
    reads as a bug in the app rather than a rule about the ground.
    """
    depths, qc = _series([(0.0, 4.0, 12.0)])
    bands = [_band("u", 0.0, 2.0, 7, litho=LITHO_A), _band("l", 2.0, 4.0, 7, litho=LITHO_B)]
    with pytest.raises(GeotechBandEditError) as excinfo:
        plan_move(
            bands=bands,
            upper_band_id="u",
            lower_band_id="l",
            new_depth_m=2.4,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )
    assert str(excinfo.value).startswith("Move rejected")


def test_pm8_the_refusal_names_the_re_subdivide_that_actually_clears_it() -> None:
    """PM8 — "edit the contact" alone is necessary but NOT sufficient.

    Dogfeed 2026-08-09, verbatim: *"i tried merging a litho, but it was in
    separate geo bands, so i updated geo bands and the litho model i tried to
    merge the bands, but i couldn't ... re-subdivide did the trick though."*

    He did exactly what the message told him and the refusal persisted, because
    the packing bands still carry the parent units they were built against.
    Correcting the contact upstairs does not restate them — only re-running
    Subdivide does. The message has to say the whole fix, or it sends the
    engineer in a circle.
    """
    depths, qc = _series([(0.0, 4.0, 12.0)])
    bands = [_band("u", 0.0, 2.0, 7, litho=LITHO_A), _band("l", 2.0, 4.0, 7, litho=LITHO_B)]
    with pytest.raises(GeotechBandEditError, match="[Ss]ubdivide"):
        plan_merge(
            bands=bands,
            upper_band_id="u",
            lower_band_id="l",
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


# ---------------------------------------------------------------------------
# RC - plan_restated_contact_move: the boundary between two LITHO units
# ---------------------------------------------------------------------------
#
# The gesture the owner asked for on 2026-08-09: on the geotech axis, drag the
# boundary that restates a lithostratigraphic contact and take all three levels
# with it. ``plan_move`` cannot serve it — it REFUSES a cross-body pair, which is
# ruling 2 doing its job for a packing boundary.
#
# What makes this a different plan, not a flag on the old one: the two bands sit
# in DIFFERENT litho units, so they have different soil types. The owner's chain
# is soil type → qc → NAD parameters, so each side re-derives with its OWN soil.
# Passing one soil for both would classify the sand with the clay's column.


def test_rc1_a_restated_contact_move_reclassifies_each_side_with_its_own_soil() -> None:
    """Each band re-derives under the soil of the litho unit it subdivides."""
    # Same qc either side of the drag, so only the SOIL can explain a class
    # difference — if both sides came back with one column, this could not fail.
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, None, litho=LITHO_A),
        _band("lower", 4.0, 10.0, None, litho=LITHO_B),
    ]

    plan = plan_restated_contact_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=5.0,
        upper_soil="ZAND",
        upper_admixtures=(),
        lower_soil="KLEI",
        lower_admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    upper, lower = plan.intervals
    assert (upper.depth_top_m, upper.depth_base_m) == (0.0, 5.0)
    assert (lower.depth_top_m, lower.depth_base_m) == (5.0, 10.0)
    # 5 MPa is a real ZAND class and is NOT a KLEI class — the two sides must not
    # come back with the same answer, which is what one shared soil would give.
    assert upper.nad_class != lower.nad_class


def test_rc2_a_same_litho_pair_is_refused_because_that_is_the_packing_drag() -> None:
    """A pair inside ONE litho unit is not a restated contact.

    That boundary is the engineer's own packing subdivision and ``plan_move``
    owns it. Accepting it here would give the same boundary two verbs with
    different consequences — this one moves the litho model.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, None, litho=LITHO_A),
        _band("lower", 4.0, 10.0, None, litho=LITHO_A),
    ]

    with pytest.raises(GeotechBandEditError, match="packing boundary"):
        plan_restated_contact_move(
            bands=bands,
            upper_band_id="upper",
            lower_band_id="lower",
            new_depth_m=5.0,
            upper_soil="ZAND",
            upper_admixtures=(),
            lower_soil="ZAND",
            lower_admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.1,
        )


def test_rc3_the_pair_envelope_is_the_wall() -> None:
    """The drag stays strictly inside the two bands it separates.

    Beyond the envelope there is another band, and moving the contact there
    would collapse this one to nothing. The FE clamps first; this is the
    structural floor that makes a bypass impossible.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, None, litho=LITHO_A),
        _band("lower", 4.0, 10.0, None, litho=LITHO_B),
    ]

    with pytest.raises(GeotechBandEditError, match="outside the pair"):
        plan_restated_contact_move(
            bands=bands,
            upper_band_id="upper",
            lower_band_id="lower",
            new_depth_m=10.5,
            upper_soil="ZAND",
            upper_admixtures=(),
            lower_soil="KLEI",
            lower_admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.1,
        )


def test_rc4_landing_on_the_next_boundary_is_a_MERGE_not_a_move() -> None:
    """Snapping a contact onto the next packing boundary absorbs the band between.

    The gesture the owner named himself: *"can't skip a boundary right, drag merge,
    first, then drag merge second"*. Dragging the contact down to the next boundary
    means the litho unit above now owns everything down to it — so the packing band
    that sat between the two collapses into the band above.

    This is the HEADLINE case, not an edge one: the clamp lands the drag exactly ON a
    boundary every time, so a plan that demands a depth strictly inside the pair
    refuses the only landing the gesture can produce. e2e caught it; the strictly-
    inside rule was inherited from ``plan_move``, where it is right because a packing
    boundary genuinely may not swallow its neighbour.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, None, litho=LITHO_A),
        _band("lower", 4.0, 7.0, None, litho=LITHO_B),
    ]

    plan = plan_restated_contact_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=7.0,
        upper_soil="ZAND",
        upper_admixtures=(),
        lower_soil="KLEI",
        lower_admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    # ONE surviving interval, spanning both bands, under the UPPER unit's soil —
    # the ground down there now belongs to the unit above.
    assert plan.kind == KIND_MERGE
    assert len(plan.intervals) == 1
    (survivor,) = plan.intervals
    assert (survivor.depth_top_m, survivor.depth_base_m) == (0.0, 7.0)


def test_rc5_a_landing_short_of_the_boundary_is_still_a_move() -> None:
    """The nudge keeps two bands. Without this, every drag would merge."""
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, None, litho=LITHO_A),
        _band("lower", 4.0, 7.0, None, litho=LITHO_B),
    ]

    plan = plan_restated_contact_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=5.0,
        upper_soil="ZAND",
        upper_admixtures=(),
        lower_soil="KLEI",
        lower_admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert plan.kind == KIND_MOVE
    assert len(plan.intervals) == 2


def test_rc6_the_merged_band_re_derives_its_class_from_the_new_intervals_qc() -> None:
    """The survivor is classified from the ground it now covers, never from what it was.

    Owner, on whether a drag-merge should re-derive: *"Ofcourse rederive the Qc, it
    goes like this -> soil type -> QC -> nad parameters, if you change the interval
    the qc will differ"*. So a merge that triples a band's thickness has to read the
    qc again over the whole of it.

    The case is built so that carrying the old class and re-deriving give different
    answers: the upper band is 2 m of soft ground (qc 5 MPa, its stored class 6) and
    it absorbs 5 m of dense ground (qc 30 MPa). The union is dominated by the deep
    part, so a re-derived class must be the dense one — if the survivor came back as
    class 6, the value was carried.
    """
    depths, qc = _series([(0.0, 2.0, 5.0), (2.0, 7.0, 30.0)])
    bands = [
        _band("upper", 0.0, 2.0, 6, litho=LITHO_A),
        _band("lower", 2.0, 7.0, 9, litho=LITHO_B),
    ]

    plan = plan_restated_contact_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=7.0,
        upper_soil="ZAND",
        upper_admixtures=(),
        lower_soil="KLEI",
        lower_admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    (survivor,) = plan.intervals
    # Neither band's stored class survives — 6 was the upper band's, 9 the lower's.
    assert survivor.nad_class not in (6, 9)
    # The qc read over the merged span, and the class that follows from it.
    assert survivor.median_qc_mpa == pytest.approx(30.0)
    assert survivor.nad_class == 8
