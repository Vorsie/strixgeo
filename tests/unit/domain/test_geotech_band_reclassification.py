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
  the litho contact is the hard wall, and the ONLY one; a geological contact is
  not (owner, 2026-08-26: "just drop the wall everywhere, user wil have to
  manually do it");
* manual override always wins: a band thinner than the minimum is ALLOWED with a
  warning, never blocked;
* qc that cannot answer yields "cannot answer", never a plausible class.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.geotech_band_reclassification import (
    KIND_ABSORB,
    KIND_MERGE,
    KIND_MOVE,
    WARNING_BELOW_MINIMUM_THICKNESS,
    WARNING_QC_PULL_DOWN,
    WARNING_QC_PULL_UP,
    GeotechBand,
    GeotechBandEditError,
    ProposedInterval,
    enclosing_litho_bounds,
    plan_absorb_run,
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


def test_a_merge_across_a_geological_boundary_is_allowed() -> None:
    """A packing band DOES cross a geological contact (owner, 2026-08-26).

    This test asserted the refusal until the owner dropped the geological wall:
    *"just drop the wall everywhere, user wil have to manually do it"*. Inverted
    rather than deleted, so the pair with
    ``test_a_merge_across_a_litho_boundary_is_rejected`` above states both halves
    of the rule side by side — litho refuses, geology does not.
    """
    depths, qc = _series([(0.0, 4.0, 5.0)])
    bands = [
        _band("b1", 0.0, 2.0, 6, geo=GEO_1),
        _band("b2", 2.0, 4.0, 6, geo=GEO_2),
    ]
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

    assert plan.kind == KIND_MERGE
    (survivor,) = plan.intervals
    assert (survivor.depth_top_m, survivor.depth_base_m) == (0.0, 4.0)


def test_the_litho_body_is_the_contiguous_run_sharing_the_same_litho_parent() -> None:
    """The hard wall is where the LITHO parent changes — the geological one is not a wall.

    Owner, 2026-08-26: *"just drop the wall everywhere, user wil have to manually
    do it"*. A geological line no longer ends the run a boundary may move in, so
    b1..b3 are one body even though the geological parent changes at 3.0 m; the
    litho change at 1.0 m still ends it.
    """
    bands = [
        _band("b0", 0.0, 1.0, 6, litho=LITHO_B, geo=GEO_1),
        _band("b1", 1.0, 2.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("b2", 2.0, 3.0, 7, litho=LITHO_A, geo=GEO_1),
        _band("b3", 3.0, 4.0, 7, litho=LITHO_A, geo=GEO_2),
    ]
    assert enclosing_litho_bounds(bands, 1) == (1.0, 4.0)
    assert enclosing_litho_bounds(bands, 2) == (1.0, 4.0)
    assert enclosing_litho_bounds(bands, 3) == (1.0, 4.0)
    # CONTROL: the litho wall is untouched — b0 sits in its own unit.
    assert enclosing_litho_bounds(bands, 0) == (0.0, 1.0)


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
        # LITHO_B keeps band below the absorbed one, so the unit survives the merge
        # as a thinner unit. Without it this is RC7's refusal, not a merge.
        _band("floor", 7.0, 10.0, None, litho=LITHO_B),
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
    depths, qc = _series([(0.0, 2.0, 5.0), (2.0, 7.0, 30.0), (7.0, 10.0, 30.0)])
    bands = [
        _band("upper", 0.0, 2.0, 6, litho=LITHO_A),
        _band("lower", 2.0, 7.0, 9, litho=LITHO_B),
        # LITHO_B survives the merge as a thinner unit — see RC4.
        _band("floor", 7.0, 10.0, 9, litho=LITHO_B),
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


def test_rc7_a_merge_that_would_consume_a_whole_litho_unit_is_refused() -> None:
    """Dragging a contact onto the NEXT contact would delete the unit between them.

    The owner hit this: *"this happens when i try to move a solid on another
    solid"*, and it answered with a 500. The merge absorbs the lower band, so the
    contact lands on that band's base — which is fine while the unit has more band
    below, and is the unit's own floor when it does not. Consuming the floor
    deletes the lithostratigraphic unit, which no drag on the geotech axis is
    allowed to do: the engineer is refining a boundary, not removing a layer.

    It has to be refused HERE rather than left to the database. The write is one
    transaction across three models, so the litho contiguity rule does stop it —
    but as an unhandled error, which reaches the engineer as "nothing was changed"
    with no reason attached.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, None, litho=LITHO_A),
        # The only band of LITHO_B. Absorbing it leaves the unit with nothing.
        _band("lower", 4.0, 7.0, None, litho=LITHO_B),
    ]

    with pytest.raises(GeotechBandEditError, match="lithostratigraphic unit"):
        plan_restated_contact_move(
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


def test_rc8_landing_on_the_pairs_TOP_is_the_upward_merge() -> None:
    """Dragging the contact UP onto the previous packing boundary absorbs the UPPER band.

    Direction decides who swallows whom (owner, §4c): *"Down = the layer above grows;
    up = the reverse."* The downward landing has been a merge since RC4; the upward one
    was refused "falls outside the pair" — while the renderer clamps every upward drag
    onto exactly this landing and telegraphs *release to merge* (audit F02, found by
    three lenses independently).

    The survivor spans both bands and is classified under the LOWER unit's soil,
    because the ground up there now belongs to the unit below. The case is built so
    carrying and re-deriving disagree: the absorbed upper band is 2 m of dense ground
    (qc 30) joining 5 m of soft (qc 5), so the union's qc is the soft side's.
    """
    depths, qc = _series([(0.0, 3.0, 30.0), (3.0, 5.0, 30.0), (5.0, 10.0, 5.0)])
    bands = [
        # LITHO_A keeps band above the absorbed one, so the unit survives — see RC9.
        _band("ceiling", 0.0, 3.0, 8, litho=LITHO_A),
        _band("upper", 3.0, 5.0, 8, litho=LITHO_A),
        _band("lower", 5.0, 10.0, 22, litho=LITHO_B),
    ]

    plan = plan_restated_contact_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=3.0,
        upper_soil="ZAND",
        upper_admixtures=(),
        lower_soil="KLEI",
        lower_admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert plan.kind == KIND_MERGE
    assert plan.absorbs == "upper"
    (survivor,) = plan.intervals
    assert (survivor.depth_top_m, survivor.depth_base_m) == (3.0, 10.0)
    # Classified under KLEI (the lower unit's soil) over the whole union: harmonic-free
    # median of [30]*100 + [5]*250 samples is 5 → KLEI "vast" is qc ≥ 4 → class 24.
    assert survivor.nad_class == 24


def test_rc8b_an_upward_landing_short_of_the_boundary_is_still_a_move() -> None:
    """The upward nudge keeps two bands, exactly as RC5 pinned for the downward one."""
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("ceiling", 0.0, 3.0, None, litho=LITHO_A),
        _band("upper", 3.0, 5.0, None, litho=LITHO_A),
        _band("lower", 5.0, 10.0, None, litho=LITHO_B),
    ]

    plan = plan_restated_contact_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=4.0,
        upper_soil="ZAND",
        upper_admixtures=(),
        lower_soil="KLEI",
        lower_admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert plan.kind == KIND_MOVE
    assert plan.absorbs is None
    assert len(plan.intervals) == 2


def test_rc9_an_upward_merge_that_would_consume_the_unit_above_is_refused() -> None:
    """The RC7 mirror: absorbing the upper unit's LAST band deletes the unit above.

    The renderer's contact-wall clamp stops an upward drag short of this landing, so
    reaching it means the clamp failed — the refusal is the second line of defence,
    exactly as RC7 is for the downward direction.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        # LITHO_A's only band — absorbing it leaves the unit with nothing.
        _band("upper", 3.0, 5.0, None, litho=LITHO_A),
        _band("lower", 5.0, 10.0, None, litho=LITHO_B),
    ]

    with pytest.raises(GeotechBandEditError, match="lithostratigraphic unit"):
        plan_restated_contact_move(
            bands=bands,
            upper_band_id="upper",
            lower_band_id="lower",
            new_depth_m=3.0,
            upper_soil="ZAND",
            upper_admixtures=(),
            lower_soil="KLEI",
            lower_admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.1,
        )


def test_rc10_a_downward_merge_may_land_on_a_geological_contact() -> None:
    """RC10 — landing ON a geological contact is a legal merge (owner, 2026-08-12).

    The audit-F03 wall refused this landing outright. The owner hit it on
    GEO-10/170-S6 — the swallowed interval stayed inside ONE formation, the geo
    contact did not move and was not crossed, the drag only landed exactly on
    it — and reversed the wall: *"yes allow it and couple them, this is
    unnecessary friction."* The planner now plans the merge; the WRITER couples
    the litho contact to the coinciding geological contact (RM7) and still
    refuses the one dangerous case, carrying a DIFFERENT geological contact
    onto this one (RM8).
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, None, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, None, litho=LITHO_B, geo=GEO_1),
        # Same litho unit as "lower" but the OTHER geological formation: the
        # boundary at 7.0 m IS a geological contact interior to unit B.
        _band("floor", 7.0, 10.0, None, litho=LITHO_B, geo=GEO_2),
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

    assert plan.kind == KIND_MERGE
    assert plan.absorbs == "lower"
    (survivor,) = plan.intervals
    assert (survivor.depth_top_m, survivor.depth_base_m) == (0.0, 7.0)


def test_rc11_an_upward_merge_may_land_on_a_geological_contact() -> None:
    """RC11 — the mirror for the upward direction (same 2026-08-12 ruling)."""
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("ceiling", 0.0, 3.0, None, litho=LITHO_A, geo=GEO_1),
        # Same litho unit as "upper" but across a geological contact at 3.0 m.
        _band("upper", 3.0, 5.0, None, litho=LITHO_A, geo=GEO_2),
        _band("lower", 5.0, 10.0, None, litho=LITHO_B, geo=GEO_2),
    ]

    plan = plan_restated_contact_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=3.0,
        upper_soil="ZAND",
        upper_admixtures=(),
        lower_soil="KLEI",
        lower_admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert plan.kind == KIND_MERGE
    assert plan.absorbs == "upper"
    (survivor,) = plan.intervals
    assert (survivor.depth_top_m, survivor.depth_base_m) == (3.0, 10.0)


def test_sp_r1_the_split_previews_the_depth_the_commit_writes() -> None:
    """SP-R1 — plan_split rounds before validating and classifying (audit F15).

    Its two sibling planners round to the millimetre first; plan_split validated
    and built both intervals at the RAW depth while the commit wrote the rounded
    one — so a sample inside the sub-millimetre difference belonged to one half in
    the preview and the other half on disk. The scene puts an extreme reading at
    exactly 4.0 m: splitting at 4.0004 m must classify [top, 4.0), which excludes
    it, because 4.0 is what the commit writes.
    """
    depths, qc = _series([(0.0, 3.98, 5.0), (3.98, 4.02, 60.0), (4.02, 9.0, 5.0)])
    bands = [_band("b1", 0.0, 9.0, 6)]
    plan = plan_split(
        bands=bands,
        band_id="b1",
        split_depth_m=4.0004,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    # The intervals ARE the commit's intervals — mm-rounded.
    assert plan.intervals[0].depth_base_m == pytest.approx(4.0)
    assert plan.intervals[1].depth_top_m == pytest.approx(4.0)


def test_sp_r2_a_split_that_rounds_onto_the_bands_edge_is_refused_not_written() -> None:
    """SP-R2 — the zero-width-row 500, closed at the planner (audit F15).

    A split at 4.0004 m inside a band whose top is 4.0 m passed the raw
    strictly-inside check and then the commit rounded it onto the band's own
    edge — a zero-width row and a constraint error mid-transaction. Validating
    the rounded depth turns it into the ordinary refusal.
    """
    depths, qc = _series([(0.0, 9.0, 5.0)])
    bands = [
        _band("b0", 0.0, 4.0, 6),
        _band("b1", 4.0, 9.0, 6),
    ]
    with pytest.raises(GeotechBandEditError, match="not inside the band"):
        plan_split(
            bands=bands,
            band_id="b1",
            split_depth_m=4.0004,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )


def test_pt1_the_edit_window_is_the_builds_window_to_the_last_sample() -> None:
    """PT1 — no epsilon shift between the two paths' sampling (audit F17).

    The edit path sampled ``top - 1e-6 <= d < base - 1e-6`` while the build
    samples ``top <= d < base`` — the whole window shifted by a micron, under
    docstrings in BOTH files claiming exact parity. Real depth grids never put a
    sample in that sliver, but the parity claim was false as written and the trap
    arms itself if the epsilon is ever widened toward the 1 cm adjacency epsilon
    four lines above it.

    The scene plants a sample at base - 5e-7 — inside the disputed sliver — whose
    extreme value decides the class. The build's window includes it; the edit
    path must agree.
    """
    depths = [0.0, 1.0, 2.0, 3.0 - 5e-7]
    qc: list[float | None] = [5.0, 5.0, 60.0, 60.0]
    band = _band("b1", 0.0, 3.0, 6)
    (outcome,) = reclassify_intervals(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        intervals=[ProposedInterval(0.0, 3.0, (band,))],
    )
    # All four samples in [0, 3): median of [5, 5, 60, 60] = 32.5 → zeer dicht.
    assert outcome.median_qc_mpa == pytest.approx(32.5)
    assert outcome.nad_class == 8


# ---------------------------------------------------------------------------
# GW — the geological wall is GONE; the lithostratigraphic one stands
# ---------------------------------------------------------------------------
#
# Owner, 2026-08-26: *"just drop the wall everywhere, user wil have to manually
# do it"*. A geological line is no longer structure for the packing bands: the
# machine never cuts at one and the editor never refuses one. Five clays in his
# project were cut by the wall — GEO-05/040-S3's clay 0.05-1.48 m was cut at
# 0.57 m into NAD 21 over NAD 21, twin halves of one band and a pure artefact.
# The Tertiary case he DOES want divided (GEO-10/171-B9, Kortrijk top at
# 18.00 m) becomes a hand split; the split tool already exists.
#
# The GW1-GW4 pins below were written on 2026-08-12, when the wall stood and
# only its data source was in question. Each is retired or inverted here
# deliberately, and named so the history is legible.


def test_gw1_a_merge_whose_stamps_disagree_is_allowed() -> None:
    """GW1 (kept, wall-independent) — a build-time stamp never refuses a merge.

    This was the 2026-08-12 pin that stale stamps must not wall an edit. It
    survives the 2026-08-26 ruling unchanged in intent: no geological datum,
    live or stamped, refuses anything now.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, 7, litho=LITHO_A, geo=GEO_2),
    ]

    plan = plan_merge(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert plan.kind == KIND_MERGE
    (survivor,) = plan.intervals
    assert (survivor.depth_top_m, survivor.depth_base_m) == (0.0, 7.0)


def test_gw2_a_geological_contact_inside_the_union_no_longer_refuses() -> None:
    """GW2 (INVERTED, 2026-08-26) — a merge across a geological line is allowed.

    The 2026-08-12 version of this test asserted the refusal and only argued
    about which depths the wall should read. The owner has since ruled the wall
    away entirely: he merges across the geological line himself, and re-splits
    by hand where he wants the division.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        # The geological contact sits at 4.00 m, squarely between the two bands.
        _band("upper", 0.0, 4.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, 7, litho=LITHO_A, geo=GEO_2),
    ]

    plan = plan_merge(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert plan.kind == KIND_MERGE
    (survivor,) = plan.intervals
    assert (survivor.depth_top_m, survivor.depth_base_m) == (0.0, 7.0)


# GW3 (RETIRED, 2026-08-26) — "a live contact on the union's outer edge does not
# refuse" pinned the tolerance band of a wall that no longer exists. Nothing is
# refused at any position now, so the case is covered by GW2 above.


def test_gw4_a_move_across_a_geological_contact_is_allowed() -> None:
    """GW4 (INVERTED, 2026-08-26) — the drag reads no geological datum either.

    The merge and the move shared one wall, so dropping it must free both
    gestures. Dragging the 4.00 m boundary down to 5.00 m carries it across the
    geological contact that used to pin it there.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, 7, litho=LITHO_A, geo=GEO_2),
    ]

    plan = plan_move(
        bands=bands,
        upper_band_id="upper",
        lower_band_id="lower",
        new_depth_m=5.0,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert plan.kind == KIND_MOVE
    assert len(plan.intervals) == 2
    assert [(i.depth_top_m, i.depth_base_m) for i in plan.intervals] == [(0.0, 5.0), (5.0, 7.0)]


def test_gw5_the_split_reports_the_whole_litho_unit_as_its_walls() -> None:
    """GW5 (2026-08-26) — the third gesture: the walls a split reports widen too.

    The split verb never read a geological datum directly, but it reports the
    walls it clamps to, and the section editor draws the amber "stopped here"
    readout from them. Those walls used to end at the geological parent change,
    so the engineer was stopped mid-unit by a line he is now free to cross. The
    band being split sits above the geological change at 4.00 m; its reported
    walls must still reach the base of the litho unit at 7.00 m.
    """
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, 7, litho=LITHO_A, geo=GEO_2),
    ]

    plan = plan_split(
        bands=bands,
        band_id="upper",
        split_depth_m=2.0,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.1,
    )

    assert (plan.parent_top_m, plan.parent_base_m) == (0.0, 7.0)
    assert [(i.depth_top_m, i.depth_base_m) for i in plan.intervals] == [(0.0, 2.0), (2.0, 4.0)]


