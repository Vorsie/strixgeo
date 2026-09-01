"""Unit tests for :func:`plan_body_aliases` — the cross-section body merge.

Owner rule (2026-07-28): *"there should be no auto ties that are generated, you
just keep the ties and merge the bodies on lithological adjacency, like the
renderer does"*, so that *"something rendered as one body is one body in the
data"*.

The renderer's ``mergeTouchingBodies`` does this WITHIN a section (stage 1) and
records that the cross-section stage is somebody else's job. This is that stage,
and it lives on the server so ONE alias map can be applied to BOTH the section
regions and the honored investigation columns — the earlier frontend-only relabel
left the honored columns on their original ids, so the same material carried two
identities.
"""

from __future__ import annotations

import pytest

from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (
    _spans_at_fraction,
    plan_body_aliases,
    plan_layer_groups,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


def _band(formation: str, body: str | None, top: float, base: float) -> RegionInput:
    """A full-width band region spanning its gap from ``top`` down to ``base``."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=0,
    )


def _section(columns: list[str], regions: list[RegionInput]) -> SectionPartitionInput:
    """A two-or-more column section carrying ``regions`` in its first gap."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=tuple(
            SectionColumnInput(investigation_id=c, along_m=i * 50.0, world_x=i * 50.0, world_y=0.0)
            for i, c in enumerate(columns)
        ),
        regions=tuple(regions),
    )


def test_same_unit_on_two_sections_becomes_one_body() -> None:
    """S9 is on both sections; its sand must end up under a single id."""
    aliases = plan_body_aliases(
        [
            _section(["S4", "S9"], [_band("ZAND", "from-tie", 3.2, -4.5)]),
            _section(["S9", "S8"], [_band("ZAND", "from-cs1", 3.2, -4.5)]),
        ]
    )

    assert aliases["from-tie"] == aliases["from-cs1"]


def test_representative_is_order_independent() -> None:
    """The winning id is the smallest, whichever order the sections arrive in."""
    a = _section(["S4", "S9"], [_band("ZAND", "bbb", 3.2, -4.5)])
    b = _section(["S9", "S8"], [_band("ZAND", "aaa", 3.2, -4.5)])

    assert plan_body_aliases([a, b]) == plan_body_aliases([b, a])
    assert plan_body_aliases([a, b])["bbb"] == "aaa"


def test_different_lithologies_never_merge() -> None:
    """Meeting at a column is not enough — the formation must match."""
    aliases = plan_body_aliases(
        [
            _section(["S4", "S9"], [_band("ZAND", "sand", 3.2, -4.5)]),
            _section(["S9", "S8"], [_band("KLEI", "clay", 3.2, -4.5)]),
        ]
    )

    assert aliases.get("sand", "sand") == "sand"
    assert aliases.get("clay", "clay") == "clay"


def test_stacked_same_formation_units_never_merge() -> None:
    """An upper sand and a deep sand at one column are two bodies, not one.

    Welding these is precisely the "the upper lens gets pulled down to the deep
    one" defect, so overlap must be strict, not mere contact.
    """
    aliases = plan_body_aliases(
        [
            _section(["S4", "S9"], [_band("ZAND", "upper", 8.0, 5.0)]),
            _section(["S9", "S8"], [_band("ZAND", "deep", 3.0, -4.0)]),
        ]
    )

    assert aliases.get("upper", "upper") == "upper"
    assert aliases.get("deep", "deep") == "deep"


def test_sections_sharing_no_column_never_merge() -> None:
    """Adjacency is via a SHARED column; nothing else connects two sections."""
    aliases = plan_body_aliases(
        [
            _section(["S1", "S2"], [_band("ZAND", "left", 3.2, -4.5)]),
            _section(["S7", "S8"], [_band("ZAND", "right", 3.2, -4.5)]),
        ]
    )

    assert aliases.get("left", "left") == "left"
    assert aliases.get("right", "right") == "right"


def test_merges_transitively_across_the_fence() -> None:
    """A meets B at one column, B meets C at another — all three are one body."""
    aliases = plan_body_aliases(
        [
            _section(["S4", "S9"], [_band("ZAND", "ccc", 3.2, -4.5)]),
            _section(["S9", "S8"], [_band("ZAND", "bbb", 3.2, -4.5)]),
            _section(["S8", "S7"], [_band("ZAND", "aaa", 3.2, -4.5)]),
        ]
    )

    assert {aliases["ccc"], aliases["bbb"], aliases["aaa"]} == {"aaa"}


