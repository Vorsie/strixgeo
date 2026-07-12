"""Pydantic schema: :class:`BatchAcceptLithoSuggestionsResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from groundmodel.api.schemas.project.cross_section import CrossSectionResponse
from groundmodel.api.schemas.project.litho_suggestion.batch_accept_litho_anchor_result import (
    BatchAcceptLithoAnchorResult,
)


class BatchAcceptLithoSuggestionsResponse(BaseModel):
    """Body of ``POST .../contacts/batch-accept-litho-suggestions``.

    Parameters
    ----------
    anchors : list[BatchAcceptLithoAnchorResult]
        Per-anchor outcomes in request order, so the frontend can update each
        ghost column and build per-anchor undo entries.
    total_created_contacts : int
        Sum of created contacts across all anchors.
    total_found_contacts : int
        Sum of found (idempotent) contacts across all anchors.
    total_created_formations : int
        Sum of created litho formations across all anchors.
    failed_anchor_count : int
        Number of anchors skipped due to a ValueError (their ``error`` is set).
    inference_ran : bool
        Whether ``RecomputeAllAbsencesForModel`` ran after the batch.
    updated_section : CrossSectionResponse | None
        The refreshed section after its ``seeded_formation_contact_ids`` was
        extended once with every anchor's contact ids, or ``None`` when no
        ``section_id`` was provided.
    """

    anchors: list[BatchAcceptLithoAnchorResult]
    total_created_contacts: int
    total_found_contacts: int
    total_created_formations: int
    failed_anchor_count: int = 0
    inference_ran: bool = False
    updated_section: CrossSectionResponse | None = None
