"""Clause 5 of the gapless gate (``column-totality``): the denominator and its hole.

The gate's promise is "every column inside the model footprint carries
material" — a promise nobody could check before, because
``beyond_void_columns`` had no denominator at all and only ever answered a
narrower question (see ``LabelReport.empty_in_footprint_columns``'s
docstring). These tests pin the two counters that make the promise
checkable: ``in_footprint_columns`` (how many columns the promise applies to)
and ``empty_in_footprint_columns`` (how many of them broke it).
"""

from __future__ import annotations

from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_SAND = "ZAND"


def _band(formation: str, body: str, top: float, base: float) -> RegionInput:
    """A band spanning the section's single gap from ``top`` down to ``base``."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=0,
    )


def _section(y: float, x1: float, regions: tuple[RegionInput, ...]) -> SectionPartitionInput:
    """An E-W section at ``y`` running from ``x=0`` to ``x=x1``."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=y,
        end_x=x1,
        end_y=y,
        columns=(
            SectionColumnInput(investigation_id=f"L{y:.0f}", along_m=0.0, world_x=0.0, world_y=y),
            SectionColumnInput(investigation_id=f"R{y:.0f}", along_m=x1, world_x=x1, world_y=y),
        ),
        regions=regions,
    )


def _domain(x1: float, y_min: float = -5.0, y_max: float = 45.0) -> object:
    """A footprint that strictly contains both section lines (y=0 and y=40)."""
    return build_model_domain(
        [
            DomainTest("F0", 0.0, y_min, 10.0, -10.0),
            DomainTest("F1", x1, y_min, 10.0, -10.0),
            DomainTest("G0", 0.0, y_max, 10.0, -10.0),
            DomainTest("G1", x1, y_max, 10.0, -10.0),
        ]
    )


def test_a_fully_covered_grid_carries_no_empty_column() -> None:
    """Two whole sections, no void anywhere: the numerator stays zero."""
    whole_a = _section(0.0, 80.0, (_band(_SAND, "sand-a", 10.0, -10.0),))
    whole_b = _section(40.0, 80.0, (_band(_SAND, "sand-b", 10.0, -10.0),))

    grid = label_voxels(_domain(80.0), 4.0, [whole_a, whole_b])

    assert grid.report.in_footprint_columns > 0
    assert grid.report.empty_in_footprint_columns == 0


def test_an_in_footprint_column_nobody_filled_is_named() -> None:
    """Two sections each leave their EASTERN gap blank — a real hole east of x=80.

    Both sections draw only the western half (0->80 m) of a 160 m line and
    say nothing east of it, so a column out there has no section to answer
    for it: the partition genuinely has nothing to say, and clause 5 must
    name that column as broken, not silently drop it from the count.
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

    domain = _domain(160.0, y_min=-20.0, y_max=45.0)

    grid = label_voxels(domain, 4.0, [half(0.0), half(40.0)])

    assert grid.report.empty_in_footprint_columns > 0
    # The numerator never exceeds the denominator it is counted against.
    assert grid.report.in_footprint_columns >= grid.report.empty_in_footprint_columns


def test_the_denominator_counts_every_column_the_footprint_gate_admitted() -> None:
    """A small hand-countable grid: in_footprint_columns matches the gate exactly.

    Cross-checks the counter against an independent replay of the SAME
    ``domain.contains`` gate the labeller itself runs, over the grid's OWN
    returned axes — not a guessed number, and not a re-derivation of the
    labeller's ``arange`` construction (which would risk silently matching an
    off-by-one in both places at once).
    """
    from groundmodel.domain.services.voxel_litho.footprint_tolerance import footprint_tolerance_m

    section = _section(0.0, 40.0, (_band(_SAND, "sand-a", 10.0, -10.0),))
    domain = _domain(40.0, y_min=-5.0, y_max=5.0)

    grid_spacing = 10.0
    grid = label_voxels(domain, grid_spacing, [section])

    tol = footprint_tolerance_m(grid_spacing)
    expected = sum(
        1 for x in grid.gx for y in grid.gy if domain.contains(float(x), float(y), tol=tol)
    )

    assert grid.report.in_footprint_columns == expected
