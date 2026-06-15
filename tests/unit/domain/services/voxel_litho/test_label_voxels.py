"""Behavioural tests for ``label_voxels`` — labelling the 3-D grid.

The fixture is a two-section partition with a genuine SAND lens enclosed in
KLEI on section A, where the SAND pinches out laterally to nothing on section
B.  Comments are phrased in geological terms (pinch-out, interfingering,
midline) rather than implementation-variable terms, so a regression reads as a
clear break of the stratigraphic behaviour the labeller must reproduce.

The three load-bearing assertions:

(a) a voxel column ON section A reproduces A's partition top→down
    (KLEI / SAND / KLEI — the lens present);
(b) a voxel column ON section B reproduces B's partition (KLEI only — the
    SAND has pinched out);
(c) a voxel column at the A–B midline carries SAND in the upper part but
    THINNER than on A — the lens pinches toward zero as the node approaches
    the midline between the two sections.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# Two parallel E-W sections, A at y=0 and B at y=40, each 80 m long.  Three
# tests per section (so the alpha hull triangulates and is not collinear).
_KLEI = "KLEI"
_SAND = "SAND"


def _section_a() -> SectionPartitionInput:
    """Section A (y=0): KLEI / SAND-lens / KLEI top→down across the whole line.

    Surface at +10 m, base at -10 m.  The SAND lens sits between +4 and -4 m,
    enclosed top and bottom by KLEI.  Two columns → one gap; the region
    polygons span the full gap (fraction 0→1) at constant elevation, i.e. a
    flat-lying lens.
    """
    columns = (
        SectionColumnInput("A0", along_m=0.0, world_x=0.0, world_y=0.0),
        SectionColumnInput("A1", along_m=80.0, world_x=80.0, world_y=0.0),
    )
    regions = (
        # upper KLEI: +10 → +4
        RegionInput(_KLEI, "kleiTop", ((0.0, 10.0), (1.0, 10.0), (1.0, 4.0), (0.0, 4.0)), 0),
        # SAND lens: +4 → -4
        RegionInput(_SAND, "sandLens", ((0.0, 4.0), (1.0, 4.0), (1.0, -4.0), (0.0, -4.0)), 0),
        # lower KLEI: -4 → -10
        RegionInput(_KLEI, "kleiBot", ((0.0, -4.0), (1.0, -4.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=0.0, end_x=80.0, end_y=0.0, columns=columns, regions=regions
    )


def _section_b() -> SectionPartitionInput:
    """Section B (y=40): KLEI only — the SAND lens has pinched out laterally.

    Same surface/base envelope (+10 → -10) so the only difference from A is the
    absence of the SAND body: a single KLEI body fills the whole column.
    """
    columns = (
        SectionColumnInput("B0", along_m=0.0, world_x=0.0, world_y=40.0),
        SectionColumnInput("B1", along_m=80.0, world_x=80.0, world_y=40.0),
    )
    regions = (
        RegionInput(_KLEI, "kleiAll", ((0.0, 10.0), (1.0, 10.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=40.0, end_x=80.0, end_y=40.0, columns=columns, regions=regions
    )


def _domain_for_two_sections() -> object:
    """A model domain whose footprint strictly contains both section lines.

    The footprint is framed by tests at y=-5 and y=45 (5 m beyond the section
    lines at y=0 and y=40), so a voxel ON section A (y=0), ON section B (y=40),
    and at the midline (y=20) all fall strictly INSIDE the alpha hull — the
    section lines themselves are not on the hull boundary (where point-in-
    polygon would exclude them).  +10 surface / -10 base covers the partition
    vertical extent.
    """
    tests = [
        DomainTest("F0", 0.0, -5.0, 10.0, -10.0),
        DomainTest("Fmid", 40.0, -5.0, 10.0, -10.0),
        DomainTest("F1", 80.0, -5.0, 10.0, -10.0),
        DomainTest("G0", 0.0, 45.0, 10.0, -10.0),
        DomainTest("Gmid", 40.0, 45.0, 10.0, -10.0),
        DomainTest("G1", 80.0, 45.0, 10.0, -10.0),
    ]
    return build_model_domain(tests)


def _vertical_formation_sequence(grid, x: float, y: float) -> list[str]:
    """Read the run-length-encoded formation sequence of the voxel column at (x, y).

    Picks the nearest grid column to (x, y), walks it shallow→deep (descending
    gz), resolves each non-void label to its formation, and collapses runs so
    the result is the stratigraphic sequence (e.g. ``[KLEI, SAND, KLEI]``).
    """
    i = int(np.argmin(np.abs(grid.gx - x)))
    j = int(np.argmin(np.abs(grid.gy - y)))
    formation_to_body = grid.formation_by_body
    seq: list[str] = []
    # shallow → deep means descending elevation
    for k in range(len(grid.gz) - 1, -1, -1):
        label = int(grid.labels[i, j, k])
        if label < 0:
            continue
        body_id = grid.body_id_by_index[label]
        formation = formation_to_body[body_id]
        if not seq or seq[-1] != formation:
            seq.append(formation)
    return seq


def _sand_thickness(grid, x: float, y: float) -> float:
    """Total vertical thickness (in metres) of SAND voxels at the column (x, y)."""
    i = int(np.argmin(np.abs(grid.gx - x)))
    j = int(np.argmin(np.abs(grid.gy - y)))
    dz = float(grid.gz[1] - grid.gz[0]) if len(grid.gz) > 1 else 0.0
    count = 0
    for k in range(len(grid.gz)):
        label = int(grid.labels[i, j, k])
        if label < 0:
            continue
        body_id = grid.body_id_by_index[label]
        if grid.formation_by_body[body_id] == _SAND:
            count += 1
    return count * dz


def test_voxel_column_on_section_a_reproduces_the_enclosed_sand_lens():
    """ON section A the column is KLEI / SAND / KLEI — the lens is present."""
    domain = _domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_section_a(), _section_b()])

    # mid-gap on section A's line (along=40, y=0)
    seq = _vertical_formation_sequence(grid, x=40.0, y=0.0)
    assert seq == [_KLEI, _SAND, _KLEI]


def test_voxel_column_on_section_b_reproduces_the_pinched_out_partition():
    """ON section B the SAND has pinched out — the column is KLEI top→down."""
    domain = _domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_section_a(), _section_b()])

    seq = _vertical_formation_sequence(grid, x=40.0, y=40.0)
    assert seq == [_KLEI]


def test_sand_lens_pinches_toward_the_midline_between_the_sections():
    """At the A–B midline the SAND lens is THINNER than on A — interfingering.

    On section A the SAND spans +4 → -4 (8 m thick).  The lens is absent on B.
    Halfway between the two sections the midline-pinch rule scales the
    one-sided body toward zero, so the midline column carries SOME sand but
    distinctly less than the full 8 m present on A.
    """
    domain = _domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_section_a(), _section_b()])

    sand_on_a = _sand_thickness(grid, x=40.0, y=0.0)
    sand_at_midline = _sand_thickness(grid, x=40.0, y=20.0)

    # The lens is fully present on A ...
    assert sand_on_a > 6.0
    # ... and pinches as we approach the equidistance midline (present but
    # thinner — the interfingering behaviour the implicit field could not do).
    assert sand_at_midline < sand_on_a
