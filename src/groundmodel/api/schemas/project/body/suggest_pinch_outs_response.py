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
    below_contact_id : UUID | None
        Formation contact below the candidate body's depth interval.
        ``None`` for the deepest-formation open candidate — that unit has
        no base contact because it extends to the bottom of the hole.
    below_depth_m : float | None
        Investigation bottom depth (m below surface) for the
        deepest-formation open candidate, whose base is the bottom of the
        hole rather than a contact.  ``None`` for normal framed candidates
        (they use ``below_contact_id``).
    side : {'left', 'right'}
        Which lateral direction this candidate represents.
    suggested_neighbour_investigation_id : UUID
        The neighbouring investigation that the auto-suggest algorithm
        proposes as the pinch-out partner.
    """

    body_id: UUID | None
    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID | None
    # Investigation bottom depth (m below surface) for the deepest-formation
    # open candidate, whose base is the bottom of the hole rather than a
    # contact. None for normal framed candidates (they use below_contact_id).
    below_depth_m: float | None = None
    side: Literal["left", "right"]
    # 'pinch_out_halfway' (interior) or 'open' (edge test — opens to boundary).
    kind: Literal["pinch_out_halfway", "open"] = "pinch_out_halfway"
    # None for an 'open' edge candidate (no halfway target).
    suggested_neighbour_investigation_id: UUID | None = None


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
