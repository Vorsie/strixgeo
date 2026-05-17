"""Pydantic schema: :class:`AutoPopulateFromStratigraphyResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from .lumping_collision_item import LumpingCollisionItem


class AutoPopulateFromStratigraphyResponse(BaseModel):
    """Result counts + ids returned by the auto-populate endpoint.

    ``skipped_existing`` covers idempotency hits (the layer already
    seeded a contact); ``skipped_unmatched`` covers layers with an
    empty description; ``skipped_no_stratigraphy`` covers boreholes
    that don't carry a formal OR informal stratigraphy observation
    at all.

    ``deleted_formation_ids`` is populated only when ``selected_keys``
    was provided (the Fill-from-boreholes confirm path).  These
    formations were deleted server-side because their canonical key was
    not in the selected set.  The client uses this list to update its
    local manifest / session-import state without issuing separate
    DELETE requests — eliminating the divergent-client-key freeze that
    the pre-da98053 client-side delete loop suffered.

    ``collisions`` is populated only when ``manual_map`` was provided and
    at least one borehole had ≥2 layers resolve to the same effective key.
    Empty list when no lumping was requested or no collision occurred.
    The dialog renders these as amber warnings; they mirror the warnings
    shown during the discover preview so there are no surprises on confirm.
    """

    created_contact_ids: list[UUID]
    created_formation_ids: list[UUID]
    deleted_formation_ids: list[UUID] = []
    skipped_existing: int
    skipped_unmatched: int
    skipped_no_stratigraphy: int
    collisions: list[LumpingCollisionItem] = []
