"""Load a geological model's picks as observations, filtered like the surface build.

A pick feeds the check exactly when it feeds the TIN: its test is drawn by a
cross-section, not removed from the project and not excluded from the model
(`contact_feeds_surface`). Synthetic pinch-out contacts are extrapolations, not
observations, and are skipped.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.formation_picks import FormationPicks
from groundmodel.application.section_membership import load_section_member_investigation_ids
from groundmodel.domain.services.formation_surface_contacts import contact_feeds_surface
from groundmodel.domain.services.geostat.pick_noise_floor import pick_noise_floor_m
from groundmodel.domain.value_objects.pick_observation import PickObservation
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)
from groundmodel.shared.logging.capped_name_list import capped_name_list
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


async def load_formation_picks(
    session: AsyncSession, model_id: UUID, logger: GroundModelLogger
) -> list[FormationPicks]:
    """Return the model's picks grouped per formation, youngest formation first.

    Parameters
    ----------
    session : AsyncSession
        Open database session.
    model_id : UUID
        Geological model.
    logger : GroundModelLogger
        The calling use case's logger (helpers never own one).

    Returns
    -------
    list[FormationPicks]
        One entry per formation with at least one contact that feeds the model;
        empty when the model does not exist.
    """
    model_row = (
        await session.execute(
            select(
                GeologicalModelOrm.app_project_id, GeologicalModelOrm.excluded_borehole_ids
            ).where(GeologicalModelOrm.id == model_id)
        )
    ).one_or_none()
    if model_row is None:
        logger.warning(f"load_formation_picks: model {model_id} not found")
        return []
    project_id = model_row.app_project_id
    excluded = set(model_row.excluded_borehole_ids or [])
    hidden = await InvestigationReviewRepository(session).hidden_investigation_ids(project_id)
    members = await load_section_member_investigation_ids(session, project_id=project_id)

    contacts = await GeologyRepository(session).list_contacts(model_id)
    # Synthetic pinch-out contacts (no investigation anchor) are extrapolations
    # the tool computed, not observations: checking them against their
    # neighbours would test the tool, not the picks.
    anchored = [c for c in contacts if c.borehole_id is not None or c.cpt_id is not None]
    kept = [
        c
        for c in anchored
        if contact_feeds_surface(
            borehole_id=c.borehole_id,
            cpt_id=c.cpt_id,
            hidden_investigation_ids=hidden,
            excluded_borehole_ids=excluded,
            section_member_ids=members,
        )
    ]
    logger.info(
        f"load_formation_picks: model={model_id} contacts={len(contacts)} "
        f"synthetic_skipped={len(contacts) - len(anchored)} "
        f"off_model_skipped={len(anchored) - len(kept)}"
    )

    bh_ids = {c.borehole_id for c in kept if c.borehole_id is not None}
    cpt_ids = {c.cpt_id for c in kept if c.cpt_id is not None}
    boreholes: dict[UUID, BoreholeOrm] = (
        {
            b.id: b
            for b in (
                await session.execute(select(BoreholeOrm).where(BoreholeOrm.id.in_(bh_ids)))
            ).scalars()
        }
        if bh_ids
        else {}
    )
    cpts: dict[UUID, CptOrm] = (
        {
            c.id: c
            for c in (await session.execute(select(CptOrm).where(CptOrm.id.in_(cpt_ids)))).scalars()
        }
        if cpt_ids
        else {}
    )
    formation_ids = {c.formation_id for c in kept}
    formations: dict[UUID, GeologicalFormationOrm] = (
        {
            f.id: f
            for f in (
                await session.execute(
                    select(GeologicalFormationOrm).where(
                        GeologicalFormationOrm.id.in_(formation_ids)
                    )
                )
            ).scalars()
        }
        if formation_ids
        else {}
    )

    grouped: dict[UUID, list[PickObservation]] = defaultdict(list)
    # Names, not just counts: the log must say WHICH tests lack a position or
    # ground elevation (CLAUDE.md "log what was NOT found").
    skipped: dict[UUID, list[str]] = defaultdict(list)
    for c in kept:
        kind = "borehole" if c.borehole_id is not None else "cpt"
        anchor: BoreholeOrm | CptOrm | None = (
            boreholes.get(c.borehole_id)
            if c.borehole_id is not None
            else cpts.get(c.cpt_id)
            if c.cpt_id is not None
            else None
        )
        if (
            anchor is None
            or anchor.location_x is None
            or anchor.location_y is None
            or anchor.elevation_m is None
        ):
            # The contact id stands in when the anchor row itself is missing.
            skipped[c.formation_id].append(
                f"contact {c.id}" if anchor is None else (anchor.name or anchor.test_id)
            )
            continue
        grouped[c.formation_id].append(
            PickObservation(
                contact_id=str(c.id),
                investigation_id=str(anchor.id),
                investigation_kind=kind,
                investigation_name=anchor.name or anchor.test_id,
                x_m=float(anchor.location_x),
                y_m=float(anchor.location_y),
                # Same conversion as the TIN build: ground elevation minus pick depth.
                elevation_m=float(anchor.elevation_m) - float(c.depth_top_m),
                noise_floor_m=pick_noise_floor_m(kind),
            )
        )
    for fid, names in skipped.items():
        formation = formations.get(fid)
        logger.warning(
            f"load_formation_picks: model={model_id} "
            f"formation={formation.name if formation is not None else fid}: "
            f"{capped_name_list(names)} (no position/elevation)"
        )

    result = [
        FormationPicks(
            formation_id=fid,
            formation_name=formations[fid].name,
            display_order=formations[fid].display_order,
            picks=tuple(grouped.get(fid, [])),
            skipped_no_location=len(skipped.get(fid, [])),
        )
        for fid in formation_ids
        if fid in formations
    ]
    result.sort(key=lambda g: -g.display_order)
    logger.debug(
        f"load_formation_picks: model={model_id} formations="
        f"{[(g.formation_name, len(g.picks)) for g in result]}"
    )
    return result