def test_never_correlated_regions_keep_no_identity() -> None:
    """A ``None`` body has nothing to alias and must not adopt a neighbour's."""
    aliases = plan_body_aliases(
        [
            _section(["S4", "S9"], [_band("ZAND", None, 3.2, -4.5)]),
            _section(["S9", "S8"], [_band("ZAND", "sand", 3.2, -4.5)]),
        ]
    )

    assert None not in aliases
    assert aliases.get("sand", "sand") == "sand"


def test_a_region_pinching_out_before_the_column_does_not_reach_it() -> None:
    """A wedge that closes mid-gap never touches the far column."""
    wedge = RegionInput(
        formation_id="ZAND",
        body_id="wedge",
        polygon=((0.0, 3.2), (0.4, 0.0), (0.0, -4.5)),
        gap_index=0,
    )
    aliases = plan_body_aliases(
        [
            _section(["S4", "S9"], [wedge]),
            _section(["S9", "S8"], [_band("ZAND", "sand", 3.2, -4.5)]),
        ]
    )

    assert aliases.get("wedge", "wedge") == "wedge"


def test_empty_input_is_an_empty_map() -> None:
    """No sections, nothing to alias."""
    assert plan_body_aliases([]) == {}


# ---------------------------------------------------------------------------
# A region that spans its whole gap still REACHES the column it stops a snap
# cell short of.
#
# The 2-D engine snaps polygon coordinates to a 1 mm grid in METRES, so a region
# drawn all the way across an 11 m gap lands at fraction 0.999909…, not 1.0.
# Debt #259 measured this on the owner's real build payload: 33 of 69 gaps had
# no polygon vertex within 1e-6 of fraction 1, and 15 of 69 none at fraction 0.
# ``_section_stack_at`` was taught to inset by a snap cell; this module reads the
# SAME polygons and was never updated, so the merge silently decides the region
# never touched the shared column.
# ---------------------------------------------------------------------------

#: One millimetre on an 11 m gap, in gap-local fraction — the real shortfall.
_MM_ON_11M = 0.001 / 11.0


