"""Behavioural tests for ``label_voxels`` — labelling the 3-D grid.

The fixture is a two-section partition with a genuine SAND lens enclosed in
KLEI on section A, where the SAND pinches out laterally to nothing on section
B.  Comments are phrased in geological terms (pinch-out, interfingering,
midline) rather than implementation-variable terms, so a regression reads as a
clear break of the stratigraphic behaviour the labeller must reproduce.

The load-bearing assertions:

(a) a voxel column ON section A reproduces A's partition top→down
    (KLEI / SAND / KLEI — the lens present);
(b) a voxel column ON section B reproduces B's partition (KLEI only — the
    SAND has pinched out);
(c) the one-sided SAND lens (present on A, absent on B) pinches toward zero
    as the node approaches the equidistance midline: at the exact midline its
    thickness is zero, and off-midline (nearer A) it is present but thinner
    than on A — the interfingering the implicit field could not reproduce;
(d) a body present on BOTH sections under the SAME ``body_id`` but with a
    different thickness on each blends to an in-between thickness at the
    midline — the matched-body thickness-blend path (the core conformable
    interfingering behaviour, distinct from the one-sided pinch).
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
    """The one-sided SAND lens pinches to ZERO at the midline, thinner near A.

    On section A the SAND spans +4 → -4 (8 m thick); the lens is absent on B.
    The midline-pinch rule scales a one-sided body by ``max(0, 2*w_own - 1)``:
    at the exact equidistance midline (y=20, equal distance to A and B) the
    weight is 0.5, so the lens pinches clean to ZERO thickness — the apex of
    the wedge.  Off the midline, nearer A (y=10, three-quarters of the way to
    A), the body is present but distinctly thinner than the full 8 m on A.
    """
    domain = _domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_section_a(), _section_b()])

    sand_on_a = _sand_thickness(grid, x=40.0, y=0.0)
    sand_near_a = _sand_thickness(grid, x=40.0, y=10.0)
    sand_at_midline = _sand_thickness(grid, x=40.0, y=20.0)

    # The lens is fully present on A ...
    assert sand_on_a > 6.0
    # ... pinches clean to nothing at the equidistance midline (the wedge apex) ...
    assert sand_at_midline == 0.0
    # ... and is present but thinner partway out toward A — the interfingering
    # behaviour the implicit field could not reproduce.
    assert 0.0 < sand_near_a < sand_on_a


# ---------------------------------------------------------------------------
# Matched-body thickness blend (a body present on BOTH sections, same body_id)
# ---------------------------------------------------------------------------


def _section_c_thick_klei() -> SectionPartitionInput:
    """Section C (y=0): a KLEI body 16 m thick over a 4 m SAND, both shared.

    The KLEI body carries ``body_id='kleiShared'`` and the SAND ``'sandShared'``
    — the SAME identities as section D — so they MATCH across the two sections
    and exercise the thickness-blend path (not the one-sided pinch).  KLEI spans
    +10 → -6 (16 m), SAND -6 → -10 (4 m).
    """
    columns = (
        SectionColumnInput("C0", along_m=0.0, world_x=0.0, world_y=0.0),
        SectionColumnInput("C1", along_m=80.0, world_x=80.0, world_y=0.0),
    )
    regions = (
        RegionInput(_KLEI, "kleiShared", ((0.0, 10.0), (1.0, 10.0), (1.0, -6.0), (0.0, -6.0)), 0),
        RegionInput(_SAND, "sandShared", ((0.0, -6.0), (1.0, -6.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=0.0, end_x=80.0, end_y=0.0, columns=columns, regions=regions
    )


def _section_d_thin_klei() -> SectionPartitionInput:
    """Section D (y=40): the SAME KLEI body but only 8 m thick over 12 m SAND.

    Same shared ``body_id``s as section C, same +10 → -10 envelope, but here
    KLEI spans +10 → +2 (8 m) and SAND +2 → -10 (12 m).  The shared KLEI body
    is thick on C and thin on D, so the matched-blend path must yield an
    in-between thickness at the midline.
    """
    columns = (
        SectionColumnInput("D0", along_m=0.0, world_x=0.0, world_y=40.0),
        SectionColumnInput("D1", along_m=80.0, world_x=80.0, world_y=40.0),
    )
    regions = (
        RegionInput(_KLEI, "kleiShared", ((0.0, 10.0), (1.0, 10.0), (1.0, 2.0), (0.0, 2.0)), 0),
        RegionInput(_SAND, "sandShared", ((0.0, 2.0), (1.0, 2.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=40.0, end_x=80.0, end_y=40.0, columns=columns, regions=regions
    )


def _klei_thickness(grid, x: float, y: float) -> float:
    """Total vertical thickness (in metres) of KLEI voxels at the column (x, y)."""
    i = int(np.argmin(np.abs(grid.gx - x)))
    j = int(np.argmin(np.abs(grid.gy - y)))
    dz = float(grid.gz[1] - grid.gz[0]) if len(grid.gz) > 1 else 0.0
    count = 0
    for k in range(len(grid.gz)):
        label = int(grid.labels[i, j, k])
        if label < 0:
            continue
        body_id = grid.body_id_by_index[label]
        if grid.formation_by_body[body_id] == _KLEI:
            count += 1
    return count * dz


def test_matched_body_blends_thickness_to_an_in_between_value_at_the_midline():
    """A shared KLEI body blends to a thickness BETWEEN its two sections at midline.

    KLEI carries one ``body_id`` on both sections — 16 m thick on C (y=0) and
    8 m thick on D (y=40).  At the equidistance midline (y=20) the matched-body
    thickness-blend (weights 0.5 / 0.5) gives ``0.5*16 + 0.5*8 = 12`` m: strictly
    between the two sections' thicknesses.  This is the conformable-interfingering
    path — distinct from the one-sided pinch the lens test covers, where the body
    is absent on the far section.
    """
    domain = _domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_section_c_thick_klei(), _section_d_thin_klei()])

    klei_on_c = _klei_thickness(grid, x=40.0, y=0.0)
    klei_on_d = _klei_thickness(grid, x=40.0, y=40.0)
    klei_at_midline = _klei_thickness(grid, x=40.0, y=20.0)

    # KLEI is thick on C and thin on D ...
    assert klei_on_c > klei_on_d
    # ... and the matched-body blend lands the midline thickness strictly
    # between the two sections (the conformable-interfingering behaviour).
    assert klei_on_d < klei_at_midline < klei_on_c
