"""Tests for the geotech NAD subdivision suggester (spec §4 Step B)."""

import pytest

from groundmodel.domain.services.geotech_band_reclassification import (
    GeotechBand,
    ProposedInterval,
    reclassify_intervals,
)
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


def test_no_samples_returns_one_band_spanning_the_segment():
    """A segment with no CPT samples still returns exactly one band — never empty."""
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
#   4. No qc in the window at all → needs review (nad_class None), NOT a class.
#      (Revised 2026-08-03: rule 4 used to read "borehole-only → loosest class".
#      Only CPT segments ever reach this function, so an empty window means the
#      cone did not read here — see the no-cone-readings block at the bottom.)


def test_no_cpt_series_at_all_needs_review_not_a_class():
    """An empty qc series answers "needs review" — the same as any unread window.

    A class asserted from zero readings is an invented value; the caller
    (SubdivideAllBodies) already routes a genuinely series-less investigation to
    a skeleton band before this function is reached."""
    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=[],
        qc_mpa=[],
        segment_top_m=5.0,
        segment_base_m=10.0,
        min_thickness_m=0.35,
    )
    assert [s.nad_class for s in splits] == [None]


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


def test_one_isolated_bad_point_never_flags_a_coarse_cpt():
    """Rule 2 ("one isolated bad point never flags a unit") must hold at ANY spacing.

    The same single void reading that is irrelevant on a 2 cm CPT is still one
    isolated bad point on a logger writing at 5 cm — the engineer's qc is good
    everywhere else, so the unit must classify, not come back unnamed.
    """
    depths = _depths(0.0, 2.0, 0.05)  # coarser, uniform CPT: 5 cm spacing
    qc: list = [8.0] * len(depths)
    qc[20] = None  # exactly one void reading in the middle
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


def test_a_change_of_sampling_interval_alone_never_flags_a_unit():
    """Every qc reading is good — a hybrid CPT changing its step must still classify.

    An electric cone at 2 cm continued mechanically at 20 cm reads valid qc over
    the whole unit. Nothing is missing, so "needs review" would be telling the
    engineer his data is bad because the rig changed method.
    """
    depths = _depths(0.0, 1.0, 0.02) + _depths(1.2, 3.0, 0.20)
    qc: list = [8.0] * len(depths)
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
    assert [s.nad_class for s in splits] == [6]


def test_a_cone_that_returned_half_its_readings_scattered_still_needs_review():
    """Half the cone's readings are unusable, spread out one at a time — review.

    Rule 3's first half ("more than ~40% of the unit's thickness lacks valid qc")
    is about HOW MUCH of the unit has no reading, not about whether the bad
    readings happen to sit next to each other. A cone that came back with every
    other sample void gave the engineer half a unit's worth of data; a NAD class
    stamped "CPT-derived estimate" from that is an invented value.
    """
    depths = _depths(0.0, 2.0, 0.02)  # 101 samples over 2 m at CPT density
    qc: list = [8.0] * len(depths)
    for i in range(1, len(depths), 2):  # every other reading void, never two in a row
        qc[i] = None
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
    assert [s.nad_class for s in splits] == [None]


def test_a_few_scattered_dropouts_well_under_the_fraction_still_classify():
    """The near-miss to the rule above: a handful of one-off dropouts is not half a unit.

    Five isolated void readings on a 2 cm logger leave ~10 cm of a 2 m unit
    unread (5%) — nowhere near the 40% bound, and no run long enough to trip the
    gap rule either. The unit must still come back with a class.
    """
    depths = _depths(0.0, 2.0, 0.02)
    qc: list = [8.0] * len(depths)
    for i in (7, 23, 41, 67, 89):  # five scattered dropouts, none adjacent
        qc[i] = None
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


def test_a_run_of_voids_on_a_coarse_cpt_still_needs_review():
    """The relaxation must not swallow a real void run: several dropouts in a row
    leave a stretch with no usable reading, and that unit stays unnamed."""
    depths = _depths(0.0, 2.0, 0.05)
    qc: list = [8.0] * len(depths)
    for i in range(20, 25):  # ~25 cm of continuous void
        qc[i] = None
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
    assert [s.nad_class for s in splits] == [None]


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


# --- no cone readings in the window -----------------------------------------
# ``suggest_geotech_subdivision`` is only ever reached for CPT segments
# (``subdivide_all_bodies.py``: ``cpt_segs = [s for s in group_segs if
# anchor_kind.get(...) == "cpt"]``, and a CPT with no series row is routed to a
# skeleton band before this function is called). So "no samples in the window"
# never means "this is a borehole"; it means the cone did not read over this
# interval — a contact placed above the CPT's first sample (pre-drill start), or
# a sliver produced by the geo-bounding divide.


def test_cpt_window_with_no_cone_readings_needs_review_not_a_packing_class():
    """A window the cone never read gets NO packing class — it is flagged for review.

    The class is *derived from the cone resistance*. With no cone resistance in
    the interval there is nothing to derive it from, so the answer is "needs
    review", never a plausible number. "Loose sand" is the most consequential
    packing answer in a BE/NL deliverable; it must never come from zero readings.
    """
    depths = _depths(1.0, 5.0, 0.02)  # the cone starts reading at 1.0 m
    qc = [12.0] * len(depths)

    splits = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,  # contact placed above the first sample
        segment_base_m=0.8,
        min_thickness_m=0.35,
    )

    assert len(splits) == 1
    assert splits[0].depth_top_m == 0.0 and splits[0].depth_base_m == 0.8
    assert splits[0].nad_class is None


