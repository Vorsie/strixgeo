"""Re-identifying a body must not cost the region its 2-D classification.

``apply_body_aliases`` rewrites a region's ``body_id`` when the cross-section merge
decides two bodies are one. It rebuilds the value object to do so, which is exactly
where a field added later gets silently dropped — the same failure debt #256 records
at the payload boundary, one layer further in.

Phrased in the classification's own vocabulary: a lens that gets merged into another
body is still a lens.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_POLYGON = ((0.0, 5.0), (1.0, 5.0), (1.0, 0.0), (0.0, 0.0))


def _section(region: RegionInput) -> SectionPartitionInput:
    """A one-gap section carrying a single region."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="B", along_m=100.0, world_x=100.0, world_y=0.0),
        ),
        regions=(region,),
    )


def test_a_merged_lens_is_still_a_lens() -> None:
    """Re-identifying the body keeps every classification field intact."""
    lens = RegionInput(
        formation_id="SILT",
        body_id="old",
        polygon=_POLYGON,
        gap_index=0,
        kind="lens",
        overlay_tier="lens",
        tied_band_base=-7.61,
        tie_clipped=True,
    )

    merged = apply_body_aliases([_section(lens)], {"old": "new"})[0].regions[0]

    assert merged.body_id == "new"
    assert merged.kind == "lens"
    assert merged.overlay_tier == "lens"
    assert merged.tied_band_base == -7.61
    assert merged.tie_clipped is True


def test_a_region_whose_body_is_unchanged_is_returned_as_is() -> None:
    """No alias for this body → the very same object, nothing rebuilt."""
    banded = RegionInput(
        formation_id="ZAND",
        body_id="keep",
        polygon=_POLYGON,
        gap_index=0,
        kind="quad",
    )

    unchanged = apply_body_aliases([_section(banded)], {"other": "new"})[0].regions[0]

    assert unchanged is banded
