"""A build the machine cannot hold is refused by name, not attempted.

The Settings dialog offers a horizontal spacing down to 0.5 m and a vertical
spacing down to 0.25 m, and neither end validates the resulting voxel COUNT.  On
a 2 km linear alignment (a road or dike, ~40 CPTs) 0.5 m horizontal resolves to
roughly 4000 x 800 map columns; the label array alone is then gigabytes, the
mesher allocates seven more full-grid boolean arrays per body, and the request
runs for hours or dies — with no progress, no cancel and no partial result.

The rule this file pins: **before a single cell is allocated, a grid over the
budget is refused, and the refusal names the grid it resolved to and a spacing
that would fit.**  Guessing a smaller number until the app stops hanging is not
a usable answer for an engineer.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_grid_budget import (
    MAX_VOXEL_CELLS,
    check_voxel_grid_budget,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)
from groundmodel.shared.exceptions import VoxelGridTooLargeError

_KLEI = "KLEI"


def _long_alignment_section(y: float, prefix: str) -> SectionPartitionInput:
    """A 2 km E-W section of KLEI — the linear-works shape (road / dike / quay)."""
    columns = (
        SectionColumnInput(f"{prefix}0", along_m=0.0, world_x=0.0, world_y=y),
        SectionColumnInput(f"{prefix}1", along_m=2000.0, world_x=2000.0, world_y=y),
    )
    regions = (
        RegionInput(
            _KLEI, f"{prefix}klei", ((0.0, 10.0), (1.0, 10.0), (1.0, -30.0), (0.0, -30.0)), 0
        ),
    )
    return SectionPartitionInput(
        start_x=0.0, start_y=y, end_x=2000.0, end_y=y, columns=columns, regions=regions
    )


def _alignment_domain() -> object:
    """A 2000 x 400 m footprint — the road-alignment corridor."""
    return build_model_domain(
        [
            DomainTest("A", 0.0, 0.0, 10.0, -30.0),
            DomainTest("B", 1000.0, 0.0, 10.0, -30.0),
            DomainTest("C", 2000.0, 0.0, 10.0, -30.0),
            DomainTest("D", 0.0, 400.0, 10.0, -30.0),
            DomainTest("E", 1000.0, 400.0, 10.0, -30.0),
            DomainTest("F", 2000.0, 400.0, 10.0, -30.0),
        ]
    )


def test_the_finest_spacing_the_settings_dialog_offers_is_refused_on_a_long_alignment() -> None:
    """0.5 m over a 2 km corridor is refused before anything is allocated."""
    sections = [_long_alignment_section(0.0, "N"), _long_alignment_section(400.0, "S")]

    with pytest.raises(VoxelGridTooLargeError) as err:
        label_voxels(_alignment_domain(), 0.5, sections, vertical_spacing_m=0.25)

    assert "0.5" in str(err.value), "the refusal must name the spacing that was asked for"


def test_the_refusal_names_the_resolved_grid_and_a_spacing_that_would_fit() -> None:
    """An engineer must be told what to change, not left to guess a smaller number."""
    with pytest.raises(VoxelGridTooLargeError) as err:
        check_voxel_grid_budget(nx=4001, ny=801, nz=161, horizontal_m=0.5, vertical_m=0.25)

    message = str(err.value)
    assert "4001" in message and "801" in message and "161" in message
    # The suggested spacing has to be BIGGER than the one that was refused, and
    # actually fit: the whole point is that retrying with it works.
    suggested = err.value.suggested_horizontal_m
    assert suggested > 0.5
    scaled = (4001 * 0.5 / suggested) * (801 * 0.5 / suggested) * 161
    assert scaled <= MAX_VOXEL_CELLS


def test_a_grid_inside_the_budget_is_left_alone() -> None:
    """The owner's own model at the default spacing must not be touched.

    Measured on the real v2 payload at 2.0 m / 0.25 m: 297 x 326 x 107 voxels.
    """
    check_voxel_grid_budget(nx=297, ny=326, nz=107, horizontal_m=2.0, vertical_m=0.25)


def test_a_build_that_fits_still_labels() -> None:
    """The guard is a gate, not a wall — the ordinary build is unchanged."""
    sections = [_long_alignment_section(0.0, "N"), _long_alignment_section(400.0, "S")]

    grid = label_voxels(_alignment_domain(), 50.0, sections, vertical_spacing_m=5.0)

    assert grid.labels.size > 0
    assert int((grid.labels >= 0).sum()) > 0
    assert isinstance(grid.gz, np.ndarray)
