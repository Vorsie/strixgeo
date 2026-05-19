"""Unit tests for CreateFormationContact (debt #38).

The highest-frequency Phase-4 write path. These cover the domain
branches the pre-commit unit suite was previously blind to:

* the best-effort duplicate pre-check → ``DuplicateContactError``
* the race-loser path (``IntegrityError`` → re-query winner →
  ``DuplicateContactError``; or re-raise when it was a different
  constraint)
* the happy path flips the (model, formation) surface stale and commits

The DB session is mocked at the ``execute`` / ``commit`` / ``refresh``
boundary and the repository is swapped for an ``AsyncMock`` — no real
DB or network I/O (matches the convention in
``test_auto_populate_contacts_from_stratigraphy``).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from groundmodel.application.create_formation_contact import (
    CreateFormationContact,
    DuplicateContactError,
)

MODEL = uuid4()
FORMATION = uuid4()
BOREHOLE = uuid4()
PROJECT = uuid4()


def _execute_result(scalar: object | None) -> MagicMock:
    """A mock ``Result`` whose ``scalar_one_or_none()`` returns ``scalar``."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    return result


def _in_project(project_id: object) -> SimpleNamespace:
    """Return a stub ORM row whose ``app_project_id`` matches ``project_id``.

    The VULN-9 defence-in-depth checks call ``session.get()`` for the
    formation and the anchor (borehole / CPT) and verify their
    ``app_project_id``. These stubs satisfy that check so the rest of
    the use-case path is exercisable.
    """
    return SimpleNamespace(app_project_id=project_id)


def _use_case(session: AsyncMock) -> CreateFormationContact:
    uc = CreateFormationContact(session)
    # Swap the repo for a mock — the production __init__ built a real
    # GeologyRepository(session); we never want it to touch the DB.
    uc._repo = AsyncMock()
    return uc


@pytest.mark.asyncio
async def test_duplicate_precheck_raises_before_insert() -> None:
    """The best-effort pre-check raises DuplicateContactError, no insert."""
    existing = uuid4()
    session = AsyncMock()
    # session.get: formation check, then borehole check (VULN-9).
    session.get = AsyncMock(side_effect=[_in_project(PROJECT), _in_project(PROJECT)])
    session.execute = AsyncMock(return_value=_execute_result(existing))
    uc = _use_case(session)

    with pytest.raises(DuplicateContactError) as exc:
        await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            formation_id=FORMATION,
            depth_top_m=2.0,
            borehole_id=BOREHOLE,
        )

    assert exc.value.existing_contact_id == existing
    # Short-circuited — no insert, no stale flip, no commit.
    uc._repo.create_contact.assert_not_awaited()
    uc._repo.mark_surfaces_stale.assert_not_awaited()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_happy_path_flips_surface_stale_and_commits() -> None:
    """A clean insert flips the (model, formation) surface stale + commits."""
    contact = SimpleNamespace(id=uuid4())
    session = AsyncMock()
    # session.get: formation check, then borehole check (VULN-9).
    session.get = AsyncMock(side_effect=[_in_project(PROJECT), _in_project(PROJECT)])
    # Pre-check finds nothing.
    session.execute = AsyncMock(return_value=_execute_result(None))
    uc = _use_case(session)
    uc._repo.create_contact = AsyncMock(return_value=contact)

    result = await uc.execute(
        project_id=PROJECT,
        model_id=MODEL,
        formation_id=FORMATION,
        depth_top_m=2.0,
        borehole_id=BOREHOLE,
    )

    assert result is contact
    # On-click build pivot: mark stale, do NOT recompute.
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, FORMATION)])
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited_once_with(contact)


@pytest.mark.asyncio
async def test_race_loser_maps_integrity_error_to_duplicate() -> None:
    """IntegrityError + a re-query winner → DuplicateContactError(winner)."""
    winner = uuid4()
    cpt_id = uuid4()
    session = AsyncMock()
    # session.get: formation check, then CPT check (VULN-9).
    session.get = AsyncMock(side_effect=[_in_project(PROJECT), _in_project(PROJECT)])
    # 1st execute: pre-check finds nothing. 2nd execute (post-
    # IntegrityError re-query): the row that won the race.
    session.execute = AsyncMock(side_effect=[_execute_result(None), _execute_result(winner)])
    uc = _use_case(session)
    uc._repo.create_contact = AsyncMock(
        side_effect=IntegrityError("INSERT", {}, Exception("dup key"))
    )

    with pytest.raises(DuplicateContactError) as exc:
        await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            formation_id=FORMATION,
            depth_top_m=2.0,
            borehole_id=BOREHOLE,
        )

    assert exc.value.existing_contact_id == winner
    session.rollback.assert_awaited_once()
    uc._repo.mark_surfaces_stale.assert_not_awaited()


@pytest.mark.asyncio
async def test_integrity_error_from_other_constraint_is_reraised() -> None:
    """A non-uniqueness IntegrityError (no winner) is re-raised as-is."""
    cpt_id = uuid4()
    session = AsyncMock()
    # session.get: formation check, then CPT check (VULN-9).
    session.get = AsyncMock(side_effect=[_in_project(PROJECT), _in_project(PROJECT)])
    # Pre-check clean; re-query after IntegrityError also finds no
    # winner → it wasn't the uniqueness index, re-raise the original.
    session.execute = AsyncMock(side_effect=[_execute_result(None), _execute_result(None)])
    uc = _use_case(session)
    original = IntegrityError("INSERT", {}, Exception("fk violation"))
    uc._repo.create_contact = AsyncMock(side_effect=original)

    with pytest.raises(IntegrityError):
        await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            formation_id=FORMATION,
            depth_top_m=2.0,
            cpt_id=cpt_id,
        )
    session.rollback.assert_awaited_once()
