"""Integration tests for ``CptRepository`` covering the Phase 3a elevation editor.

The full ``ImportCpt`` round-trip lives in ``test_import_cpt.py`` (which depends
on the gitignored ``data/cpt/`` GEF fixtures). This file keeps a lightweight,
fixture-free path for testing repository methods that don't need a real GEF
file — currently just ``set_elevation``.

Requires Docker DB on localhost:5433.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository


def _cpt(
    *,
    name: str = "CPT-1",
    project_id: str = "DOV",
    test_id: str = "DOV-25/001",
    app_project_id: UUID | None = None,
    elevation_m: float | None = None,
    z_epsg: int | None = None,
) -> CptOrm:
    """Build a minimal ``CptOrm`` with sensible defaults for synthetic tests."""
    return CptOrm(
        id=uuid7(),
        name=name,
        cpt_type="CPTU",
        project_id=project_id,
        test_id=test_id,
        app_project_id=app_project_id,
        location_x=200000.0,
        location_y=200000.0,
        epsg=31370,
        elevation_m=elevation_m,
        z_epsg=z_epsg,
    )


# ---------------------------------------------------------------------------
# Phase 3a — manual surface-elevation editor (set_elevation)
# ---------------------------------------------------------------------------


async def test_set_elevation_writes_value_and_z_epsg(db_session: AsyncSession) -> None:
    """Setting elevation persists both the value and the supplied vertical CRS."""
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="set-elev")
    await repo.save(cpt)
    await db_session.commit()

    updated = await repo.set_elevation(cpt.id, 7.42, 5710)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m == 7.42
    assert updated.z_epsg == 5710


async def test_set_elevation_clears_zepsg_when_value_cleared(
    db_session: AsyncSession,
) -> None:
    """Clearing elevation drops z_epsg too — keeps the column pair consistent."""
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="clear-elev", elevation_m=5.0, z_epsg=5710)
    await repo.save(cpt)
    await db_session.commit()

    updated = await repo.set_elevation(cpt.id, None, 5710)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m is None
    assert updated.z_epsg is None


async def test_set_elevation_returns_none_for_missing_id(
    db_session: AsyncSession,
) -> None:
    """Patching a non-existent CPT returns None — handler maps to 404."""
    repo = CptRepository(db_session)
    assert await repo.set_elevation(uuid7(), 5.0, 5710) is None


async def test_set_elevation_defaults_zepsg_from_belgian_horizontal_crs(
    db_session: AsyncSession,
) -> None:
    """A Belgian Lambert72 row defaults to mTAW (5710) when no z_epsg is supplied."""
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="default-be")
    await repo.save(cpt)
    await db_session.commit()

    updated = await repo.set_elevation(cpt.id, 4.2, None)
    await db_session.commit()
    assert updated is not None
    assert updated.z_epsg == 5710


async def test_set_elevation_defaults_zepsg_from_dutch_horizontal_crs(
    db_session: AsyncSession,
) -> None:
    """An Amersfoort/RD row defaults to NAP (5709) — covers future BRO imports."""
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="default-nl")
    cpt.epsg = 28992  # Amersfoort / RD New
    await repo.save(cpt)
    await db_session.commit()

    updated = await repo.set_elevation(cpt.id, 4.2, None)
    await db_session.commit()
    assert updated is not None
    assert updated.z_epsg == 5709


async def test_set_elevation_caller_zepsg_overrides_default(
    db_session: AsyncSession,
) -> None:
    """An explicit z_epsg from the caller wins over the CRS-derived default."""
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="explicit-zepsg")
    await repo.save(cpt)
    await db_session.commit()

    # Lambert72 row would default to 5710; force 5709 to confirm the
    # caller-supplied value is honoured.
    updated = await repo.set_elevation(cpt.id, 4.2, 5709)
    await db_session.commit()
    assert updated is not None
    assert updated.z_epsg == 5709
