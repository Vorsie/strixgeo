"""Unit tests for ClearBodyBoundaries (the "Reset manual points" bulk clear).

The use case issues one bulk DELETE on ``body_boundary_shape`` filtered by the
model's denormalised ``model_id`` column, then commits.  Its DB interaction is
mocked at the ``session.execute`` boundary; the row-count returned by that
statement becomes ``shapes_deleted``.  End-to-end persistence + node CASCADE is
covered by the integration test.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.clear_body_boundaries import (
    ClearBodyBoundaries,
    ClearBodyBoundariesResult,
)

MODEL_ID: UUID = uuid4()


@pytest.mark.asyncio
async def test_clear_returns_deleted_count_and_commits() -> None:
    """The use case reports the DELETE rowcount and commits the transaction."""
    session = MagicMock()
    execute_result = MagicMock()
    execute_result.rowcount = 7  # 7 hand-shaped bodies (the owner's leftover overrides)
    session.execute = AsyncMock(return_value=execute_result)
    session.commit = AsyncMock()

    result = await ClearBodyBoundaries(session).execute(model_id=MODEL_ID)

    assert result == ClearBodyBoundariesResult(shapes_deleted=7)
    session.execute.assert_awaited_once()
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_clear_is_idempotent_on_empty_model() -> None:
    """A model with no stored shapes returns 0 (not an error)."""
    session = MagicMock()
    execute_result = MagicMock()
    execute_result.rowcount = 0
    session.execute = AsyncMock(return_value=execute_result)
    session.commit = AsyncMock()

    result = await ClearBodyBoundaries(session).execute(model_id=MODEL_ID)

    assert result.shapes_deleted == 0
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_clear_handles_none_rowcount() -> None:
    """A driver returning rowcount=None coerces to 0 rather than raising."""
    session = MagicMock()
    execute_result = MagicMock()
    execute_result.rowcount = None
    session.execute = AsyncMock(return_value=execute_result)
    session.commit = AsyncMock()

    result = await ClearBodyBoundaries(session).execute(model_id=MODEL_ID)

    assert result.shapes_deleted == 0
