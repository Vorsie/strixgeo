"""The single public entry point of the implicit stratigraphic 3-D builder.

:func:`build_strat_model` is the one function the application layer (Task 8's
``RecomputeLithoSolids``) calls to turn Stage-2 control data into a list of
watertight :class:`LithoBodyMesh` solids.  It chains the already-built stages:

    Stage 3  fit_potential_field(control, blocks)   →  the implicit field F
    Stage 5  assemble_bodies(field, order, domain)  →  watertight body solids

Stage 1 (stratigraphic order) and Stage 2 (control data) run UPSTREAM of this
function — the caller has already built the :class:`StratControlData` (its
``.column`` carries the order).  Stage 4 (isosurface extraction) is NOT part of
the solid build under the chosen Approach B (height-field prisms): the bodies are
assembled directly from the field over the shared grid, so ``extract_isosurfaces``
is reserved for the 3-D preview / nesting validation and is not invoked here.

This module is purely functional compute — no I/O, no logging, no framework
dependencies.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import NotRequired, TypedDict

import numpy as np

from groundmodel.domain.services.strat_field.body_assembly import (
    assemble_bodies,
    assemble_bodies_with_fields,
    build_shared_grid,
)
from groundmodel.domain.services.strat_field.lens_carving import (
    LensCarveInput,
    carve_lenses,
)
from groundmodel.domain.services.strat_field.potential_field import fit_potential_field
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    StratControlData,
)
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh


def build_strat_model(
    control: StratControlData,
    domain: Block,
    blocks: Sequence[Block],
    grid_spacing_m: float,
) -> list[LithoBodyMesh]:
    """Build the watertight 3-D litho model from Stage-2 control data.

    Fits the implicit potential field through ``control`` over ``blocks``, then
    assembles one watertight body solid per litho band over a regular grid
    spanning ``domain`` (Approach B — height-field prisms, watertight by
    construction; see :mod:`body_assembly`).

    The ``domain`` block frames the SOLID extent (the grid the bodies are built
    over and the top / base caps), while ``blocks`` is the field-fit input
    (``fit_potential_field`` requires exactly one block in v1).  In v1 the two are
    the same block; the parameters are kept distinct so a future faulted model can
    fit per-block fields while still assembling solids over one whole-domain grid.

    Parameters
    ----------
    control : StratControlData
        The Stage-2 control data.  ``control.column`` is the stratigraphic order
        (already built by Stage 1) and supplies each horizon's iso-value and
        lithology naming; ``control.points`` are the on-contact field constraints.
    domain : Block
        The model block framing the solid build: its polygon's xy bounding box
        sets the grid extent and ``z_min`` / ``z_max`` set the top / base caps.
    blocks : Sequence of Block
        The field-fit blocks passed straight to ``fit_potential_field`` (v1:
        exactly one block, typically ``[domain]``).
    grid_spacing_m : float
        Target grid spacing in metres for both the field sampling and the prism
        cells.  Finer spacing → smoother tapers and dipping bases, at O(1/h²) grid
        cost (see the perf note in the module-level benchmark).

    Returns
    -------
    list of LithoBodyMesh
        The watertight body solids, deterministic in order and geometry.  Each is
        ``is_flagged=False`` and passes ``assert_closed_manifold`` by construction;
        no two different bodies overlap, and the model reproduces the authored
        litho stack at every control column (the Task-7 invariants).

    Raises
    ------
    ValueError
        Propagated from ``fit_potential_field`` (no control points, or ``blocks``
        does not contain exactly one block).
    """
    field = fit_potential_field(control, blocks)
    return assemble_bodies(field, control.column, domain, grid_spacing_m)


def build_strat_model_with_fields(
    control: StratControlData,
    domain: Block,
    blocks: Sequence[Block],
    grid_spacing_m: float,
) -> tuple[list[LithoBodyMesh], dict[str, tuple[np.ndarray, np.ndarray]]]:
    """Build the watertight 3-D litho model AND expose each body's height field.

    Identical to :func:`build_strat_model` (fits the implicit field, then
    assembles watertight body solids over the shared grid), but ALSO returns the
    per-emitted-body ``(top, base)`` per-node height arrays the assembly already
    computed.  ``RecomputeLithoSolids`` threads these into the lens carve so the
    carve reuses them instead of reconstructing each host's height field with an
    O(grid_nodes × triangles) vertical ray-cast — the dominant real-data build
    hotspot.  The arrays are EXACTLY what the ray-cast reconstruction recovers, so
    the carve output is byte-identical to the ray-cast path.

    Parameters
    ----------
    control : StratControlData
        The Stage-2 control data (see :func:`build_strat_model`).
    domain : Block
        The model block framing the solid build (see :func:`build_strat_model`).
    blocks : Sequence of Block
        The field-fit blocks (see :func:`build_strat_model`).
    grid_spacing_m : float
        Target grid spacing in metres (see :func:`build_strat_model`).

    Returns
    -------
    (list of LithoBodyMesh, dict[str, tuple[numpy.ndarray, numpy.ndarray]])
        The watertight body solids (identical to :func:`build_strat_model`), and a
        mapping from each mesh's ``body_id`` to its ``(top, base)`` per-node
        ``(nx, ny)`` height arrays (``NaN`` off the body's footprint).  The
        footprint is recoverable as ``~numpy.isnan(top)``.

    Raises
    ------
    ValueError
        Propagated from ``fit_potential_field`` (no control points, or ``blocks``
        does not contain exactly one block).
    """
    field = fit_potential_field(control, blocks)
    return assemble_bodies_with_fields(field, control.column, domain, grid_spacing_m)


class BandBuildInput(TypedDict):
    """One geological band's inputs for :func:`build_strat_model_per_band`.

    Parameters
    ----------
    control : StratControlData
        The Stage-2 control data for this band (its ``.column`` carries the
        matrix-only stratigraphic order for the band's picks).
    block : Block
        The surface-bounded :class:`Block` for this band.  Its ``polygon`` must be
        identical across all bands so ``build_shared_grid`` yields bit-identical
        ``gx``/``gy`` and the cross-band caps weld exactly.
    lens_inputs : list of LensCarveInput, optional
        Enclosed lenses to carve within this band.  Omitted or empty when the
        band has no lens.
    """

    control: StratControlData
    block: Block
    lens_inputs: NotRequired[list[LensCarveInput]]


def build_strat_model_per_band(
    bands: list[BandBuildInput],
    grid_spacing_m: float,
) -> list[LithoBodyMesh]:
    """Build the 3-D litho model as a sequence of geology-bounded band solids.

    Each geological band has its own :class:`StratControlData` (already partitioned
    and ordered upstream by ``partition_picks_by_geology`` + Stage-1/2 per-band
    pipeline) and a :class:`Block` whose ``top_surface`` / ``base_surface`` are
    :class:`~groundmodel.domain.services.strat_field.strat_types.SurfaceBound`
    objects shared with the adjacent band.

    **Watertight seam guarantee**: adjacent bands share the SAME
    ``SurfaceBound`` instance as band *k*'s ``base_surface`` and band *k+1*'s
    ``top_surface``.  Both bands are built over a grid derived from the SAME
    polygon (``band.block.polygon``; caller must ensure all bands share the same
    hull polygon so ``build_shared_grid`` produces byte-identical ``gx/gy``
    arrays for every band call).  Because ``SurfaceBound.evaluate`` is a pure
    deterministic function and the grid nodes are bit-identical, the cap
    elevation arrays for the two touching faces are byte-identical → exact weld →
    no gap or overlap at the seam.

    Each band entry may carry optional ``lens_inputs`` (a list of
    :class:`~groundmodel.domain.services.strat_field.lens_carving.LensCarveInput`)
    for enclosed lenses within that band.  When present, the band is assembled
    with :func:`assemble_bodies_with_fields` (to obtain the host height fields)
    and the lenses are carved on the same shared grid.

    Parameters
    ----------
    bands : list[dict]
        One dict per geological band, ordered shallowest → deepest.  Each dict
        must carry:

        ``"control"`` : :class:`StratControlData`
            The Stage-2 control data for this band.
        ``"block"`` : :class:`Block`
            The surface-bounded block for this band.  Its ``polygon`` must be
            identical across all bands so the grids are bit-consistent.
        ``"lens_inputs"`` : list of :class:`LensCarveInput`
            Enclosed lenses to carve within this band.  May be empty.

    grid_spacing_m : float
        Target grid spacing in metres, applied identically to every band (same
        polygon → same grid → watertight cross-band stitch).

    Returns
    -------
    list of LithoBodyMesh
        All watertight body solids from all bands, concatenated in band order
        (shallowest → deepest within each band, then the next band's bodies).
        Every body passes ``assert_closed_manifold``; no two bodies from
        different bands overlap at the seam (the shared-surface guarantee).

    Raises
    ------
    ValueError
        Propagated from ``fit_potential_field`` when a band's control data has
        no control points.
    """
    # WHY: the watertight cross-band seam (band k's base == band k+1's top) holds
    # ONLY because every band is built over the SAME grid, which requires the SAME
    # block polygon (``build_shared_grid`` derives gx/gy from the polygon's bbox).
    # A Task-8 wiring bug that handed each band a per-band-filtered alpha hull would
    # silently gap the seam — the exact failure class that killed the loft builder.
    # Reject it loudly here rather than emitting a quietly non-watertight model.
    if len(bands) > 1:
        polygons = {band["block"].polygon for band in bands}
        if len(polygons) > 1:
            raise ValueError(
                f"all band polygons must be identical for a watertight seam "
                f"({len(polygons)} distinct polygons found)"
            )

    all_bodies: list[LithoBodyMesh] = []

    for band in bands:
        control: StratControlData = band["control"]
        block: Block = band["block"]
        lens_inputs: list[LensCarveInput] = band.get("lens_inputs") or []

        field = fit_potential_field(control, [block])

        if lens_inputs:
            # Need the host height fields to pass to the carver (avoids an
            # O(grid_nodes × triangles) ray-cast reconstruction per carved host).
            matrix_bodies, host_height_fields = assemble_bodies_with_fields(
                field, control.column, block, grid_spacing_m
            )
            gx, gy, node_inside = build_shared_grid(block, grid_spacing_m)
            band_bodies = carve_lenses(
                lens_inputs,
                matrix_bodies,
                gx,
                gy,
                node_inside,
                host_height_fields=host_height_fields,
            )
        else:
            band_bodies = assemble_bodies(field, control.column, block, grid_spacing_m)

        all_bodies.extend(band_bodies)

    return all_bodies
