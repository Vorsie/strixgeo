"""The labeller reports the structural anomalies it had to paper over.

Three of them are silent by construction and were found only by an adversarial
offline sweep (2026-08-26). None of them can be *fixed* here — each needs a
geological ruling nobody has given — so each is instead made LOUD, and the build
carries the numbers out on :class:`LabelReport` for the caller to log.

* ``_layout`` stacks a blended column cumulatively downward, so a void inside
  either input stack is closed and everything below it shifts UP by its height.
  Measured on the owner's real geotech payload: 6 distinct (section, gap) sites
  are read by the labeller with an interior void over a millimetre, worst
  13.9 mm at ``GEO-10/117-B1 -> GEO-05/040-S1``. It is not "unreachable" — it
  fires on every build of that model, and until now said nothing.
* A void that SURVIVES to the final stack is legitimate (the partition said
  unknown), but the 2-D engine's millimetre snapping also leaves hairlines a
  contact drawn flush. Below the snap grid that is rounding; a centimetre is
  not, and the two must not be confused silently. Worst on real data today is
  0.999 mm — exactly one snap cell — so anything over 15 mm is a new class of
  event and says so.
* The grid's elevation range comes from the SECTION polygons alone, so an
  honored investigation whose log reaches deeper than every section is silently
  truncated at the grid floor. Zero on the owner's model today; the day it is
  not, the engineer must hear it rather than find a flat-bottomed borehole.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_CLAY = "KLEI"
_SAND = "ZAND"


def _band(formation: str, body: str, top: float, base: float) -> RegionInput:
    """A band spanning the section's single gap from ``top`` down to ``base``."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=0,
    )


