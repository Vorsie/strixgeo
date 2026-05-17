"""Pydantic schema: :class:`AutoPopulateFromStratigraphyResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class AutoPopulateFromStratigraphyResponse(BaseModel):
    """Result counts + ids returned by the auto-populate endpoint.

    ``skipped_existing`` covers idempotency hits (the layer already
    seeded a contact); ``skipped_unmatched`` covers layers with an
    empty description; ``skipped_no_stratigraphy`` covers boreholes
    that don't carry a formal OR informal stratigraphy observation
    at all.
    """

    created_contact_ids: list[UUID]
    created_formation_ids: list[UUID]
    skipped_existing: int
    skipped_unmatched: int
    skipped_no_stratigraphy: int
