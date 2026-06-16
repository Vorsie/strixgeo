"""Unit tests for ``VoxelBuildRequest`` — the anisotropic-spacing resolver (Task 4).

The request schema may carry a CUBIC spacing (``grid_spacing_m`` only) or an
ANISOTROPIC pair (``horizontal_spacing_m`` for X/Y + ``vertical_spacing_m`` for
Z).  The two ``effective_*`` properties resolve each axis against the cubic
fallback so a legacy payload (only ``grid_spacing_m``) still builds a cubic grid
and a new payload can fine the Z axis independently.

Phrased in the contract's own vocabulary (cubic fallback / independent axis
override / positive-only) rather than implementation terms.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.project.voxel_build_request import VoxelBuildRequest


def test_cubic_payload_resolves_both_axes_to_grid_spacing() -> None:
    """Only ``grid_spacing_m`` → both effective spacings equal it (legacy cubic).

    A payload that predates anisotropy carries just ``grid_spacing_m``; both the
    horizontal and the vertical effective spacing must fall back to it, so the
    build is cubic and backwards-compatible.
    """
    req = VoxelBuildRequest(grid_spacing_m=2.0)
    assert req.effective_horizontal_spacing_m == 2.0
    assert req.effective_vertical_spacing_m == 2.0


def test_anisotropic_payload_resolves_each_axis_independently() -> None:
    """Explicit horizontal + vertical override the cubic fallback per axis.

    A coarse X/Y (2 m) over a fine Z (0.5 m) — the thin-layer path — must resolve
    to exactly those two values, independent of ``grid_spacing_m``.
    """
    req = VoxelBuildRequest(grid_spacing_m=2.0, horizontal_spacing_m=2.0, vertical_spacing_m=0.5)
    assert req.effective_horizontal_spacing_m == 2.0
    assert req.effective_vertical_spacing_m == 0.5


def test_vertical_only_fines_z_while_horizontal_falls_back() -> None:
    """``vertical_spacing_m`` alone fines Z; horizontal falls back to the cubic value.

    Setting only the vertical spacing must leave the horizontal at
    ``grid_spacing_m`` — the common case (the user only needs finer elevation
    resolution).
    """
    req = VoxelBuildRequest(grid_spacing_m=4.0, vertical_spacing_m=1.0)
    assert req.effective_horizontal_spacing_m == 4.0
    assert req.effective_vertical_spacing_m == 1.0


def test_horizontal_override_wins_over_grid_spacing_for_xy_only() -> None:
    """An explicit ``horizontal_spacing_m`` takes precedence over ``grid_spacing_m``.

    When both ``grid_spacing_m`` and ``horizontal_spacing_m`` are present (no
    vertical), the X/Y axes resolve to the explicit horizontal value — the cubic
    value loses for X/Y — while Z, having no override, falls back to the cubic
    ``grid_spacing_m``.  So ``{grid_spacing_m: 2, horizontal_spacing_m: 3}`` is
    3 m X/Y, 2 m Z.
    """
    req = VoxelBuildRequest(grid_spacing_m=2.0, horizontal_spacing_m=3.0)
    assert req.effective_horizontal_spacing_m == 3.0
    assert req.effective_vertical_spacing_m == 2.0


def test_non_positive_anisotropic_spacing_is_rejected() -> None:
    """A non-positive ``vertical_spacing_m`` (or horizontal) fails validation.

    The anisotropic fields carry the same ``gt=0`` constraint as
    ``grid_spacing_m`` — a zero / negative spacing is a degenerate grid and must
    be rejected at the schema boundary.
    """
    with pytest.raises(ValidationError):
        VoxelBuildRequest(grid_spacing_m=2.0, vertical_spacing_m=0.0)
    with pytest.raises(ValidationError):
        VoxelBuildRequest(grid_spacing_m=2.0, horizontal_spacing_m=-1.0)