def test_build_and_band_edit_agree_that_an_unread_window_cannot_be_classified():
    """Parity: the build and the band-edit preview give the SAME answer for one interval.

    The band-edit dialog already refuses ("the class cannot be re-derived here").
    The build must not answer a question the preview says is unanswerable —
    otherwise the two surfaces disagree about the same metres of soil.
    """
    depths = _depths(1.0, 5.0, 0.02)
    qc: list[float | None] = [12.0] * len(depths)
    top_m, base_m = 0.0, 0.8

    build = suggest_geotech_subdivision(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=top_m,
        segment_base_m=base_m,
        min_thickness_m=0.35,
    )

    band = GeotechBand(
        band_id="band-1",
        depth_top_m=top_m,
        depth_base_m=base_m,
        nad_class=5,
        source_litho_formation_id="litho-1",
        source_geo_formation_id=None,
    )
    preview = reclassify_intervals(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        intervals=[ProposedInterval(depth_top_m=top_m, depth_base_m=base_m, sources=(band,))],
    )

    assert preview[0].nad_class is None
    assert preview[0].unclassifiable_reason is not None
    assert [s.nad_class for s in build] == [o.nad_class for o in preview], (
        "the build and the band-edit preview disagree about whether this interval "
        "can be classified from the cone resistance"
    )


# --- Ruling 7: the representative statistic is the MODEL'S choice -----------


def test_statistic_shifts_the_class_of_a_hand_edit_interval():
    """ST-SUB1 - the chosen statistic governs the class a HAND EDIT derives.

    Ruling 7 (docs/debt.md #227): harmonic is weighted toward the low values
    that govern bearing and settlement, so the choice systematically shifts
    classes. The subdivision pipeline itself quantizes bands into same-class
    runs before classifying (sustained cuts), so the statistic's class-shifting
    power lives where the owner exercises it: re-deriving an arbitrary
    interval a hand merge/drag created, spanning a loose/dense boundary.
    """
    depths = [0.0, 0.5, 1.0, 1.5, 2.0]
    # Half-open sampling keeps d in [0.0, 2.0): the union sees [4, 14, 14, 14]
    # -> median 14.0 (dicht) vs harmonic ~8.6 (matig) — the low excursion that
    # governs bearing pulls the conservative statistic across the 10 MPa wall.
    qc = [4.0, 14.0, 14.0, 14.0, 14.0]
    band = GeotechBand(
        band_id="band-1",
        depth_top_m=0.0,
        depth_base_m=2.0,
        nad_class=7,
        source_litho_formation_id="litho-1",
        source_geo_formation_id=None,
    )
    interval = ProposedInterval(depth_top_m=0.0, depth_base_m=2.0, sources=(band,))
    kwargs = dict(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        intervals=[interval],
    )
    median_run = reclassify_intervals(**kwargs)
    harmonic_run = reclassify_intervals(**kwargs, statistic="harmonic")

    assert median_run[0].nad_class is not None and harmonic_run[0].nad_class is not None
    assert harmonic_run[0].nad_class < median_run[0].nad_class


def test_statistic_default_is_median_identical_output():
    """ST-SUB2 - omitting the statistic IS the median run (frozen-gate safety).

    Every caller that predates ruling 7 keeps byte-identical output, which is
    what keeps the CS1 frozen gates green by construction.
    """
    depths = [round(0.1 * i, 2) for i in range(31)]
    qc = [8.0 if d < 1.0 else (12.0 if d < 2.0 else 18.0) for d in depths]
    kwargs = dict(
        soil="ZAND",
        admixtures=(),
        depth_m=depths,
        qc_mpa=qc,
        segment_top_m=0.0,
        segment_base_m=3.0,
        min_thickness_m=0.35,
        gradient_snap=True,
    )
    assert suggest_geotech_subdivision(**kwargs) == suggest_geotech_subdivision(
        **kwargs, statistic="median"
    )


def test_st_sub3_the_build_arm_classifies_under_the_models_chosen_statistic() -> None:
    """ST-SUB3 — ruling 7 reaches the BUILD, not only the preview.

    The preview arm is pinned elsewhere. This is the arm that writes the bands
    the engineer keeps, and until this test it was unguarded: hard-coding
    ``median`` inside the build while still stamping
    ``classified_with_statistic='harmonic'`` left every suite green and every
    band classified under a statistic the model denied using — the silent
    divergence ruling 6 exists to forbid.

    The scene is a dicht sand carrying isolated weak readings, scattered so no
    run of them is long enough to become a band of its own. The segment
    therefore survives as ONE band and its name is decided purely by the chosen
    statistic — which is the point of offering the choice. The median shrugs the
    weak readings off (12 MPa, *dicht*); the harmonic mean is dragged down by
    them (8.2 MPa, *matig*), which is exactly why a conservative engineer picks
    it. Same data, same boundaries, different name.
    """
    sample_count = 500
    depth_m = [round(0.02 * i, 3) for i in range(sample_count)]
    qc_mpa: list[float | None] = [
        0.5 if i % 50 == 7 else 12.0 for i in range(sample_count)
    ]

    def bands_under(statistic: str) -> list[tuple[float, float, int | None]]:
        return [
            (s.depth_top_m, s.depth_base_m, s.nad_class)
            for s in suggest_geotech_subdivision(
                "ZAND",
                (),
                depth_m,
                qc_mpa,
                segment_top_m=0.0,
                segment_base_m=10.0,
                min_thickness_m=0.35,
                statistic=statistic,
            )
        ]

    median_bands = bands_under("median")
    harmonic_bands = bands_under("harmonic")

    # One band either way — the geometry is not what changed.
    assert median_bands == [(0.0, 10.0, 7)], median_bands
    assert harmonic_bands == [(0.0, 10.0, 6)], harmonic_bands
