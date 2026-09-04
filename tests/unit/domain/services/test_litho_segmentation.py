"""Behaviour of the CPT and borehole lithology segmenters (litho slice 3).

Pins the segmentation contract the owner specified: a user-set
minimum layer thickness merges sub-threshold runs, the major
lithology boundaries survive, sand layers carry a Dr-derived NAD
class, and the output is a contiguous top-to-bottom partition. Pure
unit — synthetic series, no DB, no DOV.

Borehole-path tests (dogfeed 2026-05-25): same-lithology merge applies
to the borehole segmenter identically to the CPT path.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_segmentation import segment_borehole, segment_cpt


def test_segments_sand_over_clay_and_merges_thin_sliver() -> None:
    """A clean-sand block over a clay block, with a 0.2 m silt sliver
    between, segmented at 0.5 m min thickness: the sand/clay boundary
    survives, the sub-threshold sliver is merged away."""
    step = 0.1
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float | None] = []

    # 0.0–4.0 m: clean dense sand (high qc, low fs).
    z = 0.0
    while z < 4.0 - 1e-9:
        depths.append(round(z, 2))
        qc.append(22.0)
        fs.append(0.10)
        z += step
    # 4.0–4.2 m: thin silt sliver (sub-min-thickness — must merge).
    while z < 4.2 - 1e-9:
        depths.append(round(z, 2))
        qc.append(3.0)
        fs.append(0.12)
        z += step
    # 4.2–8.0 m: soft clay (low qc, higher fs).
    while z < 8.0 - 1e-9:
        depths.append(round(z, 2))
        qc.append(0.7)
        fs.append(0.045)
        z += step

    layers = segment_cpt(
        depths,
        qc,
        fs,
        niveau_m=10.0,
        yw_m=10.0,
        minimum_layer_thickness_m=0.5,
    )

    # At least the two major bodies; the 0.2 m sliver did NOT survive
    # as its own ≥0.5 m layer.
    assert len(layers) >= 2
    assert all((lyr.depth_base_m - lyr.depth_top_m) >= 0.5 - 1e-6 for lyr in layers), [
        (round(x.depth_top_m, 2), round(x.depth_base_m, 2)) for x in layers
    ]

    # Contiguous, ordered top→bottom, spanning the full series.
    assert layers[0].depth_top_m == depths[0]
    for a, b in zip(layers, layers[1:], strict=False):
        assert b.depth_top_m >= a.depth_top_m
        assert b.depth_top_m == a.depth_base_m  # no gaps / overlaps

    # The shallow body reads as sand, the deep body as a fine soil.
    assert layers[0].suggested_lithology == "ZAND"
    assert layers[-1].suggested_lithology in ("KLEI", "SILT", "VEEN")


def test_sand_layer_carries_a_dr_and_nad_class() -> None:
    """A clean-sand column yields a ZAND layer with Dr and a NAD class
    in the clean-sand band 5..8."""
    step = 0.1
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float | None] = []
    z = 0.0
    while z < 6.0 - 1e-9:
        depths.append(round(z, 2))
        qc.append(18.0)
        fs.append(0.09)
        z += step

    layers = segment_cpt(depths, qc, fs, niveau_m=10.0, yw_m=10.0, minimum_layer_thickness_m=0.5)
    assert layers
    sand = [x for x in layers if x.suggested_lithology == "ZAND"]
    assert sand, "expected at least one ZAND layer"
    top = sand[0]
    assert top.dr_pct is not None
    assert top.suggested_nad_class in (5, 6, 7, 8)
    assert top.mean_qc_mpa is not None


def test_deep_loose_sand_still_gets_dr_nad_raw_fr_gate() -> None:
    """Senior-review B1 regression: the sand Dr/NAD gate is on RAW
    FR=fs/qc*100 (the clean-sand gate's raw friction ratio), not the Robertson-normalised F.

    A deep, loose, low-friction sand has raw FR < 1.2 but, under high
    overburden, normalised F ≥ 1.2. Gating on normalised F (the bug)
    would skip Dr and leave nad_class None for exactly this
    commercially-important case. Build a thick sand column starting
    deep (large niveau→stress) with very low fs so raw FR ≈ 0.7 % and
    assert a ZAND layer with Dr + a clean-sand NAD class is produced.
    """
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float | None] = []
    z = 0.0
    while z < 8.0 - 1e-9:
        depths.append(round(z, 2))
        qc.append(2.2)  # loose sand
        fs.append(0.0154)  # raw FR = 0.0154/2.2*100 ≈ 0.70 % (< 1.2)
        z += 0.1

    # Deep ground surface + deep water → high effective stress, which
    # is what pushes normalised F above the raw FR for the same point.
    layers = segment_cpt(
        depths,
        qc,
        fs,
        niveau_m=40.0,
        yw_m=38.0,
        minimum_layer_thickness_m=0.5,
    )
    sand = [x for x in layers if x.suggested_lithology == "ZAND"]
    assert sand, "deep loose sand should classify as ZAND"
    assert any(s.dr_pct is not None for s in sand), (
        "raw-FR gate must admit deep loose sand for Dr (normalised-F gate would wrongly skip it)"
    )
    assert any(s.suggested_nad_class in (5, 6, 7, 8) for s in sand)


def test_min_thickness_controls_granularity() -> None:
    """A larger minimum thickness yields no more layers than a smaller
    one over the same series (coarser segmentation)."""
    step = 0.1
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float | None] = []
    # Alternating 0.4 m sand / clay bands — fine vs coarse min thickness.
    z = 0.0
    band = 0
    while z < 8.0 - 1e-9:
        depths.append(round(z, 2))
        if band % 2 == 0:
            qc.append(20.0)
            fs.append(0.10)
        else:
            qc.append(0.8)
            fs.append(0.05)
        z += step
        if abs(z % 0.4) < 1e-9:
            band += 1

    fine = segment_cpt(depths, qc, fs, niveau_m=10.0, yw_m=10.0, minimum_layer_thickness_m=0.3)
    coarse = segment_cpt(depths, qc, fs, niveau_m=10.0, yw_m=10.0, minimum_layer_thickness_m=2.0)
    assert len(coarse) <= len(fine)
    assert all((x.depth_base_m - x.depth_top_m) >= 2.0 - 1e-6 for x in coarse) or len(coarse) == 1


def test_empty_series_returns_no_layers() -> None:
    """No data → no suggestions, never a crash."""
    assert segment_cpt([], [], [], niveau_m=10.0, yw_m=10.0) == []


def test_non_normalised_mode_segments_via_isbt_and_skips_dr_nad() -> None:
    """use_normalised_qc=False classifies via the non-normalised I_SBT index.

    It builds no effective-stress profile, so Dr (and the NAD packing class
    derived from it) cannot be computed — sand layers carry dr_pct=None and
    suggested_nad_class=None. The lithology segmentation itself still works:
    a dense-sand block over soft clay reads sand-over-fine, contiguous.
    """
    step = 0.1
    depths: list[float] = []
    qc: list[float] = []
    fs: list[float | None] = []
    z = 0.0
    while z < 4.0 - 1e-9:  # dense sand
        depths.append(round(z, 2))
        qc.append(22.0)
        fs.append(0.10)
        z += step
    while z < 8.0 - 1e-9:  # soft clay
        depths.append(round(z, 2))
        qc.append(0.7)
        fs.append(0.045)
        z += step

    layers = segment_cpt(
        depths,
        qc,
        fs,
        niveau_m=10.0,
        yw_m=10.0,
        minimum_layer_thickness_m=0.5,
        use_normalised_qc=False,
    )

    assert layers
    assert layers[0].suggested_lithology == "ZAND"
    assert layers[-1].suggested_lithology in ("KLEI", "SILT", "VEEN")
    for a, b in zip(layers, layers[1:], strict=False):
        assert b.depth_top_m == a.depth_base_m  # contiguous, gap-free
    # Dr / NAD need effective stress, which non-normalised mode does not build.
    assert all(lyr.dr_pct is None for lyr in layers)
    assert all(lyr.suggested_nad_class is None for lyr in layers)


# ---------------------------------------------------------------------------
# Borehole-path merge tests (dogfeed 2026-05-25)
# ---------------------------------------------------------------------------
#
# Data-structure note: the borehole segmenter uses layer MIDPOINTS as the
# depth proxy inside _greedy_merge.  A single-layer run has zero midpoint
# thickness and is absorbed into its neighbour by the greedy-merge before
# merge_adjacent_same_lithology ever fires.  Tests therefore use at least
# TWO observation layers per distinct lithology unit so each RLE run spans
# a non-zero midpoint distance and survives the greedy-merge step.
#
# DOV hoofdnaam codes used below (see litho_segmentation_constants.py):
#   "XZ" → ZAND (zand, generic)
#   "KL" → KLEI (klei)
#   "SI" → SILT (silt)


def test_borehole_merge_collapses_same_lithology_stack() -> None:
    """Two ZAND obs-layers / two KLEI obs-layers / two ZAND obs-layers.

    After the greedy-merge (RLE collapses adjacent same-code layers to one
    run each) we get three segments: ZAND [0-2], KLEI [2-4], ZAND [4-6].
    The ZAND and KLEI runs are already distinct — merge_adjacent_same_lithology
    has nothing to collapse.  Asserting three output layers verifies the whole
    pipeline produces non-stacked output.

    The dogfeed symptom (2026-05-25) was SAND/SAND/CLAY/SAND/SAND stacked
    bands — five segments instead of three.  This test pins the correct shape.
    """
    # 6 observation layers, each 1 m thick, DOV codes: XZ XZ KL KL XZ XZ
    tops = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]
    bases = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    codes: list[list[str]] = [["XZ"], ["XZ"], ["KL"], ["KL"], ["XZ"], ["XZ"]]

    layers = segment_borehole(tops, bases, codes, minimum_layer_thickness_m=0.5)

    # Three segments: ZAND [0-2], KLEI [2-4], ZAND [4-6]
    assert len(layers) == 3, [
        (round(lyr.depth_top_m, 2), round(lyr.depth_base_m, 2), lyr.suggested_lithology)
        for lyr in layers
    ]
    assert layers[0].suggested_lithology == "ZAND"
    assert layers[0].depth_top_m == 0.0
    assert layers[0].depth_base_m == 2.0
    assert layers[1].suggested_lithology == "KLEI"
    assert layers[1].depth_top_m == 2.0
    assert layers[1].depth_base_m == 4.0
    assert layers[2].suggested_lithology == "ZAND"
    assert layers[2].depth_top_m == 4.0
    assert layers[2].depth_base_m == 6.0
    assert all(lyr.source == "borehole_observation" for lyr in layers)


def test_borehole_merge_collapses_zand_split_by_thin_silt() -> None:
    """A thin SILT interbed between two ZAND blocks that is thinner than
    minimum_layer_thickness_m gets absorbed by greedy-merge, leaving two
    adjacent ZAND runs.  merge_adjacent_same_lithology then collapses those
    into a single ZAND layer — this is the exact merge-pass exercise.

    Setup: ZAND×2 (2 m) / SILT×1 (0.25 m, sub-threshold) / ZAND×2 (2 m).
    minimum_layer_thickness_m = 0.5 m.  The SILT run spans one layer whose
    midpoint thickness = 0 relative to adjacent midpoints → absorbed by
    greedy-merge into the preceding ZAND.  merge_adjacent_same_lithology
    then finds two adjacent ZAND runs and collapses them to one.
    """
    # Observation layers — each 0.5 m except the thin SILT at 0.25 m
    tops = [0.0, 0.5, 1.0, 1.25, 1.75]
    bases = [0.5, 1.0, 1.25, 1.75, 2.25]
    codes: list[list[str]] = [["XZ"], ["XZ"], ["SI"], ["XZ"], ["XZ"]]

    layers = segment_borehole(tops, bases, codes, minimum_layer_thickness_m=0.5)

    # The thin SILT is absorbed; the two ZAND runs merge → one ZAND layer.
    assert len(layers) == 1, [
        (round(lyr.depth_top_m, 3), round(lyr.depth_base_m, 3), lyr.suggested_lithology)
        for lyr in layers
    ]
    assert layers[0].suggested_lithology == "ZAND"
    assert layers[0].depth_top_m == 0.0
    assert layers[0].depth_base_m == 2.25


def test_borehole_merge_disabled_keeps_greedy_merge_output_unchanged() -> None:
    """merge_same_lithology=False: the same-lithology merge pass is skipped;
    the greedy-merge output is returned as-is.

    Same input as test_borehole_merge_collapses_zand_split_by_thin_silt:
    after greedy-merge the two ZAND runs are adjacent.  With merge disabled
    both survive as separate layers.
    """
    tops = [0.0, 0.5, 1.0, 1.25, 1.75]
    bases = [0.5, 1.0, 1.25, 1.75, 2.25]
    codes: list[list[str]] = [["XZ"], ["XZ"], ["SI"], ["XZ"], ["XZ"]]

    merged = segment_borehole(tops, bases, codes, minimum_layer_thickness_m=0.5)
    unmerged = segment_borehole(
        tops, bases, codes, minimum_layer_thickness_m=0.5, merge_same_lithology=False
    )

    # Merge collapses to fewer layers than the disabled path.
    assert len(merged) < len(unmerged)
    # Both end at the same base depth.
    assert merged[-1].depth_base_m == unmerged[-1].depth_base_m


def test_borehole_merge_admixtures_propagated_on_collapse() -> None:
    """When two ZAND runs with a KL admixture collapse, the admixture is
    carried into the merged result (not silently dropped).

    Build a case where merge_adjacent_same_lithology fires: thin SILT between
    two ZAND×2 blocks so the SILT is absorbed by greedy-merge, then the two
    ZAND runs collapse.  The admixture on both ZAND groups must appear in
    the merged result.
    """
    from groundmodel.domain.value_objects.admixture import Admixture

    tops = [0.0, 0.5, 1.0, 1.25, 1.75]
    bases = [0.5, 1.0, 1.25, 1.75, 2.25]
    codes: list[list[str]] = [["XZ"], ["XZ"], ["SI"], ["XZ"], ["XZ"]]
    admix = Admixture(soil_code="KL", amount="zwak", locally=False)
    # ZAND layers carry the admixture; SILT layer does not.
    admixtures: list[list[Admixture]] = [[admix], [admix], [], [admix], [admix]]

    layers = segment_borehole(
        tops,
        bases,
        codes,
        minimum_layer_thickness_m=0.5,
        admixtures_per_layer=admixtures,
    )

    # Collapsed to one ZAND layer carrying the KL admixture.
    assert len(layers) == 1
    assert layers[0].suggested_lithology == "ZAND"
    assert len(layers[0].suggested_admixtures) == 1
    assert layers[0].suggested_admixtures[0].soil_code == "KL"


def test_borehole_merge_structural_error_unknown_code() -> None:
    """Layers with unmappable codes are skipped; remaining mapped layers
    still merge correctly — the function never raises on unknown codes."""
    # UNKNOWN / ZAND×2 / KLEI×2 — the unknown code maps to None and
    # is dropped by greedy-merge.
    tops = [0.0, 1.0, 2.0, 3.0, 4.0]
    bases = [1.0, 2.0, 3.0, 4.0, 5.0]
    codes: list[list[str]] = [["NOTACODE"], ["XZ"], ["XZ"], ["KL"], ["KL"]]

    layers = segment_borehole(tops, bases, codes, minimum_layer_thickness_m=0.5)

    # The unknown layer is absorbed; one or two mappable layers remain.
    assert len(layers) >= 1
    assert all(
        lyr.suggested_lithology in ("ZAND", "KLEI", "SILT", "GRIND", "VEEN") for lyr in layers
    )


def test_borehole_empty_series_returns_no_layers() -> None:
    """No borehole layers → no suggestions, never a crash."""
    assert segment_borehole([], [], []) == []


def test_a_two_metre_clay_bed_described_as_one_log_layer_survives_the_minimum() -> None:
    """A real bed thicker than the minimum must survive, even when the driller
    described it as ONE layer.

    This is the normal shape of a DOV description log: one observation layer per
    lithology change (XZ 0–1.5 m, KL 1.5–3.5 m, XZ 3.5–8 m). The 2 m clay bed is
    more than ten times the 0.15 m default minimum, so the engineer must be shown
    a KLEI ghost between two ZAND ghosts — not a single sand column.
    """
    tops = [0.0, 1.5, 3.5]
    bases = [1.5, 3.5, 8.0]
    codes = [["XZ"], ["KL"], ["XZ"]]

    layers = segment_borehole(tops, bases, codes, minimum_layer_thickness_m=0.15)

    assert [s.suggested_lithology for s in layers] == ["ZAND", "KLEI", "ZAND"]
    klei = layers[1]
    assert klei.depth_top_m == 1.5
    assert klei.depth_base_m == 3.5


def test_alternating_single_layer_log_is_not_collapsed_into_one_layer() -> None:
    """Every layer a different lithology → every layer survives, none absorbed.

    The degenerate case of the same rule: when no two consecutive log layers
    share a lithology, each run is a single observation layer. Measuring those
    runs by anything other than their real bounds collapses the whole borehole
    into one layer of whichever lithology happened to survive.
    """
    tops = [0.0, 1.0, 2.0, 3.0]
    bases = [1.0, 2.0, 3.0, 4.0]
    codes = [["XZ"], ["KL"], ["LE"], ["XZ"]]

    layers = segment_borehole(tops, bases, codes, minimum_layer_thickness_m=0.15)

    assert len(layers) == 4
    assert layers[0].depth_top_m == 0.0
    assert layers[-1].depth_base_m == 4.0


def test_a_genuinely_thin_single_log_layer_is_still_absorbed() -> None:
    """The near-miss: a 5 cm drape below the 0.15 m minimum still merges away.

    Fixing the thickness measure must not turn the minimum into a no-op.
    """
    tops = [0.0, 1.50, 1.55]
    bases = [1.50, 1.55, 4.0]
    codes = [["XZ"], ["KL"], ["XZ"]]

    layers = segment_borehole(tops, bases, codes, minimum_layer_thickness_m=0.15)

    assert [s.suggested_lithology for s in layers] == ["ZAND"]
    assert layers[0].depth_top_m == 0.0 and layers[0].depth_base_m == 4.0
