"""Geotech-stage knobs read from the project view-state.

Extracted 2026-08-17 on the second caller: ``SubdivideAllBodies`` reads the
minimum sub-unit thickness to segment a CPT, and ``DivideBoreholes`` reads the
same value to refuse bands a mapped donor stack would compress below it.  Two
copies of the key path would be two places for the default to drift.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.view_state_helpers import (
    load_project_view_state,
    read_view_state_float,
)

DEFAULT_MIN_THICKNESS_M: float = 0.35
"""Minimum geotech sub-unit thickness when the project has not set one."""


async def read_geotech_min_thickness_m(session: AsyncSession, project_id: UUID) -> float:
    """Read the geotech minimum sub-unit thickness for a project.

    Reads ``view_state["geotech_subdivision"]["minimum_layer_thickness_m"]`` — a
    GEOTECH-specific knob, distinct from the litho segmenter's, so coarsening
    packing bands never affects lithology layering.

    Parameters
    ----------
    session : AsyncSession
        Open session.
    project_id : UUID
        Owning project id.

    Returns
    -------
    float
        The configured minimum, or :data:`DEFAULT_MIN_THICKNESS_M` when absent,
        non-positive or non-numeric.
    """
    view_state = await load_project_view_state(session, project_id)
    return read_view_state_float(
        view_state,
        "geotech_subdivision",
        "minimum_layer_thickness_m",
        DEFAULT_MIN_THICKNESS_M,
    )
