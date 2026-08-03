"""Re-importing the same CPT REFRESHES the existing row in place.

Uses a SYNTHETIC in-memory GEF (project_id + test_id set) so it needs neither
the gitignored ``data/cpt/`` fixtures nor a network — only the integration DB.

The invariant (CLAUDE.md "Idempotency on ingest"): re-importing a CPT that is
already present under the same project must **refresh** it — replace the depth
series, update the header/metadata from the fresh parse — while keeping the
same ``cpt.id`` so every row that references it (reviews, contacts, litho
layers, sections) survives. A parser fix that lands after the user already
imported must reach them by re-importing the file, not by wiping the project.

Requires Docker DB on localhost:5433 (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import (
    InvestigationReviewOrm,
)
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.shared.exceptions import CptRefreshConfirmationRequiredError
from tests.integration.conftest import make_project

# A minimal but complete GEF: PROJECTID + TESTID (both are required for the
# duplicate guard to fire), XY, ZID, and three depth/qc/fs rows.
_GEF = (
    "#PROJECTID= IDEMPOTENT-PROJ\n"
    "#TESTID= CPT-IDEM-01\n"
    "#XYID= 32000, 200000.0, 100000.0\n"
    "#ZID= 32001, 5.0\n"
    "#COLUMN= 3\n"
    "#COLUMNINFO= 1, m, depth, 1\n"
    "#COLUMNINFO= 2, MPa, cone resistance, 2\n"
    "#COLUMNINFO= 3, MPa, sleeve friction, 3\n"
    "#EOH=\n"
    "0.20; 1.0; 0.05\n0.40; 1.5; 0.06\n0.60; 2.0; 0.07\n"
)


async def _count_rows(session: AsyncSession, test_id: str) -> int:
    """Count CPT rows with the given test_id.

    Parameters
    ----------
    session : AsyncSession
        Active integration-test session.
    test_id : str
        GEF ``#TESTID`` to count rows for.

    Returns
    -------
    int
        Number of ``cpt`` rows carrying that ``test_id``.
    """
    stmt = select(func.count()).select_from(CptOrm).where(CptOrm.test_id == test_id)
    return int((await session.execute(stmt)).scalar_one())


async def _depths(session: AsyncSession, cpt_id: UUID) -> list[float]:
    """Return the persisted depth array for one CPT.

    Parameters
    ----------
    session : AsyncSession
        Active integration-test session.
    cpt_id : UUID
        CPT whose series to read.

    Returns
    -------
    list[float]
        The stored ``depths_m`` array.
    """
    stmt = select(CptSeriesOrm.depths_m).where(CptSeriesOrm.cpt_id == cpt_id)
    return list((await session.execute(stmt)).scalar_one())


async def test_reimport_refreshes_in_place_and_keeps_references(
    db_session: AsyncSession,
) -> None:
    """A second import of the same file corrects stale depths, same id, references intact.

    Simulates the real dogfeed shape: the user imported the file when the
    parser produced wrong depths, reviewed the CPT, then re-imported after the
    fix. The re-import must correct the stored series and leave the review row
    (and the id every other table references) untouched.
    """
    project = await make_project(db_session)
    parsed = GEFParser().parse(_GEF)
    importer = ImportCpt(db_session)

    # First import — one row lands.
    first = await importer.persist(parsed, "CPT-IDEM-01", app_project_id=project.id)
    assert await _count_rows(db_session, "CPT-IDEM-01") == 1
    assert first.refreshed is False

    # The engineer reviewed it — a referencing row that must survive.
    review = InvestigationReviewOrm(
        id=uuid7(),
        app_project_id=project.id,
        target_kind="cpt",
        target_id=first.cpt_id,
        review_status="reviewed",
    )
    db_session.add(review)
    await db_session.commit()

    # Simulate the old, wrong parse already sitting in the DB.
    stored = await db_session.get(CptSeriesOrm, first.cpt_id)
    assert stored is not None
    stored.depths_m = [9.9, 9.9, 9.9]
    cpt_row = await db_session.get(CptOrm, first.cpt_id)
    assert cpt_row is not None
    cpt_row.max_depth_m = 9.9
    cpt_row.n_rows = 3
    await db_session.commit()

    # Re-import the SAME file.
    second = await importer.persist(
        parsed, "CPT-IDEM-01", app_project_id=project.id, confirm_refresh=True
    )

    # Same identity — every referencing row still points at a live CPT.
    assert second.cpt_id == first.cpt_id
    assert second.refreshed is True
    assert await _count_rows(db_session, "CPT-IDEM-01") == 1

    # The stale depths were replaced by the fresh parse.
    assert await _depths(db_session, first.cpt_id) == [0.20, 0.40, 0.60]
    refreshed_row = await db_session.get(CptOrm, first.cpt_id)
    assert refreshed_row is not None
    assert refreshed_row.max_depth_m == 0.60

    # The review survived the refresh.
    surviving = (
        await db_session.execute(
            select(InvestigationReviewOrm).where(InvestigationReviewOrm.target_id == first.cpt_id)
        )
    ).scalar_one()
    assert surviving.review_status == "reviewed"


async def test_an_unconfirmed_reimport_writes_nothing_and_reports_the_diff(
    db_session: AsyncSession,
) -> None:
    """Without consent the stored series survives untouched, and the diff is offered.

    A refresh is irreversible (``docs/ux.md``), so the default must be "ask",
    not "overwrite". The refusal carries the numbers the dialog shows.
    """
    project = await make_project(db_session)
    parsed = GEFParser().parse(_GEF)
    importer = ImportCpt(db_session)

    first = await importer.persist(parsed, "CPT-IDEM-01", app_project_id=project.id)

    # Pretend the stored parse was shallower, so the diff is visible.
    stored = await db_session.get(CptSeriesOrm, first.cpt_id)
    assert stored is not None
    stored.depths_m = [0.20, 0.40]
    cpt_row = await db_session.get(CptOrm, first.cpt_id)
    assert cpt_row is not None
    cpt_row.max_depth_m = 0.40
    cpt_row.n_rows = 2
    await db_session.commit()

    with pytest.raises(CptRefreshConfirmationRequiredError) as err:
        await importer.persist(parsed, "CPT-IDEM-01", app_project_id=project.id)

    assert err.value.existing_id == first.cpt_id
    assert err.value.old_n_rows == 2
    assert err.value.new_n_rows == 3
    assert err.value.old_max_depth_m == 0.40
    assert err.value.new_max_depth_m == 0.60

    # Nothing was written.
    await db_session.rollback()
    assert await _depths(db_session, first.cpt_id) == [0.20, 0.40]


async def test_a_header_only_row_refreshes_into_a_complete_cpt(
    db_session: AsyncSession,
) -> None:
    """The defensive no-stored-series branch REPAIRS the row instead of raising.

    A row whose series never landed (an import interrupted mid-transaction) must
    be repairable by re-importing the file. The branch used to hand SQLAlchemy a
    transient ``CptOrm`` carrying the same primary key as the persistent row via
    the ``series.cpt`` back-reference cascade, which raises on flush.
    """
    project = await make_project(db_session)
    parsed = GEFParser().parse(_GEF)
    importer = ImportCpt(db_session)

    first = await importer.persist(parsed, "CPT-IDEM-01", app_project_id=project.id)

    # Reduce the row to header-only.
    orphan = await db_session.get(CptSeriesOrm, first.cpt_id)
    assert orphan is not None
    await db_session.delete(orphan)
    await db_session.commit()
    db_session.expunge_all()

    second = await importer.persist(
        parsed, "CPT-IDEM-01", app_project_id=project.id, confirm_refresh=True
    )

    assert second.cpt_id == first.cpt_id
    assert second.refreshed is True
    assert await _depths(db_session, first.cpt_id) == [0.20, 0.40, 0.60]


async def test_refresh_does_not_clobber_a_manual_elevation(
    db_session: AsyncSession,
) -> None:
    """A manually-edited collar Z survives a refresh; an imported Z is overwritten.

    The rule is stated on ``ElevationSource.MANUAL`` (debt #8): the
    refresh-on-duplicate path may correct a Z that came from the file, but the
    engineer's own edit outranks the file.
    """
    project = await make_project(db_session)
    parsed = GEFParser().parse(_GEF)
    importer = ImportCpt(db_session)

    first = await importer.persist(parsed, "CPT-IDEM-01", app_project_id=project.id)

    # The engineer corrected the collar by hand afterwards.
    cpt_row = await db_session.get(CptOrm, first.cpt_id)
    assert cpt_row is not None
    cpt_row.elevation_m = 42.0
    cpt_row.elevation_source = ElevationSource.MANUAL.value
    await db_session.commit()

    await importer.persist(parsed, "CPT-IDEM-01", app_project_id=project.id, confirm_refresh=True)

    kept = await db_session.get(CptOrm, first.cpt_id)
    assert kept is not None
    assert kept.elevation_m == 42.0
    assert kept.elevation_source == ElevationSource.MANUAL.value
