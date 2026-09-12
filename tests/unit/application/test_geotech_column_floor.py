"""A band with no evidence falls to the loosest class ITS COLUMN reached.

Owner, 2026-08-16, correcting the lithology-floor fallback: *"the fallback only
fires when ... we first do what we can, and then the fallback fires. But when
the fallback fires, there is already a sand beneath it that does have a higher
NAD class. So we take that NAD class as the lowest on the column ... the upper
bands which fall back to the lowest class will get medium instead of loose."*

The table floor is not conservative, it is fictional.  A loose sand band
inserted into a column whose every measured sand reads medium dense or better
is a layer the site does not show anywhere on that column — and packing density
feeds strength, so inventing one can drive a design on data that does not
exist.  The column's own loosest measured class is the honest floor.

Ordering is part of the rule: this runs AFTER the donor rule has answered
everything it can, because it reads those answers.
"""

from uuid import UUID

from groundmodel.application.divide_boreholes import PlannedBand, apply_column_floor

# The floor is read PER LITHO UNIT — the band's own ``source_litho_formation_id``.
# ZAND_F and KLEI_F are two soils; ZAND_GL_F (a glauconitic sand) is a SEPARATE
# unit from ZAND_F while sharing the SAME soil — the case a per-soil floor lumps
# and a per-unit floor keeps apart (owner 2026-09-12, *"per unit ofcourse"*).
ZAND_F = UUID(int=1)
KLEI_F = UUID(int=2)
ZAND_GL_F = UUID(int=3)

_ZAND_FLOOR, _MD, _D, _VD = 5, 6, 7, 8
_KLEI_FLOOR, _KLEI_FIRM = 21, 22


def _band(top: float, base: float, nad: int, source: str, formation: UUID = ZAND_F) -> PlannedBand:
    """One planned band on the borehole."""
    return PlannedBand(
        depth_top_m=top,
        depth_base_m=base,
        nad_class=nad,
        source=source,
        confidence="high" if source == "cpt_interpolated" else "low",
        body_id=None,
        source_litho_formation_id=formation,
        source_geo_formation_id=None,
    )


def _classes(bands: list[PlannedBand]) -> list[tuple[int, str]]:
    out = apply_column_floor(bands)
    return [(b.nad_class, b.source) for b in out]


def test_cf1_an_unmeasured_sand_takes_the_column_s_loosest_measured_sand() -> None:
    """His case: the sliver reads medium dense, not loose.

    The column's sand was measured at NAD 6 and 7, so NAD 5 appears nowhere on
    it and must not be invented for the one interval nothing could answer.
    """
    assert _classes(
        [
            _band(9.07, 9.50, _ZAND_FLOOR, "absolute_min"),
            _band(9.50, 11.49, _MD, "cpt_interpolated"),
            _band(11.49, 12.52, _D, "cpt_interpolated"),
        ]
    ) == [(_MD, "column_min"), (_MD, "cpt_interpolated"), (_D, "cpt_interpolated")]


def test_cf2_it_never_reaches_past_the_loosest_measured_class() -> None:
    """Loosest, not nearest: the dense band next door does not set the floor."""
    assert _classes(
        [
            _band(0.0, 1.0, _ZAND_FLOOR, "absolute_min"),
            _band(1.0, 2.0, _VD, "cpt_interpolated"),
            _band(2.0, 3.0, _MD, "cpt_interpolated"),
        ]
    )[0] == (_MD, "column_min")


def test_cf3_the_floor_is_read_per_unit_so_a_clay_cannot_take_a_sand_class() -> None:
    """A clay band cannot take a sand class, however loose.

    Retargeted 2026-09-12 from "per soil" to "per unit": the clay and the sand
    here are two litho units (two formations), and a per-unit floor keeps them
    apart — as it also keeps two same-soil units apart (see CF8).
    """
    assert _classes(
        [
            _band(0.0, 1.0, _KLEI_FLOOR, "absolute_min", formation=KLEI_F),
            _band(1.0, 2.0, _KLEI_FIRM, "cpt_interpolated", formation=KLEI_F),
            _band(2.0, 3.0, _MD, "cpt_interpolated"),
        ]
    )[0] == (_KLEI_FIRM, "column_min")


def test_cf4_a_column_that_measured_none_of_that_soil_keeps_the_table_floor() -> None:
    """With nothing measured there is nothing to be honest about but the floor."""
    assert _classes(
        [
            _band(0.0, 1.0, _ZAND_FLOOR, "absolute_min"),
            _band(1.0, 2.0, _KLEI_FIRM, "cpt_interpolated", formation=KLEI_F),
        ]
    )[0] == (_ZAND_FLOOR, "absolute_min")


def test_cf5_a_measured_band_is_never_rewritten() -> None:
    """The pass fills gaps; it does not correct evidence."""
    assert _classes(
        [
            _band(0.0, 1.0, _VD, "cpt_interpolated"),
            _band(1.0, 2.0, _MD, "cpt_interpolated"),
        ]
    ) == [(_VD, "cpt_interpolated"), (_MD, "cpt_interpolated")]


def test_cf6_a_floor_already_at_the_column_s_loosest_is_left_alone() -> None:
    """No relabelling for a band that was already right."""
    assert _classes(
        [
            _band(0.0, 1.0, _ZAND_FLOOR, "absolute_min"),
            _band(1.0, 2.0, _ZAND_FLOOR, "cpt_interpolated"),
        ]
    )[0] == (_ZAND_FLOOR, "absolute_min")


def test_cf7_it_never_makes_a_band_looser() -> None:
    """A conservative fallback must not be walked back by this pass.

    A standing sub-minimum sliver (his 2026-08-11 ruling) sits at a class the
    column may have beaten; the pass only ever raises a band to the column's
    loosest, never lowers one.
    """
    assert _classes(
        [
            _band(0.0, 1.0, _D, "body_min"),
            _band(1.0, 2.0, _MD, "cpt_interpolated"),
        ]
    )[0] == (_D, "body_min")


def test_cf8_a_glauconitic_sand_and_a_pure_sand_behave_differently_the_floor_is_per_unit() -> None:
    """Owner, 2026-09-12: *"per unit ofcourse"*.

    A glauconitic sand and a pure sand are DIFFERENT litho units — different
    formation rows though the same soil — and they *behave differently*, so the
    floor is per unit, not per soil.  The pure sand this column measured at
    medium dense says NOTHING about the glauconitic sand's unread interval:
    that interval keeps the honest table floor, never the clean sand's class.
    A per-soil floor would lump both ``ZAND`` bands and raise the glauconitic
    fallback to the clean sand's NAD 6 — a packing the glauconitic unit shows
    nowhere on this column.
    """
    assert _classes(
        [
            _band(0.0, 1.0, _ZAND_FLOOR, "absolute_min", formation=ZAND_GL_F),
            _band(1.0, 2.0, _MD, "cpt_interpolated", formation=ZAND_F),
        ]
    )[0] == (_ZAND_FLOOR, "absolute_min")
