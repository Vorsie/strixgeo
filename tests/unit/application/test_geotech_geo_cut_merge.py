"""A geological cut does not split a packing band of unchanged class.

Owner, 2026-08-17: *"we're still emitting geotech bands to the geological
boundary that was split off, that's the user's decision"* — and, when asked how
a user would make that split themselves: *"how can the user split it is my
question? there must be a gesture"*.  There is: right-click a band →
"Split band…", right-click a boundary → "Merge bands", and "Link to geology" to
couple a boundary to a geological contact.  So the split is his to make, and
the engine has no business making it for him.

Where it came from: ``divide_picks_by_geology`` cut every litho pick at the
geological surfaces BEFORE any packing was derived, so each piece was classified
independently — and could land on the same class.  His B4 carried
``0.00-0.60 SILT (NAD 13)`` and ``0.60-5.19 SILT (NAD 13)``, a contact that
marks no packing change at all, and each piece then earned its own correlation.

That cut was deleted at the source on 2026-08-26 (owner: *"just drop the wall
everywhere, user wil have to manually do it"*), so the duplication these cases
describe should no longer be produced at all.  ``merge_geo_split_bands`` is kept
as a cheap invariant — one class, one litho unit, one band — and these cases
still pin it.  They are the specification of that invariant now, not of a
repair for a cut that no longer happens.
"""

from uuid import UUID

from groundmodel.application.divide_boreholes import PlannedBand, merge_geo_split_bands

SILT_F = UUID(int=1)
ZAND_F = UUID(int=2)
GEO_UPPER = UUID(int=11)
GEO_LOWER = UUID(int=12)


def _band(
    top: float,
    base: float,
    nad: int,
    litho: UUID = SILT_F,
    geo: UUID | None = GEO_UPPER,
    source: str = "cpt_interpolated",
) -> PlannedBand:
    """One planned band."""
    return PlannedBand(
        depth_top_m=top,
        depth_base_m=base,
        nad_class=nad,
        source=source,
        # The planner never stamps a fallback "high"; the fixture must not either.
        confidence="high" if source == "cpt_interpolated" else "low",
        body_id=None,
        source_litho_formation_id=litho,
        source_geo_formation_id=geo,
    )


def _spans(bands: list[PlannedBand]) -> list[tuple[float, float, int]]:
    return [(b.depth_top_m, b.depth_base_m, b.nad_class) for b in merge_geo_split_bands(bands)]


def test_gm1_his_b4_silt_becomes_one_band() -> None:
    """0.00-0.60 and 0.60-5.19, both NAD 13, are one band."""
    assert _spans([_band(0.00, 0.60, 13, geo=GEO_UPPER), _band(0.60, 5.19, 13, geo=GEO_LOWER)]) == [
        (0.00, 5.19, 13)
    ]


def test_gm2_the_survivor_keeps_the_upper_piece_s_geological_parent() -> None:
    """One band, one parent — the shallower one, which owns the contact above."""
    merged = merge_geo_split_bands(
        [_band(0.00, 0.60, 13, geo=GEO_UPPER), _band(0.60, 5.19, 13, geo=GEO_LOWER)]
    )
    assert merged[0].source_geo_formation_id == GEO_UPPER


def test_gm3_a_real_packing_change_is_never_merged() -> None:
    """Different class means the contact IS a packing boundary."""
    assert _spans([_band(0.00, 0.60, 13, geo=GEO_UPPER), _band(0.60, 5.19, 14, geo=GEO_LOWER)]) == [
        (0.00, 0.60, 13),
        (0.60, 5.19, 14),
    ]


def test_gm4_a_different_litho_unit_is_never_merged() -> None:
    """Same class either side of a LITHO contact is two units, not one band.

    The litho model owns that boundary and it must survive whatever the classes
    happen to be.
    """
    assert _spans([_band(0.00, 0.60, 13, litho=SILT_F), _band(0.60, 5.19, 13, litho=ZAND_F)]) == [
        (0.00, 0.60, 13),
        (0.60, 5.19, 13),
    ]


def test_gm5_a_gap_between_bands_is_never_closed() -> None:
    """Only touching bands merge; a gap would be a different defect."""
    assert _spans([_band(0.00, 0.60, 13), _band(1.00, 5.19, 13)]) == [
        (0.00, 0.60, 13),
        (1.00, 5.19, 13),
    ]


def test_gm6_a_run_of_three_collapses_to_one() -> None:
    """Two geological contacts through one packing band leave one band."""
    assert _spans([_band(0.0, 1.0, 13), _band(1.0, 2.0, 13), _band(2.0, 3.0, 13)]) == [
        (0.0, 3.0, 13)
    ]


def test_gm8_the_band_sequence_the_new_pipeline_produces_is_untouched() -> None:
    """GM8 — the guard is a NO-OP on what the pipeline emits since 2026-08-26.

    The owner dropped the geological cut (*"just drop the wall everywhere, user
    wil have to manually do it"*), so the duplication GM1 repairs is no longer
    manufactured. What the planner now hands this pass is a column whose bands
    come from the qc segmenter — which splits on a CLASS CHANGE, so two touching
    bands inside one litho unit never share a class — plus the litho unit
    changes. Nothing here is mergeable, and the guard must return it verbatim.

    This is the pin that keeps the kept-guard honest: if it ever starts merging
    real pipeline output, that is a defect, not a repair.
    """
    pipeline_output = [
        # One SILT unit, segmented by qc into three real packing changes.
        _band(0.00, 1.20, 13, litho=SILT_F, geo=GEO_UPPER),
        _band(1.20, 3.40, 15, litho=SILT_F, geo=GEO_UPPER),
        # A geological contact falls in here — and no longer splits anything,
        # so this band spans it whole and is labelled by its midpoint unit.
        _band(3.40, 7.80, 13, litho=SILT_F, geo=GEO_LOWER),
        # The litho contact: a different unit, whatever the classes do.
        _band(7.80, 9.00, 13, litho=ZAND_F, geo=GEO_LOWER),
    ]

    assert _spans(pipeline_output) == [
        (0.00, 1.20, 13),
        (1.20, 3.40, 15),
        (3.40, 7.80, 13),
        (7.80, 9.00, 13),
    ]


def test_gm9_a_band_spanning_a_geological_contact_is_left_whole() -> None:
    """GM9 — the twin halves are never created now, so there is nothing to merge.

    His GEO-05/040-S3 clay, as the pipeline emits it today: ONE band 0.05-1.48 m
    across the geological surface at 0.57 m. The guard must not find work here.
    """
    assert _spans([_band(0.05, 1.48, 21, geo=GEO_LOWER)]) == [(0.05, 1.48, 21)]


def test_gm7_provenance_of_the_weaker_piece_does_not_upgrade() -> None:
    """A measured band merged with a guess reports the guess.

    Merging must not claim evidence for ground the donor never answered.
    """
    merged = merge_geo_split_bands(
        [
            _band(0.0, 1.0, 13, source="cpt_interpolated"),
            _band(1.0, 2.0, 13, source="column_min"),
        ]
    )
    assert merged[0].source == "column_min"
    assert merged[0].confidence == "low"
