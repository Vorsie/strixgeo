"""The column-floor raise may never leave two stacked same-class bands.

Owner, installer #40, borehole GEO-07/182-B2: *"how come i have two stacked md
sands on B2?"*.  His litho ZAND layer (7.50-10.58 m) carried two touching NAD-6
packing bands — 7.50-9.60 and 9.60-10.58.  The upper one was a ``body_min``
floor band that :func:`~groundmodel.application.divide_boreholes.apply_column_floor`
RAISED to NAD 6 (the loosest class the column measured for that sand) AFTER the
geological-cut merge had already run and, seeing a NAD-5 band over a NAD-6 band,
correctly left them split.  Nothing merged them once the raise made them the
same class.

Two touching bands of one class in one litho layer are one band, whatever pass
split them, so the merge runs again after the raise.
"""

from uuid import UUID

from groundmodel.application.divide_boreholes import (
    PlannedBand,
    PlannedBoreholeSegment,
    finalize_borehole_bands,
)

ZAND = UUID(int=1)
LAYER_A = UUID(int=21)
LAYER_B = UUID(int=22)
BH = UUID(int=99)


def _band(
    top: float,
    base: float,
    nad: int,
    source: str,
    *,
    layer: UUID = LAYER_A,
) -> PlannedBand:
    """One planned band on the borehole."""
    return PlannedBand(
        depth_top_m=top,
        depth_base_m=base,
        nad_class=nad,
        source=source,
        # The planner stamps "high" only on a measured (cpt_interpolated) band.
        confidence="high" if source == "cpt_interpolated" else "low",
        body_id=None,
        source_litho_formation_id=ZAND,
        source_geo_formation_id=None,
        source_litho_layer_id=layer,
    )


def _spans(segments: list[PlannedBoreholeSegment]) -> list[tuple[float, float, int]]:
    """The (top, base, nad) of every band across the segments, top to bottom."""
    return [
        (band.depth_top_m, band.depth_base_m, band.nad_class)
        for seg in segments
        for band in seg.bands
    ]


def test_two_touching_bands_of_one_class_in_one_litho_layer_are_one_band_whatever_pass_split_them():
    """B2's stacked medium-dense sands: the floor raise makes them one class → one band.

    The pre-floor state ``DivideBoreholes`` reaches on B2 is a ``body_min`` NAD-5
    floor band over a measured NAD-6 band, both inside the ONE litho ZAND layer.
    The first merge cannot weld them (5 ≠ 6); the column floor then raises the
    NAD-5 band to NAD 6 (the loosest the column measured for that sand); the
    SECOND merge welds the two NAD-6 pieces of one litho layer into one band.
    """
    seg = PlannedBoreholeSegment(
        borehole_id=BH,
        investigation_id=str(BH),
        bands=(
            _band(7.50, 9.60, 5, "body_min"),
            _band(9.60, 10.58, 6, "cpt_interpolated"),
        ),
    )

    segments, _merged_away, raised_count, merged_after_floor = finalize_borehole_bands([seg])

    # The floor raised the body_min NAD-5 band to NAD 6 (the column's measured floor)...
    assert raised_count == 1
    # ... and the SECOND merge welded the two NAD-6 pieces of one litho layer into one.
    assert merged_after_floor == 1
    assert _spans(segments) == [(7.50, 10.58, 6)]


def test_a_user_split_here_survives_even_after_the_floor_raise():
    """Owner 2026-09-12: *"if a layer is split into two in the litho it stays split"*.

    Two same-class bands drawn from two DIFFERENT litho layers (a user "Split
    here") must NOT be welded, even once the column-floor raise makes their
    classes match.  The merge keys on ``source_litho_layer_id``, so only a
    geological cut inside ONE litho layer collapses; the engineer's split stands.
    """
    segs = [
        PlannedBoreholeSegment(
            borehole_id=BH,
            investigation_id=str(BH),
            bands=(_band(7.50, 9.60, 5, "body_min", layer=LAYER_A),),
        ),
        PlannedBoreholeSegment(
            borehole_id=BH,
            investigation_id=str(BH),
            bands=(_band(9.60, 10.58, 6, "cpt_interpolated", layer=LAYER_B),),
        ),
    ]

    segments, _merged_away, raised_count, merged_after_floor = finalize_borehole_bands(segs)

    # The floor still raises the body_min band to the column's measured NAD 6 ...
    assert raised_count == 1
    # ... but the split (two litho layers) survives — nothing is welded across it.
    assert merged_after_floor == 0
    assert _spans(segments) == [(7.50, 9.60, 6), (9.60, 10.58, 6)]
