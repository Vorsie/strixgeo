"""Where each body is measured to die, taken from the 2-D partition itself.

A region that tapers to nothing at one end is a body pinching out, and that apex is a
MEASURED termination — the owner's point that the ties already place the pinch-out,
so the builder never has to assume an equidistance midline. All 48 lens regions on
the dev model taper to <= 1 cm, so the apex is real geometry, not a tolerance
artefact.

Phrased in the partition's own vocabulary: a region that runs out has a termination
where it runs out; a region that is full thickness at both ends has none.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.pinch_terminations import body_terminations
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


def _section(*regions: RegionInput) -> SectionPartitionInput:
    """A two-gap section 200 m long, columns at 0, 100 and 200 m east."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=200.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="B", along_m=100.0, world_x=100.0, world_y=0.0),
            SectionColumnInput(investigation_id="C", along_m=200.0, world_x=200.0, world_y=0.0),
        ),
        regions=regions,
    )


def test_a_region_that_runs_out_has_a_termination_where_it_runs_out() -> None:
    """A wedge thinning to nothing at its right end terminates there."""
    wedge = RegionInput(
        formation_id="SILT",
        body_id="s",
        polygon=((0.0, 9.0), (1.0, 7.0), (1.0, 7.0), (0.0, 7.0)),
        gap_index=0,
        kind="lens",
    )

    found = body_terminations([_section(wedge)])["s"]

    assert len(found) == 1
    assert math.isclose(found[0].world_x, 100.0, abs_tol=1e-6)
    assert math.isclose(found[0].world_y, 0.0, abs_tol=1e-6)
    assert found[0].kind == "lens"


def test_a_region_that_is_full_thickness_at_both_ends_has_no_termination() -> None:
    """A band carrying straight across the gap does not die in it."""
    band = RegionInput(
        formation_id="ZAND",
        body_id="z",
        polygon=((0.0, 10.0), (1.0, 10.0), (1.0, 5.0), (0.0, 5.0)),
        gap_index=0,
        kind="quad",
    )

    assert body_terminations([_section(band)]).get("z", ()) == ()


def test_a_region_that_runs_out_at_both_ends_terminates_twice() -> None:
    """A lens enclosed within one gap dies at each end of itself."""
    lens = RegionInput(
        formation_id="SILT",
        body_id="s",
        polygon=((0.0, 8.0), (0.5, 9.0), (1.0, 8.0), (0.5, 7.0)),
        gap_index=0,
        kind="lens",
    )

    found = body_terminations([_section(lens)])["s"]

    assert len(found) == 2
    assert sorted(round(t.world_x) for t in found) == [0, 100]


def test_the_termination_lands_between_the_columns_it_falls_between() -> None:
    """A gap-local fraction becomes a world position on the line joining its columns.

    The apex here sits in the SECOND gap, so it must land between the columns at
    100 m and 200 m, not be measured from the section start.
    """
    wedge = RegionInput(
        formation_id="KLEI",
        body_id="k",
        polygon=((0.0, 4.0), (1.0, 1.0), (1.0, 1.0), (0.0, 1.0)),
        gap_index=1,
        kind="lens",
    )

    found = body_terminations([_section(wedge)])["k"]

    assert len(found) == 1
    assert math.isclose(found[0].world_x, 200.0, abs_tol=1e-6)


def test_a_region_with_no_body_is_left_out() -> None:
    """A never-correlated minority has no identity to group a termination under."""
    orphan = RegionInput(
        formation_id="VEEN",
        body_id=None,
        polygon=((0.0, 3.0), (1.0, 1.0), (1.0, 1.0), (0.0, 1.0)),
        gap_index=0,
        kind="lens",
    )

    assert body_terminations([_section(orphan)]) == {}


def test_terminations_from_several_sections_gather_under_one_body() -> None:
    """The same body dying on two sections yields both places, which is the edge."""
    wedge = RegionInput(
        formation_id="SILT",
        body_id="s",
        polygon=((0.0, 9.0), (1.0, 7.0), (1.0, 7.0), (0.0, 7.0)),
        gap_index=0,
        kind="lens",
    )
    north = SectionPartitionInput(
        start_x=0.0,
        start_y=50.0,
        end_x=200.0,
        end_y=50.0,
        columns=(
            SectionColumnInput(investigation_id="D", along_m=0.0, world_x=0.0, world_y=50.0),
            SectionColumnInput(investigation_id="E", along_m=100.0, world_x=100.0, world_y=50.0),
            SectionColumnInput(investigation_id="F", along_m=200.0, world_x=200.0, world_y=50.0),
        ),
        regions=(wedge,),
    )

    found = body_terminations([_section(wedge), north])["s"]

    assert sorted(round(t.world_y) for t in found) == [0, 50]