def _section_11m(columns: list[str], regions: list[RegionInput]) -> SectionPartitionInput:
    """A two-column section whose single gap is 11 m wide (the measured case)."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=11.0,
        end_y=0.0,
        columns=tuple(
            SectionColumnInput(investigation_id=c, along_m=i * 11.0, world_x=i * 11.0, world_y=0.0)
            for i, c in enumerate(columns)
        ),
        regions=tuple(regions),
    )


def test_a_band_snapped_a_millimetre_short_of_the_column_still_reaches_it() -> None:
    """A band drawn across the whole gap merges even though the snap grid clips it.

    The right edge lands at ``1 - 1 mm / 11 m`` instead of exactly 1.0. That is
    the mm snap grid, not a wedge that stops before the column: the unit is on
    both sections and must end up under one body id.
    """
    snapped_right = 1.0 - _MM_ON_11M
    across_the_gap = RegionInput(
        formation_id="ZAND",
        body_id="from-tie",
        polygon=((0.0, 3.2), (snapped_right, 3.2), (snapped_right, -4.5), (0.0, -4.5)),
        gap_index=0,
    )
    aliases = plan_body_aliases(
        [
            _section_11m(["S4", "S9"], [across_the_gap]),
            _section_11m(["S9", "S8"], [_band("ZAND", "from-cs1", 3.2, -4.5)]),
        ]
    )

    assert aliases["from-tie"] == aliases["from-cs1"]


def test_a_band_snapped_a_millimetre_past_the_left_column_still_reaches_it() -> None:
    """The same shortfall at fraction 0 — 15 of 69 measured gaps sit here."""
    snapped_left = _MM_ON_11M
    across_the_gap = RegionInput(
        formation_id="ZAND",
        body_id="from-tie",
        polygon=((snapped_left, 3.2), (1.0, 3.2), (1.0, -4.5), (snapped_left, -4.5)),
        gap_index=0,
    )
    aliases = plan_body_aliases(
        [
            _section_11m(["S9", "S4"], [across_the_gap]),
            _section_11m(["S9", "S8"], [_band("ZAND", "from-cs1", 3.2, -4.5)]),
        ]
    )

    assert aliases["from-tie"] == aliases["from-cs1"]


def test_a_wedge_that_dies_well_before_the_column_still_does_not_reach_it() -> None:
    """Widening the touch tolerance to a snap cell must not weld a real pinch-out.

    A millimetre is the snap grid; a metre is a geological statement. The wedge
    closes 1 m before the shared column, so it never reaches it.
    """
    wedge = RegionInput(
        formation_id="ZAND",
        body_id="wedge",
        polygon=((0.0, 3.2), (1.0 - 1.0 / 11.0, 0.0), (0.0, -4.5)),
        gap_index=0,
    )
    aliases = plan_body_aliases(
        [
            _section_11m(["S4", "S9"], [wedge]),
            _section_11m(["S9", "S8"], [_band("ZAND", "sand", 3.2, -4.5)]),
        ]
    )

    assert aliases.get("wedge", "wedge") == "wedge"


# ---------------------------------------------------------------------------
# Sections that CROSS mid-gap
#
# Owner, 2026-07-28: "two regions are the same body when they meet at a shared
# investigation column, same formation, but also when they touch in between
# columns right?" — yes. Two section lines can cross in map space nowhere near a
# column, and the same unit passes through that crossing on both of them. With
# tie-sections cutting across the long cross-sections this is the common case,
# not an exotic one.
# ---------------------------------------------------------------------------


def _section_at(
    columns: list[tuple[str, float, float]], regions: list[RegionInput]
) -> SectionPartitionInput:
    """A section whose columns sit at explicit world positions."""
    return SectionPartitionInput(
        start_x=columns[0][1],
        start_y=columns[0][2],
        end_x=columns[-1][1],
        end_y=columns[-1][2],
        columns=tuple(
            SectionColumnInput(investigation_id=c, along_m=float(i), world_x=x, world_y=y)
            for i, (c, x, y) in enumerate(columns)
        ),
        regions=tuple(regions),
    )


def test_sections_crossing_between_columns_merge() -> None:
    """Two fences crossing at (50, 0) share no column, but share the sand."""
    east_west = _section_at([("A", 0.0, 0.0), ("B", 100.0, 0.0)], [_band("ZAND", "ew", 3.2, -4.5)])
    north_south = _section_at(
        [("C", 50.0, -50.0), ("D", 50.0, 50.0)], [_band("ZAND", "ns", 3.2, -4.5)]
    )

    aliases = plan_body_aliases([east_west, north_south])

    assert aliases["ew"] == aliases["ns"]


def test_crossing_sections_with_different_lithologies_do_not_merge() -> None:
    """Crossing is adjacency, not identity — the formation still has to match."""
    aliases = plan_body_aliases(
        [
            _section_at([("A", 0.0, 0.0), ("B", 100.0, 0.0)], [_band("ZAND", "sand", 3.2, -4.5)]),
            _section_at(
                [("C", 50.0, -50.0), ("D", 50.0, 50.0)], [_band("KLEI", "clay", 3.2, -4.5)]
            ),
        ]
    )

    assert aliases.get("sand", "sand") == "sand"
    assert aliases.get("clay", "clay") == "clay"


def test_crossing_sections_at_disjoint_elevations_do_not_merge() -> None:
    """They cross in plan, but the two sands are at different levels."""
    aliases = plan_body_aliases(
        [
            _section_at([("A", 0.0, 0.0), ("B", 100.0, 0.0)], [_band("ZAND", "upper", 8.0, 5.0)]),
            _section_at(
                [("C", 50.0, -50.0), ("D", 50.0, 50.0)], [_band("ZAND", "deep", 3.0, -4.0)]
            ),
        ]
    )

    assert aliases.get("upper", "upper") == "upper"
    assert aliases.get("deep", "deep") == "deep"


def test_sections_that_do_not_cross_do_not_merge() -> None:
    """Parallel fences that never meet stay separate bodies."""
    aliases = plan_body_aliases(
        [
            _section_at([("A", 0.0, 0.0), ("B", 100.0, 0.0)], [_band("ZAND", "north", 3.2, -4.5)]),
            _section_at(
                [("C", 0.0, 80.0), ("D", 100.0, 80.0)], [_band("ZAND", "south", 3.2, -4.5)]
            ),
        ]
    )

    assert aliases.get("north", "north") == "north"
    assert aliases.get("south", "south") == "south"


# ---------------------------------------------------------------------------
# R7 (debt #278) — a region touches a column at TWO disjoint elevation
# stretches, connected only away from the column (a C-shape / re-entrant
# region).  The reach at that column is the two intervals, NOT the envelope
# that spans the void between them: another region sitting in the void must
# NOT weld through a stretch of column its neighbour never actually covered.
# ---------------------------------------------------------------------------


def _c_shape(
    formation: str, body: str | None, right: float = 1.0, layer_ids: tuple[str, ...] = ()
) -> RegionInput:
    """A region reaching its right column at ``[0, 1]`` and ``[3, 4]`` only.

    The notch between elevation 1 and 3 recedes to fraction 0.3, so the region
    is one connected component that touches the ``right`` column at two disjoint
    elevation stretches — the envelope ``[0, 4]`` covers ground the region does
    not occupy at that column.  ``right`` < 1.0 places the touching edges one
    snap margin short of the column, to exercise the ``touch`` tolerance.
    """
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=(
            (right, 4.0),
            (0.0, 4.0),
            (0.0, 0.0),
            (right, 0.0),
            (right, 1.0),
            (0.3, 1.0),
            (0.3, 3.0),
            (right, 3.0),
        ),
        gap_index=0,
        layer_ids=layer_ids,
    )


def test_c_shape_does_not_weld_a_body_sitting_in_its_notch_aliases() -> None:
    """plan_body_aliases: the notch is void, so nothing in it is the same body.

    The C-shape reaches the shared column at ``[0, 1]`` and ``[3, 4]``; the band
    on the next section sits at ``[1.5, 2.5]`` — squarely in the notch the
    C-shape does NOT cover.  The envelope over-union welds them; the true
    intervals must not.
    """
    aliases = plan_body_aliases(
        [
            _section(["L", "S"], [_c_shape("ZAND", "cshape")]),
            _section(["S", "R"], [_band("ZAND", "band", 2.5, 1.5)]),
        ]
    )

    assert aliases.get("cshape", "cshape") == "cshape"
    assert aliases.get("band", "band") == "band"


def test_c_shape_does_not_weld_a_layer_sitting_in_its_notch_groups() -> None:
    """plan_layer_groups: same geometry, keyed on layer identity — no group."""
    groups = plan_layer_groups(
        [
            _section(["L", "S"], [_c_shape("ZAND", "cshape", layer_ids=("La",))]),
            _section(["S", "R"], [_band_with_layers("ZAND", "band", 2.5, 1.5, ("Lb",))]),
        ]
    )

    assert all(not {"La", "Lb"}.issubset(group) for group in groups)


def _band_with_layers(
    formation: str, body: str | None, top: float, base: float, layer_ids: tuple[str, ...]
) -> RegionInput:
    """A full-width band carrying explicit ``layer_ids`` (for plan_layer_groups)."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=0,
        layer_ids=layer_ids,
    )


