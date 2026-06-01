"""Integration tests for BodyOrm + Position 4 schema (#101 R1, renamed #body-with-extent).

Exercises the updated schema after the body-with-extent rename:

* Round-trip a ``BodyOrm`` row through INSERT → SELECT
  (uses ``formation_id`` and ``body_ordinal``)
* UNIQUE constraint on ``(model_id, formation_id, body_ordinal)``
* Delete the body row → FormationContact is NOT affected
  (contacts are independent of body metadata)
* Delete the parent formation → body is cascade-deleted
  (``ON DELETE CASCADE`` on ``formation_id``)
* Delete the lithostratigraphic model → body is cascade-deleted
* Delete the project → body is cascade-deleted
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


async def _make_fixture(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalFormationOrm]:
    """Project + lithostratigraphic model + formation."""
    project = ProjectOrm(id=uuid7(), name="Body ORM test", status="active")
    db_session.add(project)
    await db_session.flush()
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Geo M", kind="geological"
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho M",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="ZAND", color="#fceb9a"
    )
    db_session.add_all([geo_model, model, formation])
    await db_session.commit()
    return project, model, formation


@pytest.mark.asyncio
async def test_body_round_trip(db_session: AsyncSession) -> None:
    """A BodyOrm row round-trips through INSERT → SELECT with every field."""
    project, model, formation = await _make_fixture(db_session)

    source_inv_id = uuid7()
    body_id = uuid7()
    db_session.add(
        BodyOrm(
            id=body_id,
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            source_investigation_id=source_inv_id,
            name="Channel sand lens",
        )
    )
    await db_session.commit()

    loaded = (await db_session.execute(select(BodyOrm).where(BodyOrm.id == body_id))).scalar_one()
    assert loaded.app_project_id == project.id
    assert loaded.model_id == model.id
    assert loaded.formation_id == formation.id
    assert loaded.body_ordinal == 0
    assert loaded.source_investigation_id == source_inv_id
    assert loaded.name == "Channel sand lens"
    assert loaded.created_at is not None
    assert loaded.updated_at is not None


@pytest.mark.asyncio
async def test_body_name_nullable(db_session: AsyncSession) -> None:
    """The body name is optional — a body without a label persists fine."""
    project, model, formation = await _make_fixture(db_session)

    body_id = uuid7()
    db_session.add(
        BodyOrm(
            id=body_id,
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            source_investigation_id=uuid7(),
            name=None,
        )
    )
    await db_session.commit()

    loaded = (await db_session.execute(select(BodyOrm).where(BodyOrm.id == body_id))).scalar_one()
    assert loaded.name is None


@pytest.mark.asyncio
async def test_body_ordinal_distinguishes_two_bodies(
    db_session: AsyncSession,
) -> None:
    """Two body rows with different body_ordinals can coexist for the same
    (model, formation) pair — different ordinals = different bodies."""
    project, model, formation = await _make_fixture(db_session)

    db_session.add(
        BodyOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            source_investigation_id=uuid7(),
            name="First clay drape",
        )
    )
    db_session.add(
        BodyOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=1,
            source_investigation_id=uuid7(),
            name="Second clay drape",
        )
    )
    # Should not raise.
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(BodyOrm).where(
                    BodyOrm.model_id == model.id,
                    BodyOrm.formation_id == formation.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2
    ordinals = {r.body_ordinal for r in rows}
    assert ordinals == {0, 1}


@pytest.mark.asyncio
async def test_unique_constraint_blocks_duplicate_body(db_session: AsyncSession) -> None:
    """UNIQUE(model_id, formation_id, body_ordinal) rejects a second body row
    for the same identity triple."""
    project, model, formation = await _make_fixture(db_session)

    db_session.add(
        BodyOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            source_investigation_id=uuid7(),
            name="First",
        )
    )
    await db_session.flush()

    db_session.add(
        BodyOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,  # same triple → violation
            source_investigation_id=uuid7(),
            name="Duplicate",
        )
    )
    # The migration kept the old constraint name on the renamed table;
    # a future migration will rename it to uq_body_model_formation_ordinal.
    with pytest.raises(IntegrityError, match="uq_litho_lens_model_formation_ordinal"):
        await db_session.flush()

    await db_session.rollback()


@pytest.mark.asyncio
async def test_formation_delete_cascades_body(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on formation_id: deleting the formation evaporates
    its body rows."""
    project, model, formation = await _make_fixture(db_session)

    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=uuid7(),
        name=None,
    )
    db_session.add(body)
    await db_session.commit()
    body_id = body.id

    await db_session.delete(formation)
    await db_session.commit()

    result = await db_session.execute(select(BodyOrm).where(BodyOrm.id == body_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_model_delete_cascades_body(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on model_id: deleting the model evaporates every
    body row that belonged to it."""
    project, model, formation = await _make_fixture(db_session)

    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=uuid7(),
        name=None,
    )
    db_session.add(body)
    await db_session.commit()
    body_id = body.id

    await db_session.delete(model)
    await db_session.commit()

    result = await db_session.execute(select(BodyOrm).where(BodyOrm.id == body_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_project_delete_cascades_body(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on app_project_id: deleting the project evaporates
    every body row that belonged to it."""
    project, model, formation = await _make_fixture(db_session)

    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=uuid7(),
        name=None,
    )
    db_session.add(body)
    await db_session.commit()
    body_id = body.id

    await db_session.delete(project)
    await db_session.commit()

    result = await db_session.execute(select(BodyOrm).where(BodyOrm.id == body_id))
    assert result.scalar_one_or_none() is None
