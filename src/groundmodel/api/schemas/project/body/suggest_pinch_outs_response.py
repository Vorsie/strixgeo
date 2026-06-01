"""Pydantic schemas: :class:`PinchOutCandidateItem` and :class:`SuggestPinchOutsResponse`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class PinchOutCandidateItem(BaseModel):
    """One ephemeral pinch-out candidate from the suggestion pass.

    Candidates are computed on the fly from the correlation graph and are
    NOT persisted.  They represent potential lateral extents that the user
    can confirm via the ``ClaimBodyExtent`` gesture.

    Attributes
    ----------
    body_id : UUID | None
        The ``BodyOrm`` row id if this body has already been claimed;
        ``None`` for bodies that exist in the graph but have not been
        named yet.
    source_investigation_id : UUID
        The investigation whose correlation defines the candidate body.
    above_contact_id : UUID
        Formation contact above the candidate body's depth interval.
    below_contact_id : UUID
        Formation contact below the candidate body's depth interval.
    side : {'left', 'right'}
        Which lateral direction this candidate represents.
    suggested_neighbour_investigation_id : UUID
        The neighbouring investigation that the auto-suggest algorithm
        proposes as the pinch-out partner.
    """

    body_id: UUID | None
    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID
    side: Literal["left", "right"]
    suggested_neighbour_investigation_id: UUID


class SuggestPinchOutsResponse(BaseModel):
    """Response of ``GET .../geology/models/{mid}/lenses/suggest-pinch-outs``.

    Returns an ephemeral list of pinch-out candidates for the user to
    review and confirm.  The list is recomputed from the live correlation
    graph on each call and is not stored.

    Attributes
    ----------
    candidates : list[PinchOutCandidateItem]
        All pinch-out candidates found for this model, ordered by
        source_investigation_id then side.
    """

    candidates: list[PinchOutCandidateItem]