# --- CONTROL: the LITHOSTRATIGRAPHIC wall is untouched ----------------------
#
# "THE LITHO WALL STAYS: a packing boundary still never moves/crosses a LITHO
# contact and stays inside its litho body." These three pins fail if dropping
# the geological wall took the litho one with it.


def test_gw6_control_a_merge_across_a_litho_contact_is_still_refused() -> None:
    """GW6 — the litho contact still refuses the merge, and says which wall it is."""
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, 7, litho=LITHO_B, geo=GEO_1),
    ]

    with pytest.raises(GeotechBandEditError) as err:
        plan_merge(
            bands=bands,
            upper_band_id="upper",
            lower_band_id="lower",
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.1,
        )
    message = str(err.value)
    assert "lithostratigraphic" in message
    assert "litho axis" in message


def test_gw7_control_a_move_across_a_litho_contact_is_still_refused() -> None:
    """GW7 — the drag stops at the litho contact, naming the gesture the owner made."""
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, 7, litho=LITHO_B, geo=GEO_1),
    ]

    with pytest.raises(GeotechBandEditError) as err:
        plan_move(
            bands=bands,
            upper_band_id="upper",
            lower_band_id="lower",
            new_depth_m=5.0,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.1,
        )
    assert "Move rejected" in str(err.value)
    assert "lithostratigraphic" in str(err.value)


