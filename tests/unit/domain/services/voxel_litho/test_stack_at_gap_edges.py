"""A gap's far edge must read the column that is drawn there (#259).

The 2-D engine snaps polygon coordinates to a 1 mm grid, so a region spanning a whole
gap still stops about one snap cell short of fraction 1 — 8.9e-5 on an 11 m gap. The
query was nudged in by a fixed 1e-6, which lands BEYOND that edge, and the scanline then
found nothing: on the owner's model 33 of 69 gaps read as EMPTY at fraction 1 and 15 at
fraction 0, while all 69 are non-empty at 0.5.

It stayed invisible because ``_stack_at`` defers to the other section when one stack is
empty, so instead of a void the build quietly dropped a section's contribution.

Phrased in the ground's vocabulary: standing at the far column of a gap, the model must
report the column the section draws there.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.label_voxels import _section_stack_at
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# One snap cell on an 11 m gap: the engine cannot place a vertex any closer to 1.0.
SNAPPED_EDGE = 1.0 - 0.001 / 11.0


def _section(right_edge: float, width_m: float = 11.0) -> SectionPartitionInput:
    """A one-gap section whose only region stops at ``right_edge`` in fraction space."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=width_m,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="B", along_m=width_m, world_x=width_m, world_y=0.0),
        ),
        regions=(
            RegionInput(
                formation_id="ZAND",
                body_id="z",
                polygon=(
                    (1.0 - right_edge, 10.0),
                    (right_edge, 10.0),
                    (right_edge, 4.0),
                    (1.0 - right_edge, 4.0),
                ),
                gap_index=0,
                kind="quad",
            ),
        ),
    )


def test_the_far_column_of_a_gap_reports_its_column() -> None:
    """Querying at fraction 1 must find the region the engine drew to the snapped edge."""
    stack = _section_stack_at(_section(SNAPPED_EDGE), 0, 1.0)

    assert [e.body_id for e in stack] == ["z"]


def test_the_near_column_of_a_gap_reports_its_column() -> None:
    """Same at fraction 0 — 15 of the owner's 69 gaps were empty on that side."""
    stack = _section_stack_at(_section(SNAPPED_EDGE), 0, 0.0)

    assert [e.body_id for e in stack] == ["z"]


def test_the_middle_of_the_gap_is_unaffected() -> None:
    """The nudge only moves the query at the edges; mid-gap answers as before."""
    stack = _section_stack_at(_section(SNAPPED_EDGE), 0, 0.5)

    assert [e.body_id for e in stack] == ["z"]
    assert stack[0].top_elev == 10.0
    assert stack[0].base_elev == 4.0


def test_a_wide_gap_needs_a_smaller_nudge_and_still_reads() -> None:
    """The snap is 1 mm of GROUND, so its fraction width depends on the gap.

    On a 333 m gap one cell is 3e-6 — a fixed nudge sized for an 11 m gap would step
    far inside the region and read the wrong place; one sized for 333 m would fall short
    on an 11 m gap. It has to be measured in the gap's own fraction space.
    """
    wide = 1.0 - 0.001 / 333.0
    stack = _section_stack_at(_section(wide, width_m=333.0), 0, 1.0)

    assert [e.body_id for e in stack] == ["z"]


def test_a_region_that_genuinely_stops_short_is_not_dragged_to_the_edge() -> None:
    """A region ending at 0.45 is geology, not quantisation, and must stay ended.

    Clamping the query to whatever the regions happen to reach would extrude this one
    across the half of the gap it does not occupy.
    """
    stack = _section_stack_at(_section(0.45), 0, 1.0)

    assert stack == []