def _section(y: float, regions: tuple[RegionInput, ...]) -> SectionPartitionInput:
    """An E-W section at ``y``, two columns 80 m apart, carrying ``regions``."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=y,
        end_x=80.0,
        end_y=y,
        columns=(
            SectionColumnInput(investigation_id=f"L{y:.0f}", along_m=0.0, world_x=0.0, world_y=y),
            SectionColumnInput(investigation_id=f"R{y:.0f}", along_m=80.0, world_x=80.0, world_y=y),
        ),
        regions=regions,
    )


def _voided(separation_m: float, y: float = 0.0) -> SectionPartitionInput:
    """A section whose sand base and clay top are ``separation_m`` apart.

    The partition covers +10 to the sand base and the clay top down to -10, with
    nothing at all in between — the interior void this module has to report.
    """
    return _section(
        y,
        (
            _band(_SAND, "sand-body", 10.0, 0.0),
            _band(_CLAY, "clay-body", -separation_m, -10.0),
        ),
    )


def _whole(y: float = 40.0) -> SectionPartitionInput:
    """A fully drawn section — sand over clay, no void."""
    return _section(
        y,
        (
            _band(_SAND, "sand-body", 10.0, 0.0),
            _band(_CLAY, "clay-body", 0.0, -10.0),
        ),
    )


def _domain(y_min: float = -5.0, y_max: float = 45.0) -> object:
    """A footprint that strictly contains both section lines (y=0 and y=40)."""
    return build_model_domain(
        [
            DomainTest("F0", 0.0, y_min, 10.0, -10.0),
            DomainTest("F1", 80.0, y_min, 10.0, -10.0),
            DomainTest("G0", 0.0, y_max, 10.0, -10.0),
            DomainTest("G1", 80.0, y_max, 10.0, -10.0),
        ]
    )


# ---------------------------------------------------------------------------
# _layout closing an input void
# ---------------------------------------------------------------------------


def test_a_closed_input_void_is_counted_and_its_worst_height_named() -> None:
    """Blending over a 50 mm hole reports the hole, its height and where it was."""
    grid = label_voxels(_domain(), 4.0, [_voided(0.05), _whole()])

    assert grid.report.layout_closed_voids > 0
    assert grid.report.layout_closed_worst_m == pytest.approx(0.05)
    assert grid.report.layout_closed_worst_site == "section 0 gap 0"


def test_a_snap_grid_hairline_in_the_input_is_not_reported_as_a_void() -> None:
    """Half a millimetre is the 2-D engine rounding a flush contact, not a hole."""
    grid = label_voxels(_domain(), 4.0, [_voided(0.0005), _whole()])

    assert grid.report.layout_closed_voids == 0
    assert grid.report.layout_closed_worst_site is None


def test_a_gap_free_model_reports_no_closed_voids() -> None:
    """Nothing to paper over, nothing to say."""
    grid = label_voxels(_domain(), 4.0, [_whole(0.0), _whole(40.0)])

    assert grid.report.layout_closed_voids == 0


# ---------------------------------------------------------------------------
# Hairlines that survive to the final stack
# ---------------------------------------------------------------------------


def test_a_void_wider_than_a_hairline_in_the_final_stack_is_reported() -> None:
    """A 50 mm gap the beyond path carries through is over the limit and counted.

    Columns south of y=0 lie beyond both sections, so they take the nearest
    section's stack verbatim — void included — instead of the blend that would
    have closed it.
    """
    grid = label_voxels(_domain(y_min=-20.0), 4.0, [_voided(0.05), _whole()])

    assert grid.report.hairline_gaps_over_limit > 0
    assert grid.report.hairline_worst_m == pytest.approx(0.05)


def test_a_centimetre_void_stays_under_the_limit_but_is_still_measured() -> None:
    """10 mm is inside the tolerated band: worst height reported, no count."""
    grid = label_voxels(_domain(y_min=-20.0), 4.0, [_voided(0.010), _whole()])

    assert grid.report.hairline_gaps_over_limit == 0
    assert grid.report.hairline_worst_m == pytest.approx(0.010)


# ---------------------------------------------------------------------------
# An honored log deeper than the grid
# ---------------------------------------------------------------------------


def test_a_log_reaching_below_the_section_floor_is_inside_the_grid() -> None:
    """The borehole reaches 15 m below anything a section drew — and is IN.

    This used to pin the ``logs_below_grid_floor`` WARNING: the grid was framed
    from the section partitions alone, so a deeper log was truncated and the
    tripwire named it on every build (debt #242's detector). Owner ruling
    2026-08-31 — *"down to the deepest investigation"* — cured the truncation at
    the frame: the grid's vertical range now covers the honored logs, so the
    situation the warning existed for is unreachable from here. The tripwire
    STAYS as a backstop against a future framing regression, and this test now
    pins both halves of the cure: the floor reaches the log, and the warning
    stays silent.
    """
    deep = InvestigationColumn(
        investigation_id="B-DEEP",
        world_x=40.0,
        world_y=20.0,
        intervals=(("clay-body", _CLAY, -5.0, -25.0),),
    )

    grid = label_voxels(_domain(), 4.0, [_whole(0.0), _whole(40.0)], investigation_columns=(deep,))

    assert float(grid.gz.min()) <= -25.0 + 4.0  # within one voxel of the log base
    assert grid.report.logs_below_grid_floor == ()


def test_a_log_inside_the_grid_range_is_not_named() -> None:
    """The common case is silent — only truncation is worth a word."""
    shallow = InvestigationColumn(
        investigation_id="B-SHALLOW",
        world_x=40.0,
        world_y=20.0,
        intervals=(("clay-body", _CLAY, -5.0, -9.0),),
    )

    grid = label_voxels(
        _domain(), 4.0, [_whole(0.0), _whole(40.0)], investigation_columns=(shallow,)
    )

    assert grid.report.logs_below_grid_floor == ()


# ---------------------------------------------------------------------------
# The beyond fall-through, counted
# ---------------------------------------------------------------------------


def test_columns_saved_by_the_beyond_fall_through_are_counted() -> None:
    """Every column a farther section had to answer for is reported.

    The near section's second gap is undrawn, so columns beyond it over that gap
    would have been void without the fall-through.
    """
    half_drawn = SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=160.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="N0", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="N1", along_m=80.0, world_x=80.0, world_y=0.0),
            SectionColumnInput(investigation_id="N2", along_m=160.0, world_x=160.0, world_y=0.0),
        ),
        regions=(_band(_SAND, "sand-body", 10.0, -10.0),),
    )
    far = SectionPartitionInput(
        start_x=0.0,
        start_y=40.0,
        end_x=160.0,
        end_y=40.0,
        columns=(
            SectionColumnInput(investigation_id="F0", along_m=0.0, world_x=0.0, world_y=40.0),
            SectionColumnInput(investigation_id="F1", along_m=160.0, world_x=160.0, world_y=40.0),
        ),
        regions=(_band(_CLAY, "clay-body", 10.0, -10.0),),
    )
    domain = build_model_domain(
        [
            DomainTest("F0", 0.0, -20.0, 10.0, -10.0),
            DomainTest("F1", 160.0, -20.0, 10.0, -10.0),
            DomainTest("G0", 0.0, 45.0, 10.0, -10.0),
            DomainTest("G1", 160.0, 45.0, 10.0, -10.0),
        ]
    )

    grid = label_voxels(domain, 4.0, [half_drawn, far])

    assert grid.report.beyond_fallthrough_columns > 0
    assert grid.report.beyond_void_columns == 0


def test_a_model_nobody_drew_reports_its_void_columns() -> None:
    """When NO section answers, the columns stay void AND are counted as such.

    Both sections drew their western gap and left their eastern one blank, so a
    column beyond them in the east has nowhere to fall through to.  The hole is
    real — the partition genuinely says nothing there — and must be reported, not
    filled from a section that never covered the ground.
    """

    def half(y: float) -> SectionPartitionInput:
        return SectionPartitionInput(
            start_x=0.0,
            start_y=y,
            end_x=160.0,
            end_y=y,
            columns=(
                SectionColumnInput(
                    investigation_id=f"W{y:.0f}", along_m=0.0, world_x=0.0, world_y=y
                ),
                SectionColumnInput(
                    investigation_id=f"M{y:.0f}", along_m=80.0, world_x=80.0, world_y=y
                ),
                SectionColumnInput(
                    investigation_id=f"E{y:.0f}", along_m=160.0, world_x=160.0, world_y=y
                ),
            ),
            regions=(_band(_SAND, f"sand-{y:.0f}", 10.0, -10.0),),
        )

    domain = build_model_domain(
        [
            DomainTest("F0", 0.0, -20.0, 10.0, -10.0),
            DomainTest("F1", 160.0, -20.0, 10.0, -10.0),
            DomainTest("G0", 0.0, 45.0, 10.0, -10.0),
            DomainTest("G1", 160.0, 45.0, 10.0, -10.0),
        ]
    )

    grid = label_voxels(domain, 4.0, [half(0.0), half(40.0)])

    assert grid.report.beyond_void_columns > 0
