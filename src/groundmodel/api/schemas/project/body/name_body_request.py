"""Pydantic schemas: :class:`NameBodyRequest` and :class:`NameBodyResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class NameBodyRequest(StrictRequestModel):
    """Body of ``POST .../geology/models/{model_id}/lenses``.

    Creates or updates a human-readable label for a body.  The body is
    identified by its ``(formation_id, body_ordinal)`` pair, which is
    assigned by the correlation resolver and must be known by the caller
    before invoking this endpoint.

    Parameters
    ----------
    formation_id : UUID
        The geological formation whose body is being named.
    body_ordinal : int
        Zero-based ordinal from the correlation resolver.
    name : str
        Human-readable label (1–120 characters, non-empty).
    primary_section_id : UUID | None
        The cross-section from which the naming gesture was invoked.
        Stored so the perpendicular-companion use case can locate the
        section when computing the bearing.  Optional.
    """

    formation_id: UUID
    body_ordinal: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=120)
    primary_section_id: UUID | None = None


class NameBodyResponse(BaseModel):
    """Response of ``POST .../geology/models/{model_id}/lenses``.

    Attributes
    ----------
    body_id : UUID
        The ``BodyOrm`` row id (new or pre-existing).
    was_created : bool
        ``True`` when a new row was inserted; ``False`` when an existing
        row was updated in-place.
    """

    body_id: UUID
    was_created: bool
