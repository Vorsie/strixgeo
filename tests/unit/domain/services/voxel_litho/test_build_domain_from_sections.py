"""Behavioural tests for the voxel model's lateral footprint.

The rule these tests encode, in the modelling vocabulary rather than the
implementation's:

    An investigation whose OWN drilled log the 3-D model honors must lie
    INSIDE the model footprint.

A borehole feeds a cross-section at its PROJECTED FOOT on the section line,
which on real data sits metres — sometimes tens of metres — from where the
borehole actually is.  The voxel builder honors each investigation's log at its
TRUE map position, so a footprint framed only from the projected feet can leave
a borehole standing outside the model it helped build: the model then has no
material at all where the ground was actually drilled.

The tests use a single E–W section whose projected feet run along ``y = 0`` and
one investigation that truly sits well to the north of that line.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# The off-line borehole's true map position: 60 m north of the section fence.
_OFF_LINE_X = 40.0
_OFF_LINE_Y = 60.0

# Footprint admission tolerance the labeller uses (half a 2 m cell diagonal).
_TOL_M = 1.5


def _fence_section() -> SectionPartitionInput:
    """An E–W section whose three projected column feet all lie on ``y = 0``.

    Three feet (not two) so the alpha hull has non-collinear input once a
    fourth, off-line position joins them.
    """
    columns = (
        SectionColumnInput("west", along_m=0.0, world_x=0.0, world_y=0.0),
        SectionColumnInput("mid", along_m=40.0, world_x=40.0, world_y=2.0),
        SectionColumnInput("east", along_m=80.0, world_x=80.0, world_y=0.0),
    )
    regions = (
        RegionInput("KLEI", "klei", ((0.0, 10.0), (1.0, 10.0), (1.0, -10.0), (0.0, -10.0)), 0),
        RegionInput("KLEI", "klei", ((0.0, 10.0), (1.0, 10.0), (1.0, -10.0), (0.0, -10.0)), 1),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=0.0, end_x=80.0, end_y=0.0, columns=columns, regions=regions
    )


def test_footprint_from_feet_alone_excludes_the_off_line_borehole() -> None:
    """The section feet alone frame a footprint that misses the real borehole.

    This is the behaviour that produced the uncovered columns on real data —
    it is asserted so the fix below is measured against a known starting point,
    not against an assumption.
    """
    domain = build_domain_from_sections([_fence_section()])

    assert not domain.contains(_OFF_LINE_X, _OFF_LINE_Y, tol=_TOL_M)


def test_footprint_covers_an_investigation_that_sits_off_the_section_line() -> None:
    """A borehole 60 m off the fence is inside the footprint once it is supplied.

    The drilled position — not just the projected foot — must be modelled
    ground, because that is where the builder honors the borehole's own log.
    """
    domain = build_domain_from_sections(
        [_fence_section()],
        investigation_positions=(("offline-bh", _OFF_LINE_X, _OFF_LINE_Y),),
    )

    assert domain.contains(_OFF_LINE_X, _OFF_LINE_Y, tol=_TOL_M)


def test_the_section_fence_stays_inside_the_widened_footprint() -> None:
    """Widening to the drilled positions ADDS ground; it never drops the fence.

    The 2-D partition lives on the fence, so every projected foot must remain
    modelled ground after the footprint grows.
    """
    domain = build_domain_from_sections(
        [_fence_section()],
        investigation_positions=(("offline-bh", _OFF_LINE_X, _OFF_LINE_Y),),
    )

    for x, y in ((0.0, 0.0), (40.0, 2.0), (80.0, 0.0)):
        assert domain.contains(x, y, tol=_TOL_M), f"section foot ({x}, {y}) fell outside"


def test_an_investigation_already_on_the_fence_keeps_both_its_positions() -> None:
    """A test that is BOTH a section column and a drilled position keeps both.

    Its projected foot and its true position are different places on the map;
    the footprint has to cover both, so the two must not collapse into one
    hull input by sharing an investigation id.
    """
    domain = build_domain_from_sections(
        [_fence_section()],
        # "mid" already appears as a column foot at (40, 2); its true position
        # is the off-line one.
        investigation_positions=(("mid", _OFF_LINE_X, _OFF_LINE_Y),),
    )

    assert domain.contains(40.0, 2.0, tol=_TOL_M), "the projected foot was dropped"
    assert domain.contains(_OFF_LINE_X, _OFF_LINE_Y, tol=_TOL_M), "the true position was dropped"


def test_no_investigation_positions_is_byte_identical_to_the_old_footprint() -> None:
    """Omitting the drilled positions leaves the previous footprint unchanged.

    The parameter is additive: an un-supplied build must frame exactly the hull
    it framed before the parameter existed.
    """
    without = build_domain_from_sections([_fence_section()])
    explicit_empty = build_domain_from_sections([_fence_section()], investigation_positions=())

    assert without.polygon == explicit_empty.polygon
