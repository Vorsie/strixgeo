"""The CPT duplicate lookup must be scoped to the request's project.

``ImportCpt`` finds a duplicate by the GEF ``#PROJECTID`` + ``#TESTID`` before a
refresh-on-duplicate overwrite. Those two ids are public to anyone who has the
file, so if the lookup is UNSCOPED, a ``confirm_refresh=true`` import that omits
``project_id`` matches — and overwrites — a CPT that lives in a DIFFERENT app
project. The lookup must always constrain ``app_project_id``: to the given
project, or to the null-project scope when none is given (never "any project").

These pins inspect the compiled statement through a capturing fake session, so
they run without a database.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository


class _CapturingSession:
    """Fake AsyncSession that records the statements passed to ``execute``."""

    def __init__(self) -> None:
        self.statements: list[object] = []

    async def execute(self, statement: object) -> object:
        """Record the statement and return an empty result."""
        self.statements.append(statement)

        class _Scalars:
            def all(self) -> list[object]:
                return []

        class _Result:
            def scalar_one_or_none(self) -> None:
                return None

            def scalars(self) -> _Scalars:
                return _Scalars()

        return _Result()


def _normalised_sql(statement: object) -> str:
    """Return the compiled statement as lowercase single-spaced SQL text."""
    return " ".join(str(statement).lower().split())


@pytest.mark.asyncio
async def test_no_project_scope_constrains_to_null_not_all_projects() -> None:
    """With no project id the lookup must be scoped to the NULL-project rows.

    The pre-fix statement carried no ``app_project_id`` clause at all, so it
    matched the same GEF ids in every project — the cross-project overwrite.
    """
    session = _CapturingSession()
    repo = CptRepository(session)  # type: ignore[arg-type]

    await repo.find_by_project_test("PROJ-123", "TEST-1", None)

    sql = _normalised_sql(session.statements[-1])
    assert "app_project_id is null" in sql, (
        "an unscoped duplicate lookup can overwrite another project's CPT — "
        f"the None-scope statement must constrain app_project_id: {sql}"
    )


@pytest.mark.asyncio
async def test_a_project_id_scopes_the_lookup_to_that_project() -> None:
    """With a project id the lookup is constrained to it (guard, already true)."""
    session = _CapturingSession()
    repo = CptRepository(session)  # type: ignore[arg-type]

    await repo.find_by_project_test("PROJ-123", "TEST-1", uuid4())

    sql = _normalised_sql(session.statements[-1])
    assert "app_project_id =" in sql, (
        f"a project-scoped lookup must constrain app_project_id to it: {sql}"
    )
    assert "app_project_id is null" not in sql
