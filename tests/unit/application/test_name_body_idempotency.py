"""Idempotency-branch unit test for NameBody (debt #116 C6).

Audit item C6 named ``name_lens_body`` among the lens / companion / wedge-tip
use cases with untested skip-and-count branches. That use case was renamed to
``NameBody`` in the lens→body naming sweep (Slice 2; debt #216-#218) and now
lives in ``name_body.py``.

Its skip branch is the find-or-create idempotency guard: when a ``BodyOrm``
metadata row already exists for the ``(model_id, formation_id, body_ordinal)``
triple, the use case SKIPS the insert and updates the existing row in place,
returning ``was_created=False``. No second row is minted.

This is a characterisation GUARD, not a red-first pin — the branch already
ships; the test locks its observable contract (existing row updated, no new
row added, ``was_created=False``).

NB-I1 — an existing metadata row for the triple → the row's name is updated
        in place, ``was_created=False``, and ``session.add`` is never called.

The DB session is fully mocked — no DB or I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.name_body import NameBody

PROJECT_ID = uuid4()
MODEL_ID = uuid4()
FORMATION_ID = uuid4()
EXISTING_BODY_ID = uuid4()
BODY_ORDINAL = 0


@pytest.mark.asyncio
async def test_nb_i1_existing_row_is_updated_in_place_not_recreated() -> None:
    """NB-I1: an existing body metadata row is updated, not duplicated.

    The scope guards pass, the advisory partition lock is acquired
    uncontended, and the ``(model, formation, ordinal)`` lookup finds an
    existing row — so the use case updates that row's name and returns
    ``was_created=False`` without adding a new ``BodyOrm``.
    """
    model_stub = SimpleNamespace(app_project_id=PROJECT_ID)
    formation_stub = SimpleNamespace(app_project_id=PROJECT_ID)
    existing_body = SimpleNamespace(
        id=EXISTING_BODY_ID,
        name="Old label",
        primary_section_id=None,
    )

    async def _get(orm_class: object, id_val: object) -> object | None:
        class_name = getattr(orm_class, "__name__", "")
        if class_name == "GeologicalModelOrm":
            return model_stub
        if class_name == "GeologicalFormationOrm":
            return formation_stub
        return None

    # One result mock serves both ``session.execute`` calls in this path:
    #   * ``lock_body_partition`` → ``.scalar_one()`` (advisory lock acquired)
    #   * the (model, formation, ordinal) lookup → ``.scalar_one_or_none()``
    execute_result = MagicMock()
    execute_result.scalar_one = MagicMock(return_value=True)  # lock acquired
    execute_result.scalar_one_or_none = MagicMock(return_value=existing_body)

    session = AsyncMock()
    session.get = AsyncMock(side_effect=_get)
    session.execute = AsyncMock(return_value=execute_result)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    uc = NameBody(session)

    result = await uc.execute(
        project_id=PROJECT_ID,
        model_id=MODEL_ID,
        formation_id=FORMATION_ID,
        body_ordinal=BODY_ORDINAL,
        name="New label",
    )

    assert result.was_created is False
    assert result.body_id == EXISTING_BODY_ID
    # The existing row was mutated in place...
    assert existing_body.name == "New label"
    # ...and no new BodyOrm was inserted (the skip half of find-or-create).
    session.add.assert_not_called()