def test_gw8_control_a_split_outside_the_litho_body_is_still_refused() -> None:
    """GW8 — the split still clamps at the litho unit's own edge."""
    depths, qc = _series([(0.0, 10.0, 5.0)])
    bands = [
        _band("upper", 0.0, 4.0, 6, litho=LITHO_A, geo=GEO_1),
        _band("lower", 4.0, 7.0, 7, litho=LITHO_B, geo=GEO_1),
    ]

    with pytest.raises(GeotechBandEditError) as err:
        plan_split(
            bands=bands,
            band_id="upper",
            # 5.00 m is inside the COLUMN but past the litho contact at 4.00 m.
            split_depth_m=5.0,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.1,
        )
    assert "litho" in str(err.value).lower()


# ---------------------------------------------------------------------------
# AR — plan_absorb_run: Ctrl+drag absorb-all on the geotech axis (owner 2026-09-25)
# ---------------------------------------------------------------------------
#
# "Add the ctrl drag over multiple geotech ghost to absorb them" — the litho
# ghost gesture (PR #53) on packing bands: the dragged boundary runs through
# every band it passes, those bands union into the dragged one, and the
# boundary with the band the release landed in moves to the released depth.
# ONE plan, so the consequence sheet shows the final two intervals and never
# an intermediate union that exists on no screen.


