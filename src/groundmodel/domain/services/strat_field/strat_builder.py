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

import numpy as np

from groundmodel.domain.services.strat_field.body_assembly import (
    assemble_bodies,
    assemble_bodies_with_fields,
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
