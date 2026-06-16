"""Scope-guard unit tests for CreatePerpendicularCompanion (#211 DRY-01).

The model-scope guard in ``CreatePerpendicularCompanion.execute`` was migrated
from a hand-rolled ``is None or app_project_id != project_id`` check to the
shared ``load_scoped_or_raise`` helper.  That raise path was previously
exercised only indirectly (and only on the happy path) via the
``materialise_body_companions`` integration test, so these two cases pin the
behaviour the migration must preserve:

CC-S1 — the geological model belongs to another project → ValueError, no commit.
CC-S2 — the geological model does not exist → ValueError, no commit.

In both cases the lens (body) row passes its own scope check, so execution
reaches the model guard.  The DB session is fully mocked — no DB or I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.create_perpendicular_companion import (
    CreatePerpendicularCompanion,
)

PROJECT_ID = uuid4()
OTHER_PROJECT_ID = uuid4()
MODEL_ID = uuid4()
BODY_ID = uuid4()


def _make_session(*, model_project_id: object | None, model_exists: bool) -> AsyncMock:
    """Build a mocked AsyncSession that reaches the model-scope guard.

    The body row (``BodyOrm``, imported as ``LithoLensOrm``) always passes its
    own check — right project, right model.  ``session.get`` for the model
    returns a stub whose ``app_project_id`` is ``model_project_id`` when
    ``model_exists`` is True, else None (the not-found branch).
    """
    body_stub = SimpleNamespace(app_project_id=PROJECT_ID, model_id=MODEL_ID)
    model_stub = SimpleNamespace(app_project_id=model_project_id) if model_exists else None

    async def _get(orm_class: object, id_val: object) -> object | None:  # noqa: ANN001
        class_name = getattr(orm_class, "__name__", "")
        # BodyOrm is imported into the use case under the alias LithoLensOrm.
        if class_name == "BodyOrm":
            return body_stub if id_val == BODY_ID else None
        if class_name == "GeologicalModelOrm":
            return model_stub if id_val == MODEL_ID else None
        return None

    session = AsyncMock()
    session.get = AsyncMock(side_effect=_get)
    session.commit = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_cc_s1_model_in_other_project_raises_value_error() -> None:
    """CC-S1: a model owned by another project is rejected before any mutation."""
    session = _make_session(model_project_id=OTHER_PROJECT_ID, model_exists=True)
    uc = CreatePerpendicularCompanion(session)

    # Match the model message specifically — the lens guard's message also
    # contains "not found in project", so target "Geological model" to prove
    # execution reached the migrated model guard.
    with pytest.raises(ValueError, match="Geological model"):
        await uc.execute(project_id=PROJECT_ID, model_id=MODEL_ID, body_id=BODY_ID)

    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_cc_s2_missing_model_raises_value_error() -> None:
    """CC-S2: a non-existent model id is rejected (same message as wrong-project)."""
    session = _make_session(model_project_id=None, model_exists=False)
    uc = CreatePerpendicularCompanion(session)

    with pytest.raises(ValueError, match="Geological model"):
        await uc.execute(project_id=PROJECT_ID, model_id=MODEL_ID, body_id=BODY_ID)

    session.commit.assert_not_awaited()
