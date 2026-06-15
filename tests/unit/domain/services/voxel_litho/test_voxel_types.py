"""Behavioural tests for the ``voxel_types`` build-request value objects.

Comments are phrased in the contract's vocabulary (region, gap, column,
labelled voxel) rather than in implementation terms, so a regression reads
as a clear contract break.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import numpy as np
import pytest

from groundmodel.domain.services.voxel_litho.voxel_types import (
    LabelGrid,
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)


def test_region_input_round_trips_its_fields_and_is_frozen():
    """A RegionInput carries the region's formation, body, polygon and gap index."""
    region = RegionInput(
        formation_id="SAND",
        body_id="body-1",
        polygon=((0.0, 12.5), (1.0, 12.5), (1.0, 8.0), (0.0, 9.0)),
        gap_index=2,
    )
    assert region.formation_id == "SAND"
    assert region.body_id == "body-1"
    assert region.polygon[0] == (0.0, 12.5)
    assert region.gap_index == 2
    # frozen: rebinding any field must raise rather than silently mutate
    with pytest.raises(FrozenInstanceError):
        region.gap_index = 99  # type: ignore[misc]


def test_region_input_allows_a_null_body():
    """A region whose units are not part of a correlated body has body_id None."""
    region = RegionInput(
        formation_id="CLAY", body_id=None, polygon=((0.0, 1.0), (1.0, 1.0)), gap_index=0
    )
    assert region.body_id is None


def test_section_column_input_carries_world_position():
    """A SectionColumnInput carries the investigation's along-line + world position."""
    column = SectionColumnInput(
        investigation_id="CPT-001", along_m=42.0, world_x=150000.0, world_y=210000.0
    )
    assert column.investigation_id == "CPT-001"
    assert column.along_m == 42.0
    assert column.world_x == 150000.0
    assert column.world_y == 210000.0


def test_section_partition_input_bundles_line_columns_and_regions():
    """A SectionPartitionInput carries the section line, its columns and regions."""
    columns = (
        SectionColumnInput("CPT-001", 0.0, 150000.0, 210000.0),
        SectionColumnInput("CPT-002", 50.0, 150040.0, 210030.0),
    )
    regions = (
        RegionInput("SAND", "body-1", ((0.0, 12.0), (1.0, 12.0), (1.0, 4.0), (0.0, 4.0)), 0),
    )
    section = SectionPartitionInput(
        start_x=150000.0,
        start_y=210000.0,
        end_x=150040.0,
        end_y=210030.0,
        columns=columns,
        regions=regions,
    )
    assert section.start_x == 150000.0
    assert section.end_y == 210030.0
    assert section.columns == columns
    assert section.regions == regions
    # the region references the gap between the two columns it bridges
    assert section.regions[0].gap_index == 0


def test_label_grid_labels_shape_matches_the_axis_lengths():
    """LabelGrid.labels.shape == (len(gx), len(gy), len(gz)) per the indexing rule."""
    gx = np.array([0.0, 1.0, 2.0])
    gy = np.array([0.0, 1.0])
    gz = np.array([0.0, 1.0, 2.0, 3.0])
    labels = np.full((len(gx), len(gy), len(gz)), -1, dtype=int)
    labels[1, 0, 2] = 0  # one voxel filled by body index 0
    grid = LabelGrid(
        gx=gx,
        gy=gy,
        gz=gz,
        labels=labels,
        body_id_by_index=("body-1",),
        formation_by_body={"body-1": "SAND"},
    )
    assert grid.labels.shape == (len(gx), len(gy), len(gz))
    # -1 is void; a labelled voxel resolves through body_id_by_index → formation
    assert grid.labels[0, 0, 0] == -1
    label = grid.labels[1, 0, 2]
    body_id = grid.body_id_by_index[label]
    assert body_id == "body-1"
    assert grid.formation_by_body[body_id] == "SAND"
