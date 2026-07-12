"""Shared litho↔geo coupling helpers (#162).

Two use cases couple a lithostratigraphic contact to the nearest
geological contact on the same investigation: the accept-time auto-link
(``AcceptLithoSuggestions``) and the manual re-link (``LinkLithoToGeo``).
Both previously carried private, near-verbatim copies of the same two
helpers (audit BE-APPLICATION-GEOTECH-IMPORT-07 / debt #224); they are
extracted here per the project's "extract on second copy" rule.  (A
third copy died with the retired C1 skeleton flow.)
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm


def nearest_geo_contact_within_tolerance(
    litho_depth_m: float,
    geo_contacts_at_inv: list[tuple[float, UUID, UUID]],
    tolerance_m: float,
) -> UUID | None:
    """Return the geo contact id a litho contact should couple to, or None.

    Picks the geological contact whose depth is nearest ``litho_depth_m``
    and within ``tolerance_m``.  Entries are ``(depth_m, formation_id,
    contact_id)``.

    Parameters
    ----------
    litho_depth_m : float
        The litho contact's ``depth_top_m``.
    geo_contacts_at_inv : list[tuple[float, UUID, UUID]]
        Geological contacts at the same investigation:
        ``[(depth_top_m, formation_id, contact_id), ...]``.
    tolerance_m : float
        Maximum allowed depth difference for linking.

    Returns
    -------
    UUID | None
        The geo contact id to link to, or ``None`` when no contact is
        within ``tolerance_m``.
    """
    best: tuple[float, UUID] | None = None
    for depth, _fid, contact_id in geo_contacts_at_inv:
        d = abs(depth - litho_depth_m)
        if d <= tolerance_m and (best is None or d < best[0]):
            best = (d, contact_id)
    return best[1] if best is not None else None


async def load_geo_contacts_at_investigation(
    session: AsyncSession,
    geology_model_id: UUID,
    *,
    borehole_id: UUID | None,
    cpt_id: UUID | None,
) -> list[tuple[float, UUID, UUID]]:
    """Load depth-ordered geological contacts at a specific investigation.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    geology_model_id : UUID
        Parent geological model.
    borehole_id : UUID | None
        Borehole anchor (mutually exclusive with ``cpt_id``).
    cpt_id : UUID | None
        CPT anchor.

    Returns
    -------
    list[tuple[float, UUID, UUID]]
        ``[(depth_top_m, formation_id, contact_id), ...]`` ordered
        ascending by depth.
    """
    stmt = select(
        FormationContactOrm.depth_top_m,
        FormationContactOrm.formation_id,
        FormationContactOrm.id,
    ).where(FormationContactOrm.model_id == geology_model_id)

    if borehole_id is not None:
        stmt = stmt.where(FormationContactOrm.borehole_id == borehole_id)
    else:
        stmt = stmt.where(FormationContactOrm.cpt_id == cpt_id)

    stmt = stmt.order_by(FormationContactOrm.depth_top_m)
    rows = (await session.execute(stmt)).all()
    return [(row.depth_top_m, row.formation_id, row.id) for row in rows]
