"""Unit tests for BatchAcceptLithoSuggestions.

Pins the batch transaction contract that makes it the #153 lever:

B1  Every anchor is accepted with commit=False + defer_inference=True +
    section_id=None, and the session is committed exactly ONCE for the whole
    batch (not once per anchor).
B2  A per-anchor ValueError is recorded as an outcome error and the batch
    continues + still commits the successful anchors.
B3  Per-anchor results are returned in input order with the anchor identity
    echoed back.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.accept_litho_suggestions import AcceptLithoResult
from groundmodel.application.batch_accept_litho_suggestions import (
    BatchAcceptAnchorInput,
    BatchAcceptLithoSuggestions,
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
        "groundmodel.application.batch_accept_litho_suggestions.lock_body_partition", _noop_lock
    )
    monkeypatch.setattr(
        "groundmodel.application.batch_accept_litho_suggestions.lock_sibling_geotech_partitions",
        _noop_siblings,
    )


PROJECT = uuid4()
MODEL = uuid4()
CPT_A = uuid4()
CPT_B = uuid4()
CPT_C = uuid4()


def _accept_result(created_contact: object) -> AcceptLithoResult:
    return AcceptLithoResult(
        created_formation_ids=[uuid4()],
        found_formation_ids=[],
        created_contact_ids=[created_contact],
        found_contact_ids=[],
        updated_section_id=None,
    )


def _anchor(cpt_id) -> BatchAcceptAnchorInput:
    return BatchAcceptAnchorInput(suggestions=[object()], cpt_id=cpt_id)  # type: ignore[list-item]


@pytest.mark.asyncio
async def test_batch_commits_once_with_deferred_per_anchor() -> None:
    """B1: N anchors → N accept calls (commit=False, defer_inference) + ONE commit."""
    session = AsyncMock()
    uc = BatchAcceptLithoSuggestions(session)

    contact_ids = [uuid4(), uuid4(), uuid4()]
    with patch(
        "groundmodel.application.batch_accept_litho_suggestions.AcceptLithoSuggestions"
    ) as MockAccept:
        accept_instance = AsyncMock()
        accept_instance.execute = AsyncMock(side_effect=[_accept_result(c) for c in contact_ids])
        MockAccept.return_value = accept_instance

        result = await uc.execute(
            project_id=PROJECT,
            litho_model_id=MODEL,
            anchors=[_anchor(CPT_A), _anchor(CPT_B), _anchor(CPT_C)],
        )

    assert accept_instance.execute.await_count == 3
    for call in accept_instance.execute.await_args_list:
        assert call.kwargs["commit"] is False
        assert call.kwargs["defer_inference"] is True
        assert call.kwargs["section_id"] is None
    # The batch's own single commit (the accept calls used commit=False).
    session.commit.assert_awaited_once()
    assert result.committed is True
    assert [o.cpt_id for o in result.outcomes] == [CPT_A, CPT_B, CPT_C]


@pytest.mark.asyncio
async def test_value_error_anchor_recorded_and_batch_continues() -> None:
    """B2: a failing anchor is recorded with its error; others still commit."""
    session = AsyncMock()
    uc = BatchAcceptLithoSuggestions(session)

    with patch(
        "groundmodel.application.batch_accept_litho_suggestions.AcceptLithoSuggestions"
    ) as MockAccept:
        accept_instance = AsyncMock()
        accept_instance.execute = AsyncMock(
            side_effect=[
                _accept_result(uuid4()),
                ValueError("CPT not found in project"),
                _accept_result(uuid4()),
            ]
        )
        MockAccept.return_value = accept_instance

        result = await uc.execute(
            project_id=PROJECT,
            litho_model_id=MODEL,
            anchors=[_anchor(CPT_A), _anchor(CPT_B), _anchor(CPT_C)],
        )

    # All three attempted, one commit despite the failure.
    assert accept_instance.execute.await_count == 3
    session.commit.assert_awaited_once()
    assert result.outcomes[0].error is None
    assert result.outcomes[1].error == "CPT not found in project"
    assert result.outcomes[1].result is None
    assert result.outcomes[2].error is None


@pytest.mark.asyncio
async def test_empty_batch_is_noop_commit() -> None:
    """B3 edge: no anchors → no accept calls, still a clean commit, empty outcomes."""
    session = AsyncMock()
    uc = BatchAcceptLithoSuggestions(session)

    with patch(
        "groundmodel.application.batch_accept_litho_suggestions.AcceptLithoSuggestions"
    ) as MockAccept:
        accept_instance = AsyncMock()
        MockAccept.return_value = accept_instance

        result = await uc.execute(project_id=PROJECT, litho_model_id=MODEL, anchors=[])

    accept_instance.execute.assert_not_awaited()
    session.commit.assert_awaited_once()
    assert result.outcomes == []
