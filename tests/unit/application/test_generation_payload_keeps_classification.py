"""The stored build generation must record the classification it was built from.

``_write_generation`` persists the partitions so a build can be reproduced from the
database (#252) and so diagnostics can read what the builder actually received. It
hand-listed four keys per region, which drops the 2-D classification threaded in
#256 — the third place in this pipeline where writing field names by hand silently
lost data, after the payload boundary and ``apply_body_aliases``.

Reproduction is the point: replaying a build from a payload that lost the
classification would label differently from the build it claims to reproduce.
"""

from __future__ import annotations

from groundmodel.application.build_voxel_litho_model import _generation_payload
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_POLYGON = ((0.0, 5.0), (1.0, 5.0), (1.0, 0.0), (0.0, 0.0))


def _section(*regions: RegionInput) -> SectionPartitionInput:
    """A one-gap section carrying the given regions."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="B", along_m=100.0, world_x=100.0, world_y=0.0),
        ),
        regions=regions,
    )


def test_an_enclosed_lens_is_recorded_as_an_enclosed_lens() -> None:
    """Every classification field reaches the stored payload."""
    lens = RegionInput(
        formation_id="SILT",
        body_id="s",
        polygon=_POLYGON,
        gap_index=0,
        kind="lens",
        overlay_tier="lens",
        tied_band_base=-7.61,
        tie_clipped=True,
    )

    stored = _generation_payload([_section(lens)])["sections"][0]["regions"][0]

    assert stored["kind"] == "lens"
    assert stored["overlay_tier"] == "lens"
    assert stored["tied_band_base"] == -7.61
    assert stored["tie_clipped"] is True


def test_the_geometry_it_already_recorded_is_unchanged() -> None:
    """The pre-existing four keys keep their names, values and polygon shape.

    Every stored generation and every diagnostic that reads one depends on this
    shape; the classification is additive, not a reshuffle.
    """
    band = RegionInput(formation_id="ZAND", body_id="z", polygon=_POLYGON, gap_index=3)

    payload = _generation_payload([_section(band)])
    section = payload["sections"][0]
    stored = section["regions"][0]

    assert section["start_x"] == 0.0
    assert section["end_x"] == 100.0
    assert section["columns"][0]["investigation_id"] == "A"
    assert section["columns"][1]["along_m"] == 100.0
    assert stored["formation_id"] == "ZAND"
    assert stored["body_id"] == "z"
    assert stored["gap_index"] == 3
    assert stored["polygon"] == [[0.0, 5.0], [1.0, 5.0], [1.0, 0.0], [0.0, 0.0]]


def test_a_region_the_engine_left_unclassified_records_its_absence() -> None:
    """An unset classification is stored as null / false, never omitted.

    The reader defaults missing keys, so either shape loads — but a payload that
    omits them cannot be told apart from one written before #256, which is exactly
    the ambiguity that made the last rebuild unreadable.
    """
    plain = RegionInput(formation_id="KLEI", body_id=None, polygon=_POLYGON, gap_index=0)

    stored = _generation_payload([_section(plain)])["sections"][0]["regions"][0]

    assert stored["kind"] is None
    assert stored["overlay_tier"] is None
    assert stored["tied_band_base"] is None
    assert stored["tie_clipped"] is False
