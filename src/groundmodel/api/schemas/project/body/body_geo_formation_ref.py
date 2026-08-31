"""Pydantic schema: :class:`BodyGeoFormationRef` — one crossed geological formation."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class BodyGeoFormationRef(BaseModel):
    """One geological formation a body crosses (debt #278, R2).

    A body may span geological-formation boundaries, so its geological
    attribution is a LIST of these refs, shallowest first — not a single
    majority stamp. A minimal ``{id, name}`` ref: the id resolves the formation,
    the name is what the UI and exports show.

    Attributes
    ----------
    id : UUID
        The geological formation's row id.
    name : str
        The geological formation's display name (e.g. ``"Pleistoceen"``).
    """

    id: UUID
    name: str
