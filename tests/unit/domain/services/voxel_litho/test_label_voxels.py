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
from groundmodel.domain.services.strat_field.strat_types import SurfaceBound
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
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
    # A fine 0.1 m grid so the would-be 0.1 m KLEI sliver between the litho
    # contact (-4.9) and the geological surface (-5.0) is a full voxel — visible
    # ONLY if the contact failed to snap.
    grid = label_voxels(
        domain, 0.1, [deep, shallow], geo_surfaces=surfaces, litho_snap_tolerance_m=0.20
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
