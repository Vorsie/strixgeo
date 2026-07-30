"""A neighbouring section with nothing at this point must not thin the model.

Owner, 2026-07-30, on the first geology-independent build: *"bottom clay is not
being made 3d even though it has a top tie and a base tie"*.

THE DEFECT. ``_stack_at`` blends the two nearest sections. A body present on one
and absent on the other is a lens, so it is pinched by ``max(0, 2w - 1)`` — zero at
the equidistance midline. That rule is right for a body the other section shows
pinching out. It is wrong when the other section has **no stack at all** at the
projected point, which happens routinely: the projection clamps to a section's end
column, or lands in a gap the partition never filled. An absent stack means "this
section knows nothing here", not "this section says there is no material here".

Blending against it pinched EVERY body in the informed section's column by the same
factor, and because ``_layout`` re-stacks thicknesses cumulatively downward from a
blended top, the shortfall accumulates: on the dev model the column at
``GEO-77/002-A .. GEO-05/040-S3`` lost 6.35 % of every unit, the total went 19.99 m
-> 17.45 m, and the tied bottom clay landed at -4.086/-5.072 instead of its authored
-6.481/-7.610. The deepest 2.5 m of a clay tied top AND base read as void.

``_blended_top`` already treats an empty stack correctly — it returns the other
stack's top verbatim rather than averaging against nothing. These tests hold
``_stack_at`` to the same standard.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.voxel_litho.label_voxels import _stack_at
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_CLAY = "KLEI"
_SAND = "ZAND"


def _full_width(formation: str, body: str, top: float, base: float) -> RegionInput:
    """A band spanning its gap from ``top`` down to ``base``."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=0,
    )


def _section(y: float, regions: tuple[RegionInput, ...]) -> SectionPartitionInput:
    """An E-W section at ``y``, two columns 100 m apart, carrying ``regions``."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=y,
        end_x=100.0,
        end_y=y,
        columns=(
            SectionColumnInput(investigation_id=f"L{y:.0f}", along_m=0.0, world_x=0.0, world_y=y),
            SectionColumnInput(
                investigation_id=f"R{y:.0f}", along_m=100.0, world_x=100.0, world_y=y
            ),
        ),
        regions=regions,
    )


def _informed() -> SectionPartitionInput:
    """The section that HAS an interpretation: sand over a tied bottom clay."""
    return _section(
        0.0,
        (
            _full_width(_SAND, "sand-body", 4.0, -6.5),
            _full_width(_CLAY, "clay-body", -6.5, -7.6),
        ),
    )


def _uninformative() -> SectionPartitionInput:
    """A section with NO regions — it knows nothing at any point."""
    return _section(40.0, ())


#: Query point: 5 m off the informed section, 35 m off the uninformative one, so
#: the node lies BETWEEN them and the old rule pinched by max(0, 2*0.875-1) = 0.75.
_X, _Y = 50.0, 5.0


def test_a_tied_bottom_clay_keeps_its_authored_base() -> None:
    """The clay's base is where the partition put it, not lifted by a pinch."""
    stack = _stack_at([_informed(), _uninformative()], _X, _Y)

    clay = [e for e in stack if e.formation_id == _CLAY]
    assert clay, [(e.formation_id, e.top_elev, e.base_elev) for e in stack]
    assert clay[-1].base_elev == -7.6


def test_nothing_in_the_column_is_thinned_by_an_uninformed_neighbour() -> None:
    """Every unit keeps its own thickness — the column is not scaled down."""
    stack = _stack_at([_informed(), _uninformative()], _X, _Y)

    by_formation = {e.formation_id: e for e in stack}
    assert by_formation[_SAND].top_elev - by_formation[_SAND].base_elev == pytest.approx(10.5)
    assert by_formation[_CLAY].top_elev - by_formation[_CLAY].base_elev == pytest.approx(1.1)


def test_the_order_of_the_sections_does_not_matter() -> None:
    """The rule is symmetric — the informed section wins whichever it is."""
    a = _stack_at([_informed(), _uninformative()], _X, _Y)
    b = _stack_at([_uninformative(), _informed()], _X, _Y)

    assert [(e.formation_id, e.top_elev, e.base_elev) for e in a] == [
        (e.formation_id, e.top_elev, e.base_elev) for e in b
    ]


def test_a_body_the_neighbour_actually_contradicts_still_pinches() -> None:
    """The lens rule is untouched where the neighbour genuinely has a stack.

    The neighbour here DOES carry an interpretation — clay only, no sand — so the
    sand is a real one-sided lens and must still thin toward the midline. Only the
    no-information case changed.
    """
    informing_neighbour = _section(40.0, (_full_width(_CLAY, "clay-body", 4.0, -7.6),))

    stack = _stack_at([_informed(), informing_neighbour], _X, _Y)

    sand = [e for e in stack if e.formation_id == _SAND]
    assert sand, [(e.formation_id, e.top_elev, e.base_elev) for e in stack]
    assert 0.0 < sand[0].top_elev - sand[0].base_elev < 10.5


def test_two_uninformative_sections_leave_the_column_empty() -> None:
    """No information anywhere means unknown, not invented material."""
    assert _stack_at([_uninformative(), _section(80.0, ())], _X, _Y) == []
