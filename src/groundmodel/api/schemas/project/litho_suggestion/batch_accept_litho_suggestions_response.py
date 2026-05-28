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
    total_straddle_splits : int
        Sum of straddle splits across all anchors.
    total_stale_tin_fallbacks : int
        Sum of stale-TIN straddle fallbacks across all anchors (debt #68).
    total_extrapolated_formations : int
        Sum of TIN-extrapolated-parent formations across all anchors (#87).
    total_orphan_formations : int
        Sum of orphan-parent formations across all anchors (#87).
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
    total_straddle_splits: int = 0
    total_stale_tin_fallbacks: int = 0
    total_extrapolated_formations: int = 0
    total_orphan_formations: int = 0
    failed_anchor_count: int = 0
    inference_ran: bool = False
    updated_section: CrossSectionResponse | None = None
