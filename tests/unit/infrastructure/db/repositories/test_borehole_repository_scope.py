"""A borehole duplicate lookup must be scoped to the request's project.

``ImportBoreholeDov`` finds a duplicate by the DOV ``project_id`` + ``test_id``
before a refresh-on-duplicate persist. Those two ids are public to anyone who
has the record, so if the lookup is UNSCOPED, an import that omits
``app_project_id`` matches — and would refresh — a borehole that lives in a
DIFFERENT app project. The lookup must always constrain ``app_project_id``: to
the given project, or to the null-project scope when none is given (never "any
project"). Mirrors the CPT pins in ``test_cpt_repository_scope.py``.

These pins inspect the compiled statement through a capturing fake session, so
they run without a database.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
)


class _CapturingSession:
    """Fake AsyncSession that records the statements passed to ``execute``."""

    def __init__(self) -> None:
        self.statements: list[object] = []

    async def execute(self, statement: object) -> object:
        """Record the statement and return an empty, iterable result."""
        self.statements.append(statement)

        class _Result:
            def scalar_one_or_none(self) -> None:
                return None

            def __iter__(self):
                return iter(())

        return _Result()


def _normalised_sql(statement: object) -> str:
    """Return the compiled statement as lowercase single-spaced SQL text."""
    return " ".join(str(statement).lower().split())


@pytest.mark.asyncio
async def test_find_by_project_test_with_no_project_constrains_to_null() -> None:
    """With no project id the single-lookup must be scoped to the NULL-project rows.

    The pre-fix statement carried no ``app_project_id`` clause at all, so it
    matched the same DOV ids in every project — the cross-project match.
    """
    session = _CapturingSession()
    repo = BoreholeRepository(session)  # type: ignore[arg-type]

    await repo.find_by_project_test("PROJ-123", "TEST-1", None)

    sql = _normalised_sql(session.statements[-1])
    assert "app_project_id is null" in sql, (
        "an unscoped duplicate lookup can match another project's borehole — "
        f"the None-scope statement must constrain app_project_id: {sql}"
    )


@pytest.mark.asyncio
async def test_find_by_project_test_with_a_project_scopes_to_it() -> None:
    """With a project id the single-lookup is constrained to it (guard, already true)."""
    session = _CapturingSession()
    repo = BoreholeRepository(session)  # type: ignore[arg-type]

    await repo.find_by_project_test("PROJ-123", "TEST-1", uuid4())

    sql = _normalised_sql(session.statements[-1])
    assert "app_project_id =" in sql, (
        f"a project-scoped lookup must constrain app_project_id to it: {sql}"
    )
    assert "app_project_id is null" not in sql


@pytest.mark.asyncio
async def test_find_existing_test_ids_with_no_project_constrains_to_null() -> None:
    """With no project id the batch dedup must be scoped to the NULL-project rows.

    The bulk path shares the leak: an unscoped ``IN (...)`` dedup matched the
    same DOV ids in every project.
    """
    session = _CapturingSession()
    repo = BoreholeRepository(session)  # type: ignore[arg-type]

    await repo.find_existing_test_ids("PROJ-123", ["TEST-1", "TEST-2"], None)

    sql = _normalised_sql(session.statements[-1])
    assert "app_project_id is null" in sql, (
        "an unscoped batch dedup can match another project's boreholes — "
        f"the None-scope statement must constrain app_project_id: {sql}"
    )


@pytest.mark.asyncio
async def test_find_existing_test_ids_with_a_project_scopes_to_it() -> None:
    """With a project id the batch dedup is constrained to it (guard, already true)."""
    session = _CapturingSession()
    repo = BoreholeRepository(session)  # type: ignore[arg-type]

    await repo.find_existing_test_ids("PROJ-123", ["TEST-1"], uuid4())

    sql = _normalised_sql(session.statements[-1])
    assert "app_project_id =" in sql, (
        f"a project-scoped batch dedup must constrain app_project_id to it: {sql}"
    )
    assert "app_project_id is null" not in sql
