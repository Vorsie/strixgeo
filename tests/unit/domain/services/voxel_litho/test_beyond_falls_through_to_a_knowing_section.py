"""Beyond the outermost section, silence from the nearest one is not an answer.

THE DEFECT (adversarial hole-map sweep, 2026-08-26). ``_stack_at`` has two
stances on an empty section slice and they contradict each other.

* BETWEEN two sections it already knows that *"an empty stack is no information,
  not an interpretation of no material here"* and defers to the section that
  does know.
* BEYOND the outermost section it took the nearest section's slice verbatim.
  When that slice was empty the column got nothing but whatever log happened to
  be honored on it, and stopped short of the ground beside it.

On the owner's first real geotech 3-D build there is exactly one such column of
37 707 in the footprint: grid cell (30, 199) at (88 074.3, 164 745.3), under
``GEO-06/092-S1``. Its material ended at -10.72 m while the neighbouring column
carried the same material down to -11.47 m. The offline census proves a farther
section knew what was there, so the answer was available and simply never asked
for; after the fix the two columns end at the same elevation.

The owner's standing ruling is that the model is gapless and a hole is never
silent, so the beyond path takes the same defer stance the between path
already takes: keep walking outward until a section answers.

The projection tie-break below is the aggravator that feeds it. Two gaps of ONE
section can reach a query point at the SAME distance — exactly what happens when
the point sits off the shared column of two consecutive gaps — and the winner
was whichever gap came first in the fence. Where the first gap is empty and the
second carries material, that arbitrary order decides whether the column gets an
interpretation. Distance cannot separate them, so evidence does.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.label_voxels import (
    _project_to_section_fence,
    _projected_stack,
    _section_stack_at,
    _stack_at,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_CLAY = "KLEI"
_SAND = "ZAND"


def _band(formation: str, body: str, top: float, base: float, gap: int) -> RegionInput:
    """A band spanning gap ``gap`` from ``top`` down to ``base``."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=gap,
    )


def _half_drawn_section() -> SectionPartitionInput:
    """A 3-column E-W section at y=0 whose SECOND gap was never filled.

    Columns at x = 0, 100, 200. Gap 0 (x 0-100) carries sand over clay; gap 1
    (x 100-200) carries nothing at all — the partition says nothing there.
    """
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=200.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="N0", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="N1", along_m=100.0, world_x=100.0, world_y=0.0),
            SectionColumnInput(investigation_id="N2", along_m=200.0, world_x=200.0, world_y=0.0),
        ),
        regions=(
            _band(_SAND, "sand-body", 4.0, -6.5, 0),
            _band(_CLAY, "clay-body", -6.5, -7.6, 0),
        ),
    )


def _knowing_section(y: float = 60.0) -> SectionPartitionInput:
    """A fully drawn E-W section at ``y`` — sand over clay across its one gap."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=y,
        end_x=200.0,
        end_y=y,
        columns=(
            SectionColumnInput(investigation_id="F0", along_m=0.0, world_x=0.0, world_y=y),
            SectionColumnInput(investigation_id="F1", along_m=200.0, world_x=200.0, world_y=y),
        ),
        regions=(
            _band(_SAND, "sand-body", 3.0, -6.0, 0),
            _band(_CLAY, "clay-body", -6.0, -7.0, 0),
        ),
    )


#: 10 m OUTSIDE the half-drawn section, on the side away from the knowing one, so
#: the node is BEYOND both (t = -1/6 on the axis joining the two feet) and its
#: nearest section is the one whose slice here is empty.
_BEYOND_X, _BEYOND_Y = 150.0, -10.0


def test_the_query_point_is_genuinely_beyond_and_the_nearest_slice_is_empty() -> None:
    """The scene is the one the defect needs — not an accidental between case."""
    near = _half_drawn_section()
    gap, fraction, distance, _fx, _fy = _project_to_section_fence(near, _BEYOND_X, _BEYOND_Y)

    assert distance == 10.0  # nearest section, 10 m away
    assert _section_stack_at(near, gap, fraction) == []  # ... and it says nothing here


def test_a_column_beyond_the_sections_is_filled_by_the_next_one_that_knows() -> None:
    """The shaft closes: a farther section's material fills the void column."""
    stack = _stack_at([_half_drawn_section(), _knowing_section()], _BEYOND_X, _BEYOND_Y)

    assert [(e.formation_id, e.top_elev, e.base_elev) for e in stack] == [
        (_SAND, 3.0, -6.0),
        (_CLAY, -6.0, -7.0),
    ]


def test_a_knowing_nearest_section_still_wins_beyond() -> None:
    """Fall-through only fires on silence — a nearest section that speaks is kept.

    The query sits beyond both sections over gap 0, which the near section DID
    draw. Its own shallower sand top (4.0, not the far section's 3.0) proves the
    nearest section was used and no farther one overrode it.
    """
    stack = _stack_at([_half_drawn_section(), _knowing_section()], 50.0, -10.0)

    assert [(e.formation_id, e.top_elev, e.base_elev) for e in stack] == [
        (_SAND, 4.0, -6.5),
        (_CLAY, -6.5, -7.6),
    ]


