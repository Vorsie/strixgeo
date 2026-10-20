"""Geology API — always-on pick consistency check (uncertainty slice A0).

Mounted under /projects/{project_id}/geology by the package __init__.
"""

from __future__ import annotations

import math
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import get_in_project_or_404
from groundmodel.api.schemas.project.contact_consistency import (
    ContactConsistencyResponse,
    FormationPickCheckResponse,
    PickCheckFitResponse,
    PickCheckFlagResponse,
    PickCheckNeighbourResponse,
)
from groundmodel.application.check_contact_consistency import CheckContactConsistency
from groundmodel.application.contact_consistency_cache import ContactConsistencyCache
from groundmodel.application.formation_consistency_entry import FormationConsistencyEntry
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

router = APIRouter()

# One cache per engine process: results survive between requests, not restarts.
contact_consistency_cache = ContactConsistencyCache()


def _to_response(entry: FormationConsistencyEntry) -> FormationPickCheckResponse:
    """Map a use-case entry to its API schema."""
    check = entry.check
    if check is None:
        return FormationPickCheckResponse(
            formation_id=entry.formation_id,
            formation_name=entry.formation_name,
            status="computing",
            n_picks=entry.n_picks,
            skipped_no_location=entry.skipped_no_location,
            refit_fallbacks=0,
        )
    fit = (
        PickCheckFitResponse(
            range_m=check.model.range_m,
            sill_sd_m=math.sqrt(check.model.sill_m2),
            nugget_sd_m=math.sqrt(check.model.nugget_m2),
        )
        if check.model is not None
        else None
    )
    flags = [
        PickCheckFlagResponse(
            contact_id=f.pick.contact_id,
            investigation_id=f.pick.investigation_id,
            investigation_kind=f.pick.investigation_kind,
            investigation_name=f.pick.investigation_name,
            pick_elevation_m=f.pick.elevation_m,
            predicted_elevation_m=f.predicted_elevation_m,
            sigma_m=f.sigma_m,
            z=f.z_score,
            nearest=PickCheckNeighbourResponse(
                contact_id=f.nearest.contact_id,
                investigation_name=f.nearest.investigation_name,
                distance_m=f.nearest_distance_m,
                pick_elevation_m=f.nearest.elevation_m,
            ),
        )
        for f in check.flags
    ]
    return FormationPickCheckResponse(
        formation_id=entry.formation_id,
        formation_name=entry.formation_name,
        status=check.status,
        n_picks=entry.n_picks,
        skipped_no_location=entry.skipped_no_location,
        fit=fit,
        coverage_90=check.coverage_90,
        flags=flags,
        reason=check.reason,
        refit_fallbacks=check.refit_fallbacks,
    )


@router.get("/models/{model_id}/contact-consistency", response_model=ContactConsistencyResponse)
async def get_contact_consistency(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ContactConsistencyResponse:
    """Return the pick consistency report of a geological model.

    Never blocks on the computation: formations whose picks changed report
    ``computing`` and the desktop polls until ``status == "ready"``.

    Parameters
    ----------
    project_id : UUID
        Project scope guard — the model must belong to this project.
    model_id : UUID
        Geological model.
    session : AsyncSession
        Database session injected by FastAPI.

    Returns
    -------
    ContactConsistencyResponse
        Per-formation results.

    Raises
    ------
    HTTPException(404)
        When the model does not exist or belongs to another project.
    """
    logger.debug(f"GET contact-consistency: project={project_id} model={model_id}")
    await get_in_project_or_404(
        session.get(GeologicalModelOrm, model_id), project_id, detail="Model not found"
    )
    entries = await CheckContactConsistency(session, contact_consistency_cache).execute(model_id)
    formations = [_to_response(e) for e in entries]
    status = "computing" if any(f.status == "computing" for f in formations) else "ready"
    return ContactConsistencyResponse(model_id=model_id, status=status, formations=formations)
