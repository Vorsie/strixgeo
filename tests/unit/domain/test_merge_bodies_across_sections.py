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

from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (
    plan_body_aliases,
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
