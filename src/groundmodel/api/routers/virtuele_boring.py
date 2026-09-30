"""Virtuele Boring (DOV overlay) API routes.

Two endpoints behind one router:

* ``GET /dov/virtuele-boring/lagenmodellen`` — proxies DOV's model
  catalogue. Project-independent, no DB read; the desktop client
  hits this once per session to populate its model-picker dropdown.
* ``GET /projects/{project_id}/virtuele-boring/predictions`` —
  per-project overlay payload. Loads every CPT + borehole in the
  project, fans out one doorprik call per (investigation, model)
  pair, returns the aggregated predictions.

Errors mirror the DEM router's pattern (debt #43): category-only
detail to the user, full upstream context in the server log.
"""

from __future__ import annotations

import re
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.schemas.virtuele_boring import (
    VirtueleBoringInvestigationResponse,
    VirtueleBoringLagenmodelEntry,
    VirtueleBoringLayerResponse,
    VirtueleBoringPredictionsResponse,
    VirtueleBoringSkippedResponse,
)
from groundmodel.application.fetch_virtuele_boring_predictions import (
    FetchVirtueleBoringPredictions,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.infrastructure.parsers.dov.dov_http import make_dov_async_client
from groundmodel.infrastructure.parsers.dov.virtuele_boring_client import (
    VirtueleBoringClient,
    VirtueleBoringFetchError,
)
from groundmodel.shared.exceptions import DovUnreachableError
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Module-level logger — routers are stateless functions, not classes.
logger = LoggerFactory.get_logger(__name__)

# Two separate APIRouter instances since the URL prefixes differ
# (project-scoped vs DOV-global). Both expose the same Virtuele
# Boring concept so they share a tag for OpenAPI grouping.
catalog_router = APIRouter(prefix="/dov/virtuele-boring", tags=["virtuele-boring"])
project_router = APIRouter(
    prefix="/projects/{project_id}/virtuele-boring", tags=["virtuele-boring"]
)


# Maximum models per request — guards against an accidentally
# unbounded ?models= list. Two dropdowns in the UI means the
# realistic ceiling is 2; we leave headroom for future surfaces
# that may want to compare more variants side-by-side.
_MAX_MODELS_PER_REQUEST = 12

# Codelist gate for the ``models`` query param (debt #50). Each code is
# embedded raw into the outbound DOV doorprik URL path
# (``virtuele_boring_client.py``: f"{BASE}{PATH}/{model}"). DOV
# lagenmodel codes are short ASCII slugs (e.g. ``g3dv3_F``,
# ``hcovv2_H``); anything outside this charset/length is not a real
# code and must not reach the outbound request. httpx URL-normalises
# traversal so this is not RCE, but an arbitrary user string in a
# backend-issued HTTP request contradicts the project's own
# injection-defence posture — reject it at the boundary.
#
# ``\A``/``\Z`` (not ``^``/``$``): Python's ``$`` also matches just
# before a trailing newline, so ``^...$`` would let ``"g3dv3\n"``
# through — exactly the kind of smuggled control char this gate
# exists to stop.
_VALID_MODEL_CODE_RE = re.compile(r"\A[A-Za-z0-9_.\-]{1,50}\Z")

# 503 ``detail`` for the predictions sweep when DOV answered none of its
# calls. A machine ``code`` so the desktop can translate + treat it as a
# degraded overlay (WARN, no crash-bundle diagnostic) instead of a bug.
DOV_UNREACHABLE_CODE = "dov_unreachable"
DOV_UNREACHABLE_MESSAGE = "DOV is not reachable right now; the predictions will load when it is."


@catalog_router.get("/lagenmodellen", response_model=list[VirtueleBoringLagenmodelEntry])
async def list_lagenmodellen() -> list[VirtueleBoringLagenmodelEntry]:
    """Return the list of DOV lagenmodels the Virtuele Boring server exposes.

    Live passthrough — DOV's catalog is small (12 entries today) and
    cheap to fetch. The desktop client caches the result for the
    session so the dropdown opens without delay after the first call.

    Returns
    -------
    list[VirtueleBoringLagenmodelEntry]
        One entry per DOV lagenmodel (code, description, available
        resolutions), skipping catalogue rows without a ``code``.

    Raises
    ------
    HTTPException(502)
        When DOV returns an unexpected response
        (``VirtueleBoringFetchError``).
    HTTPException(503)
        When DOV is unreachable (connection error).
    HTTPException(504)
        When the DOV request times out.
    """
    async with make_dov_async_client() as http:
        try:
            catalog = await VirtueleBoringClient(http).fetch_lagenmodel_catalog()
        except VirtueleBoringFetchError as err:
            logger.warning(f"Virtuele Boring catalog fetch failed: HTTP {err.status_code}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Cannot reach Virtuele Boring catalog",
            ) from err
        except httpx.ConnectError as err:
            logger.warning(f"Virtuele Boring connect error: {type(err).__name__}: {err}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Cannot reach Virtuele Boring",
            ) from err
        except httpx.TimeoutException as err:
            logger.warning(f"Virtuele Boring timeout: {type(err).__name__}: {err}")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Virtuele Boring timed out",
            ) from err

    return [
        VirtueleBoringLagenmodelEntry(
            code=str(entry.get("code", "")),
            beschrijving=str(entry.get("beschrijving", "")),
            resoluties=[int(r) for r in entry.get("resoluties", []) if isinstance(r, (int, float))],
        )
        for entry in catalog
        if entry.get("code")
    ]


