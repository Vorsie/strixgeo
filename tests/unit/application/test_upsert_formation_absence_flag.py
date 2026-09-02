"""``was_created`` flag unit tests for UpsertFormationAbsence (debt #116 C6).

Audit item C6 named ``upsert_formation_absence`` among the use cases with
untested skip-and-count branches. Its skip branch is the UPSERT conflict path:
``INSERT ... ON CONFLICT DO UPDATE`` on
``(formation_id, investigation_kind, investigation_id)`` — on conflict the
insert is SKIPPED, the existing row is updated, and the returned id is the
pre-existing one, so ``was_created`` is reported ``False``.

Scope note (honest): the ON CONFLICT resolution itself is Postgres-enforced
and only observable against a real DB. What these UNIT tests pin is the
use case's INTERPRETATION of the returned id — ``was_created = result_row ==
new_id`` — which is the branch that turns "same id came back" into "we did
NOT create". ``uuid7`` is patched to a known ``new_id`` and the returned id is
steered to reproduce both outcomes. A DB-level round-trip that actually
triggers the conflict would strengthen this; these are characterisation
GUARDS on the flag logic.

UA-F1 — the returned id equals the freshly-minted id → ``was_created=True``.
UA-F2 — the returned id differs (conflict resolved to an existing row) →
        ``was_created=False`` (the skip-insert branch).

The DB session is fully mocked — no DB or I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.upsert_formation_absence import UpsertFormationAbsence

PROJECT_ID = uuid4()
FORMATION_ID = uuid4()
INVESTIGATION_ID = uuid4()
NEW_ID = uuid4()  # the id ``uuid7`` is patched to mint for the INSERT
EXISTING_ID = uuid4()  # the id ON CONFLICT resolves to for an existing row


def _mocked_session(returned_absence_id: object) -> AsyncMock:
    """Build a mocked session that reaches the UPSERT and returns a chosen id.

    ``session.execute`` is called twice on the happy path: first for the
    investigation-scope lookup (``.scalar_one_or_none()`` → a truthy id so the
    guard passes), then for the UPSERT (``.scalar_one()`` → ``returned_absence_id``).
    """
    formation_stub = SimpleNamespace(app_project_id=PROJECT_ID)

    validate_result = MagicMock()
    validate_result.scalar_one_or_none = MagicMock(return_value=INVESTIGATION_ID)

    upsert_result = MagicMock()
    upsert_result.scalar_one = MagicMock(return_value=returned_absence_id)

    session = AsyncMock()
    session.get = AsyncMock(return_value=formation_stub)
    session.execute = AsyncMock(side_effect=[validate_result, upsert_result])
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_ua_f1_new_id_returned_means_created() -> None:
    """UA-F1: the UPSERT returned the freshly-minted id → ``was_created=True``."""
    session = _mocked_session(returned_absence_id=NEW_ID)
    uc = UpsertFormationAbsence(session)

    with patch(
        "groundmodel.application.upsert_formation_absence.uuid7",
        return_value=NEW_ID,
    ):
        result = await uc.execute(
            project_id=PROJECT_ID,
            formation_id=FORMATION_ID,
            investigation_id=INVESTIGATION_ID,
            investigation_kind="borehole",
            source="manual",
        )

    assert result.absence_id == NEW_ID
    assert result.was_created is True


@pytest.mark.asyncio
async def test_ua_f2_existing_id_returned_means_conflict_skipped_insert() -> None:
    """UA-F2: the UPSERT resolved to an existing row → ``was_created=False``.

    A different id came back than the one this call minted, so the INSERT was
    skipped and an existing absence was updated instead — the conflict/skip
    branch of the find-or-create.
    """
    session = _mocked_session(returned_absence_id=EXISTING_ID)
    uc = UpsertFormationAbsence(session)

    with patch(
        "groundmodel.application.upsert_formation_absence.uuid7",
        return_value=NEW_ID,
    ):
        result = await uc.execute(
            project_id=PROJECT_ID,
            formation_id=FORMATION_ID,
            investigation_id=INVESTIGATION_ID,
            investigation_kind="borehole",
            source="manual",
        )

    assert result.absence_id == EXISTING_ID
    assert result.was_created is False
