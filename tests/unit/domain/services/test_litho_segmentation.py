"""Behaviour of the CPT lithology segmenter (litho slice 3).

Pins the segmentation contract the owner specified: a user-set
minimum layer thickness merges sub-threshold runs, the major
lithology boundaries survive, sand layers carry a Dr-derived NAD
class, and the output is a contiguous top-to-bottom partition. Pure
unit — synthetic series, no DB, no DOV.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_segmentation import segment_cpt


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
