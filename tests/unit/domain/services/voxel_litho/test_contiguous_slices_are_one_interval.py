"""Material both sections carry must survive the blend (#257).

The 2-D engine may cut one interval of a body into several polygons — five slices on
one section where the other has one, all touching base-to-top. ``_section_stack_at``
emitted one entry per polygon, ``_pair_occurrences`` matched them one-to-one, and the
surplus fell into the ONE-SIDED branch of ``_blend_stacks``, where the midline factor
annihilated it. The body is on BOTH sections; it is not one-sided. It was deleted
because of how the partition happened to be cut.

Because ``_layout`` stacks cumulatively downward, every deleted metre came off the
bottom: at (88 082.3, 164 463.3) both sections author their floor at -9.69 m and the
model stopped at -0.845 m.

Phrased in the ground's vocabulary: slices that touch are one layer, and a layer both
sections agree on does not thin toward the middle.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.label_voxels import (
    _blend_stacks,
    _Entry,
    _section_stack_at,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


def _slice_region(body: str, formation: str, top: float, base: float) -> RegionInput:
    """A full-width region of one body between two elevations."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=0,
        kind="quad",
    )


def _section(*regions: RegionInput) -> SectionPartitionInput:
    """A one-gap section carrying the given regions."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="B", along_m=100.0, world_x=100.0, world_y=0.0),
        ),
        regions=regions,
    )


def _thickness_of(stack: list[_Entry], body: str) -> float:
    """Total metres of one body in a stack."""
    return sum(e.top_elev - e.base_elev for e in stack if e.body_id == body)


def test_slices_that_touch_are_read_as_one_layer() -> None:
    """Three touching slices of one body come back as a single interval."""
    section = _section(
        _slice_region("z", "ZAND", 10.0, 8.0),
        _slice_region("z", "ZAND", 8.0, 6.0),
        _slice_region("z", "ZAND", 6.0, 4.0),
    )

    stack = _section_stack_at(section, 0, 0.5)

    assert len(stack) == 1
    assert math.isclose(stack[0].top_elev, 10.0)
    assert math.isclose(stack[0].base_elev, 4.0)


def test_a_body_that_really_comes_back_lower_stays_two_layers() -> None:
    """Slices with another body between them are re-entrant, not one layer."""
    section = _section(
        _slice_region("z", "ZAND", 10.0, 8.0),
        _slice_region("k", "KLEI", 8.0, 6.0),
        _slice_region("z", "ZAND", 6.0, 4.0),
    )

    stack = _section_stack_at(section, 0, 0.5)

    assert [e.body_id for e in stack] == ["z", "k", "z"]


def test_touching_slices_of_different_bodies_never_merge() -> None:
    """Only the same body merges — a contact is still a contact."""
    section = _section(
        _slice_region("z", "ZAND", 10.0, 8.0),
        _slice_region("k", "KLEI", 8.0, 6.0),
    )

    stack = _section_stack_at(section, 0, 0.5)

    assert [e.body_id for e in stack] == ["z", "k"]


def test_a_layer_both_sections_carry_keeps_its_full_thickness() -> None:
    """The defect itself, through the production path: section -> stack -> blend.

    Both sections carry 6 m of the same body. Cut into three slices on one side and one
    on the other, the old blend paired one and annihilated the rest at the midline,
    leaving 2 m of 6 — and took the missing 4 m off the bottom of the column.
    """
    sliced = _section(
        _slice_region("z", "ZAND", 10.0, 8.0),
        _slice_region("z", "ZAND", 8.0, 6.0),
        _slice_region("z", "ZAND", 6.0, 4.0),
    )
    whole = _section(_slice_region("z", "ZAND", 10.0, 4.0))

    blended = _blend_stacks(
        _section_stack_at(sliced, 0, 0.5), _section_stack_at(whole, 0, 0.5), 0.5
    )

    assert math.isclose(_thickness_of(blended, "z"), 6.0, abs_tol=1e-9)


def test_the_floor_of_such_a_column_does_not_rise() -> None:
    """A layer surviving intact leaves the base where both sections put it.

    ``_layout`` stacks downward, so this is the property that actually broke: the
    deepest base must land where the two sections agree it is, not 4 m higher.
    """
    sliced = _section(
        _slice_region("z", "ZAND", 10.0, 8.0),
        _slice_region("z", "ZAND", 8.0, 6.0),
        _slice_region("z", "ZAND", 6.0, 4.0),
    )
    whole = _section(_slice_region("z", "ZAND", 10.0, 4.0))

    blended = _blend_stacks(
        _section_stack_at(sliced, 0, 0.5), _section_stack_at(whole, 0, 0.5), 0.5
    )

    assert math.isclose(min(e.base_elev for e in blended), 4.0, abs_tol=1e-9)


def test_a_reentrant_body_both_sections_carry_blends_to_the_interpolated_total() -> None:
    """Surplus occurrences of a MATCHED body must blend, not be annihilated (#257).

    Merging touching slices does not reach the case where a hairline sliver of another
    body sits between two slices of the same one (#228) — they stay separate
    occurrences, one pairs and the rest were killed by the one-sided midline factor.

    A body both sections carry must end up with the interpolation of their two totals,
    ``w1*A + w2*B``. That falls out exactly when surplus blends with ``w``: pairing
    contributes ``w1*a1 + w2*b1`` and the surplus ``w1*a2``, which sums to
    ``w1*(a1+a2) + w2*b1``. The old factor made the surplus vanish, so at the midline
    the body lost every occurrence past the first.
    """
    sliced = _section(
        _slice_region("z", "ZAND", 10.0, 8.0),
        _slice_region("k", "KLEI", 8.0, 7.996),
        _slice_region("z", "ZAND", 7.996, 4.0),
    )
    whole = _section(_slice_region("z", "ZAND", 10.0, 4.0))

    stack1 = _section_stack_at(sliced, 0, 0.5)
    stack2 = _section_stack_at(whole, 0, 0.5)
    total1 = _thickness_of(stack1, "z")
    total2 = _thickness_of(stack2, "z")

    blended = _blend_stacks(stack1, stack2, 0.5)

    assert math.isclose(_thickness_of(blended, "z"), 0.5 * total1 + 0.5 * total2, abs_tol=1e-9)


def test_a_body_only_one_section_carries_still_pinches() -> None:
    """The one-sided rule is untouched: a body the other section lacks still thins.

    Only surplus occurrences of a body BOTH sections carry changed. A genuinely
    one-sided body must keep pinching, or this fix would resurrect material no section
    authored.
    """
    only_here = _section(
        _slice_region("z", "ZAND", 10.0, 6.0),
        _slice_region("s", "SILT", 6.0, 4.0),
    )
    other = _section(_slice_region("z", "ZAND", 10.0, 6.0))

    blended = _blend_stacks(
        _section_stack_at(only_here, 0, 0.5), _section_stack_at(other, 0, 0.5), 0.5
    )

    assert math.isclose(_thickness_of(blended, "s"), 0.0, abs_tol=1e-9)
