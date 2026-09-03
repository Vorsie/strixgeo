"""Pydantic schemas: :class:`UpdateBodyColorRequest` and :class:`UpdateBodyColorResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class UpdateBodyColorRequest(StrictRequestModel):
    """Request body for ``PATCH .../bodies/{body_id}`` colour update.

    Carries only the ``display_color`` field; the endpoint extends the
    existing ``PATCH`` handler additively without touching the ``name``
    update path.

    Attributes
    ----------
    display_color : str | None
        CSS hex colour string (e.g. ``"#aabbcc"``) or ``None`` to reset
        the per-body override and fall back to the formation colour in
        the 3-D viewer.  Max 20 characters — wide enough for
        ``"#rrggbbaa"`` (8-digit hex) plus a leading ``#``.
    """

    display_color: str | None = Field(default=None, max_length=20)


class UpdateBodyColorResponse(BaseModel):
    """Response for ``PATCH .../bodies/{body_id}`` colour update.

    Attributes
    ----------
    body_id : UUID
        The ``BodyOrm`` row that was updated.
    display_color : str | None
        The persisted colour value after the update.
    """

    body_id: UUID
    display_color: str | None
