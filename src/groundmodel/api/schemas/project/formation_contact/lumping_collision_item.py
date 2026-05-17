"""Pydantic schema: :class:`LumpingCollisionItem`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class LumpingCollisionItem(BaseModel):
    """API projection of a
    :class:`~groundmodel.application.auto_populate_contacts_from_stratigraphy.LumpingCollision`.

    Returned in the ``collisions`` list of both the discover-from-stratigraphy
    preview response and the auto-populate confirm response.  The dialog renders
    these as an amber warning panel so the user understands which layers were
    merged and which contact was kept before committing.

    Attributes
    ----------
    borehole_id : UUID
        The borehole where the collision occurred.
    target_formation_key : str
        The normalised effective key that multiple raw names were mapped to.
    target_formation_name : str
        Display name of the target formation after lumping.
    colliding_raw_names : list[str]
        All raw description strings (both kept and dropped) that resolved to
        ``target_formation_key`` within this borehole.
    kept_top_m : float
        Top depth of the surviving contact (the shallowest one).
    dropped_count : int
        Number of deeper duplicate boundaries that were dropped.
    """

    borehole_id: UUID
    target_formation_key: str
    target_formation_name: str
    colliding_raw_names: list[str]
    kept_top_m: float
    dropped_count: int
