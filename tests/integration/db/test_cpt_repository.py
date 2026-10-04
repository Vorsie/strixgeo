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


async def test_set_elevation_stamps_manual_provenance(
    db_session: AsyncSession,
) -> None:
    """``set_elevation`` always stamps MANUAL when a value is set.

    Debt #8 — pins the provenance stamp so a future refresh-on-
    duplicate path that consults the column has a stable signal.
    """
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="stamp-manual")
    cpt.elevation_source = "dov"  # imagine: row came from DOV import
    await repo.save(cpt)
    await db_session.commit()

    updated = await repo.set_elevation(cpt.id, 12.0, 5710)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_source == "manual"


async def test_set_elevation_clear_resets_source_to_none(
    db_session: AsyncSession,
) -> None:
    """Clearing the elevation flips the source back to NONE.

    Debt #8 — clearing a manual edit moves the row back to "no Z
    known" so every consumer sees a consistent (None, "none") pair.
    """
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="clear-source", elevation_m=4.0, z_epsg=5710)
    cpt.elevation_source = "manual"
    await repo.save(cpt)
    await db_session.commit()

    updated = await repo.set_elevation(cpt.id, None, None)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m is None
    assert updated.elevation_source == "none"


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


# ---------------------------------------------------------------------------
# Debt #21 — elevation rollback (clear restores the imported Z)
# ---------------------------------------------------------------------------


async def test_set_elevation_clear_restores_imported_z(
    db_session: AsyncSession,
) -> None:
    """Clearing a manual override of an imported DOV Z restores the surveyed
    value + source instead of nulling the row (debt #21)."""
    repo = CptRepository(db_session)
    cpt = _cpt(test_id="rollback-elev", elevation_m=7.42, z_epsg=5710)
    cpt.elevation_source = "dov"  # imagine: row came from DOV import
    await repo.save(cpt)
    await db_session.commit()

    # Manual override → MANUAL, upstream DOV triple snapshotted.
    updated = await repo.set_elevation(cpt.id, 9.0, None)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m == 9.0
    assert updated.elevation_source == "manual"
    assert updated.original_elevation_m == 7.42
    assert updated.original_z_epsg == 5710
    assert updated.original_elevation_source == "dov"

    # Clear → restored to the DOV value + source, snapshot consumed.
    cleared = await repo.set_elevation(cpt.id, None, None)
    await db_session.commit()
    assert cleared is not None
    assert cleared.elevation_m == 7.42
    assert cleared.z_epsg == 5710
    assert cleared.elevation_source == "dov"
    assert cleared.original_elevation_source is None
    assert cleared.original_elevation_m is None


# ---------------------------------------------------------------------------
# q_total_mpa (CPTM) — the one resistance column the DB actually stores
# ---------------------------------------------------------------------------


async def test_cptm_series_round_trips_q_total_mpa_distinct_from_qc(
    db_session: AsyncSession,
) -> None:
    """A CPTM's source-measured total resistance persists as a DISTINCT array.

    q_total_mpa (Begemann/CPTM combined tip+sleeve resistance) is genuinely
    source-measured and stored. The CPTU corrected cone resistance qt_mpa is
    intentionally NOT a stored column — it is derived on read via
    ``calculate_qt_series`` per Data Integrity Rule §1, so it must never leak
    into storage. This pins that q_total_mpa round-trips exactly, stays
    distinct from qc_mpa (never conflated), and that qt is not persisted.

    (project_qt_vs_qtotal: the two quantities are physically distinct and the
    DB holds only the measured one.)
    """
    from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

    repo = CptRepository(db_session)
    cptm = _cpt(test_id="cptm-qtotal")
    # CPTM (mechanical) — the only cone type that reports q_total.
    cptm.cpt_type = "CPTM"
    cptm.series = CptSeriesOrm(
        depths_m=[0.0, 0.5, 1.0],
        qc_mpa=[1.2, 2.4, 3.6],
        fs_mpa=None,
        u2_mpa=None,
        rf_pct=None,
        # Deliberately distinct from qc so a column-conflation regression fails.
        q_total_mpa=[10.0, 20.0, 30.0],
    )
    await repo.save(cptm)
    await db_session.commit()

    out = await repo.get_many_with_series([cptm.id])
    assert len(out) == 1
    series = out[0].series
    assert series is not None
    # q_total round-trips exactly and stays a separate array from qc.
    assert series.q_total_mpa == [10.0, 20.0, 30.0]
    assert series.qc_mpa == [1.2, 2.4, 3.6]
    assert series.q_total_mpa != series.qc_mpa
    # qt is not a stored column — it is derived on read, never persisted.
    assert not hasattr(series, "qt_mpa")


# ---------------------------------------------------------------------------
# Duplicate key matches on the PROJECT NUMBER (owner ruling 2026-10-04)
# ---------------------------------------------------------------------------
# A GEF stores "#PROJECTID= CPT, 23.15-002" as "CPT, 23.15-002"; a PDF-digitised
# CPT stores "23.15-002". Both name one project, so a later import of the same
# sounding must find the stored row (the consented Replace path) instead of
# creating a duplicate. The stored value is never rewritten.


async def test_a_stored_gef_project_id_is_found_by_its_project_number(
    db_session: AsyncSession,
) -> None:
    """Stored "CPT, 23.15-002"/"110" is found by ("23.15-002", "110")."""
    repo = CptRepository(db_session)
    project = uuid7()
    stored = _cpt(project_id="CPT, 23.15-002", test_id="110", app_project_id=project)
    await repo.save(stored)
    await db_session.commit()

    found = await repo.find_by_project_test("23.15-002", "110", project)

    assert found is not None
    assert found.id == stored.id
    assert found.project_id == "CPT, 23.15-002", "the stored value is never rewritten"


async def test_a_stored_project_number_is_found_by_the_gef_project_id(
    db_session: AsyncSession,
) -> None:
    """Stored "23.15-002"/"110" (a PDF import) is found by ("CPT, 23.15-002", "110")."""
    repo = CptRepository(db_session)
    project = uuid7()
    stored = _cpt(project_id="23.15-002", test_id="110", app_project_id=project)
    await repo.save(stored)
    await db_session.commit()

    found = await repo.find_by_project_test("CPT, 23.15-002", "110", project)

    assert found is not None
    assert found.id == stored.id


async def test_another_project_number_with_the_same_sounding_is_not_found(
    db_session: AsyncSession,
) -> None:
    """("23.15-003", "110") does NOT find the stored "CPT, 23.15-002"/"110"."""
    repo = CptRepository(db_session)
    project = uuid7()
    await repo.save(_cpt(project_id="CPT, 23.15-002", test_id="110", app_project_id=project))
    await db_session.commit()

    assert await repo.find_by_project_test("23.15-003", "110", project) is None


async def test_the_project_number_match_stays_inside_the_app_project(
    db_session: AsyncSession,
) -> None:
    """The normalised match never reaches another app project's CPT (audit C2)."""
    repo = CptRepository(db_session)
    await repo.save(_cpt(project_id="CPT, 23.15-002", test_id="110", app_project_id=uuid7()))
    await db_session.commit()

    assert await repo.find_by_project_test("23.15-002", "110", uuid7()) is None
