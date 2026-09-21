"""The overhang above the flank cover reads the FLOOR, never the dense band.

Direct unit pins for the pure ``_clamp_bands_to_flank_cover`` band-planning
function.  Its behaviour was only exercised through the async ``DivideBoreholes``
class path (``test_geotech_flank_overhang.py``); these feed the pure function a
hand-built band list so the rule is guarded on its own terms before it moves out
of ``divide_boreholes.py`` into ``band_planning.py``.

Owner, installer #37 dogfeed (2026-09-14), borehole GEO-07/182-B2, on his own
clean-sand unit reading dense while both neighbours read medium dense there:

    I don't know where the dense sand is coming from though. it says md on the
    left and md on the right.

The rule the function encodes: where the borehole unit extends ABOVE the
shallowest flank band (or BELOW the deepest), the overhang takes the
conservative floor the flanks measured (``floor_class`` — the loosest packing),
NOT the class of the dense band next to it.  Design note s1c ("unread ground is
not silently claimed"): an overhang LONGER than the minimum layer thickness
becomes its own floor band; a shorter one keeps its neighbour's class and
stretches to the boundary.  A unit sitting entirely inside the flank coverage is
a strict no-op.
"""

from __future__ import annotations

from groundmodel.application.divide_boreholes import _clamp_bands_to_flank_cover
from groundmodel.domain.services.borehole_packing_fill import FillBand


def test_fc1_overhang_above_cover_takes_the_floor_not_the_dense_band() -> None:
    """FC1 — the owner's B2: the overhang reads the floor, not the dense sand.

    The borehole's dense (NAD 6) sand unit runs 0..5 m but the flanks only
    cover 2..5 m; the 0..2 m overhang above the cover must come back at the
    conservative floor class (NAD 3, ``body_min``), never the dense class of the
    band immediately below it.
    """
    bands = [FillBand(0.0, 5.0, 6, "cpt_interpolated")]
    correspondences = [("layerA",)]

    out_bands, out_corr = _clamp_bands_to_flank_cover(
        bands,
        correspondences,
        cover_top_m=2.0,
        cover_base_m=5.0,
        floor_class=3,
        min_thickness_m=0.35,
    )

    assert [(b.top, b.base, b.nad_class, b.source) for b in out_bands] == [
        (0.0, 2.0, 3, "body_min"),
        (2.0, 5.0, 6, "cpt_interpolated"),
    ]
    # The floor band continues nothing; the inside band keeps the flank layer id.
    assert out_corr == [(), ("layerA",)]


def test_fc2_unit_inside_flank_cover_is_a_strict_no_op() -> None:
    """FC2 — a unit entirely within the flank coverage is returned unchanged."""
    bands = [FillBand(0.0, 5.0, 6, "cpt_interpolated")]
    correspondences = [("layerA",)]

    out_bands, out_corr = _clamp_bands_to_flank_cover(
        bands,
        correspondences,
        cover_top_m=0.0,
        cover_base_m=5.0,
        floor_class=3,
        min_thickness_m=0.35,
    )

    assert out_bands == bands
    assert out_corr == correspondences


def test_fc3_overhang_thinner_than_the_minimum_keeps_its_class() -> None:
    """FC3 — a hairline overhang stretches to the boundary, no floor band.

    A 0.2 m overhang above the 0.35 m minimum thickness must not become its own
    floor band — a hairline can never flip a whole band to the floor class.
    """
    bands = [FillBand(0.0, 5.0, 6, "cpt_interpolated")]
    correspondences = [("layerA",)]

    out_bands, _ = _clamp_bands_to_flank_cover(
        bands,
        correspondences,
        cover_top_m=0.2,
        cover_base_m=5.0,
        floor_class=3,
        min_thickness_m=0.35,
    )

    assert [(b.top, b.base, b.nad_class, b.source) for b in out_bands] == [
        (0.0, 5.0, 6, "cpt_interpolated"),
    ]
