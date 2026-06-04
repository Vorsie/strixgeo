"""Shared section-projection query for the body / correlation use cases.

The "load the ``CrossSectionOrm``, build ``SectionEndpoints``, query the
project's CPT/borehole locations, project each via ``project_point_onto_line``,
and keep the ones inside ``projection_buffer_m``" block was copy-pasted across
``SuggestBodyPinchOuts._section_along_positions``,
``DetectBodies._build_section_along`` and
``AutoCorrelateContactEdges._section_along_adjacency`` (debt #197). This module
is the single source of truth for that projection so the math cannot drift
across the three callers.

Deliberately NOT used by two structurally-different projection sites:

* ``BuildSectionSnapshot`` additionally drops projections whose along-distance
  falls outside ``[0, section_length]`` and builds rich
  ``SectionInvestigationProjection`` objects (surface elevation, contacts), and
  raises ``ParseError`` on a missing section — a richer superset, not the same
  block.
* ``MaterializeWedgeTipsForFormation`` projects per contact-row across multiple
  sections, combining each with an elevation, and consumes the lower-level
  ``project_point_onto_line`` directly — it never builds this dict.
"""

from __future__ import annotations

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.gis.section_projection import (
    SectionEndpoints,
    project_point_onto_line,
)


async def project_investigations_onto_section(
    session: AsyncSession,
    *,
    project_id: UUID,
    section_id: UUID,
    restrict_to: Collection[UUID] | None = None,
    missing_ok: bool = False,
) -> dict[UUID, float]:
    """Project in-corridor investigations onto a section line.

    Loads the section, projects every project-scoped CPT and borehole onto its
    line, and returns the per-investigation along-distance for those within the
    section's ``projection_buffer_m`` lateral offset. Explicitly-excluded
    investigations (``excluded_cpt_ids`` / ``excluded_borehole_ids``) and
    off-corridor / unprojectable ones are omitted.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Owning project — the section must belong to it (scope guard), and the
        location queries are filtered to it.
    section_id : UUID
        The cross-section whose along-axis defines order.
    restrict_to : Collection[UUID] | None, optional
        When given, only investigations whose id is in this set are projected
        (the contact-bearing stack keys, for ``DetectBodies``). ``None``
        (default) projects every project investigation (for the section-edge
        ``open`` semantics in ``SuggestBodyPinchOuts``).
    missing_ok : bool, optional
        When ``False`` (default) a section absent from ``project_id`` raises
        ``ValueError``. When ``True`` it returns an empty dict instead — the
        section-less fallback ``DetectBodies`` relies on.

    Returns
    -------
    dict[UUID, float]
        ``{investigation_id: along_distance}`` for every kept investigation.

    Raises
    ------
    ValueError
        When the section does not exist in ``project_id`` and ``missing_ok``
        is ``False``.
    """
    section = (
        await session.execute(
            select(CrossSectionOrm).where(
                CrossSectionOrm.id == section_id,
                CrossSectionOrm.app_project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if section is None:
        if missing_ok:
            return {}
        raise ValueError(f"Section {section_id} not found in project {project_id}")

    endpoints = SectionEndpoints(
        start_x=section.start_x,
        start_y=section.start_y,
        end_x=section.end_x,
        end_y=section.end_y,
    )
    excluded = set(section.excluded_cpt_ids) | set(section.excluded_borehole_ids)

    restrict = set(restrict_to) if restrict_to is not None else None
    along: dict[UUID, float] = {}
    for orm in (CptOrm, BoreholeOrm):
        stmt = select(orm.id, orm.location_x, orm.location_y).where(
            orm.app_project_id == project_id
        )
        if restrict is not None:
            stmt = stmt.where(orm.id.in_(restrict))
        for row in (await session.execute(stmt)).all():
            if row.id in excluded:
                continue
            res = project_point_onto_line(endpoints, row.location_x, row.location_y)
            if res is not None and abs(res.offset) <= section.projection_buffer_m:
                along[row.id] = res.along
    return along
