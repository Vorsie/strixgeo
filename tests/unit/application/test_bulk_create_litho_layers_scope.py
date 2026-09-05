"""Unit tests for BulkCreateLithoLayers formation-ownership scope guard (debt #211-a).

The rule being locked:
    When formation_id on any LithoLayerCreateRequest does not belong to the
    same app_project_id as project_id, the use case MUST raise ValueError
    before any DB writes.  An id from a foreign project must not be silently
    accepted — the FK only enforces existence, not ownership.

Test cases:
    B1 — happy path: formation belongs to project → rows created.
    B2 — formation from a different project → ValueError, no rows created.
    B3 — formation not found (session.get returns None) → ValueError, no rows created.
    B4 — empty layer list with any project_id → no-op, returns [].
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.bulk_create_litho_layers import (
    BulkCreateLithoLayers,
    LithoLayerCreateRequest,
)


@pytest.fixture(autouse=True)
def _neutralize_body_partition_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralise the body-partition advisory lock for these mocked-session tests.

    These predate the lock and mock the session, which has nothing to answer the
    lock's real DB calls (``pg_advisory_xact_lock`` + the sibling-geotech SELECT).
    The lock is infrastructure orthogonal to what they assert; its
    order-of-acquisition invariant is pinned separately in
    ``test_litho_write_lock_order.py`` (BP-4).
    """

    async def _noop_lock(*_a: object, **_k: object) -> None:
        return None

    async def _noop_siblings(*_a: object, **_k: object) -> list:
        return []

    monkeypatch.setattr(
        "groundmodel.application.bulk_create_litho_layers.lock_body_partition", _noop_lock
    )
    monkeypatch.setattr(
        "groundmodel.application.bulk_create_litho_layers.lock_sibling_geotech_partitions",
        _noop_siblings,
    )


MODEL = uuid4()
PROJECT = uuid4()
OTHER_PROJECT = uuid4()
FORMATION = uuid4()


def _request(formation_id=FORMATION) -> LithoLayerCreateRequest:
    return LithoLayerCreateRequest(
        formation_id=formation_id,
        depth_top_m=0.0,
        depth_base_m=1.0,
    )


def _formation(project_id=PROJECT) -> SimpleNamespace:
    return SimpleNamespace(app_project_id=project_id, id=FORMATION)


# ---------------------------------------------------------------------------
# B1 — happy path: formation in the correct project
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_b1_formation_in_project_creates_rows() -> None:
    """Formation belongs to project → BulkCreateLithoLayers succeeds and returns rows."""
    formation = _formation(PROJECT)
    session = AsyncMock()
    session.get = AsyncMock(return_value=formation)
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    # ``session.add`` is SYNCHRONOUS on AsyncSession — a MagicMock, not an
    # AsyncMock, or the un-awaited coroutine trips "coroutine was never awaited".
    session.add = MagicMock()

    uc = BulkCreateLithoLayers(session)
    # Patch _session.refresh to no-op (the refresh would fail without a real row).
    with patch.object(session, "refresh", new=AsyncMock()):
        result = await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            layers=[_request()],
        )

    assert isinstance(result, list)
    assert len(result) == 1
    session.flush.assert_awaited()
    session.commit.assert_awaited()


# ---------------------------------------------------------------------------
# B2 — formation from a different project → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_b2_formation_from_foreign_project_raises() -> None:
    """Formation belongs to a different project → ValueError before any write."""
    # The bug (before the fix): this would silently accept the row.
    # After the fix: raises ValueError.
    formation = _formation(OTHER_PROJECT)  # wrong project
    session = AsyncMock()
    session.get = AsyncMock(return_value=formation)

    uc = BulkCreateLithoLayers(session)

    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            layers=[_request()],
        )

    session.flush.assert_not_awaited()
    session.commit.assert_not_awaited()


# ---------------------------------------------------------------------------
# B3 — formation not found → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_b3_formation_not_found_raises() -> None:
    """Formation id does not exist → ValueError (same message — no oracle for attacker)."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=None)

    uc = BulkCreateLithoLayers(session)

    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(
            project_id=PROJECT,
            model_id=MODEL,
            layers=[_request()],
        )

    session.flush.assert_not_awaited()
    session.commit.assert_not_awaited()


# ---------------------------------------------------------------------------
# B4 — empty list is always a no-op (scope check not reached)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_b4_empty_layers_is_noop() -> None:
    """Empty layer list returns [] without touching the DB or checking formations."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=None)  # would raise if called

    uc = BulkCreateLithoLayers(session)
    result = await uc.execute(project_id=PROJECT, model_id=MODEL, layers=[])

    assert result == []
    session.get.assert_not_called()
    session.commit.assert_not_awaited()
