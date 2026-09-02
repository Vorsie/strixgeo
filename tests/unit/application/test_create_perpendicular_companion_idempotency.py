"""Idempotency-guard unit test for CreatePerpendicularCompanion (debt #116 C6).

Audit item C6: the lens / companion / wedge-tip mutation use cases have
untested skip-and-count branches. For ``CreatePerpendicularCompanion`` the
skip branch is the single-companion idempotency guard (step 2 of the
algorithm): when the body already owns a companion section, the use case
SKIPS creation and returns the existing row with ``already_existed=True``
rather than minting a duplicate.

This is a characterisation GUARD, not a red-first pin — the branch already
ships; the test locks its observable contract (existing row returned, no new
section created, no commit) so a refactor cannot silently start duplicating.

CC-I1 — a body that already has a companion → the existing row is returned,
        ``already_existed=True``, and the create/commit path is never reached.

The DB session is fully mocked — no DB or I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.create_perpendicular_companion import (
    CreatePerpendicularCompanion,
)

PROJECT_ID = uuid4()
MODEL_ID = uuid4()
BODY_ID = uuid4()
EXISTING_COMPANION_ID = uuid4()


@pytest.mark.asyncio
async def test_cc_i1_existing_companion_is_returned_without_creating() -> None:
    """CC-I1: a body that already owns a companion skips creation.

    The idempotency guard queries for an existing companion and, finding one,
    returns it with ``already_existed=True``. Nothing is created and nothing
    is committed — the guard fires before the repository is even instantiated.
    """
    body_stub = SimpleNamespace(app_project_id=PROJECT_ID, model_id=MODEL_ID)
    model_stub = SimpleNamespace(app_project_id=PROJECT_ID)
    existing_companion = SimpleNamespace(id=EXISTING_COMPANION_ID)

    async def _get(orm_class: object, id_val: object) -> object | None:
        class_name = getattr(orm_class, "__name__", "")
        if class_name == "BodyOrm":
            return body_stub if id_val == BODY_ID else None
        if class_name == "GeologicalModelOrm":
            return model_stub if id_val == MODEL_ID else None
        return None

    # The idempotency query runs through ``session.execute(...).scalar_one_or_none()``
    # and must surface the existing companion row.
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=existing_companion)

    session = AsyncMock()
    session.get = AsyncMock(side_effect=_get)
    session.execute = AsyncMock(return_value=execute_result)
    session.commit = AsyncMock()

    uc = CreatePerpendicularCompanion(session)

    # Patch the repository so an accidental fall-through to creation would be
    # loudly visible rather than silently minting a real row.
    with patch(
        "groundmodel.application.create_perpendicular_companion.CrossSectionRepository"
    ) as MockRepo:
        result = await uc.execute(project_id=PROJECT_ID, model_id=MODEL_ID, body_id=BODY_ID)

    assert result.already_existed is True
    assert result.companion_section is existing_companion
    # Skip-branch invariants: no creation, no commit.
    MockRepo.assert_not_called()
    session.commit.assert_not_awaited()
