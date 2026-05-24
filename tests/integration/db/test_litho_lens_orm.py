"""Integration tests for the LithoLensOrm + Position 4 schema (#101 R1).

Exercises the updated schema after the Position 4 pivot:

* Round-trip a ``LithoLensOrm`` row through INSERT → SELECT
  (uses ``formation_id`` and ``body_ordinal``)
* UNIQUE constraint on ``(model_id, formation_id, body_ordinal)``
* Delete the lens → FormationContact is NOT affected
  (lens_id column dropped; contacts are independent of lens metadata)
* Delete the parent formation → lens is cascade-deleted
  (``ON DELETE CASCADE`` on ``formation_id``)
* Delete the lithostratigraphic model → lens is cascade-deleted
* Delete the project → lens is cascade-deleted
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

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
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalFormationOrm]:
    """Project + lithostratigraphic model + formation."""
    project = ProjectOrm(id=uuid7(), name="Lens Position4 test", status="active")
    db_session.add(project)
    await db_session.flush()
    model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Litho M", kind="lithostratigraphic"
    )
    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="ZAND", color="#fceb9a"
    )
    db_session.add_all([model, formation])
    await db_session.commit()
    return project, model, formation


@pytest.mark.asyncio
async def test_litho_lens_round_trip(db_session: AsyncSession) -> None:
    """A LithoLensOrm row round-trips through INSERT → SELECT with every field."""
    project, model, formation = await _make_fixture(db_session)

    lens_id = uuid7()
    db_session.add(
        LithoLensOrm(
            id=lens_id,
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            name="Channel sand lens",
        )
    )
    await db_session.commit()

    loaded = (
        await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    ).scalar_one()
    assert loaded.app_project_id == project.id
    assert loaded.model_id == model.id
    assert loaded.formation_id == formation.id
    assert loaded.body_ordinal == 0
    assert loaded.name == "Channel sand lens"
    assert loaded.created_at is not None
    assert loaded.updated_at is not None


@pytest.mark.asyncio
async def test_litho_lens_name_nullable(db_session: AsyncSession) -> None:
    """The lens name is optional — a lens without a label persists fine."""
    project, model, formation = await _make_fixture(db_session)

    lens_id = uuid7()
    db_session.add(
        LithoLensOrm(
            id=lens_id,
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            name=None,
        )
    )
    await db_session.commit()

    loaded = (
        await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    ).scalar_one()
    assert loaded.name is None


@pytest.mark.asyncio
async def test_litho_lens_body_ordinal_distinguishes_two_bodies(
    db_session: AsyncSession,
) -> None:
    """Two lens metadata rows with different body_ordinals can coexist for the
    same (model, formation) pair — different ordinals = different bodies."""
    project, model, formation = await _make_fixture(db_session)

    db_session.add(
        LithoLensOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            name="First clay drape",
        )
    )
    db_session.add(
        LithoLensOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=1,
            name="Second clay drape",
        )
    )
    # Should not raise.
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(LithoLensOrm).where(
                    LithoLensOrm.model_id == model.id,
                    LithoLensOrm.formation_id == formation.id,
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
    """UNIQUE(model_id, formation_id, body_ordinal) rejects a second metadata
    row for the same body."""
    project, model, formation = await _make_fixture(db_session)

    db_session.add(
        LithoLensOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,
            name="First",
        )
    )
    await db_session.flush()

    db_session.add(
        LithoLensOrm(
            id=uuid7(),
            app_project_id=project.id,
            model_id=model.id,
            formation_id=formation.id,
            body_ordinal=0,  # same triple → violation
            name="Duplicate",
        )
    )
    with pytest.raises(IntegrityError, match="uq_litho_lens_model_formation_ordinal"):
        await db_session.flush()

    await db_session.rollback()


@pytest.mark.asyncio
async def test_formation_delete_cascades_lens(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on formation_id: deleting the formation evaporates
    its lens metadata rows."""
    project, model, formation = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        name=None,
    )
    db_session.add(lens)
    await db_session.commit()
    lens_id = lens.id

    await db_session.delete(formation)
    await db_session.commit()

    result = await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_model_delete_cascades_lens(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on model_id: deleting the model evaporates every
    lens metadata row that belonged to it."""
    project, model, formation = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
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
    """ON DELETE CASCADE on app_project_id: deleting the project evaporates
    every lens metadata row that belonged to it."""
    project, model, formation = await _make_fixture(db_session)

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        name=None,
    )
    db_session.add(lens)
    await db_session.commit()
    lens_id = lens.id

    await db_session.delete(project)
    await db_session.commit()

    result = await db_session.execute(select(LithoLensOrm).where(LithoLensOrm.id == lens_id))
    assert result.scalar_one_or_none() is None
