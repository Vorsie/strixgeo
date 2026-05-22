"""Pydantic schema: :class:`WipeLithoContactsResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class WipeLithoContactsResponse(BaseModel):
    """Result of ``DELETE /projects/{pid}/geology/models/{mid}/contacts``.

    Returns the count of rows removed so the frontend toast is
    meaningful.  The operation is irreversible — no id list is
    returned because there is nothing to undo via the API.

    Attributes
    ----------
    deleted : int
        Number of ``FormationContact`` rows removed from the model.
        Zero when the model had no contacts (idempotent no-op).
    """

    deleted: int