def test_vertical_edge_at_the_exact_crossing_fraction_still_welds() -> None:
    """A region whose own vertical edge lies on the crossing line still reaches it.

    Two fences cross at fraction 0.5.  One region is a half-band whose right
    edge is a VERTICAL edge at exactly fraction 0.5 — the even-odd ray cast's
    half-open straddle plus its vertical-edge skip drops it, so the merge used
    to read the region as absent at the crossing and refuse the weld.  The two
    sands pass through the crossing and are one body.
    """
    half_band = RegionInput(
        formation_id="ZAND",
        body_id="half",
        polygon=((0.0, 3.2), (0.5, 3.2), (0.5, -4.5), (0.0, -4.5)),
        gap_index=0,
    )
    aliases = plan_body_aliases(
        [
            _section_at([("A", 0.0, 0.0), ("B", 100.0, 0.0)], [half_band]),
            _section_at(
                [("C", 50.0, -50.0), ("D", 50.0, 50.0)], [_band("ZAND", "full", 3.2, -4.5)]
            ),
        ]
    )

    assert aliases["half"] == aliases["full"]


def test_a_snap_margin_short_region_still_yields_a_span() -> None:
    """#259 pin: a region a snap margin short of the column still reaches it.

    The helper is asked for the reach on the column line at fraction 1.0 of a
    band whose right edge snapped to ``1 - 9e-5``.  With a ``touch`` wider than
    the shortfall, the reach must be the band's full span, not an empty list —
    the snap-grid tolerance the envelope reader had must survive the rewrite.
    """
    snapped = 1.0 - 9e-5
    band = RegionInput(
        formation_id="ZAND",
        body_id="b",
        polygon=((0.0, 3.2), (snapped, 3.2), (snapped, -4.5), (0.0, -4.5)),
        gap_index=0,
    )

    spans = _spans_at_fraction(band, 1.0, 2e-4)

    assert len(spans) == 1
    (low, high) = spans[0]
    assert low == pytest.approx(-4.5)
    assert high == pytest.approx(3.2)


