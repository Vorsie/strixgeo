"""Unit tests for ResolveLithoInstances use case (Phase-2 Slice 3).

Covers:
  R1 — Happy path: delegates to _run_resolver, commits, returns updates.
  R2 — Idempotent no-op: when _run_resolver returns empty, updated is [].
  R3 — execute() signature has no section_id (structural #57 guard).
  R4 — The use case does NOT duplicate resolution logic — it calls
       _run_resolver, not the pure domain service inline.

No DB or network I/O — session and helpers are AsyncMock.
"""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
    ResolveResult,
)

_MODEL = UUID("00000000-0000-0000-0000-000000000002")
_FA = UUID("10000000-0000-0000-0000-000000000000")
_FB = UUID("20000000-0000-0000-0000-000000000000")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_use_case(session: AsyncMock) -> ResolveLithoInstances:
    """Return a ResolveLithoInstances with a mocked session."""
    return ResolveLithoInstances(session)


# ---------------------------------------------------------------------------
# R1 — happy path: delegates and commits
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_r1_delegates_to_run_resolver_and_commits() -> None:
    """execute() calls _run_resolver with (session, model_id) and commits the session.

    The use case must NOT re-implement resolution logic — it is a thin
    wrapper around the shared ``_run_resolver`` helper.
    """
    session = AsyncMock()
    session.commit = AsyncMock()

    raw_updates = [
        {"formation_id": str(_FA), "new_ordinal": 1},
        {"formation_id": str(_FB), "new_ordinal": 2},
    ]

    with patch(
        "groundmodel.application.resolve_litho_instances_use_case._run_resolver",
        # _run_resolver returns (changes, displaced_names, inert_union_pairs,
        # suppressed_union_pairs): lineage adoption (owner 2026-08-12: oldest name
        # wins) + the visible-union outcomes (debt #278).
        new=AsyncMock(return_value=(raw_updates, (), (), ())),
    ) as mock_run_resolver:
        uc = _make_use_case(session)
        result = await uc.execute(model_id=_MODEL)

    # _run_resolver was called with the session + correct model_id, defaulting to
    # stale_solids=True (the geometry-changing path stales the 3-D cache).
    mock_run_resolver.assert_awaited_once_with(session, _MODEL, stale_solids=True)

    # Session was committed after the resolver ran.
    session.commit.assert_awaited_once()

    # Result carries the two updates.
    assert isinstance(result, ResolveResult)
    assert len(result.updated) == 2
    update_map = {u.formation_id: u.new_ordinal for u in result.updated}
    assert update_map[_FA] == 1
    assert update_map[_FB] == 2


# ---------------------------------------------------------------------------
# R2 — idempotent no-op
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_r2_idempotent_noop_returns_empty_list() -> None:
    """When _run_resolver returns [], updated is [] and the session is still committed."""
    session = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.application.resolve_litho_instances_use_case._run_resolver",
        new=AsyncMock(return_value=([], (), (), ())),
    ):
        uc = _make_use_case(session)
        result = await uc.execute(model_id=_MODEL)

    assert result.updated == []
    # Commit still fires so the session is cleanly closed even on no-ops.
    session.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# R3 — structural #57 guard: no section_id parameter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_r5_forwards_stale_solids_flag_to_run_resolver() -> None:
    """execute(stale_solids=...) forwards the flag to _run_resolver; default is True.

    D3 (owner 2026-09-01): a body-identity-only resolve (a Join / Un-join) must NOT
    stale the 3-D solids — the voxel geometry is unchanged, only body grouping — so
    the union endpoints call ``execute(stale_solids=False)``. Every other caller
    keeps the default ``True`` so a geometry-changing resolve still stales.
    """
    session = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.application.resolve_litho_instances_use_case._run_resolver",
        new=AsyncMock(return_value=([], (), (), ())),
    ) as mock_run_resolver:
        uc = _make_use_case(session)
        # Identity-only path: the flag threads straight through to _run_resolver.
        await uc.execute(model_id=_MODEL, stale_solids=False)
    mock_run_resolver.assert_awaited_once_with(session, _MODEL, stale_solids=False)

    with patch(
        "groundmodel.application.resolve_litho_instances_use_case._run_resolver",
        new=AsyncMock(return_value=([], (), (), ())),
    ) as mock_run_resolver:
        uc = _make_use_case(session)
        # Default: geometry-changing callers still stale the solids.
        await uc.execute(model_id=_MODEL)
    mock_run_resolver.assert_awaited_once_with(session, _MODEL, stale_solids=True)


def test_r3_no_section_id_in_execute_signature() -> None:
    """execute() must not accept a section_id argument.

    Structural guard: correlations are MODEL-level — the #57
    applyUpdatedSection trap structurally cannot recur when there is no
    section in scope.
    """
    sig = inspect.signature(ResolveLithoInstances.execute)
    assert "section_id" not in sig.parameters, (
        "ResolveLithoInstances.execute() must not have a section_id parameter — "
        "resolve is model-level (#57 structural guard)"
    )

    # ResolveResult must also be free of section artefacts.
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(ResolveResult)}
    assert "seeded_formation_contact_ids" not in field_names
    assert "updated_section" not in field_names
    assert "section_id" not in field_names

    # The delegation-to-_run_resolver contract is covered behaviourally by R1
    # (mocks _run_resolver and asserts it is awaited). The previous R4 test
    # asserted on the source text of execute() (``"deque" not in src``) — an
    # impl-shaped canary that a legitimate refactor would break while a broken
    # resolver could pass; removed in favour of the behavioural R1/R2 + the
    # domain resolver's own unit tests.
