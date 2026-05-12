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


# ---------------------------------------------------------------------------
# S7 — batched plot fetch via ``get_many_with_series``
# ---------------------------------------------------------------------------


async def test_get_many_with_series_returns_each_requested_cpt(
    db_session: AsyncSession,
) -> None:
    """Round-trips a batch of CPTs with their depth-series loaded.

    Backs ``POST /cpt/plot-batch`` — the cross-section panel folds N
    per-CPT plot fetches into one DB query. Missing ids must drop
    silently (no exception, no padding) so the caller can index by
    ``cpt_id`` rather than position.
    """
    from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

    repo = CptRepository(db_session)
    a = _cpt(test_id="batch-a")
    a.series = CptSeriesOrm(
        depths_m=[0.0, 0.5, 1.0],
        qc_mpa=[1.2, 2.4, 3.6],
        fs_mpa=None,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    b = _cpt(test_id="batch-b")
    b.series = CptSeriesOrm(
        depths_m=[0.0, 1.0],
        qc_mpa=[5.0, 6.0],
        fs_mpa=None,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    await repo.save(a)
    await repo.save(b)
    await db_session.commit()

    # Mix in an unknown id to confirm it drops silently.
    out = await repo.get_many_with_series([a.id, b.id, uuid7()])
    assert len(out) == 2
    by_id = {c.id: c for c in out}
    assert by_id[a.id].series is not None
    assert by_id[a.id].series.depths_m == [0.0, 0.5, 1.0]
    assert by_id[b.id].series is not None


async def test_get_many_with_series_empty_input_returns_empty(
    db_session: AsyncSession,
) -> None:
    """Empty ``cpt_ids`` short-circuits without an IN-query."""
    repo = CptRepository(db_session)
    assert await repo.get_many_with_series([]) == []


async def test_get_many_with_series_filters_by_app_project_id(
    db_session: AsyncSession,
) -> None:
    """The project-scope guard drops foreign-project CPTs even when their id is in the batch.

    This is debt #24's regression test. A caller passing a CPT id from
    project B alongside ids from project A must NOT receive project B's
    series — that's the cross-project data leak the filter prevents.
    """
    from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

    repo = CptRepository(db_session)
    project_a = uuid7()
    project_b = uuid7()
    a = _cpt(test_id="proj-a-cpt", app_project_id=project_a)
    a.series = CptSeriesOrm(
        depths_m=[0.0, 1.0],
        qc_mpa=[1.0, 2.0],
        fs_mpa=None,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    b = _cpt(test_id="proj-b-cpt", app_project_id=project_b)
    b.series = CptSeriesOrm(
        depths_m=[0.0, 1.0],
        qc_mpa=[10.0, 20.0],
        fs_mpa=None,
        u2_mpa=None,
        rf_pct=None,
        q_total_mpa=None,
    )
    await repo.save(a)
    await repo.save(b)
    await db_session.commit()

    # Caller in project A asks for BOTH ids. The filter must drop B.
    out = await repo.get_many_with_series([a.id, b.id], app_project_id=project_a)
    assert len(out) == 1
    assert out[0].id == a.id

    # Without the filter (admin / test path), both come back.
    unfiltered = await repo.get_many_with_series([a.id, b.id])
    assert len(unfiltered) == 2
