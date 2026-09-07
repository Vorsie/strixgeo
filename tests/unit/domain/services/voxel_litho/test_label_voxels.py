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
from groundmodel.domain.services.surface_bound import SurfaceBound
from groundmodel.domain.services.voxel_litho.label_voxels import (
    _column_labels,
    _column_labels_gapped,
    _Entry,
    label_voxels,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    InvestigationColumn,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# Two parallel E-W sections, A at y=0 and B at y=40, each 80 m long.  Three
# tests per section (so the alpha hull triangulates and is not collinear).
_KLEI = "KLEI"
_SAND = "SAND"
# A third lithology, so a honored column can be told apart from BOTH the
# section blend (KLEI) and the other contender in a shared-column test.
_VEEN = "VEEN"


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


def test_sand_lens_thins_all_the_way_to_the_section_that_lacks_it():
    """The one-sided SAND reaches the section that contradicts it, not the midline.

    On section A the SAND spans +4 → -4 (8 m thick); it is absent on B.  Under the
    owner's ruling of 2026-07-31 the body runs out where the evidence against it
    stands — section B — and thins evenly on the way there.  The equidistance midline
    it used to die at was never evidence: nothing is measured halfway between two
    sections, and ``max(0, 2*w_own - 1)`` killed the body there anyway.

    So the wedge spans the WHOLE gap, apex on B, and interfingering is what happens
    across all of it rather than only across the near half.
    """
    domain = _domain_for_two_sections()
    grid = label_voxels(domain, 2.0, [_section_a(), _section_b()])

    on_a = _sand_thickness(grid, x=40.0, y=0.0)
    quarter = _sand_thickness(grid, x=40.0, y=10.0)
    midline = _sand_thickness(grid, x=40.0, y=20.0)
    three_quarters = _sand_thickness(grid, x=40.0, y=30.0)
    on_b = _sand_thickness(grid, x=40.0, y=40.0)

    # Whole where it is drawn, gone where the section that lacks it stands ...
    assert on_a > 6.0
    assert on_b == 0.0
    # ... still there at the midline, which is the change: it used to be zero here ...
    assert midline > 0.0
    # ... and thinning the whole way rather than stopping short of B.
    assert on_a > quarter > midline > three_quarters > on_b


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


# ---------------------------------------------------------------------------
# Honor-borehole: an investigation's OWN observed log overrides the blend at
# its true map location (within its logged depth range), falls back to the
# section blend above/below the log so the column stays filled.
# ---------------------------------------------------------------------------


def _section_klei_all(y: float, id_prefix: str) -> SectionPartitionInput:
    """A single KLEI body filling the whole +10 → -10 column, on the line at ``y``.

    Used as the surrounding section context so the between-section blend reads
    KLEI everywhere — the disagreeing background a borehole's own ZAND-on-top
    log must override at its true location.  The KLEI body carries the SAME
    ``body_id`` ('kleiAll') on both sections so it MATCHES across them and fills
    the equidistance midline (a one-sided body would pinch to zero there).
    """
    columns = (
        SectionColumnInput(f"{id_prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{id_prefix}1", along_m=80.0, world_x=80.0, world_y=y),
    )
    regions = (
        RegionInput(_KLEI, "kleiAll", ((0.0, 10.0), (1.0, 10.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=80.0, end_y=y, columns=columns, regions=regions
    )


def test_honored_column_reproduces_its_own_log_then_falls_back_below():
    """At a borehole's location the model reads its OWN log on top, blend below.

    The surrounding sections (y=0 and y=40, KLEI top→down) make the between-
    section blend read KLEI everywhere — so without honoring, a column at the
    borehole's true location (the midline y=20) would be KLEI all the way down.
    The borehole's OWN log is ZAND from surface (+10) down to 0 m, observed
    only over [+10, 0].  Honoring it must reproduce ZAND on top within that
    logged range, then fall back to the section blend (KLEI) BELOW the log —
    so the column reads ZAND / KLEI top→down and stays filled to the base
    (no hole below the log).
    """
    domain = _domain_for_two_sections()
    # The borehole sits at the equidistance midline of the two KLEI sections,
    # where (without honoring) the blend is pure KLEI top→down.
    bh = InvestigationColumn(
        investigation_id="BH-zand-on-top",
        world_x=40.0,
        world_y=20.0,
        # observed ZAND from +10 down to 0; nothing logged below 0.
        intervals=(("bodyZand", _SAND, 10.0, 0.0),),
    )
    grid = label_voxels(
        domain,
        2.0,
        [_section_klei_all(0.0, "P"), _section_klei_all(40.0, "Q")],
        investigation_columns=(bh,),
    )

    # At the borehole's true (x, y): ZAND on top (its own log), KLEI below
    # (the section blend filling past the log's bottom).
    seq = _vertical_formation_sequence(grid, x=40.0, y=20.0)
    assert seq == [_SAND, _KLEI]

    # The ZAND is present only within the logged range — a non-trivial slab.
    assert _sand_thickness(grid, x=40.0, y=20.0) > 6.0


def test_shallow_honored_log_does_not_punch_a_hole_below_it():
    """A SHALLOW borehole log keeps the column filled below via the blend.

    The borehole logs only the top 4 m (ZAND from +10 to +6); everything below
    +6 is unlogged.  Honoring must NOT truncate the column at +6 — below the
    log the section blend (KLEI down to -10) still fills it.  So the column is
    continuous from the surface to the global base with no void gap below the
    shallow log.
    """
    domain = _domain_for_two_sections()
    bh = InvestigationColumn(
        investigation_id="BH-shallow",
        world_x=40.0,
        world_y=20.0,
        intervals=(("bodyZandShallow", _SAND, 10.0, 6.0),),
    )
    grid = label_voxels(
        domain,
        2.0,
        [_section_klei_all(0.0, "P"), _section_klei_all(40.0, "Q")],
        investigation_columns=(bh,),
    )

    # Walk the honored column: it must be filled (non-void) at every elevation
    # from the surface down to the global base — a shallow log creates no hole.
    i = int(np.argmin(np.abs(grid.gx - 40.0)))
    j = int(np.argmin(np.abs(grid.gy - 20.0)))
    column = grid.labels[i, j, :]
    filled = column[column >= 0]
    # The fill spans the full envelope: at least as many filled voxels as the
    # surrounding pure-KLEI column at the same place would have had.
    assert filled.size >= 9  # ~20 m / 2 m grid, minus the open-top voxel

    # And the sequence is ZAND (the shallow log) over KLEI (the blend below).
    seq = _vertical_formation_sequence(grid, x=40.0, y=20.0)
    assert seq == [_SAND, _KLEI]


def test_no_investigation_columns_keeps_the_section_blend_unchanged():
    """The default (no honored columns) is byte-identical to the blend path.

    Passing no ``investigation_columns`` must leave the labelling exactly as
    the section-blend path produced it — the honor-borehole override is purely
    additive.  Same two-section KLEI/SAND-lens fixture as the lens test, with
    and without the (empty) keyword, must yield the identical label array.
    """
    domain = _domain_for_two_sections()
    sections = [_section_a(), _section_b()]

    grid_default = label_voxels(domain, 2.0, sections)
    grid_empty = label_voxels(domain, 2.0, sections, investigation_columns=())

    assert np.array_equal(grid_default.labels, grid_empty.labels)
    assert grid_default.body_id_by_index == grid_empty.body_id_by_index


# ---------------------------------------------------------------------------
# Honor-borehole: a borehole defines its OWN ground surface — there is no
# material above its logged top.  When the interpolated section-blend surface at
# the borehole's (x, y) sits ABOVE the borehole's own logged top, the voxels
# between the log top and the blend top must be VOID (the borehole's surface),
# not filled with a neighbour's blend lithology (an above-surface sliver).
# ---------------------------------------------------------------------------


def _section_high_klei(y: float, id_prefix: str) -> SectionPartitionInput:
    """A KLEI section whose surface is HIGH (+20) over the same base (-10).

    Used as the surrounding section context so the between-section blend SURFACE
    interpolates high (well above a borehole whose own log tops out lower).  A
    single KLEI body fills +20 → -10; ``body_id='kleiHigh'`` so it matches across
    the two surrounding sections and fills the midline (a one-sided body would
    pinch to zero there).
    """
    columns = (
        SectionColumnInput(f"{id_prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{id_prefix}1", along_m=80.0, world_x=80.0, world_y=y),
    )
    regions = (
        RegionInput(_KLEI, "kleiHigh", ((0.0, 20.0), (1.0, 20.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=80.0, end_y=y, columns=columns, regions=regions
    )


def test_honored_column_voids_above_its_own_logged_surface():
    """A honored borehole has NO material above its own logged top (its surface).

    The surrounding sections (y=0 and y=40) have a HIGH KLEI surface at +20, so
    the between-section blend at the borehole's location (the midline y=20) reads
    KLEI from +20 down — a surface 10 m above the borehole's own logged top.  The
    borehole's OWN log is SAND from its surface (+10) down to -4 (observed only
    over [-4, +10]).  A borehole defines its own ground surface: there is no
    material above +10 at its location, so the [+10, +20] band — where the naive
    blend fallback would fill a KLEI sliver — must be VOID.

    Within the log range [-4, +10] the column reads the OWN log (SAND); below the
    log base (-4) the column still falls back to the section blend (KLEI down to
    -10) so a shallow log punches no hole below it.
    """
    domain = _domain_for_two_sections()
    bh = InvestigationColumn(
        investigation_id="BH-own-surface",
        world_x=40.0,
        world_y=20.0,
        # Observed SAND from the borehole's surface (+10) down to -4.
        intervals=(("bodySandOwn", _SAND, 10.0, -4.0),),
    )
    grid = label_voxels(
        domain,
        2.0,
        [_section_high_klei(0.0, "P"), _section_high_klei(40.0, "Q")],
        investigation_columns=(bh,),
    )

    # ABOVE the borehole's own logged top (+10), where the blend surface sits at
    # +20: the column is VOID — the borehole's surface, no above-top blend sliver.
    assert _formation_at(grid, x=40.0, y=20.0, elev=15.0) is None
    # WITHIN the log range: the borehole's OWN SAND.
    assert _formation_at(grid, x=40.0, y=20.0, elev=4.0) == _SAND
    # BELOW the log base (-4): the section blend (KLEI) still fills past the log —
    # the void above the surface did NOT punch a hole below the log.
    assert _formation_at(grid, x=40.0, y=20.0, elev=-7.0) == _KLEI

    # And the top→down sequence is exactly SAND (own log) over KLEI (blend below):
    # no KLEI sliver above the SAND.
    seq = _vertical_formation_sequence(grid, x=40.0, y=20.0)
    assert seq == [_SAND, _KLEI]


# ---------------------------------------------------------------------------
# Geological-band-scoped fill (Task 3): a geological surface partitions space
# into bands; a litho never crosses a band surface, and below a shallow test's
# TD the band-scoped sideways fill draws the deeper band's lithology from the
# nearest section that REACHES that band (not the shallow unit pushed down, not
# void).
# ---------------------------------------------------------------------------

_ZAND = "ZAND"


def _flat_geo_surface(elev: float) -> SurfaceBound:
    """A flat geological band surface at constant elevation ``elev``.

    Spans the whole two-section footprint (a large triangle well outside the
    x∈[0,80], y∈[-5,45] partition extent) so every query ``(x, y)`` lands inside
    the TIN footprint and interpolates exactly ``elev`` — a clean horizontal
    geological boundary to test band membership against.
    """
    vertices = [
        (-1000.0, -1000.0, elev),
        (2000.0, -1000.0, elev),
        (0.0, 2000.0, elev),
    ]
    triangles = [(0, 1, 2)]
    return SurfaceBound(vertices=vertices, triangles=triangles)


def _section_deep_zand_over_klei(y: float, id_prefix: str) -> SectionPartitionInput:
    """A DEEP section: ZAND in the upper band over KLEI in the lower band.

    The column spans the surface (+12) down to a deep base (-15).  With a
    geological surface at -5, the ZAND fills the UPPER geological band
    (+12 → -5) and the KLEI fills the LOWER band (-5 → -15) — the section
    reaches BOTH bands.  The KLEI carries ``body_id='kleiDeep'`` so the lower
    band has a stable deep-band identity to fill the shallow column's lower band
    with (the sideways fill).
    """
    columns = (
        SectionColumnInput(f"{id_prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{id_prefix}1", along_m=80.0, world_x=80.0, world_y=y),
    )
    regions = (
        RegionInput(_ZAND, "zandDeep", ((0.0, 12.0), (1.0, 12.0), (1.0, -5.0), (0.0, -5.0)), 0),
        RegionInput(_KLEI, "kleiDeep", ((0.0, -5.0), (1.0, -5.0), (1.0, -15.0), (0.0, -15.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=80.0, end_y=y, columns=columns, regions=regions
    )


def _section_shallow_zand_only(y: float, id_prefix: str, base_elev: float) -> SectionPartitionInput:
    """A SHALLOW section: ZAND only, stopping at ``base_elev`` in the UPPER band.

    The column spans the surface (+12) down to ``base_elev`` (e.g. -1, above the
    geological surface at -5), so it reaches the UPPER geological band ONLY — it
    never reaches the lower band.  Below its TD the column is unlogged, and the
    band-scoped fill must draw the LOWER band's lithology from the deep section.
    """
    columns = (
        SectionColumnInput(f"{id_prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{id_prefix}1", along_m=80.0, world_x=80.0, world_y=y),
    )
    regions = (
        RegionInput(
            _ZAND,
            "zandShallow",
            ((0.0, 12.0), (1.0, 12.0), (1.0, base_elev), (0.0, base_elev)),
            0,
        ),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=80.0, end_y=y, columns=columns, regions=regions
    )


def _formation_at(grid, x: float, y: float, elev: float) -> str | None:
    """Resolve the labelled formation at the voxel nearest world ``(x, y, elev)``.

    Returns ``None`` when the nearest voxel is void.
    """
    i = int(np.argmin(np.abs(grid.gx - x)))
    j = int(np.argmin(np.abs(grid.gy - y)))
    k = int(np.argmin(np.abs(grid.gz - elev)))
    label = int(grid.labels[i, j, k])
    if label < 0:
        return None
    return grid.formation_by_body[grid.body_id_by_index[label]]


def test_lower_band_below_a_shallow_test_fills_with_the_deep_band_lithology():
    """Below a shallow test's TD the LOWER geological band fills with deep KLEI.

    Two parallel sections share a geological surface at -5 m.  The DEEP section
    (y=0) carries ZAND in the upper band over KLEI in the lower band; the SHALLOW
    section (y=40) carries ZAND only, stopping at -1 m — it never reaches the
    lower geological band.  At the SHALLOW section's own line (y=40), the lower
    band (below the -5 surface) has no local lithology, so the band-scoped
    sideways fill must draw it from the nearest section that REACHES the lower
    band — the deep section's KLEI.  Without geology this region would either be
    void or wrongly carry the shallow ZAND pushed down; the geological-band fill
    makes it KLEI.
    """
    domain = _domain_for_two_sections()
    sections = [
        _section_deep_zand_over_klei(0.0, "D"),
        _section_shallow_zand_only(40.0, "S", base_elev=-1.0),
    ]
    surfaces = (_flat_geo_surface(-5.0),)
    grid = label_voxels(domain, 2.0, sections, geo_surfaces=surfaces)

    # Deep in the lower band, on the shallow section's line: the lower band's
    # KLEI (the sideways fill), NOT void and NOT the shallow ZAND pushed down.
    assert _formation_at(grid, x=40.0, y=40.0, elev=-10.0) == _KLEI


def _section_upper_pinch_over_deep_klei(y: float, id_prefix: str) -> SectionPartitionInput:
    """A section whose upper-band ZAND PINCHES at -2 over a lower-band KLEI.

    The ZAND fills only +12 → -2 — it pinches out well ABOVE the -5 geological
    surface, so the upper geological band (down to -5) is only PARTLY filled
    (a genuine void gap -5 → -2 of pinched-out litho).  The KLEI fills the lower
    band -5 → -15.  The lower band's KLEI must NOT bleed UP across the -5 surface
    into the upper band's void gap — the geological boundary stops it.
    """
    columns = (
        SectionColumnInput(f"{id_prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{id_prefix}1", along_m=80.0, world_x=80.0, world_y=y),
    )
    regions = (
        RegionInput(_ZAND, "zandPinch", ((0.0, 12.0), (1.0, 12.0), (1.0, -2.0), (0.0, -2.0)), 0),
        RegionInput(_KLEI, "kleiDeep", ((0.0, -5.0), (1.0, -5.0), (1.0, -15.0), (0.0, -15.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=80.0, end_y=y, columns=columns, regions=regions
    )


def test_lower_band_lithology_does_not_bleed_up_across_a_geo_surface():
    """The lower band's KLEI does NOT bleed up across the -5 surface (no crossing).

    Both sections carry a ZAND pinching out at -2 (above the -5 surface) over a
    KLEI in the lower band (-5 → -15).  The upper geological band therefore has a
    genuine void gap from -5 up to -2 (pinched-out litho).  The hard geological
    boundary must stop the lower band's KLEI from filling that gap: just ABOVE the
    -5 surface (-3.5, in the gap) must NOT read KLEI (the deeper band may not
    cross up), while just BELOW the surface (-7) reads KLEI (the lower band).
    This pins the gap-aware fill — a deeper band never bleeds across a geological
    surface into a shallower band's pinch-out void.
    """
    domain = _domain_for_two_sections()
    sections = [
        _section_upper_pinch_over_deep_klei(0.0, "X"),
        _section_upper_pinch_over_deep_klei(40.0, "Y"),
    ]
    surfaces = (_flat_geo_surface(-5.0),)
    grid = label_voxels(domain, 2.0, sections, geo_surfaces=surfaces)

    in_gap = _formation_at(grid, x=40.0, y=20.0, elev=-3.5)  # upper band, in the pinch gap
    below = _formation_at(grid, x=40.0, y=20.0, elev=-7.0)  # lower band
    assert in_gap != _KLEI  # the deeper KLEI did NOT bleed up across the surface
    assert below == _KLEI  # the lower band is KLEI


def test_a_litho_contact_within_tolerance_of_a_geo_surface_snaps_to_it():
    """A litho contact near a geological surface SNAPS — no thin sliver across it.

    The deep section's internal ZAND/KLEI contact sits at -4.9 m, only 0.1 m
    above the geological surface at -5.0 m — within the 0.20 m snap tolerance.
    The band-scoped clip must SNAP that contact to the surface (so the ZAND ends
    exactly at the band boundary and the KLEI begins exactly there), rather than
    leaving a thin 0.1 m sliver of KLEI in the UPPER band (above the surface) or
    a sliver of ZAND in the LOWER band.  So just above the surface is ZAND only
    and just below is KLEI only — the contact reads as coincident with the band.
    """
    domain = _domain_for_two_sections()

    # Deep section whose ZAND/KLEI contact is at -4.9 (0.1 m above the -5 surface).
    columns = (
        SectionColumnInput("E0", along_m=0.0, world_x=0.0, world_y=0.0),
        SectionColumnInput("E1", along_m=80.0, world_x=80.0, world_y=0.0),
    )
    regions = (
        RegionInput(_ZAND, "zandDeep", ((0.0, 12.0), (1.0, 12.0), (1.0, -4.9), (0.0, -4.9)), 0),
        RegionInput(_KLEI, "kleiDeep", ((0.0, -4.9), (1.0, -4.9), (1.0, -15.0), (0.0, -15.0)), 0),
    )
    deep = SectionPartitionInput(
        start_x=0.0, start_y=0.0, end_x=80.0, end_y=0.0, columns=columns, regions=regions
    )
    shallow = _section_shallow_zand_only(40.0, "S", base_elev=-1.0)
    surfaces = (_flat_geo_surface(-5.0),)
    # A fine 0.1 m VERTICAL step so the would-be 0.1 m KLEI sliver between the
    # litho contact (-4.9) and the geological surface (-5.0) is a full voxel —
    # visible ONLY if the contact failed to snap.  The sliver is a vertical
    # question, so only Z needs the fine step: asking for 0.1 m horizontally too
    # resolved to 108 M cells (435 MB of labels) for a test that reads two of
    # them, which is now over the build's voxel budget.
    grid = label_voxels(
        domain,
        2.0,
        [deep, shallow],
        vertical_spacing_m=0.1,
        geo_surfaces=surfaces,
        litho_snap_tolerance_m=0.20,
    )

    # The contact snaps DOWN to the -5 surface, so the [-5.0, -4.9] interval that
    # would otherwise be a thin KLEI sliver IN THE UPPER BAND is ZAND (the
    # contact reads as coincident with the band boundary — no sliver across it).
    assert _formation_at(grid, x=40.0, y=0.0, elev=-4.95) == _ZAND
    # Well below the surface stays KLEI (the lower band).
    assert _formation_at(grid, x=40.0, y=0.0, elev=-5.5) == _KLEI


# ---------------------------------------------------------------------------
# Anisotropic spacing (Task 4): a single horizontal spacing for X/Y, a finer
# vertical spacing for Z, so thin layers resolve without exploding the X/Y
# voxel count.  Geology is thin-layered vertically — fine Z + coarse X/Y.
# ---------------------------------------------------------------------------


def test_anisotropic_spacing_steps_horizontal_in_xy_and_vertical_in_z():
    """``gx``/``gy`` step at the horizontal spacing; ``gz`` steps at the vertical.

    Splitting the cubic spacing into a coarse horizontal (X and Y) and a fine
    vertical (Z) is the Task-4 contract: the grid samples thin geology layers
    finely in elevation without paying the X/Y voxel-count cost.  With
    ``grid_spacing_m=4.0`` (horizontal) and ``vertical_spacing_m=1.0`` the
    consecutive node deltas must be 4 m along X and Y and 1 m along Z.
    """
    domain = _domain_for_two_sections()
    sections = [_section_a(), _section_b()]

    grid = label_voxels(domain, 4.0, sections, vertical_spacing_m=1.0)

    # X and Y step at the horizontal spacing (4 m).
    assert np.allclose(np.diff(grid.gx), 4.0)
    assert np.allclose(np.diff(grid.gy), 4.0)
    # Z steps at the vertical spacing (1 m) — finer than X/Y.
    assert np.allclose(np.diff(grid.gz), 1.0)


def test_cubic_when_vertical_equals_horizontal_is_byte_identical_to_grid_spacing():
    """``vertical_spacing_m`` omitted (or == horizontal) reproduces the cubic build.

    The cubic-equals invariant is load-bearing: the anisotropy keyword must be
    purely additive, so a build with no ``vertical_spacing_m`` and a build with
    ``vertical_spacing_m`` set EQUAL to the horizontal spacing must both be
    byte-identical to the original ``label_voxels(domain, 2.0, sections)`` cubic
    output — same labels, same axes, same body ordering.
    """
    domain = _domain_for_two_sections()
    sections = [_section_a(), _section_b()]

    cubic = label_voxels(domain, 2.0, sections)
    omitted = label_voxels(domain, 2.0, sections, vertical_spacing_m=None)
    equal = label_voxels(domain, 2.0, sections, vertical_spacing_m=2.0)

    for other in (omitted, equal):
        assert np.array_equal(cubic.labels, other.labels)
        assert np.array_equal(cubic.gx, other.gx)
        assert np.array_equal(cubic.gy, other.gy)
        assert np.array_equal(cubic.gz, other.gz)
        assert cubic.body_id_by_index == other.body_id_by_index


def test_empty_geo_surfaces_is_byte_identical_to_the_unbounded_blend():
    """``geo_surfaces=()`` leaves the labelling byte-identical to the blend path.

    The geological-band branch is purely additive: with no geological surfaces
    the labeller must reproduce EXACTLY the un-bounded section-blend labels.
    Same DEEP/SHALLOW fixture run with the default (no surfaces) and with an
    explicit empty tuple must yield the identical label array — the proof that
    the band branch never perturbs the no-geology path.
    """
    domain = _domain_for_two_sections()
    sections = [
        _section_deep_zand_over_klei(0.0, "D"),
        _section_shallow_zand_only(40.0, "S", base_elev=-1.0),
    ]

    grid_default = label_voxels(domain, 2.0, sections)
    grid_empty = label_voxels(domain, 2.0, sections, geo_surfaces=())

    assert np.array_equal(grid_default.labels, grid_empty.labels)
    assert grid_default.body_id_by_index == grid_empty.body_id_by_index


# ---------------------------------------------------------------------------
# Honor-borehole + gapped log: an investigation whose observed log has an
# UNLOGGED interval between two observed units must defer that interval to the
# section fill (the blend), NOT bridge it with one of the observed bodies.
# ---------------------------------------------------------------------------


def test_honored_gapped_log_defers_the_unlogged_interval_to_the_blend():
    """An UNLOGGED interval between two observed units takes the blend, not a bridge.

    A borehole observes ZAND from the surface (+10) down to +4, then nothing
    from +4 down to -4 (an unlogged interval — the layer there was rejected /
    body-unassigned, so it is absent from the log), then KLEI from -4 to -10.
    The honored column must reproduce the OBSERVED units where they exist and
    DEFER the unlogged middle interval to the section fill.  The surrounding
    sections read SAND in that middle band (the lens fixture: KLEI / SAND /
    KLEI on A), so the unlogged gap must read the blend's SAND there — NOT a
    bridge of the borehole's own ZAND-on-top or KLEI-below across the gap.

    Geologically: a borehole that did not observe the interfingered SAND
    (because that interval was not accepted) should let the cross-section fill
    speak for the unlogged depth, not stretch its own bounding units to cover
    it.
    """
    domain = _domain_for_two_sections()
    # Surrounding sections are the KLEI / SAND-lens / KLEI fixture, and the borehole
    # stands at y=8, four fifths of the way to A.  The blend carries the SAND there
    # spanning about -4 → +1, so the unlogged interval is set to +2 → -5 to sit over
    # it: an elevation inside that gap must read the blend's SAND, not a bridge of
    # the borehole's own ZAND-above or KLEI-below.
    #
    # The band used to sit at +2 → +7 and the gap was written to match. It moved when
    # the one-sided SAND stopped dying at the midline (#256): under the old rule every
    # body BELOW a thinned one rode up with it, putting this SAND 4.5 m above section
    # A's own +4 → -4. The fixture follows the corrected geometry; what is under test
    # — that an unlogged interval defers rather than bridging — is unchanged.
    bh = InvestigationColumn(
        investigation_id="BH-gapped",
        world_x=40.0,
        world_y=8.0,
        # ZAND +10 → +2, UNLOGGED +2 → -5, KLEI -5 → -10 (two non-adjacent units).
        intervals=(
            ("bodyZandTop", _ZAND, 10.0, 2.0),
            ("bodyKleiBot", _KLEI, -5.0, -10.0),
        ),
    )
    grid = label_voxels(
        domain,
        2.0,
        [_section_a(), _section_b()],
        investigation_columns=(bh,),
    )

    # Inside the unlogged interval, where the blend carries the SAND lens: must read
    # the blend's SAND, proving the log did NOT bridge the gap with its own bounding
    # ZAND/KLEI.
    assert _formation_at(grid, x=40.0, y=8.0, elev=0.0) == _SAND
    # The observed units are honored where they exist: ZAND on top, KLEI below.
    assert _formation_at(grid, x=40.0, y=8.0, elev=8.0) == _ZAND
    assert _formation_at(grid, x=40.0, y=8.0, elev=-7.0) == _KLEI


def test_shallow_honored_log_over_a_geo_band_fills_below_td_with_band_litho():
    """A shallow honored log over a geo-band reads OWN log on top, band fill below TD.

    The combined honor + geology path: a SHALLOW borehole (logged only the top
    band) sits at a column where the geology-bounded fill must draw the deeper
    geological band's lithology sideways from the section that reaches it.

    Two sections share a geological surface at -5 m.  The DEEP section (y=0)
    carries ZAND over KLEI (reaching both bands); the SHALLOW section (y=40)
    carries ZAND only, stopping above the surface.  A borehole at the midline
    (y=20) observes ZAND only in the UPPER band (+12 → -1) — it never reaches
    the lower band.  Honoring must:
      (a) within the log range read the borehole's OWN ZAND, and
      (b) BELOW the log's TD the LOWER geological band fills with the deep
          section's KLEI (the band-scoped sideways fill) — NOT void, and NOT
          the borehole's own deepest unit (ZAND) pushed down past its TD.

    This exercises ``_column_labels_gapped`` as the honor fallback on the geo
    path: the band-scoped column stack feeds the fallback, so the below-log
    fill is the deeper band's litho, bounded by the geological surface.
    """
    domain = _domain_for_two_sections()
    sections = [
        _section_deep_zand_over_klei(0.0, "D"),
        _section_shallow_zand_only(40.0, "S", base_elev=-1.0),
    ]
    surfaces = (_flat_geo_surface(-5.0),)
    bh = InvestigationColumn(
        investigation_id="BH-shallow-over-band",
        world_x=40.0,
        world_y=20.0,
        # Observed ZAND only in the upper band (+12 down to -1); nothing below.
        intervals=(("zandShallowOwn", _ZAND, 12.0, -1.0),),
    )
    grid = label_voxels(
        domain,
        2.0,
        sections,
        geo_surfaces=surfaces,
        investigation_columns=(bh,),
    )

    # (a) Within the log range: the borehole's OWN ZAND on top.
    assert _formation_at(grid, x=40.0, y=20.0, elev=5.0) == _ZAND
    # (b) Below the log's TD, in the LOWER geological band: the deep section's
    #     KLEI drawn sideways — not void, not the borehole's ZAND pushed down.
    assert _formation_at(grid, x=40.0, y=20.0, elev=-10.0) == _KLEI


def test_a_cpt_takes_a_shared_voxel_column_from_a_borehole():
    """Two tests inside one voxel: the model shows the cone's log, not the driller's.

    Both stand at the same spot to well within one 2 m voxel, so the grid has a
    single column for them and can hold a single log.  The honored voxels must
    carry the CPT's lithology whichever order the two are supplied in — the
    choice must come from what the tests ARE, not from which was seen first.

    The borehole's id sorts BEFORE the CPT's, so under the old "smallest id
    wins" rule (which on time-ordered UUIDv7 meant "imported first") the
    borehole took the column.
    """
    domain = _domain_for_two_sections()
    sections = [_section_klei_all(0.0, "P"), _section_klei_all(40.0, "Q")]

    borehole = InvestigationColumn(
        investigation_id="aaa-borehole",
        world_x=40.0,
        world_y=20.6,
        intervals=(("bodyZand", _SAND, 10.0, 0.0),),
        kind="borehole",
    )
    cpt = InvestigationColumn(
        investigation_id="zzz-cpt",
        world_x=40.3,
        world_y=20.9,
        intervals=(("bodyVeen", _VEEN, 10.0, 0.0),),
        kind="cpt",
    )

    for order in ((borehole, cpt), (cpt, borehole)):
        grid = label_voxels(domain, 2.0, sections, investigation_columns=order)
        # Both tests map to the SAME grid node (x=40, y=21) — that is the
        # single column they are contending for, so read it there.
        seq = _vertical_formation_sequence(grid, x=40.0, y=20.9)
        supplied = [column.investigation_id for column in order]
        assert seq[0] == _VEEN, f"order {supplied} honored the borehole, not the CPT"
        assert _SAND not in seq, f"order {supplied} kept the borehole's log"


def test_between_two_cpts_in_one_voxel_the_deeper_one_is_honored():
    """Same kind in one column: the test that reached deeper describes it.

    Both are cones, so the kind cannot separate them; the deeper log wins
    because it accounts for more of the column.
    """
    domain = _domain_for_two_sections()
    sections = [_section_klei_all(0.0, "P"), _section_klei_all(40.0, "Q")]

    shallow = InvestigationColumn(
        investigation_id="aaa-shallow-cpt",
        world_x=40.0,
        world_y=20.6,
        intervals=(("bodyZand", _SAND, 10.0, 6.0),),
        kind="cpt",
    )
    deep = InvestigationColumn(
        investigation_id="zzz-deep-cpt",
        world_x=40.3,
        world_y=20.9,
        intervals=(("bodyVeen", _VEEN, 10.0, -4.0),),
        kind="cpt",
    )

    for order in ((shallow, deep), (deep, shallow)):
        grid = label_voxels(domain, 2.0, sections, investigation_columns=order)
        # Both tests map to the SAME grid node (x=40, y=21) — that is the
        # single column they are contending for, so read it there.
        seq = _vertical_formation_sequence(grid, x=40.0, y=20.9)
        supplied = [column.investigation_id for column in order]
        assert seq[0] == _VEEN, f"order {supplied} honored the shallower cone"
        assert _SAND not in seq, f"order {supplied} kept the shallower log"


# ---------------------------------------------------------------------------
# What the partition leaves UNKNOWN stays unknown in 3-D.
#
# Owner ruling 2026-07-30, quoted in ``BuildVoxelLithoModel``: *"the voids below
# td are always filled through correlations from other tests the left or right
# (as in fill bands) if that is not the case then you leave it unkown."*  The
# 2-D engine already decides that; the builder's job is to take its answer
# INCLUDING its voids, never to supply a second opinion.
# ---------------------------------------------------------------------------


def _section_with_an_unfilled_middle() -> SectionPartitionInput:
    """Section A, but the interval +4 → -4 is UNKNOWN — no region fills it.

    Same envelope as :func:`_section_a` (+10 surface, -10 base) with the SAND
    lens simply absent: nothing correlated across that interval, so the 2-D
    engine drew nothing there.
    """
    columns = (
        SectionColumnInput("A0", along_m=0.0, world_x=0.0, world_y=0.0),
        SectionColumnInput("A1", along_m=80.0, world_x=80.0, world_y=0.0),
    )
    regions = (
        RegionInput(_KLEI, "kleiTop", ((0.0, 10.0), (1.0, 10.0), (1.0, 4.0), (0.0, 4.0)), 0),
        RegionInput(_KLEI, "kleiBot", ((0.0, -4.0), (1.0, -4.0), (1.0, -10.0), (0.0, -10.0)), 0),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=0.0, end_x=80.0, end_y=0.0, columns=columns, regions=regions
    )


def _formations_between(grid, x: float, y: float, low: float, high: float) -> set[str | None]:
    """Every formation (``None`` for void) the column at ``(x, y)`` shows in a band."""
    i = int(np.argmin(np.abs(grid.gx - x)))
    j = int(np.argmin(np.abs(grid.gy - y)))
    out: set[str | None] = set()
    for k, z in enumerate(grid.gz):
        if not (low < float(z) < high):
            continue
        label = int(grid.labels[i, j, k])
        out.add(None if label < 0 else grid.formation_by_body[grid.body_id_by_index[label]])
    return out


def test_an_unfilled_interval_stays_unknown_instead_of_taking_the_body_above():
    """The clay above an unknown interval must not be extruded down through it.

    Read beyond the sections (nearer A than B, outside the band between them) so
    the column is A's own partition extended sideways — the answer A actually
    drew, voids and all.
    """
    domain = _domain_for_two_sections()
    sections = [_section_with_an_unfilled_middle(), _section_b()]

    grid = label_voxels(domain, 2.0, sections)

    assert _formations_between(grid, x=40.0, y=-3.0, low=-4.0, high=4.0) == {None}


def test_the_bodies_around_an_unfilled_interval_stay_exactly_where_they_are():
    """Nothing above or below the unknown interval moves to close it up."""
    domain = _domain_for_two_sections()
    sections = [_section_with_an_unfilled_middle(), _section_b()]

    grid = label_voxels(domain, 2.0, sections)

    assert _formations_between(grid, x=40.0, y=-3.0, low=4.0, high=10.0) == {_KLEI}
    assert _formations_between(grid, x=40.0, y=-3.0, low=-10.0, high=-4.0) == {_KLEI}


# ---------------------------------------------------------------------------
# A void is what the 2-D engine LEFT BLANK, not what its 1 mm snap grid rounded
# ---------------------------------------------------------------------------
# The 2-D partition engine snaps every polygon coordinate to a 1 mm grid, so two
# regions meeting at one contact can come back a fraction of a millimetre apart.
# That is rounding, not a statement that the interval is unknown.


_TWO_BODIES = {"upper": 0, "lower": 1}


def _stack_split_at(upper_base: float, lower_top: float) -> list[_Entry]:
    """A two-body column, shallow → deep, whose contact is written twice."""
    return [
        _Entry("upper", _KLEI, top_elev=10.0, base_elev=upper_base),
        _Entry("lower", _SAND, top_elev=lower_top, base_elev=0.0),
    ]


def test_a_contact_that_snaps_a_fraction_of_a_millimetre_apart_is_still_a_contact():
    """Half a millimetre between two regions is the snap grid, not an unknown interval.

    A voxel sitting in that sliver must take the body above it — the way it did
    before voids were preserved — rather than become a thread of void voxels
    drifting through a contact the engineer drew as flush.
    """
    stack = _stack_split_at(upper_base=4.0005, lower_top=4.0)
    gz = np.array([4.0002], dtype=float)

    col = _column_labels(stack, gz, _TWO_BODIES, {})

    assert col.tolist() == [0]


def test_an_interval_wider_than_the_snap_grid_is_still_a_void():
    """The near-miss: 2 mm is more than the engine's rounding, so it stays unknown.

    This is the case the void slot exists for — the 2-D engine deliberately left
    the interval blank and the grid must not invent lithology in it.
    """
    stack = _stack_split_at(upper_base=4.002, lower_top=4.0)
    gz = np.array([4.001], dtype=float)

    col = _column_labels(stack, gz, _TWO_BODIES, {})

    assert col.tolist() == [-1]


def test_both_labellers_agree_on_a_voxel_sitting_exactly_on_a_contact():
    """One boundary rule, two implementations — a shared contact goes to the body above.

    The fast searchsorted labeller and the gap-tolerant one are two consumers of
    the same half-open convention; a voxel landing exactly on a global boundary
    must not depend on which one the caller passed.
    """
    stack = _stack_split_at(upper_base=4.0, lower_top=4.0)
    # Every boundary of the stack plus a point inside each body.
    gz = np.array([0.0, 2.0, 4.0, 7.0, 10.0], dtype=float)

    fast = _column_labels(stack, gz, _TWO_BODIES, {})
    gapped = _column_labels_gapped(stack, gz, _TWO_BODIES, {})

    assert fast.tolist() == gapped.tolist()


def test_grid_floor_reaches_the_deepest_honored_investigation():
    """The model bottoms out at the deepest test, not at the 2-D partition.

    Owner ruling 2026-08-31 (debt #242): *"down to the deepest investigation"*
    — nothing he paid to measure may fall outside the model, and the floor
    moves as he imports.  The sections here stop at -10 m, but the honored
    CPT logged KLEI on to -16 m — the exact shape of his GEO-05/040-S2, whose
    deepest 3.28 m the old partition-framed grid silently cut off.

    Three things must hold, and the last two are what made this a ruling
    rather than a one-liner:

    * the grid's vertical range reaches the deep log's base;
    * the honored column itself is labelled down to that base (the measured
      ground is IN the model);
    * a column AWAY from the deep test keeps its own stack ending where the
      sections end — the extra depth below it is under-floor void, not an
      interior void, so the gapless clauses stay quiet on a correct model.
    """
    domain = _domain_for_two_sections()
    deep = InvestigationColumn(
        investigation_id="CPT-deep",
        world_x=40.0,
        world_y=20.0,
        # Observed KLEI from +10 all the way to -16: six metres below the
        # deepest section region (-10).
        intervals=(("bodyDeepKlei", _KLEI, 10.0, -16.0),),
        kind="cpt",
    )
    grid = label_voxels(
        domain,
        2.0,
        [_section_klei_all(0.0, "P"), _section_klei_all(40.0, "Q")],
        investigation_columns=(deep,),
    )

    # The floor is the deepest measured base, not the partition's.
    assert float(grid.gz.min()) <= -16.0 + 1.0  # within one 2 m voxel of -16

    # The deep column carries its own measured KLEI to the bottom voxel of
    # the log — labelled, not void.
    ix = int(np.argmin(np.abs(grid.gx - 40.0)))
    iy = int(np.argmin(np.abs(grid.gy - 20.0)))
    col = grid.labels[ix, iy, :]
    deep_cells = [k for k in range(len(grid.gz)) if grid.gz[k] <= -10.0]
    assert any(col[k] >= 0 for k in deep_cells), (
        "the honored log's deepest metres are still cut off"
    )

    # A column on section P keeps its section stack: labelled to the section
    # base, void below — and NOTHING between its labelled cells (no interior
    # void invented by the deeper grid).
    jx = int(np.argmin(np.abs(grid.gx - 40.0)))
    jy = int(np.argmin(np.abs(grid.gy - 0.0)))
    colp = grid.labels[jx, jy, :]
    labelled = [k for k in range(len(grid.gz)) if colp[k] >= 0]
    assert labelled, "section column lost its labels"
    lo, hi = min(labelled), max(labelled)
    assert all(colp[k] >= 0 for k in range(lo, hi + 1)), (
        "extending the floor invented an interior void in a section column"
    )


# ---------------------------------------------------------------------------
# Bed-override cap — the canal cut-out (owner question 2026-09-07)
# ---------------------------------------------------------------------------
#
# The owner's site was dredged for a canal.  A bed override says the ground
# under the canal is at the dredged bed level, not the water surface the DEM /
# the section fill tops out at.  "Does the canal fill also cut out in the litho
# model?" — ruling: inside a bed polygon nothing lithological is built above the
# bed level; outside every polygon nothing changes.  ``label_voxels`` takes an
# optional ``bed_top_at(x, y)`` sampler that returns the bed level inside a
# polygon and ``None`` everywhere else.


def test_bed_override_cap_stops_the_litho_at_the_bed_level_inside_the_polygon():
    """Inside the canal polygon the 3-D litho model stops at the bed level.

    A bed override puts the dredged bed at -4 m TAW over the footprint's left
    half (x < 40 m).  Every voxel above -4 m in a column inside the canal must
    be void, so the shallowest labelled voxel there sits at or below the bed —
    while a column outside the canal still reaches the full +10 m collar the
    section partition drew.
    """
    domain = _domain_for_two_sections()

    def bed_top_at(x: float, y: float) -> float | None:
        # The canal covers the left half of the footprint; outside it the
        # sampler contains no point and returns None (the ground stands).
        return -4.0 if x < 40.0 else None

    grid = label_voxels(domain, 2.0, [_section_a(), _section_b()], bed_top_at=bed_top_at)

    j = int(np.argmin(np.abs(grid.gy - 20.0)))  # the midline row
    # Inside the canal (x = 20 m): nothing lithological above the bed level.
    i_in = int(np.argmin(np.abs(grid.gx - 20.0)))
    labelled_in = [float(grid.gz[k]) for k in range(len(grid.gz)) if grid.labels[i_in, j, k] >= 0]
    assert labelled_in, "the canal column lost all its material — it must keep the bed and below"
    assert max(labelled_in) <= -4.0 + 1e-9, "the litho fill did not stop at the bed level"

    # Outside the canal (x = 60 m): the column still reaches the collar.
    i_out = int(np.argmin(np.abs(grid.gx - 60.0)))
    labelled_out = [float(grid.gz[k]) for k in range(len(grid.gz)) if grid.labels[i_out, j, k] >= 0]
    assert labelled_out and max(labelled_out) > 4.0, (
        "a column outside every bed polygon must be untouched — it still reaches the collar"
    )


def test_bed_cap_containing_no_point_is_byte_identical_to_no_cap():
    """A bed sampler that returns None everywhere changes not one voxel.

    This is the outside-every-polygon guarantee AND the no-bed-overrides case
    (the caller passes ``bed_top_at=None`` then, and a project with a polygon
    that no grid column falls inside sees the same result): the labelled grid is
    array-identical to the uncapped build.
    """
    domain = _domain_for_two_sections()
    base = label_voxels(domain, 2.0, [_section_a(), _section_b()])
    capped = label_voxels(domain, 2.0, [_section_a(), _section_b()], bed_top_at=lambda x, y: None)
    assert np.array_equal(base.labels, capped.labels)
