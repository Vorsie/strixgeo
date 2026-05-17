"""Pydantic schema: :class:`DeduplicateContactsResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class DeduplicateContactsResponse(BaseModel):
    """Result of ``POST /projects/{pid}/geology/models/{mid}/contacts/dedupe``.

    Returns the count of inspected groups + the count + ids of
    removed duplicates so the frontend toast is meaningful and a
    future undo command could re-create the deleted rows.
    """

    inspected_groups: int
    duplicates_removed: int
    removed_contact_ids: list[UUID]
