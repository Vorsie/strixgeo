"""Persist and consult the engineer's deleted packing ties.

Owner rulings, 2026-08-17: *"A tie i delete stays deleted but does not delete
on the litho model"*, keyed *"just do position xyz left and xyz right and the
section it was on"*.

Three pieces, one file:

* :func:`record_tie_tombstone` — called by ``UncorrelateLithoContacts`` when
  the engineer deletes a tie on a GEOTECHNICAL model.  Machine housekeeping
  (the crossing sweep, jump-tie supersession) deletes directly and records
  nothing — a tombstone is HIS judgement, not the model's.
* :func:`build_tombstone_gates` — one closure per section for the derivation's
  ``tie_tombstoned`` parameter, translating the derivation's (column, depth)
  world into the tombstone's x/y/z world.
* The matching itself lives in the pure
  :mod:`~groundmodel.domain.services.geotech_tie_tombstone`.

The vertical tolerance is HALF the model's minimum band thickness: two
boundaries on one column can never be closer than the minimum, so half of it
is the widest value that can never suppress a neighbouring tie by mistake.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.geotech_view_state import read_geotech_min_thickness_m
from groundmodel.domain.services.geotech_tie_tombstone import (
    TiePoint,
    TieTombstone,
    tie_is_tombstoned,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import GeotechTieTombstoneOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

__all__ = [
    "build_tombstone_gates",
    "record_tie_tombstone",
]


async def _investigation_xyz(
    session: AsyncSession, investigation_ids: set[UUID]
) -> dict[str, tuple[float, float, float]]:
    """Map position + collar elevation per investigation, keyed by str(id).

    A column whose elevation is unknown is left out: without a collar there is
    no z, so a tombstone can neither be written nor matched there — the safe
    direction is "the tie is not blocked", never "the wrong tie is".
    """
    out: dict[str, tuple[float, float, float]] = {}
    if not investigation_ids:
        return out
    for cpt in (
        await session.execute(select(CptOrm).where(CptOrm.id.in_(investigation_ids)))
    ).scalars():
        if cpt.elevation_m is not None:
            out[str(cpt.id)] = (cpt.location_x, cpt.location_y, cpt.elevation_m)
    for bh in (
        await session.execute(select(BoreholeOrm).where(BoreholeOrm.id.in_(investigation_ids)))
    ).scalars():
        if bh.elevation_m is not None:
            out[str(bh.id)] = (bh.location_x, bh.location_y, bh.elevation_m)
    return out


async def record_tie_tombstone(
    session: AsyncSession,
    log: GroundModelLogger,
    edge: LithoContactCorrelationEdgeOrm,
) -> bool:
    """Remember a deleted tie by the places its two ends were.

    Parameters
    ----------
    session : AsyncSession
        Active session; the row is ``add``-ed, the caller's transaction owns it.
    log : GroundModelLogger
        The calling use case's logger.
    edge : LithoContactCorrelationEdgeOrm
        The edge being deleted, still loaded.  Each end resolves to its band's
        column and the depth of the surface the tie named (``top``/``base``),
        then to (x, y, elevation).

    Returns
    -------
    bool
        ``True`` when the tombstone was written; ``False`` when an end could
        not be placed (band gone, column without elevation) — logged, and the
        delete itself proceeds regardless: refusing HIS delete over OUR
        bookkeeping would be backwards.
    """
    band_a = await session.get(LithoLayerOrm, edge.layer_a_id)
    band_b = await session.get(LithoLayerOrm, edge.layer_b_id)
    if band_a is None or band_b is None:
        log.warning("record_tie_tombstone: an endpoint band no longer exists — not recorded")
        return False
    inv_a = band_a.cpt_id or band_a.borehole_id
    inv_b = band_b.cpt_id or band_b.borehole_id
    if inv_a is None or inv_b is None:
        log.warning("record_tie_tombstone: an endpoint has no investigation — not recorded")
        return False
    xyz = await _investigation_xyz(session, {inv_a, inv_b})
    home_a = xyz.get(str(inv_a))
    home_b = xyz.get(str(inv_b))
    if home_a is None or home_b is None:
        log.warning(
            "record_tie_tombstone: an endpoint column has no collar elevation — not recorded"
        )
        return False
    depth_a = band_a.depth_top_m if edge.layer_a_side == "top" else band_a.depth_base_m
    depth_b = band_b.depth_top_m if edge.layer_b_side == "top" else band_b.depth_base_m
    session.add(
        GeotechTieTombstoneOrm(
            id=uuid7(),
            model_id=edge.model_id,
            section_id=edge.section_id,
            a_x=home_a[0],
            a_y=home_a[1],
            # Elevation, not depth: the key survives a collar correction.
            a_z=home_a[2] - depth_a,
            b_x=home_b[0],
            b_y=home_b[1],
            b_z=home_b[2] - depth_b,
        )
    )
    log.info(
        f"record_tie_tombstone: tie deletion remembered at "
        f"({home_a[0]:.1f}, {home_a[1]:.1f}, {home_a[2] - depth_a:.2f}) - "
        f"({home_b[0]:.1f}, {home_b[1]:.1f}, {home_b[2] - depth_b:.2f}) "
        f"on section {edge.section_id}"
    )
    return True


async def build_tombstone_gates(
    session: AsyncSession,
    geotech_model_id: UUID,
    project_id: UUID,
) -> dict[UUID, Callable[[str, float, str, float], bool]]:
    """One ``tie_tombstoned`` closure per section that has recorded deletions.

    Parameters
    ----------
    session : AsyncSession
        Active session.
    geotech_model_id : UUID
        The geotech model being derived.
    project_id : UUID
        Its project — the minimum band thickness (whose half is the vertical
        tolerance) lives in the project view-state.

    Returns
    -------
    dict[UUID, Callable[[str, float, str, float], bool]]
        ``section_id → closure``; empty when the engineer never deleted
        anything, which is the ordinary case and costs one SELECT.  The
        closure takes the derivation's candidate — ``(investigation_id_str,
        depth_below_collar_m)`` per end — and answers whether a recorded
        deletion covers it.
    """
    rows = (
        (
            await session.execute(
                select(GeotechTieTombstoneOrm).where(
                    GeotechTieTombstoneOrm.model_id == geotech_model_id
                )
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return {}

    by_section: dict[UUID, list[TieTombstone]] = {}
    for row in rows:
        by_section.setdefault(row.section_id, []).append(
            TieTombstone(
                section_id=row.section_id,
                a=TiePoint(x=row.a_x, y=row.a_y, z=row.a_z),
                b=TiePoint(x=row.b_x, y=row.b_y, z=row.b_z),
            )
        )

    # Every column's collar, loaded once — the closures translate the
    # derivation's depths into elevations through it.
    project_cpts = (
        await session.execute(select(CptOrm.id).where(CptOrm.app_project_id == project_id))
    ).scalars()
    project_bhs = (
        await session.execute(
            select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == project_id)
        )
    ).scalars()
    xyz = await _investigation_xyz(session, {*project_cpts, *project_bhs})

    tolerance_m = (await read_geotech_min_thickness_m(session, project_id)) / 2.0

    def gate_for(
        section_id: UUID, stones: list[TieTombstone]
    ) -> Callable[[str, float, str, float], bool]:
        def gate(inv_a: str, depth_a: float, inv_b: str, depth_b: float) -> bool:
            home_a = xyz.get(inv_a)
            home_b = xyz.get(inv_b)
            if home_a is None or home_b is None:
                # No collar, no z — never block on a place we cannot compute.
                return False
            return tie_is_tombstoned(
                stones,
                section_id,
                TiePoint(x=home_a[0], y=home_a[1], z=home_a[2] - depth_a),
                TiePoint(x=home_b[0], y=home_b[1], z=home_b[2] - depth_b),
                tolerance_m=tolerance_m,
            )

        return gate

    return {section_id: gate_for(section_id, stones) for section_id, stones in by_section.items()}
