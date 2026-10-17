"""Request / response schemas for litho contact-correlation endpoints (#133 Phase 1+2).

Endpoints served:
  POST   /projects/{pid}/geology/models/{mid}/contact-correlations
  DELETE /projects/{pid}/geology/models/{mid}/contact-correlations
  GET    /projects/{pid}/geology/models/{mid}/contact-correlations

Section-scoped authoring (owner directive 2026-06-08): an edge carries a
``section_id`` (the section it was authored on).  POST and DELETE both require
``request_section_id`` (the use cases raise → HTTP 422 on null); GET returns the
edge's ``section_id`` and accepts an optional ``?section_id=`` filter.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# The side of a litho layer an edge ties to: its top or its base contact.
ContactSide = Literal["top", "base"]


class ContactCorrelationRequest(StrictRequestModel):
    """Body for POST and DELETE /contact-correlations.

    Attributes
    ----------
    layer_a_id : UUID
        One formation-contact endpoint.  May be supplied in either order —
        the use case normalises to canonical ``(min, max)`` before insert /
        delete.
    layer_b_id : UUID
        The other endpoint.
    source : Literal["manual"]
        Provenance token.  Only 'manual' is accepted in Phase 1; 'auto'
        is reserved for Phase 2 auto-correlate.
    request_section_id : UUID | None
        The section the edge is authored on (section-scoped correlations,
        owner directive 2026-06-08).  Stamped onto the edge's ``section_id``
        on POST and used to scope the lookup on DELETE.  Required in practice:
        both ``CorrelateLithoContacts`` and ``UncorrelateLithoContacts`` raise
        ``ValueError`` (→ HTTP 422) when it is ``None``.  Declared optional
        here only so the validation error is raised by the use case with a
        clear message rather than by request parsing.
    layer_a_side : Literal["top", "base"]
        Which contact of the ``layer_a_id`` layer the edge joins — ``'top'`` (default) or
        ``'base'``.  An edge with ``'base'`` on BOTH ends is a **bottom-tie**
        (bottom-tie spec 2026-06-17), correlating the deepest layer's base so
        the deepest unit can band.  The side travels with its contact through
        the use case's canonical ordering.
    layer_b_side : Literal["top", "base"]
        The same for the ``layer_b_id`` layer.
    """

    layer_a_id: UUID
    layer_b_id: UUID
    source: Literal["manual"] = "manual"
    request_section_id: UUID | None = None
    layer_a_side: ContactSide = "top"
    layer_b_side: ContactSide = "top"

    @model_validator(mode="after")
    def _no_self_loop(self) -> ContactCorrelationRequest:
        """Reject self-loops at the API boundary (defence in depth)."""
        if self.layer_a_id == self.layer_b_id:
            raise ValueError("layer_a_id and layer_b_id must be different layers")
        return self


class ContactCorrelationResponse(BaseModel):
    """Response body for POST /contact-correlations.

    Attributes
    ----------
    edge_id : UUID
        Primary key of the canonical edge row (new or pre-existing).
    layer_a_id : UUID
        Canonical lesser endpoint (min-ordered).
    layer_b_id : UUID
        Canonical greater endpoint.
    model_id : UUID
        The lithostratigraphic model this edge belongs to.
    layer_a_side : str
        The side (``'top'`` / ``'base'``) of the canonical lesser endpoint.
    layer_b_side : str
        The side of the canonical greater endpoint.  A ``('base', 'base')``
        pair is a bottom-tie (bottom-tie spec 2026-06-17).
    source : str
        Provenance token ('manual' in Phase 1).
    was_created : bool
        ``True`` when a new edge was inserted; ``False`` when the edge
        already existed (idempotent re-call returns 200 not 201).
    frame_warning : str | None
        Set when a geotech packing tie does not conform to the litho frame
        (different soils, or same soil with no litho correlation path).  The
        tie IS written — this is the draw-time flag the owner ordered on
        2026-08-21, surfaced as a toast; the edge also carries the matching
        ``review_reason`` badge.  ``None`` for conforming ties and for every
        litho / geological correlation.
    """

    edge_id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    layer_a_side: ContactSide
    layer_b_side: ContactSide
    model_id: UUID
    source: str
    was_created: bool
    frame_warning: str | None = None


class ContactCorrelationEdgeListItem(BaseModel):
    """One edge returned by GET /contact-correlations.

    Attributes
    ----------
    id : UUID
        Primary key of the ``litho_contact_correlation_edge`` row.
    layer_a_id : UUID
        Canonical lesser endpoint.
    layer_b_id : UUID
        Canonical greater endpoint.
    layer_a_side : str
        The side (``'top'`` / ``'base'``) of the lesser endpoint.  Maps from
        the ORM column via ``from_attributes``.
    layer_b_side : str
        The side of the greater endpoint.  A ``('base', 'base')`` pair is a
        bottom-tie (bottom-tie spec 2026-06-17).
    model_id : UUID
        The lithostratigraphic model.
    section_id : UUID
        The section this edge was authored on (section-scoped correlations,
        owner directive 2026-06-08).  The frontend filters/renders edges by it.
    source : str
        Provenance token.
    user_approved : bool
        ``True`` when the edge has been explicitly approved by the user
        (manual gestures + accepted auto edges).  ``False`` for
        auto-proposed edges that are still pending acceptance.
    review_reason : str | None
        Why this edge needs a second look, or ``None`` when it does not.  Set by
        the geotech re-anchor when a re-subdivide could not identify the band the
        tie was drawn on: the tie is carried and flagged rather than dropped.  A
        flagged edge is still ``user_approved`` — it is awaiting confirmation,
        not demoted to a proposal.
    created_at : datetime
        Row creation timestamp.
    """

    model_config = {"from_attributes": True}

    id: UUID
    layer_a_id: UUID
    layer_b_id: UUID
    layer_a_side: ContactSide
    layer_b_side: ContactSide
    model_id: UUID
    section_id: UUID
    source: str
    user_approved: bool
    review_reason: str | None = None
    created_at: datetime
