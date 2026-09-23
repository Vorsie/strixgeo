"""Which investigations are actually ON a cross-section — the geotech model's membership rule.

Owner ruling (dogfeed 2026-08-15):

    "i want subdivide cpt's also to be section scoped, i don't want any cpt's
    that aren't on any sections to be subdivided and included in the model"

The geotechnical model is built and edited entirely through the cross-section
view.  A CPT that projects onto no section can never be drawn, correlated,
inspected or corrected there — so subdividing it produces packing bands nobody
can see, that nonetheless enter the body resolver, the 3-D build and every
export.  Membership in the model is therefore defined as *"appears on at least
one cross-section"*.

Membership is decided by the app's own projection rule
(:func:`project_investigations_onto_section`), never by a hand-rolled distance
test: that function is what the section view, the DXF/PDF render and the edge
derivation all agree on, and it already honours a section's
``excluded_cpt_ids`` / ``excluded_borehole_ids``.  Consequence worth stating:
an investigation inside a section's corridor but on its exclusion list is NOT a
member *there*; if that leaves it on no section at all, it is off-section.

Since 2026-09-23 the same rule governs EVERY model, not only the geotech one
(owner: "you don't need to drop subdivision on tests, only don't use tests not
on sections for the model" — "wel into any model really"). The formation
surfaces and the ground hull read the project-wide member set through
:func:`load_section_member_investigation_ids`; a section create / geometry /
corridor / exclusion / delete stales every built surface of the project
(:meth:`GeologyRepository.mark_project_surfaces_stale`, the fields that count
in :mod:`section_membership_constants`). The picks stay on the test; only its
contribution stops while no section draws it.
"""

from __future__ import annotations

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.project_investigations_onto_section import (
    project_investigations_onto_section,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm


async def load_section_member_investigation_ids(
    session: AsyncSession,
    *,
    project_id: UUID,
    section_id: UUID | None = None,
) -> set[UUID]:
    """Return the investigations that appear on a cross-section.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Owning project.  Sections and investigations are both scoped to it.
    section_id : UUID | None, optional
        When given, membership means "on THIS section" — the section-scoped
        pipeline press.  ``None`` (the default) means "on ANY section of the
        project", which is the model-wide press and still excludes the
        investigations that appear on none.

    Returns
    -------
    set[UUID]
        Ids of CPTs and boreholes that project onto the section(s) in scope.
        Empty when the project has no sections at all — an entirely legitimate
        state (nothing has been drawn yet), and one in which the geotech model
        correctly has no members.
    """
    if section_id is not None:
        return set(
            (
                await project_investigations_onto_section(
                    session,
                    project_id=project_id,
                    section_id=section_id,
                    missing_ok=True,
                )
            ).keys()
        )

    section_ids = [
        row[0]
        for row in (
            await session.execute(
                select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
            )
        ).all()
    ]
    by_section = await load_members_by_section(
        session, project_id=project_id, section_ids=section_ids
    )
    members: set[UUID] = set()
    for one_section_members in by_section.values():
        members |= one_section_members
    return members


async def load_members_by_section(
    session: AsyncSession,
    *,
    project_id: UUID,
    section_ids: Collection[UUID],
) -> dict[UUID, set[UUID]]:
    """Return each section's member investigations, keyed by section.

    Same rule, one section at a time: a verb that judges rows *per section* —
    "does this correlation connect two columns THIS section draws?" — needs the
    membership sets side by side, not unioned.  Answering it by calling
    :func:`project_investigations_onto_section` once per section keeps the
    arithmetic single-source; a batched re-implementation would be a second
    copy of the corridor rule, which is exactly how a consumer drifts away from
    what the section view draws.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Owning project — the scope guard for every section queried.
    section_ids : Collection[UUID]
        The sections to resolve.  A section absent from the project resolves to
        an empty set rather than raising: the caller is asking a membership
        question, and "nothing is on it" is the honest answer for a section
        that is not there.

    Returns
    -------
    dict[UUID, set[UUID]]
        ``{section_id: {investigation_id, ...}}``, one entry per requested
        section — including the empty ones, so a caller can tell "no members"
        from "never asked".
    """
    return {
        section_id: set(
            (
                await project_investigations_onto_section(
                    session,
                    project_id=project_id,
                    section_id=section_id,
                    missing_ok=True,
                )
            ).keys()
        )
        for section_id in section_ids
    }


async def load_investigation_names(
    session: AsyncSession, investigation_ids: Collection[UUID]
) -> dict[UUID, str]:
    """Look up display names for a mixed set of CPT / borehole ids.

    Used to log WHAT was skipped, not just how many.  A model that quietly
    came out smaller than the engineer expected is exactly the case where the
    log has to name the rows it dropped.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    investigation_ids : Collection[UUID]
        Ids to resolve; may mix CPTs and boreholes, and may be empty.

    Returns
    -------
    dict[UUID, str]
        ``{investigation_id: name}``.  Ids that match no row are omitted.
    """
    ids = set(investigation_ids)
    if not ids:
        return {}
    names: dict[UUID, str] = {}
    for orm in (CptOrm, BoreholeOrm):
        for row in (await session.execute(select(orm.id, orm.name).where(orm.id.in_(ids)))).all():
            names[row.id] = row.name
    return names


async def load_investigation_labels(
    session: AsyncSession, investigation_ids: Collection[UUID]
) -> str:
    """Resolve a set of investigation ids to one sorted, comma-separated label.

    The log-line shape of :func:`load_investigation_names`.  Three geotech
    writers now report the columns they left off a section, and each of them
    wants the same sentence fragment; an id that resolves to no row falls back
    to its own uuid so the line never silently drops a row it is counting.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    investigation_ids : Collection[UUID]
        Ids to name; may mix CPTs and boreholes, and may be empty.

    Returns
    -------
    str
        ``"B6, S12, S22"`` — sorted for a stable log line.  Empty string when
        no ids were given.
    """
    names = await load_investigation_names(session, investigation_ids)
    return ", ".join(sorted(names.get(inv_id, str(inv_id)) for inv_id in set(investigation_ids)))