def test_c_shape_reach_is_two_intervals_not_the_envelope() -> None:
    """The helper returns BOTH stretches, with the notch excluded between them."""
    spans = _spans_at_fraction(_c_shape("ZAND", "cshape"), 1.0, 1e-4)

    assert len(spans) == 2
    (low0, high0), (low1, high1) = sorted(spans)
    assert (low0, high0) == pytest.approx((0.0, 1.0))
    assert (low1, high1) == pytest.approx((3.0, 4.0))


def test_a_snap_margin_short_c_shape_still_reaches_the_column_as_two_intervals() -> None:
    """The ``right`` param: a C-shape whose touching edges snapped a mm short.

    The two vertical edges land at ``1 - 9e-5`` instead of exactly 1.0 — the mm
    snap grid, not a pinch-out — so with a ``touch`` wider than the shortfall the
    region must still reach the column at BOTH stretches, notch excluded.
    """
    snapped = 1.0 - 9e-5
    spans = _spans_at_fraction(_c_shape("ZAND", "cshape", right=snapped), 1.0, 2e-4)

    assert len(spans) == 2
    (low0, high0), (low1, high1) = sorted(spans)
    assert (low0, high0) == pytest.approx((0.0, 1.0))
    assert (low1, high1) == pytest.approx((3.0, 4.0))


# ---------------------------------------------------------------------------
# A degenerate region (empty or 2-vertex polygon) has no area and no ring.
# ``RegionInputSchema.polygon`` carries no min_length, so one can arrive on a
# real payload; the reach helper must treat it as reaching nothing rather than
# raising ``min() arg is an empty sequence`` and 500-ing the whole request.
# ---------------------------------------------------------------------------


def test_a_degenerate_polygon_reaches_nothing() -> None:
    """An empty or 2-vertex polygon yields no interval, never an exception."""
    empty = RegionInput(formation_id="ZAND", body_id="x", polygon=(), gap_index=0)
    two_vertex = RegionInput(
        formation_id="ZAND", body_id="y", polygon=((0.0, 1.0), (1.0, 1.0)), gap_index=0
    )

    assert _spans_at_fraction(empty, 0.0, 1e-4) == []
    assert _spans_at_fraction(empty, 1.0, 1e-4) == []
    assert _spans_at_fraction(two_vertex, 0.0, 1e-4) == []


def test_both_planners_survive_a_degenerate_region() -> None:
    """A degenerate region contributes nothing; the real bands still merge."""
    degenerate = RegionInput(
        formation_id="ZAND", body_id="deg", polygon=(), gap_index=0, layer_ids=("Ld",)
    )
    sections = [
        _section(["S1", "S2"], [degenerate, _band_with_layers("ZAND", "b", 3.0, -3.0, ("Lb",))]),
        _section(["S2", "S3"], [_band_with_layers("ZAND", "c", 3.0, -3.0, ("Lc",))]),
    ]

    aliases = plan_body_aliases(sections)
    groups = plan_layer_groups(sections)

    assert aliases["b"] == aliases["c"], "the degenerate region must not block the real merge"
    assert any({"Lb", "Lc"}.issubset(group) for group in groups)


# ---------------------------------------------------------------------------
# Class-keyed PAINT vs granular IDENTITY — the two planners diverge on purpose
# (owner 2026-09-01).
#
# The geotech model can hold one packing class under several formation ROWS
# (one per geological parent). The two sibling planners treat that differently:
#
# * ``plan_body_aliases`` — the 3-D voxel PAINT path — still accepts an
#   ``identity_key_of`` callable that collapses the twin rows to a shared class
#   key, so two same-class masses paint as ONE voxel body (this avoids the
#   invented-lithology pinch). The ``..._aliases`` tests pin merge-WITH-key and
#   apart-WITHOUT-key.
# * ``plan_layer_groups`` — the persisted body IDENTITY engine — is PERMANENTLY
#   GRANULAR: it takes NO key and keys on the raw formation ROW, so two
#   same-class masses under DIFFERENT rows stay separate bodies for the user to
#   lump ("start totally granular ... the user lumps them into groups"). The
#   ``granular_identity`` tests pin that, and that a single row's touching
#   masses still group (connectivity is preserved, nothing fragments).
# ---------------------------------------------------------------------------


