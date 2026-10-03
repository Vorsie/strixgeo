"""Resolve the litho-frame warning for a packing tie from the database.

The PURE decision lives in
:mod:`groundmodel.domain.services.litho_frame_conformance` — given two soils,
whether the parent litho units are correlated, and human band descriptions, it
returns the draw-time warning or ``None``.  This module is the application-layer
half: it walks the ORM to resolve those inputs (each geotech band's parent
litho unit, its main soil, the accepted litho-correlation path between them,
and a human band description) and calls the pure helper.

It exists because TWO paths now need exactly this resolution:

* the hand-drawn tie use case
  (:class:`~groundmodel.application.correlate_litho_contacts.CorrelateLithoContacts`),
  which warns on the tie the engineer draws; and
* the machine tie path
  (:class:`~groundmodel.application.auto_correlate_geotech_edges.AutoCorrelateGeotechEdges`),
  which restates a direct litho tie onto the packing bands REGARDLESS of class
  (owner ruling 2026-08-13) and so can propose exactly the ties the hand path
  would flag.

Both call the same free functions here rather than keeping two copies of the
resolution (CLAUDE.md — extract on the second copy).  Every function takes the
session as a parameter and does I/O; nothing here holds state or a logger.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.litho_frame_conformance import frame_tie_warning
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm

# Containment tolerance for matching a geotech band's depth range to the parent
# litho layer that it subdivides.  The geotech band depths come from the same
# arithmetic pipeline (the litho picks + A3 segmenter), so a tight numeric guard
# is sufficient.  Mirrors the value in ``correlate_litho_contacts.py``, where the
# same containment test is applied to the body-resolution and crossing paths.
_DEPTH_CONTAINMENT_EPS_M: float = 1e-3


async def containing_litho_layer(
    session: AsyncSession,
    *,
    litho_model_id: UUID,
    band: LithoLayerOrm,
) -> LithoLayerOrm | None:
    """Return the accepted litho layer containing *band*, or ``None``.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    litho_model_id : UUID
        The parent lithostratigraphic model.
    band : LithoLayerOrm
        A geotech band (litho_layer row on the geotech model).

    Returns
    -------
    LithoLayerOrm | None
        The accepted litho layer whose depth range contains the band's, on the
        same column; ``None`` when the band is off any column or none contains
        it.
    """
    if band.cpt_id is not None:
        inv_filter = LithoLayerOrm.cpt_id == band.cpt_id
    elif band.borehole_id is not None:
        inv_filter = LithoLayerOrm.borehole_id == band.borehole_id
    else:
        return None
    stmt = (
        select(LithoLayerOrm)
        .where(
            and_(
                LithoLayerOrm.model_id == litho_model_id,
                LithoLayerOrm.status == "accepted",
                inv_filter,
                LithoLayerOrm.depth_top_m <= band.depth_top_m + _DEPTH_CONTAINMENT_EPS_M,
                LithoLayerOrm.depth_base_m >= band.depth_base_m - _DEPTH_CONTAINMENT_EPS_M,
            )
        )
        .order_by(LithoLayerOrm.depth_top_m)
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


async def main_soil_of(session: AsyncSession, unit: LithoLayerOrm) -> str | None:
    """The main soil code of *unit*'s formation, or ``None``.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    unit : LithoLayerOrm
        An accepted litho layer.

    Returns
    -------
    str | None
        The formation's ``litho_main_soil_code``, or ``None`` when the
        formation is missing.
    """
    formation = await session.get(GeologicalFormationOrm, unit.formation_id)
    if formation is None:
        return None
    return formation.litho_main_soil_code


async def litho_units_connected(
    session: AsyncSession,
    *,
    litho_model_id: UUID,
    a: UUID,
    b: UUID,
) -> bool:
    """Whether an accepted litho correlation path connects units *a* and *b*.

    Plain BFS over the parent litho model's accepted contact-correlation edges
    (all sections — bodies union across sections).  Deliberately permissive:
    any path counts, so an over-connection under-flags rather than nagging about
    a conforming tie.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    litho_model_id : UUID
        The parent lithostratigraphic model.
    a, b : UUID
        The two accepted litho layer ids.

    Returns
    -------
    bool
        ``True`` when a path exists (or ``a == b``).
    """
    if a == b:
        return True
    rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.layer_a_id,
                LithoContactCorrelationEdgeOrm.layer_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == litho_model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
            )
        )
    ).all()
    adjacency: dict[UUID, list[UUID]] = {}
    for x, y in rows:
        adjacency.setdefault(x, []).append(y)
        adjacency.setdefault(y, []).append(x)
    frontier = [a]
    seen = {a}
    while frontier:
        node = frontier.pop()
        for neighbour in adjacency.get(node, []):
            if neighbour == b:
                return True
            if neighbour not in seen:
                seen.add(neighbour)
                frontier.append(neighbour)
    return False


async def describe_geotech_band(session: AsyncSession, band_id: UUID) -> str:
    """Name a geotech band for a warning: formation @ investigation.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    band_id : UUID
        The geotech band (= contact) id.

    Returns
    -------
    str
        e.g. ``"KLEI (NAD 23) on GEO-22/115-S10"`` - or the bare id when the
        band cannot be resolved.  Never an id when a name is available: the
        engineer reads the message on a column he can see, not a UUID.
    """
    band = await session.get(LithoLayerOrm, band_id)
    if band is None:
        return str(band_id)
    formation = await session.get(GeologicalFormationOrm, band.formation_id)
    fname = formation.name if formation is not None else "?"
    inv_name: str | None = None
    if band.cpt_id is not None:
        cpt = await session.get(CptOrm, band.cpt_id)
        inv_name = cpt.name if cpt is not None else None
    elif band.borehole_id is not None:
        bh = await session.get(BoreholeOrm, band.borehole_id)
        inv_name = bh.name if bh is not None else None
    return f"{fname} on {inv_name}" if inv_name else fname


async def band_frame_warning(
    session: AsyncSession,
    *,
    litho_model_id: UUID,
    band_a_id: UUID,
    band_b_id: UUID,
) -> str | None:
    """Draw-time warning when a packing tie exceeds the litho frame, or ``None``.

    Owner order 2026-08-21 (after deleting a silt-to-clay tie that rendered as
    nothing): *"next time flag a tie like that when it doesn't conform to the
    litho model!"*  Resolves each endpoint band's parent litho unit, compares
    main soils and litho units, and — for same-soil pairs — walks the parent litho model's
    ACCEPTED correlation edges for a path between the two units.  Unresolvable
    parents stay silent: absence of evidence is not evidence of non-conformance.

    Parameters
    ----------
    session : AsyncSession
        Active DB session.
    litho_model_id : UUID
        The parent lithostratigraphic model (the frame).
    band_a_id, band_b_id : UUID
        The two geotech band (= contact) ids being tied.

    Returns
    -------
    str | None
        The warning sentence, or ``None`` when the tie conforms (or a parent
        could not be resolved).
    """
    band_a = await session.get(LithoLayerOrm, band_a_id)
    band_b = await session.get(LithoLayerOrm, band_b_id)
    if band_a is None or band_b is None:
        return None
    unit_a = await containing_litho_layer(session, litho_model_id=litho_model_id, band=band_a)
    unit_b = await containing_litho_layer(session, litho_model_id=litho_model_id, band=band_b)
    if unit_a is None or unit_b is None:
        return None
    soil_a = await main_soil_of(session, unit_a)
    soil_b = await main_soil_of(session, unit_b)
    # The BFS only decides the same-soil case; skip it when soils differ.
    connected = (
        soil_a == soil_b
        and soil_a is not None
        and await litho_units_connected(
            session, litho_model_id=litho_model_id, a=unit_a.id, b=unit_b.id
        )
    )
    return frame_tie_warning(
        soil_a=soil_a,
        soil_b=soil_b,
        litho_connected=connected,
        band_a=await describe_geotech_band(session, band_a_id),
        band_b=await describe_geotech_band(session, band_b_id),
        # Owner 2026-10-03: two litho units of one soil never weld, so a tie
        # across them is flagged even when a litho tie connects them.
        same_litho_unit=unit_a.formation_id == unit_b.formation_id,
    )
