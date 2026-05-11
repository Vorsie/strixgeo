"""Integration tests for ``InvestigationReviewRepository``.

Per-(project, investigation) decisions: status, notes, hidden flag.
The repo's distinguishing API is the target-keyed upsert
(``set_for_target``) — the UI doesn't track review row ids, only the
investigation a decision belongs to.

Requires the Docker DB on localhost:5433.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.base import Base
from groundmodel.infrastructure.db.models.investigation_review_orm import (
    InvestigationReviewOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.investigation_review_repository import (
    InvestigationReviewRepository,
)


async def _make_project(db_session: AsyncSession, *, name: str = "Reviews test") -> ProjectOrm:
    """Insert a bare project + commit; returns the row."""
    project = ProjectOrm(id=uuid7(), name=name, status="active")
    db_session.add(project)
    await db_session.commit()
    return project


# ---------------------------------------------------------------------------
# set_for_target — the dominant write path.
# ---------------------------------------------------------------------------


async def test_set_for_target_inserts_when_no_row_exists(
    db_session: AsyncSession,
) -> None:
    """First decision on an investigation creates a fresh row."""
    project = await _make_project(db_session)
    repo = InvestigationReviewRepository(db_session)
    target = uuid7()

    row = await repo.set_for_target(
        project.id,
        "cpt",
        target,
        {"review_status": "reviewed", "review_notes": "GW level confirmed"},
    )
    await db_session.commit()

    assert row.target_kind == "cpt"
    assert row.target_id == target
    assert row.review_status == "reviewed"
    assert row.review_notes == "GW level confirmed"
    assert row.is_hidden is False
    # Status moved to 'reviewed' on insert → reviewed_at is stamped.
    assert row.reviewed_at is not None


async def test_set_for_target_updates_existing_row(db_session: AsyncSession) -> None:
    """Second call on the same target updates in place — same id."""
    project = await _make_project(db_session)
    repo = InvestigationReviewRepository(db_session)
    target = uuid7()

    first = await repo.set_for_target(
        project.id, "borehole", target, {"review_status": "in_progress"}
    )
    await db_session.commit()

    second = await repo.set_for_target(
        project.id,
        "borehole",
        target,
        {"review_notes": "Mid-review notes"},
    )
    await db_session.commit()

    assert second.id == first.id
    assert second.review_status == "in_progress"  # unchanged
    assert second.review_notes == "Mid-review notes"


async def test_status_transition_to_reviewed_stamps_timestamp(
    db_session: AsyncSession,
) -> None:
    """Transition into 'reviewed' stamps reviewed_at; back out clears it."""
    project = await _make_project(db_session)
    repo = InvestigationReviewRepository(db_session)
    target = uuid7()

    # Start unreviewed — no timestamp.
    await repo.set_for_target(project.id, "cpt", target, {"review_status": "unreviewed"})
    await db_session.commit()
    row = await repo.get_for_target("cpt", target)
    assert row is not None and row.reviewed_at is None

    # Move to reviewed — timestamp appears.
    await repo.set_for_target(project.id, "cpt", target, {"review_status": "reviewed"})
    await db_session.commit()
    row = await repo.get_for_target("cpt", target)
    assert row is not None and row.reviewed_at is not None

    # Back to in_progress — timestamp re-NULLs.
    await repo.set_for_target(project.id, "cpt", target, {"review_status": "in_progress"})
    await db_session.commit()
    row = await repo.get_for_target("cpt", target)
    assert row is not None and row.reviewed_at is None


async def test_set_for_target_only_writes_keys_in_patch(
    db_session: AsyncSession,
) -> None:
    """Patch with one field leaves siblings untouched."""
    project = await _make_project(db_session)
    repo = InvestigationReviewRepository(db_session)
    target = uuid7()

    await repo.set_for_target(
        project.id,
        "borehole",
        target,
        {
            "review_status": "reviewed",
            "review_notes": "original notes",
            "is_hidden": True,
        },
    )
    await db_session.commit()

    # Patch only is_hidden — notes + status survive.
    await repo.set_for_target(project.id, "borehole", target, {"is_hidden": False})
    await db_session.commit()

    row = await repo.get_for_target("borehole", target)
    assert row is not None
    assert row.review_status == "reviewed"
    assert row.review_notes == "original notes"
    assert row.is_hidden is False


async def test_set_for_target_rejects_invalid_kind(db_session: AsyncSession) -> None:
    """Unknown target_kind raises ValueError before touching the DB."""
    project = await _make_project(db_session)
    repo = InvestigationReviewRepository(db_session)
    with pytest.raises(ValueError, match="target_kind"):
        await repo.set_for_target(project.id, "lab_test", uuid7(), {})


async def test_set_for_target_rejects_invalid_status(db_session: AsyncSession) -> None:
    """Unknown review_status raises ValueError before touching the DB."""
    project = await _make_project(db_session)
    repo = InvestigationReviewRepository(db_session)
    with pytest.raises(ValueError, match="review_status"):
        await repo.set_for_target(project.id, "cpt", uuid7(), {"review_status": "done"})


# ---------------------------------------------------------------------------
# get / list / delete
# ---------------------------------------------------------------------------


async def test_get_for_target_returns_none_when_absent(
    db_session: AsyncSession,
) -> None:
    """No row yet for the target → ``None``."""
    repo = InvestigationReviewRepository(db_session)
    assert await repo.get_for_target("cpt", uuid7()) is None


async def test_list_all_returns_only_this_projects_rows(
    db_session: AsyncSession,
) -> None:
    """Reviews from project A don't leak into project B's list."""
    a = await _make_project(db_session, name="A")
    b = await _make_project(db_session, name="B")
    repo = InvestigationReviewRepository(db_session)

    await repo.set_for_target(a.id, "cpt", uuid7(), {"review_status": "reviewed"})
    await repo.set_for_target(a.id, "borehole", uuid7(), {"review_status": "in_progress"})
    await repo.set_for_target(b.id, "cpt", uuid7(), {"review_status": "reviewed"})
    await db_session.commit()

    for_a = await repo.list_all(a.id)
    for_b = await repo.list_all(b.id)
    assert len(for_a) == 2
    assert len(for_b) == 1
    assert all(r.app_project_id == a.id for r in for_a)
    assert all(r.app_project_id == b.id for r in for_b)


async def test_delete_returns_true_then_row_is_gone(db_session: AsyncSession) -> None:
    """Delete by id removes the row; subsequent get returns None."""
    project = await _make_project(db_session)
    repo = InvestigationReviewRepository(db_session)
    target = uuid7()
    row = await repo.set_for_target(project.id, "cpt", target, {"review_status": "reviewed"})
    await db_session.commit()

    deleted = await repo.delete(row.id)
    await db_session.commit()
    assert deleted is True
    assert await repo.get_for_target("cpt", target) is None


async def test_delete_returns_false_for_missing(db_session: AsyncSession) -> None:
    """Repeated delete is a no-op at the boolean level."""
    repo = InvestigationReviewRepository(db_session)
    assert await repo.delete(uuid7()) is False


# ---------------------------------------------------------------------------
# Defence-in-depth: DB UNIQUE constraint catches collisions even when the
# repository's per-target check is bypassed.
# ---------------------------------------------------------------------------


async def test_unique_constraint_blocks_duplicate_target_rows(
    db_session: AsyncSession,
) -> None:
    """Two raw INSERTs for the same (target_kind, target_id) fail at commit."""
    project = await _make_project(db_session)
    target = uuid7()
    db_session.add_all(
        [
            InvestigationReviewOrm(
                id=uuid7(),
                app_project_id=project.id,
                target_kind="cpt",
                target_id=target,
                review_status="reviewed",
                is_hidden=False,
            ),
            InvestigationReviewOrm(
                id=uuid7(),
                app_project_id=project.id,
                target_kind="cpt",
                target_id=target,
                review_status="reviewed",
                is_hidden=False,
            ),
        ]
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


# ---------------------------------------------------------------------------
# Sanity-pin so SQLAlchemy's metadata registers the ORM class for the
# integration suite (same trick as the cross_section + geology tests).
# ---------------------------------------------------------------------------


async def test_orm_import_is_pinned() -> None:
    """The ORM class is wired into SQLAlchemy's metadata.

    Without an import somewhere in the test suite, SQLAlchemy's
    Declarative registry wouldn't see the class and the integration
    suite would skip the table at create_all() time. The assertion on
    Base.metadata pins the wiring concretely instead of trusting the
    side effect of the import statement above.
    """
    assert InvestigationReviewOrm.__tablename__ == "investigation_review"
    assert "investigation_review" in Base.metadata.tables
