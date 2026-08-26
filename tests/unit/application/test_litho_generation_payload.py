"""Tests for reading a stored 3-D build generation payload back into sections.

The property that matters is SYMMETRY: whatever ``_generation_payload`` writes,
``sections_from_generation_payload`` must read back unchanged. Debt #256 records
that hand-listed field names silently dropped the 2-D classification at three
separate points in one pipeline; the round-trip test below is the tripwire that
makes a fourth impossible — add a field to ``RegionInput`` and this test fails
unless the round trip really does carry it.
"""

from __future__ import annotations

import pytest

from groundmodel.application.build_voxel_litho_model import _generation_payload
from groundmodel.application.litho_generation_payload import (
    sections_from_generation_payload,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


def _section() -> SectionPartitionInput:
    """A section exercising every optional region field, not just the required ones."""
    return SectionPartitionInput(
        start_x=100.0,
        start_y=200.0,
        end_x=400.0,
        end_y=260.0,
        columns=(
            SectionColumnInput(investigation_id="S1", along_m=0.0, world_x=100.0, world_y=200.0),
            SectionColumnInput(investigation_id="S2", along_m=300.0, world_x=400.0, world_y=260.0),
        ),
        regions=(
            RegionInput(
                formation_id="f-sand",
                body_id="b-1",
                polygon=((0.0, 5.0), (1.0, 5.0), (1.0, -2.0), (0.0, -2.0)),
                gap_index=0,
                kind="quad",
                overlay_tier="onlap",
                tied_band_base=-2.0,
                tie_clipped=True,
                layer_ids=("l-1", "l-2"),
            ),
        ),
    )


def test_a_stored_section_reads_back_identical() -> None:
    """What the build stored is what a later reader gets back, field for field."""
    original = _section()

    restored = sections_from_generation_payload(_generation_payload([original]))

    # Dataclass equality compares every field, so this is the whole contract in
    # one assertion — including any field added later.
    assert restored == [original]


def test_the_optional_classification_fields_survive() -> None:
    """The 2-D classification fields debt #256 watched get dropped still round-trip."""
    # Named explicitly as well as covered by the equality assertion above, so a
    # failure points at the field rather than at a whole-dataclass mismatch.
    restored = sections_from_generation_payload(_generation_payload([_section()]))

    region = restored[0].regions[0]
    assert region.kind == "quad"
    assert region.overlay_tier == "onlap"
    assert region.tied_band_base == -2.0
    assert region.tie_clipped is True
    assert region.layer_ids == ("l-1", "l-2")


def test_polygon_points_come_back_as_tuples() -> None:
    """JSON has no tuples; the domain type declares them and downstream code hashes them."""
    restored = sections_from_generation_payload(_generation_payload([_section()]))

    polygon = restored[0].regions[0].polygon
    assert isinstance(polygon, tuple)
    assert all(isinstance(point, tuple) for point in polygon)


def test_an_empty_build_reads_back_as_no_sections() -> None:
    """A build with no sections round-trips to an empty list, not an error."""
    assert sections_from_generation_payload(_generation_payload([])) == []


def test_a_payload_that_is_not_a_mapping_is_refused() -> None:
    """A non-mapping payload fails loudly instead of being coerced."""
    with pytest.raises(TypeError, match="must be a mapping"):
        sections_from_generation_payload(["not", "a", "payload"])


def test_a_payload_without_sections_is_refused() -> None:
    """A payload carrying no ``sections`` key fails loudly."""
    with pytest.raises(KeyError):
        sections_from_generation_payload({"grid_spacing_m": 1.0})


def test_a_sections_value_that_is_not_a_list_is_refused() -> None:
    """A string ``sections`` value is refused, not iterated character by character."""
    with pytest.raises(TypeError, match="must be a list"):
        sections_from_generation_payload({"sections": "S1"})


def test_an_unknown_region_field_is_refused_not_silently_dropped() -> None:
    """A field from a newer builder makes the payload unreadable, never silently ignored."""
    # A generation written by a NEWER builder carries a field this build does
    # not know. Reconstructing it minus that field would hand the footprint a
    # partition the build never used — report it unreadable instead.
    payload = _generation_payload([_section()])
    payload["sections"][0]["regions"][0]["from_the_future"] = 1  # type: ignore[index]

    with pytest.raises(TypeError):
        sections_from_generation_payload(payload)


def test_a_missing_required_region_field_is_refused() -> None:
    """A region missing a required field is unreadable, never defaulted."""
    payload = _generation_payload([_section()])
    del payload["sections"][0]["regions"][0]["formation_id"]  # type: ignore[index]

    with pytest.raises(TypeError):
        sections_from_generation_payload(payload)


def test_a_malformed_polygon_point_is_refused() -> None:
    """A polygon point that is not a pair is refused by name."""
    payload = _generation_payload([_section()])
    payload["sections"][0]["regions"][0]["polygon"][0] = [0.0]  # type: ignore[index]

    with pytest.raises(TypeError, match="polygon point"):
        sections_from_generation_payload(payload)
