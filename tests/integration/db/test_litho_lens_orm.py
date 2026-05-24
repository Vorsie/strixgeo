"""Integration tests for the LithoLens ORM + the lens_id FK on FormationContact (#101 Slice 1).

These exercise the Slice-1 schema migration:

* Round-trip a ``LithoLensOrm`` row through INSERT → SELECT
* Tag a ``FormationContactOrm`` with ``lens_id`` and confirm it
  persists alongside the existing anchor / synthetic semantics
* Delete the lens → contact's ``lens_id`` becomes NULL
  (``ON DELETE SET NULL`` behaviour — the lens is metadata; deleting
  it must NOT silently drop the underlying contact geometry)
* Delete the parent formation → lens is cascade-deleted
  (``ON DELETE CASCADE`` on ``parent_formation_id``)
* Delete the lithostratigraphic model → lens is cascade-deleted
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


async def _make_fixture(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalFormationOrm, BoreholeOrm]:
    """Project + lithostratigraphic model + formation + borehole anchor."""
    project = ProjectOrm(id=uuid7(), name="Lens slice-1 test", status="active")
    db_session.add(project)
    await db_session.flush()
    model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Litho M", kind="lithostratigraphic"
    )
    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="ZAND", color="#fceb9a"
    )
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add_all([model, formation, borehole])
    await db_session.commit()
    return project, model, formation, borehole


@pytest.mark.asyncio
async def test_litho_lens_round_trip(db_session: AsyncSession) -> None:
    """A LithoLens row round-trips through INSERT → SELECT with every field."""
    project, model, formation, _ = await _make_fixture(db_session)

    lens_id = uuid7()
    db_session.add(
        LithoLensOrm(
            id=lens_id,
            app_project_id=project.id,
            model_id=model.id,
            parent_formation_id=formation.id,
            name="Channel sand lens",
        )
    )
    await db_session.commit()

    loaded = (
        await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    ).scalar_one()
    assert loaded.app_project_id == project.id
    assert loaded.model_id == model.id
    assert loaded.parent_formation_id == formation.id
    assert loaded.name == "Channel sand lens"
    assert loaded.created_at is not None
    assert loaded.updated_at is not None


@pytest.mark.asyncio
async def test_litho_lens_name_nullable(db_session: AsyncSession) -> None:
    """The lens name is optional — a lens without a label persists fine."""
    project, model, formation, _ = await _make_fixture(db_session)

    lens_id = uuid7()
    db_session.add(
        LithoLensOrm(
            id=lens_id,
            app_project_id=project.id,
            model_id=model.id,
            parent_formation_id=formation.id,
            name=None,
        )
    )
    await db_session.commit()

    loaded = (
        await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    ).scalar_one()
    assert loaded.name is None


@pytest.mark.asyncio
async def test_formation_contact_lens_id_tag(db_session: AsyncSession) -> None:
    """A contact tagged with lens_id persists the link alongside its anchor."""
    project, model, formation, borehole = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        parent_formation_id=formation.id,
        name=None,
    )
    db_session.add(lens)
    await db_session.flush()

    contact = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        cpt_id=None,
        depth_top_m=3.5,
        source="manual_pick",
        confidence="medium",
        lens_id=lens.id,
    )
    db_session.add(contact)
    await db_session.commit()

    loaded = (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == contact.id)
        )
    ).scalar_one()
    assert loaded.lens_id == lens.id


@pytest.mark.asyncio
async def test_lens_delete_sets_contact_lens_id_null(
    db_session: AsyncSession,
) -> None:
    """ON DELETE SET NULL: deleting the lens un-tags its contacts without
    deleting them — the lens is metadata over real contact geometry."""
    project, model, formation, borehole = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        parent_formation_id=formation.id,
        name=None,
    )
    db_session.add(lens)
    await db_session.flush()

    contact = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        cpt_id=None,
        depth_top_m=3.5,
        source="manual_pick",
        confidence="medium",
        lens_id=lens.id,
    )
    db_session.add(contact)
    await db_session.commit()

    contact_id = contact.id
    await db_session.delete(lens)
    await db_session.commit()
    # SQLAlchemy's identity map holds the contact row from before the
    # delete; ``refresh`` reloads the row from the DB so we see the
    # post-cascade ``lens_id = NULL`` value rather than the cached UUID.
    await db_session.refresh(contact)

    # Contact survives, lens_id is now NULL.
    assert contact.id == contact_id
    assert contact.lens_id is None


@pytest.mark.asyncio
async def test_formation_delete_cascades_lens(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on parent_formation_id: deleting the formation
    evaporates its lens rows (they have no meaning without the parent)."""
    project, model, formation, _ = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        parent_formation_id=formation.id,
        name=None,
    )
    db_session.add(lens)
    await db_session.commit()
    lens_id = lens.id

    await db_session.delete(formation)
    await db_session.commit()

    # Lens is gone.
    result = await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_model_delete_cascades_lens(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on model_id: deleting the lithostratigraphic
    model evaporates every lens that belonged to it."""
    project, model, formation, _ = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        parent_formation_id=formation.id,
        name=None,
    )
    db_session.add(lens)
    await db_session.commit()
    lens_id = lens.id

    await db_session.delete(model)
    await db_session.commit()

    result = await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_project_delete_cascades_lens(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on app_project_id: deleting the project
    evaporates every lens that belonged to it. Greenfield FK enforces
    this at the DB layer (unlike legacy project-scoped tables that
    leave the constraint to the application — debt #107)."""
    project, model, formation, _ = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        parent_formation_id=formation.id,
        name=None,
    )
    db_session.add(lens)
    await db_session.commit()
    lens_id = lens.id

    await db_session.delete(project)
    await db_session.commit()

    result = await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    assert result.scalar_one_or_none() is None