def test_ar1_a_downward_absorb_unions_the_run_and_lands_in_the_entered_band() -> None:
    """AR1 - b1's base dragged through b2 and b3, released inside b4."""
    depths, qc = _series([(0.0, 1.0, 5.0), (1.0, 4.0, 18.0), (4.0, 6.0, 5.0)])
    bands = [
        _band("b1", 0.0, 1.0, 6),
        _band("b2", 1.0, 2.0, 8),
        _band("b3", 2.0, 3.0, 8),
        _band("b4", 3.0, 6.0, 6),
    ]
    plan = plan_absorb_run(
        bands=bands,
        band_ids=["b1", "b2", "b3"],
        entered_band_id="b4",
        new_depth_m=4.5,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert plan.kind == KIND_ABSORB
    merged, entered = plan.intervals
    assert (merged.depth_top_m, merged.depth_base_m) == (0.0, 4.5)
    assert (entered.depth_top_m, entered.depth_base_m) == (4.5, 6.0)
    # Both survivors re-derive over their NEW extents (ruling 3), never carried.
    assert merged.nad_class is not None and entered.nad_class is not None
    assert (plan.parent_top_m, plan.parent_base_m) == (0.0, 6.0)


def test_ar2_an_upward_absorb_is_the_mirror() -> None:
    """AR2 - b4's top dragged up through b3 and b2, released inside b1."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [
        _band("b1", 0.0, 1.0, 6),
        _band("b2", 1.0, 2.0, 8),
        _band("b3", 2.0, 3.0, 8),
        _band("b4", 3.0, 6.0, 6),
    ]
    plan = plan_absorb_run(
        bands=bands,
        band_ids=["b4", "b3", "b2"],  # any order — normalised by depth
        entered_band_id="b1",
        new_depth_m=0.5,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    entered, merged = plan.intervals
    assert (entered.depth_top_m, entered.depth_base_m) == (0.0, 0.5)
    assert (merged.depth_top_m, merged.depth_base_m) == (0.5, 6.0)


def test_ar3_released_at_the_litho_wall_there_is_no_entered_band_and_one_union() -> None:
    """AR3 - dragged past every band to the wall: the run is the whole union."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [_band("b1", 0.0, 1.0, 6), _band("b2", 1.0, 2.0, 8), _band("b3", 2.0, 6.0, 8)]
    plan = plan_absorb_run(
        bands=bands,
        band_ids=["b1", "b2", "b3"],
        entered_band_id=None,
        new_depth_m=None,
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        min_thickness_m=0.35,
    )
    assert plan.kind == KIND_ABSORB
    assert len(plan.intervals) == 1
    assert (plan.intervals[0].depth_top_m, plan.intervals[0].depth_base_m) == (0.0, 6.0)


def test_ar4_the_entered_band_must_touch_the_far_end_of_the_run() -> None:
    """AR4 - a band the drag never reached cannot be the one it landed in."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [
        _band("b1", 0.0, 1.0, 6),
        _band("b2", 1.0, 2.0, 8),
        _band("b3", 2.0, 3.0, 8),
        _band("b4", 3.0, 6.0, 6),
    ]
    with pytest.raises(GeotechBandEditError) as err:
        plan_absorb_run(
            bands=bands,
            band_ids=["b1", "b2"],
            entered_band_id="b4",  # b3 sits between the run and b4
            new_depth_m=4.0,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )
    assert "Absorb rejected" in str(err.value)


def test_ar5_the_released_depth_must_lie_strictly_inside_the_entered_band() -> None:
    """AR5 - a release inside the run itself is a shorter absorb, not this one."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [_band("b1", 0.0, 1.0, 6), _band("b2", 1.0, 2.0, 8), _band("b3", 2.0, 6.0, 8)]
    with pytest.raises(GeotechBandEditError) as err:
        plan_absorb_run(
            bands=bands,
            band_ids=["b1", "b2"],
            entered_band_id="b3",
            new_depth_m=1.5,  # inside b2, not b3
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )
    assert "Absorb rejected" in str(err.value)


def test_ar6_a_run_never_crosses_a_litho_contact() -> None:
    """AR6 - ruling 2 holds for the run exactly as for a pair merge."""
    depths, qc = _series([(0.0, 6.0, 12.0)])
    bands = [
        _band("b1", 0.0, 1.0, 6, litho=LITHO_A),
        _band("b2", 1.0, 2.0, 8, litho=LITHO_A),
        _band("b3", 2.0, 6.0, 8, litho=LITHO_B),
    ]
    with pytest.raises(GeotechBandEditError) as err:
        plan_absorb_run(
            bands=bands,
            band_ids=["b1", "b2", "b3"],
            entered_band_id=None,
            new_depth_m=None,
            soil="ZAND",
            admixtures=(),
            depth_m=depths,
            qc_mpa=qc,
            min_thickness_m=0.35,
        )
    assert "Absorb rejected" in str(err.value)
    assert "lithostratigraphic" in str(err.value)
