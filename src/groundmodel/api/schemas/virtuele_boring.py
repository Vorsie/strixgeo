"""Pydantic schemas for the Virtuele Boring (DOV overlay) endpoints.

Two surfaces:

* ``GET /dov/virtuele-boring/lagenmodellen`` — proxies DOV's model
  catalogue so the desktop client populates its model-picker
  dropdowns from a live source.
* ``GET /projects/{project_id}/virtuele-boring/predictions`` — per-
  project, per-investigation overlay payload.

Wire shape mirrors :mod:`groundmodel.application.fetch_virtuele_boring_predictions`
result objects 1:1.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class VirtueleBoringLagenmodelEntry(BaseModel):
    """One available DOV layered model.

    Echoes what DOV's ``/base/lagenmodel`` endpoint returns. We pass
    the shape through so a new model added by DOV (Antwerp v1.2, NL
    catalogue, …) automatically surfaces in the desktop picker.
    """

    code: str = Field(..., description="DOV model code, e.g. 'g3dv3_F'.")
    beschrijving: str = Field(..., description="Dutch description of the model.")
    resoluties: list[int] = Field(
        default_factory=list,
        description="Allowed resolutions in metres (the polyline endpoint uses these).",
    )


class VirtueleBoringLayerResponse(BaseModel):
    """One layer present at a single investigation point.

    Self-describing — the renderer doesn't need a separate catalogue
    lookup to draw the ghost column. ``code`` is the DOV-internal
    sequential id (e.g. ``g3dv3_F_2``), kept around for debugging and
    future cross-referencing.
    """

    code: str
    name: str
    beschrijving: str
    top_m_taw: float
    base_m_taw: float
    thickness_m: float
    color_hex: str | None
    ncs_link: str | None


class VirtueleBoringInvestigationResponse(BaseModel):
    """Per-investigation overlay row.

    ``predictions_by_model`` is keyed by the same model codes the
    caller passed in the ``?models=`` query param. A missing key
    means the per-call fetch failed for that (investigation, model)
    pair — surface a placeholder in the UI rather than treating it
    as "no layers."
    """

    investigation_kind: Literal["cpt", "borehole"]
    investigation_id: UUID
    name: str
    elevation_m_taw: float | None
    predictions_by_model: dict[str, list[VirtueleBoringLayerResponse]]


class VirtueleBoringPredictionsResponse(BaseModel):
    """Full predictions payload returned by the per-project endpoint.

    ``skipped_count`` reports investigations whose CRS was not
    Lambert 72 (or whose coordinates were missing). The desktop
    client can surface this so the user understands the gap between
    project size and overlay coverage.
    """

    models: list[str]
    predictions: list[VirtueleBoringInvestigationResponse]
    skipped_count: int
