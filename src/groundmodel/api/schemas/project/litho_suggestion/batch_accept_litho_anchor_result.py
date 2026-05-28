"""Pydantic schema: :class:`BatchAcceptLithoAnchorResult`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class BatchAcceptLithoAnchorResult(BaseModel):
    """Per-anchor outcome inside a batch-accept response.

    Echoes the anchor identity plus the same id lists the single-accept
    response carries, so the frontend can map results back to each ghost
    column (mark accepted indices, build the per-anchor undo op).

    Parameters
    ----------
    cpt_id : UUID | None
        CPT anchor (set when this anchor was CPT-anchored).
    borehole_id : UUID | None
        Borehole anchor (set when this anchor was borehole-anchored).
    created_formation_ids : list[UUID]
        Litho formation rows created for this anchor.
    found_formation_ids : list[UUID]
        Litho formation rows already present and re-used.
    created_contact_ids : list[UUID]
        Contact rows newly inserted for this anchor.
    found_contact_ids : list[UUID]
        Contact rows already present (idempotent path).
    straddle_split_count : int
        Suggestions split across a geological-formation boundary.
    stale_tin_fallback_count : int
        Straddle splits that fell back to depth-ordering (debt #68).
    extrapolated_formation_ids : list[UUID]
        Formation rows whose parent was inferred via TIN extrapolation (#87).
    orphan_formation_ids : list[UUID]
        Formation rows created with ``parent_formation_id=NULL`` (#87).
    error : str | None
        When non-null, this anchor was skipped — the accept raised a
        ``ValueError`` (e.g. investigation not in project) and the rest of the
        batch continued.  All id lists are empty in that case.
    """

    cpt_id: UUID | None = None
    borehole_id: UUID | None = None
    created_formation_ids: list[UUID] = []
    found_formation_ids: list[UUID] = []
    created_contact_ids: list[UUID] = []
    found_contact_ids: list[UUID] = []
    straddle_split_count: int = 0
    stale_tin_fallback_count: int = 0
    extrapolated_formation_ids: list[UUID] = []
    orphan_formation_ids: list[UUID] = []
    error: str | None = None
