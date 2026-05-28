"""Integration test: parent_geo_contact_id FK on FormationContactOrm (#162 T1).

Verifies two behavioural properties of the nullable self-referential FK
``formation_contact.parent_geo_contact_id``:

GC1  A litho contact that points at a geo contact round-trips through the DB:
     ``litho.parent_geo_contact_id == geo.id`` after flush + refresh.

GC2  Deleting the geo contact auto-unlinks its litho children at the DB
     layer (``ON DELETE SET NULL``): ``litho.parent_geo_contact_id`` is
     ``None`` after deleting ``geo``.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Internal helper — builds the minimum rows the FK chain requires
# ---------------------------------------------------------------------------


async def _make_stack(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalModelOrm, GeologicalFormationOrm, BoreholeOrm]:
    """Insert project + geo model + litho model + formation + borehole.

    Returns (project, geo_model, litho_model, formation, borehole).
    All rows are committed so cross-session FK lookups work.
    """
    project = ProjectOrm(id=uuid7(), name="geo-link test", status="active")
    db_session.add(project)
    await db_session.flush()

    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo",
        kind="geological",
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
    )
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND",
        color="#fceb9a",
    )
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-geo-link",
        app_project_id=project.id,
        project_id="TEST",
        test_id="GL-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add_all([geo_model, litho_model, formation, borehole])
    await db_session.commit()

    return project, geo_model, litho_model, formation, borehole


# ---------------------------------------------------------------------------
# GC1 — FK round-trip: litho contact points at geo contact after flush
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gc1_parent_geo_contact_id_persists(db_session: AsyncSession) -> None:
    """A litho contact with parent_geo_contact_id set round-trips through the DB.

    After flushing and re-querying, litho.parent_geo_contact_id equals
    the geo contact's id.
    """
    _, geo_model, litho_model, formation, borehole = await _make_stack(db_session)

    # Geo contact: geological model, borehole anchor.
    geo = FormationContactOrm(
        id=uuid7(),
        model_id=geo_model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=5.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(geo)
    await db_session.flush()  # geo.id is now in DB; litho FK can reference it

    # Litho contact: lithostratigraphic model, same borehole anchor, coupled to geo.
    litho = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=5.0,
        source="borehole_observation",
        confidence="high",
        parent_geo_contact_id=geo.id,  # the coupling FK
    )
    db_session.add(litho)
    await db_session.commit()

    # Re-query from DB (bypass any ORM identity-map cache).
    litho_id = litho.id
    reloaded = (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == litho_id)
        )
    ).scalar_one()

    assert reloaded.parent_geo_contact_id == geo.id, (
        f"Expected parent_geo_contact_id={geo.id!r}, got {reloaded.parent_geo_contact_id!r}"
    )


# ---------------------------------------------------------------------------
# GC2 — SET NULL on delete: deleting the geo contact unlinks litho children
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gc2_delete_geo_contact_sets_litho_fk_null(db_session: AsyncSession) -> None:
    """Deleting a geo contact must set parent_geo_contact_id = NULL on all
    litho contacts that pointed at it (ON DELETE SET NULL).

    This is the "free unlink" lifecycle: the litho contact survives;
    only the coupling pointer is cleared.
    """
    _, geo_model, litho_model, formation, borehole = await _make_stack(db_session)

    geo = FormationContactOrm(
        id=uuid7(),
        model_id=geo_model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=8.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(geo)
    await db_session.flush()

    litho = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=8.0,
        source="borehole_observation",
        confidence="high",
        parent_geo_contact_id=geo.id,
    )
    db_session.add(litho)
    await db_session.commit()

    litho_id = litho.id
    geo_id = geo.id

    # Delete the geo contact; the litho contact must survive with FK set to NULL.
    geo_row = (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == geo_id)
        )
    ).scalar_one()
    await db_session.delete(geo_row)
    await db_session.commit()
    # Expire every cached ORM object so the next SELECT goes to the DB,
    # not the identity map. The SET NULL happened at the DB layer; without
    # this the session would return the stale pre-delete litho object.
    db_session.expire_all()

    # The litho contact must still exist.
    litho_reloaded = (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == litho_id)
        )
    ).scalar_one_or_none()
    assert litho_reloaded is not None, (
        "Litho contact must survive deletion of its geo parent (ON DELETE SET NULL, not CASCADE)"
    )

    # The FK pointer must be cleared.
    assert litho_reloaded.parent_geo_contact_id is None, (
        f"Expected parent_geo_contact_id=None after geo contact deleted, "
        f"got {litho_reloaded.parent_geo_contact_id!r}"
    )
