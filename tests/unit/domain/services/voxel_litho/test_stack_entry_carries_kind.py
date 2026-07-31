"""The stack must say what a body is doing AT A POSITION, not what kind of body it is.

Owner correction 2026-07-31: a body that onlaps at one end and bands all the way to
the section end is an onlap *there* and a band everywhere else. The 2-D classification
is per region per gap, so the builder must ask "what is this body doing here" and
never "what kind of body is this" — otherwise one onlapping end would re-classify the
whole body, which is the mistake ``max(0, 2w - 1)`` makes in the opposite direction by
treating every one-sided body alike.

``_section_stack_at`` is where a region becomes a stack entry, so it is where the
classification has to survive.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.label_voxels import _section_stack_at
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


def _rect(top: float, base: float) -> tuple[tuple[float, float], ...]:
    """A full-width region ring spanning one gap between two elevations."""
    return ((0.0, top), (1.0, top), (1.0, base), (0.0, base))


def _section(*regions: RegionInput) -> SectionPartitionInput:
    """A two-gap section carrying the given regions."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=200.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="B", along_m=100.0, world_x=100.0, world_y=0.0),
            SectionColumnInput(investigation_id="C", along_m=200.0, world_x=200.0, world_y=0.0),
        ),
        regions=regions,
    )


def test_a_banded_region_reports_a_band_where_it_is_sliced() -> None:
    """A body tied across the gap arrives in the stack saying so."""
    section = _section(
        RegionInput("ZAND", "z", _rect(10.0, 5.0), 0, kind="quad"),
    )

    entry = _section_stack_at(section, 0, 0.5)[0]

    assert entry.body_id == "z"
    assert entry.kind == "quad"


def test_an_enclosed_lens_reports_a_lens() -> None:
    """A lens arrives as a lens, so it can be pinched where a band would not be."""
    section = _section(
        RegionInput("SILT", "s", _rect(9.0, 7.0), 0, kind="lens", overlay_tier="lens"),
    )

    entry = _section_stack_at(section, 0, 0.5)[0]

    assert entry.kind == "lens"
    assert entry.overlay_tier == "lens"


def test_one_body_onlapping_in_one_gap_and_banding_in_another_reports_each() -> None:
    """The same body reads differently at each position — the owner's correction.

    Onlapping at one end must not make the body an onlap where it bands, and banding
    elsewhere must not hide the onlap. Only a per-position answer gets both right.
    """
    body = "z"
    section = _section(
        RegionInput("ZAND", body, _rect(10.0, 5.0), 0, kind="pinch"),
        RegionInput("ZAND", body, _rect(10.0, 5.0), 1, kind="quad"),
    )

    onlapping = _section_stack_at(section, 0, 0.5)[0]
    banding = _section_stack_at(section, 1, 0.5)[0]

    assert onlapping.body_id == banding.body_id == body
    assert onlapping.kind == "pinch"
    assert banding.kind == "quad"


def test_a_region_written_before_the_classification_reports_nothing() -> None:
    """An unclassified region gives an entry with no classification, not a guess."""
    section = _section(RegionInput("KLEI", "k", _rect(4.0, 1.0), 0))

    entry = _section_stack_at(section, 0, 0.5)[0]

    assert entry.kind is None
    assert entry.overlay_tier is None
