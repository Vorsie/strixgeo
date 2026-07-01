"""Idempotency round-trip for the CPT import: re-persisting the same CPT does
NOT create a duplicate row.

Uses a SYNTHETIC in-memory GEF (project_id + test_id set) so it needs neither
the gitignored ``data/cpt/`` fixtures nor a network — only the integration DB.

The invariant (CLAUDE.md "Idempotency on ingest"): a second import of a CPT
already present under the same project is detected as a duplicate
(``DuplicateCptError``) and leaves exactly one row — a re-run must not silently
double the data.

Requires Docker DB on localhost:5433 (run via scripts/run-integration-tests.ps1).
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.shared.exceptions import DuplicateCptError

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
    """Count CPT rows with the given test_id."""
    stmt = select(func.count()).select_from(CptOrm).where(CptOrm.test_id == test_id)
    return int((await session.execute(stmt)).scalar_one())


async def test_reimporting_the_same_cpt_does_not_duplicate(db_session: AsyncSession) -> None:
    """persist() twice → first inserts one row, second raises DuplicateCptError,
    and the DB still holds exactly one row (idempotent re-import).

    This is the double-``execute`` refresh-on-duplicate round-trip: the second
    run's duplicate guard (``find_by_project_test`` scoped to app_project_id)
    fires before any insert, so re-importing an already-present CPT is a no-op
    at the storage layer, not a silent doubling.
    """
    result = GEFParser().parse(_GEF)
    importer = ImportCpt(db_session)

    # First import — one row lands.
    first = await importer.persist(result, "CPT-IDEM-01", app_project_id=None)
    assert first.cpt_id is not None
    assert await _count_rows(db_session, "CPT-IDEM-01") == 1

    # Second import of the SAME CPT — the duplicate guard fires before any insert.
    with pytest.raises(DuplicateCptError):
        await importer.persist(result, "CPT-IDEM-01", app_project_id=None)

    # Count conservation: the failed re-import left the single row untouched,
    # NOT a second copy (the idempotency invariant).
    assert await _count_rows(db_session, "CPT-IDEM-01") == 1