def _same_packing_class(formation_id: str) -> str:
    """Map the two twin rows ``F1``/``F2`` to one class key; others unchanged."""
    return "ZAND|6" if formation_id in ("F1", "F2") else formation_id


def test_identity_key_aliases_twin_formations_at_a_shared_column() -> None:
    """plan_body_aliases: twin rows of one class, touching a column, are one body."""
    aliases = plan_body_aliases(
        [
            _section(["L", "S"], [_band("F1", "b1", 0.0, -5.0)]),
            _section(["S", "R"], [_band("F2", "b2", -1.0, -4.0)]),
        ],
        identity_key_of=_same_packing_class,
    )

    assert aliases["b1"] == aliases["b2"]


def test_without_a_key_twin_formations_stay_separate_aliases() -> None:
    """No callable → the raw formation ids differ → the two bodies stay apart."""
    aliases = plan_body_aliases(
        [
            _section(["L", "S"], [_band("F1", "b1", 0.0, -5.0)]),
            _section(["S", "R"], [_band("F2", "b2", -1.0, -4.0)]),
        ]
    )

    assert aliases.get("b1", "b1") == "b1"
    assert aliases.get("b2", "b2") == "b2"


def test_identity_key_aliases_twin_formations_at_a_fence_crossing() -> None:
    """plan_body_aliases: the crossing gate compares CLASS keys, not row ids."""
    aliases = plan_body_aliases(
        [
            _section_at([("A", 0.0, 0.0), ("B", 100.0, 0.0)], [_band("F1", "ew", 3.2, -4.5)]),
            _section_at([("C", 50.0, -50.0), ("D", 50.0, 50.0)], [_band("F2", "ns", 3.2, -4.5)]),
        ],
        identity_key_of=_same_packing_class,
    )

    assert aliases["ew"] == aliases["ns"]


def test_granular_identity_keeps_different_formation_rows_apart_at_a_shared_column() -> None:
    """plan_layer_groups: two same-class DIFFERENT-row masses touching a column
    stay SEPARATE groups (case a).

    ``F1`` and ``F2`` are the twin rows one packing class carries under two
    geological parents. They touch at the shared column ``S`` with overlapping
    elevation — geometrically connected — yet the granular identity engine keys
    on the raw row, so they are NOT one body: disconnected same-class masses
    under different rows remain distinct bodies for the user to lump (owner
    2026-09-01).
    """
    groups = plan_layer_groups(
        [
            _section(["L", "S"], [_band_with_layers("F1", "b1", 0.0, -5.0, ("La",))]),
            _section(["S", "R"], [_band_with_layers("F2", "b2", -1.0, -4.0, ("Lb",))]),
        ]
    )

    assert all(not {"La", "Lb"}.issubset(group) for group in groups)


def test_granular_identity_still_groups_one_formation_rows_touching_masses() -> None:
    """plan_layer_groups: a SINGLE formation row's masses that genuinely touch
    at a shared column still group into one body (case b).

    Dropping the class key must NOT fragment a connected mass. Both masses carry
    the SAME formation row ``F1`` and touch at the shared column ``S`` with
    overlapping elevation, so connectivity is preserved and their layers land in
    one group.
    """
    groups = plan_layer_groups(
        [
            _section(["L", "S"], [_band_with_layers("F1", "b1", 0.0, -5.0, ("La",))]),
            _section(["S", "R"], [_band_with_layers("F1", "b2", -1.0, -4.0, ("Lb",))]),
        ]
    )

    assert any({"La", "Lb"}.issubset(group) for group in groups)


def test_granular_identity_keeps_different_formation_rows_apart_at_a_fence_crossing() -> None:
    """plan_layer_groups: different formation rows do not bridge even where two
    fences CROSS mid-gap — the granular gate applies to the crossing arm too.
    """
    groups = plan_layer_groups(
        [
            _section_at(
                [("A", 0.0, 0.0), ("B", 100.0, 0.0)],
                [_band_with_layers("F1", "ew", 3.2, -4.5, ("La",))],
            ),
            _section_at(
                [("C", 50.0, -50.0), ("D", 50.0, 50.0)],
                [_band_with_layers("F2", "ns", 3.2, -4.5, ("Lb",))],
            ),
        ]
    )

    assert all(not {"La", "Lb"}.issubset(group) for group in groups)
