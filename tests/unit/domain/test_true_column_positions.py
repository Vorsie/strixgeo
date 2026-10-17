"""Unit tests for :func:`apply_true_column_positions` — debt #247.

The 3-D blend ranks sections by distance to a polyline through each section's
column ``world_x/world_y``. Those coordinates are the frontend's CANONICAL
positions — *"the projected position on the densest section that contains it"* —
not the investigations' true map locations. Measured on the dev model: median
11.08 m apart, max 64.91 m, 77 of 83 columns off by more than a metre.

Everything else in the builder — the voxel grid, the domain footprint (since the
July footprint fix) and the honored investigation columns — is in TRUE world
space. So the labeller decided which sections were nearest in one coordinate
space and placed the material in another. Owner ruling 2026-07-29: rank by true
positions.

This moves each section column onto its investigation's true location before
labelling, so the ranking and the gap-local fraction are both measured where the
ground actually is.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.true_column_positions import (
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


def _section(columns: list[tuple[str, float, float]]) -> SectionPartitionInput:
    """A section whose columns sit at the given (projected) positions."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=tuple(
            SectionColumnInput(investigation_id=c, along_m=float(i * 50), world_x=x, world_y=y)
            for i, (c, x, y) in enumerate(columns)
        ),
        regions=(
            RegionInput(
                formation_id="ZAND",
                body_id="b1",
                polygon=((0.0, 3.0), (1.0, 3.0), (1.0, -3.0), (0.0, -3.0)),
                gap_index=0,
            ),
        ),
    )


def _column(inv: str, x: float, y: float) -> InvestigationColumn:
    """An honored column at a TRUE map position."""
    return InvestigationColumn(
        investigation_id=inv,
        world_x=x,
        world_y=y,
        intervals=(("b1", "ZAND", 3.0, -3.0),),
    )


def test_columns_move_onto_their_true_positions() -> None:
    """The projected foot is replaced by where the investigation actually is."""
    sections, moved, max_shift = apply_true_column_positions(
        [_section([("A", 0.0, 0.0), ("B", 50.0, 0.0)])],
        (_column("A", 0.0, 12.0), _column("B", 50.0, -3.0)),
    )

    assert [(c.world_x, c.world_y) for c in sections[0].columns] == [(0.0, 12.0), (50.0, -3.0)]
    assert moved == 2
    assert max_shift == 12.0


def test_a_column_with_no_honored_investigation_keeps_its_foot() -> None:
    """Only investigations with body-assigned picks have a true position here.

    A column without one must keep the coordinate it arrived with rather than
    collapse to the origin — losing it would move geometry, not just re-measure
    it.
    """
    sections, moved, _shift = apply_true_column_positions(
        [_section([("A", 0.0, 0.0), ("B", 50.0, 0.0)])],
        (_column("A", 0.0, 12.0),),
    )

    assert [(c.world_x, c.world_y) for c in sections[0].columns] == [(0.0, 12.0), (50.0, 0.0)]
    assert moved == 1


def test_along_m_regions_and_line_are_untouched() -> None:
    """Only the world position changes — this is a re-measure, not a re-draw."""
    original = _section([("A", 0.0, 0.0), ("B", 50.0, 0.0)])
    sections, _moved, _shift = apply_true_column_positions(
        [original], (_column("A", 0.0, 12.0), _column("B", 50.0, -3.0))
    )

    assert sections[0].regions == original.regions
    assert (sections[0].start_x, sections[0].end_x) == (original.start_x, original.end_x)
    assert [c.along_m for c in sections[0].columns] == [c.along_m for c in original.columns]
    assert [c.investigation_id for c in sections[0].columns] == [
        c.investigation_id for c in original.columns
    ]


def test_no_honored_columns_is_a_no_op() -> None:
    """With nothing to move, the payload comes back untouched."""
    original = [_section([("A", 0.0, 0.0), ("B", 50.0, 0.0)])]
    sections, moved, max_shift = apply_true_column_positions(original, ())

    assert sections == original
    assert moved == 0
    assert max_shift == 0.0


def test_already_true_positions_report_no_shift() -> None:
    """When the feet already sit on the true positions nothing moves."""
    _sections, moved, max_shift = apply_true_column_positions(
        [_section([("A", 0.0, 0.0), ("B", 50.0, 0.0)])],
        (_column("A", 0.0, 0.0), _column("B", 50.0, 0.0)),
    )

    assert moved == 0
    assert max_shift == 0.0


def test_the_same_investigation_on_two_sections_lands_on_one_position() -> None:
    """A test shared by two sections must agree — that is the whole point.

    The canonical foot differs per section; the true location does not, so after
    this pass the two sections meet at exactly the same world point.
    """
    sections, _moved, _shift = apply_true_column_positions(
        [
            _section([("A", 0.0, 0.0), ("S", 50.0, 0.0)]),
            _section([("S", 40.0, 20.0), ("C", 90.0, 20.0)]),
        ],
        (_column("S", 55.0, 5.0),),
    )

    first = next(c for c in sections[0].columns if c.investigation_id == "S")
    second = next(c for c in sections[1].columns if c.investigation_id == "S")
    assert (first.world_x, first.world_y) == (second.world_x, second.world_y) == (55.0, 5.0)
