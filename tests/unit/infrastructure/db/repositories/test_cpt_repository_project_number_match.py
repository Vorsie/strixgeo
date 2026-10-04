"""The CPT duplicate lookup matches on the PROJECT NUMBER (owner ruling 2026-10-04).

A PDF-digitised CPT stores the sheet's project number ("23.15-002"); the GEF of
the same sounding stores ``#PROJECTID= CPT, 23.15-002`` as "CPT, 23.15-002" (the
GEF type field kept). Both name one project, so a later import of the same
sounding must find the stored row and take the consented Replace path instead
of creating a duplicate. The stored value is never rewritten (backwards
compatibility): the lookup compares the two ids with the GEF type dropped.

A fake session returns the candidate rows the test-id query would return, so
the comparison runs without a database.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository


class _CandidateSession:
    """Fake AsyncSession whose ``execute`` returns fixed candidate rows."""

    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows
        self.statements: list[object] = []

    async def execute(self, statement: object) -> object:
        """Record the statement and return the candidate rows."""
        self.statements.append(statement)
        rows = self.rows

        class _Scalars:
            def all(self) -> list[SimpleNamespace]:
                return rows

        class _Result:
            def scalars(self) -> _Scalars:
                return _Scalars()

        return _Result()


def _row(project_id: str, test_id: str = "110") -> SimpleNamespace:
    """Return a stand-in for a stored CPT row."""
    return SimpleNamespace(id=uuid4(), project_id=project_id, test_id=test_id)


@pytest.mark.asyncio
async def test_a_gef_row_is_found_by_the_pdf_project_number() -> None:
    """Stored "CPT, 23.15-002"/"110" is found by ("23.15-002", "110")."""
    stored = _row("CPT, 23.15-002")
    repo = CptRepository(_CandidateSession([stored]))  # type: ignore[arg-type]

    assert await repo.find_by_project_test("23.15-002", "110", uuid4()) is stored


@pytest.mark.asyncio
async def test_a_pdf_row_is_found_by_the_gef_project_id() -> None:
    """Stored "23.15-002"/"110" is found by ("CPT, 23.15-002", "110")."""
    stored = _row("23.15-002")
    repo = CptRepository(_CandidateSession([stored]))  # type: ignore[arg-type]

    assert await repo.find_by_project_test("CPT, 23.15-002", "110", uuid4()) is stored


@pytest.mark.asyncio
async def test_another_project_number_is_not_a_match() -> None:
    """Same sounding number, another project ("23.15-003"): no match."""
    repo = CptRepository(_CandidateSession([_row("CPT, 23.15-002")]))  # type: ignore[arg-type]

    assert await repo.find_by_project_test("23.15-003", "110", uuid4()) is None


@pytest.mark.asyncio
async def test_the_exact_raw_match_wins_over_a_normalised_one() -> None:
    """When both shapes are stored, the row with the identical raw id is returned."""
    gef = _row("CPT, 23.15-002")
    pdf = _row("23.15-002")
    repo = CptRepository(_CandidateSession([gef, pdf]))  # type: ignore[arg-type]

    assert await repo.find_by_project_test("23.15-002", "110", uuid4()) is pdf


@pytest.mark.asyncio
async def test_the_candidate_query_is_selective_on_test_id_and_project_scoped() -> None:
    """The candidates come from the test id inside the request's project scope."""
    session = _CandidateSession([])
    repo = CptRepository(session)  # type: ignore[arg-type]

    await repo.find_by_project_test("23.15-002", "110", uuid4())

    sql = " ".join(str(session.statements[-1]).lower().split())
    assert "cpt.test_id =" in sql
    assert "app_project_id =" in sql