def test_silence_everywhere_beyond_stays_unknown() -> None:
    """No section knows anything here, so the column stays void — nothing invented."""
    blank = SectionPartitionInput(
        start_x=0.0,
        start_y=60.0,
        end_x=200.0,
        end_y=60.0,
        columns=(
            SectionColumnInput(investigation_id="F0", along_m=0.0, world_x=0.0, world_y=60.0),
            SectionColumnInput(investigation_id="F1", along_m=200.0, world_x=200.0, world_y=60.0),
        ),
        regions=(),
    )

    assert _stack_at([_half_drawn_section(), blank], _BEYOND_X, _BEYOND_Y) == []


def test_the_between_path_is_untouched_by_the_beyond_fall_through() -> None:
    """A node BETWEEN the two sections keeps the blend it has always produced.

    Nearest is the half-drawn section over its empty gap, so the between branch
    defers to the knowing section — the behaviour that already shipped.
    """
    stack = _stack_at([_half_drawn_section(), _knowing_section()], 150.0, 10.0)

    assert [(e.formation_id, e.top_elev, e.base_elev) for e in stack] == [
        (_SAND, 3.0, -6.0),
        (_CLAY, -6.0, -7.0),
    ]


# ---------------------------------------------------------------------------
# The projection tie-break (the aggravator)
# ---------------------------------------------------------------------------

#: Off the SHARED column of gaps 0 and 1, so both gaps' nearest point is that
#: column and the two distances are exactly equal. Only evidence can separate
#: them.
_TIE_X, _TIE_Y = 100.0, 5.0


def test_the_two_gaps_really_are_the_same_distance_away() -> None:
    """The scene is a true tie, not a near-miss the old ordering would win anyway."""
    section = _half_drawn_section()
    a = _project_to_section_fence(
        SectionPartitionInput(
            start_x=0.0,
            start_y=0.0,
            end_x=100.0,
            end_y=0.0,
            columns=section.columns[:2],
            regions=section.regions,
        ),
        _TIE_X,
        _TIE_Y,
    )
    b = _project_to_section_fence(
        SectionPartitionInput(
            start_x=100.0,
            start_y=0.0,
            end_x=200.0,
            end_y=0.0,
            columns=section.columns[1:],
            regions=(),
        ),
        _TIE_X,
        _TIE_Y,
    )

    assert a[2] == b[2] == 5.0


def test_an_equidistant_contest_is_won_by_the_gap_that_carries_material() -> None:
    """Gap 0 is empty here and gap 1 is drawn, so the drawn one answers."""
    # Mirror image of ``_half_drawn_section``: the FIRST gap is the empty one, so
    # fence order alone would hand the point an empty slice.
    section = SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=200.0,
        end_y=0.0,
        columns=_half_drawn_section().columns,
        regions=(
            _band(_SAND, "sand-body", 4.0, -6.5, 1),
            _band(_CLAY, "clay-body", -6.5, -7.6, 1),
        ),
    )

    gap, fraction, distance, _fx, _fy = _project_to_section_fence(section, _TIE_X, _TIE_Y)
    read_gap, _read_fraction, stack = _projected_stack(
        section, _TIE_X, _TIE_Y, gap, fraction, distance
    )

    assert read_gap == 1
    assert [e.formation_id for e in stack] == [_SAND, _CLAY]


def test_an_equidistant_contest_keeps_fence_order_when_the_first_gap_speaks() -> None:
    """Nothing to fix: the first gap carries material, so it stays the winner."""
    section = _half_drawn_section()
    gap, fraction, distance, _fx, _fy = _project_to_section_fence(section, _TIE_X, _TIE_Y)
    read_gap, _read_fraction, stack = _projected_stack(
        section, _TIE_X, _TIE_Y, gap, fraction, distance
    )

    assert read_gap == 0
    assert [e.formation_id for e in stack] == [_SAND, _CLAY]


def test_a_clearly_nearer_empty_gap_still_wins() -> None:
    """Distance decides whenever it can — silence does not override 45 m of it.

    The point sits over the middle of the empty gap 1, 45 m from the drawn one.
    Preferring evidence there would drag the column's interpretation sideways from
    a gap that is not the nearest, which is the beyond rule's job, not this one's.
    """
    section = _half_drawn_section()
    gap, fraction, distance, _fx, _fy = _project_to_section_fence(section, 150.0, 5.0)
    read_gap, _read_fraction, stack = _projected_stack(section, 150.0, 5.0, gap, fraction, distance)

    assert read_gap == 1
    assert stack == []