@project_router.get("/predictions", response_model=VirtueleBoringPredictionsResponse)
async def fetch_predictions(
    project_id: UUID,
    models: str = Query(
        ...,
        description=(
            "Comma-separated DOV lagenmodel codes (e.g. 'g3dv3_F,hcovv2_H'). "
            "At least one required, max 12."
        ),
    ),
    session: AsyncSession = Depends(get_session),
) -> VirtueleBoringPredictionsResponse:
    """Return overlay predictions for every investigation in a project.

    For each CPT + borehole with Lambert-72 (EPSG:31370) coordinates,
    fetches one doorprik call per requested model. Investigations
    outside Lambert 72 are counted in ``skipped_count`` but not
    listed in ``predictions`` (no rendering target for them).

    A per-investigation per-model fetch failure (an HTTP error or a
    network failure: timeout, reset, refused) is logged at WARNING on
    the server, surfaces as a missing key in ``predictions_by_model``
    and as an entry in ``skipped`` with its reason — the rest of the
    sweep still returns (200).

    Parameters
    ----------
    project_id : UUID
        Primary key of the project whose investigations to overlay.
    models : str
        Comma-separated DOV lagenmodel codes (e.g. ``"g3dv3_F,hcovv2_H"``).
        At least one is required; at most ``_MAX_MODELS_PER_REQUEST`` (12).
        Each code must match ``_VALID_MODEL_CODE_RE`` before fan-out.
    session : AsyncSession
        Database session injected by FastAPI dependency injection.

    Returns
    -------
    VirtueleBoringPredictionsResponse
        The requested model codes, a ``skipped_count`` of investigations
        outside Lambert 72, and per-investigation predictions keyed by
        model code.

    Raises
    ------
    HTTPException(400)
        When no valid model code is supplied, more than
        ``_MAX_MODELS_PER_REQUEST`` codes are requested, or one or more
        codes fail the lagenmodel-code format gate.
    HTTPException(503)
        When EVERY fetch failed for a network reason (DOV unreachable):
        ``detail = {code: "dov_unreachable", message: ...}``.
    """
    requested = [m.strip() for m in models.split(",") if m.strip()]
    if not requested:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one model code is required.",
        )
    if len(requested) > _MAX_MODELS_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many models requested (max {_MAX_MODELS_PER_REQUEST}).",
        )

    invalid = [code for code in requested if not _VALID_MODEL_CODE_RE.match(code)]
    if invalid:
        # Do not echo the raw rejected values back verbatim beyond a
        # short, length-capped preview — keep the 400 from becoming a
        # reflection surface.
        preview = ", ".join(repr(code[:20]) for code in invalid[:3])
        logger.warning(
            f"Rejected {len(invalid)} invalid Virtuele Boring model "
            f"code(s) before fan-out: {preview}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more model codes are not valid lagenmodel codes.",
        )

    use_case = FetchVirtueleBoringPredictions(session)
    try:
        result = await use_case.execute(project_id, requested)
    except DovUnreachableError as err:
        # The use case already logged the one summary WARNING; an
        # unreachable external host is degraded, not a server error.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": DOV_UNREACHABLE_CODE, "message": DOV_UNREACHABLE_MESSAGE},
        ) from err

    return VirtueleBoringPredictionsResponse(
        models=result.models,
        skipped_count=result.skipped_count,
        predictions=[
            VirtueleBoringInvestigationResponse(
                investigation_kind=p.investigation_kind,
                investigation_id=p.investigation_id,
                name=p.name,
                elevation_m_taw=p.elevation_m_taw,
                predictions_by_model={
                    model_code: [
                        VirtueleBoringLayerResponse(
                            code=layer.code,
                            name=layer.name,
                            beschrijving=layer.beschrijving,
                            top_m_taw=layer.top_m_taw,
                            base_m_taw=layer.base_m_taw,
                            thickness_m=layer.thickness_m,
                            color_hex=layer.color_hex,
                            ncs_link=layer.ncs_link,
                        )
                        for layer in layers
                    ]
                    for model_code, layers in p.predictions_by_model.items()
                },
            )
            for p in result.predictions
        ],
        skipped=[
            VirtueleBoringSkippedResponse(
                investigation_kind=s.investigation_kind,
                investigation_id=s.investigation_id,
                name=s.name,
                model=s.model,
                reason=s.reason,
                detail=s.detail,
            )
            for s in result.skipped
        ],
    )
