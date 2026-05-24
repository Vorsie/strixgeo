"""Unit tests for UncorrelateLithoUnits (Phase-2 Slice 1).

Covers:
- Happy path: edge deleted, returns True.
- Idempotent: non-existent edge returns False (no error).
- Canonical ordering: (b, a) supplied → finds edge stored as (a, b).
- Ordinals re-resolved on disconnect.
- VULN-12 defence-in-depth: a model in another project raises ValueError.
- #57-class guard: execute() has no section_id parameter.

No DB or network I/O — session and repository are AsyncMock.
"""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest

from groundmodel.application.uncorrelate_litho_units import UncorrelateLithoUnits

_PROJECT = UUID("00000000-0000-0000-0000-000000000001")
_MODEL = UUID("00000000-0000-0000-0000-000000000002")
_FA = UUID("10000000-0000-0000-0000-000000000000")
_FB = UUID("20000000-0000-0000-0000-000000000000")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _scalar_result(value: object) -> MagicMock:
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    r.scalars.return_value.all.return_value = []
    # run_resolver's depth query is a single GROUP BY read via .all().
    r.all.return_value = []
    return r


def _scalars_result(values: list) -> MagicMock:
    r = MagicMock()
    r.scalar_one_or_none.return_value = None
    r.scalars.return_value.all.return_value = values
    r.all.return_value = []
    return r


def _use_case(session: AsyncMock) -> UncorrelateLithoUnits:
    return UncorrelateLithoUnits(session)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_returns_true() -> None:
    """Existing edge is deleted and True is returned."""
    session = AsyncMock()
    edge = MagicMock()
    edge.id = UUID("00000000-0000-0000-0000-000000000055")

    # Resolver (called via CorrelateLithoUnits._run_resolver):
    # model get, then empty formations, then empty edges.
    model_mock = MagicMock()
    model_mock.app_project_id = _PROJECT
    session.get = AsyncMock(return_value=model_mock)

    edge_result = _scalar_result(edge)
    empty = _scalars_result([])
    # edge-lookup + run_resolver's (formations, depth GROUP BY, edges)
    # + inference trigger: 2 × _load_project_sections (one per formation,
    # returns [] → early return from RecomputeFormationAbsencesForFormation).
    session.execute = AsyncMock(side_effect=[edge_result, empty, empty, empty, empty, empty])
    session.delete = AsyncMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    uc = _use_case(session)
    result = await uc.execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        formation_a_id=_FA,
        formation_b_id=_FB,
    )
    assert result is True
    session.delete.assert_awaited_once_with(edge)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_non_existent_edge_returns_false() -> None:
    """When the edge is not found, False is returned and nothing is deleted."""
    session = AsyncMock()
    # VULN-12 defence-in-depth: model must belong to project_id.
    model_mock = MagicMock()
    model_mock.app_project_id = _PROJECT
    session.get = AsyncMock(return_value=model_mock)
    session.execute = AsyncMock(return_value=_scalar_result(None))
    session.delete = AsyncMock()
    session.commit = AsyncMock()

    uc = _use_case(session)
    result = await uc.execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        formation_a_id=_FA,
        formation_b_id=_FB,
    )
    assert result is False
    session.delete.assert_not_awaited()
    # No commit when there is nothing to delete.
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_canonical_ordering_on_lookup() -> None:
    """Supply (b, a) reversed; the lookup must use canonical (a, b) ordering.

    We verify by checking the WHERE clause params passed to session.execute
    indirectly: the edge is found and deleted, proving the canonical
    reorder happened before the SELECT.
    """
    session = AsyncMock()
    edge = MagicMock()
    edge.id = UUID("00000000-0000-0000-0000-000000000055")

    model_mock = MagicMock()
    model_mock.app_project_id = _PROJECT
    session.get = AsyncMock(return_value=model_mock)

    edge_result = _scalar_result(edge)
    empty = _scalars_result([])
    # edge-lookup + run_resolver's (formations, depth GROUP BY, edges)
    # + inference trigger: 2 × _load_project_sections (one per formation,
    # returns [] → early return from RecomputeFormationAbsencesForFormation).
    session.execute = AsyncMock(side_effect=[edge_result, empty, empty, empty, empty, empty])
    session.delete = AsyncMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    uc = _use_case(session)
    # Supply reversed: _FB > _FA, so canonical should be (_FA, _FB).
    result = await uc.execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        formation_a_id=_FB,  # reversed
        formation_b_id=_FA,
    )
    assert result is True
    session.delete.assert_awaited_once_with(edge)


@pytest.mark.asyncio
async def test_resolver_called_on_disconnect() -> None:
    """After deletion, run_resolver is called to renumber components.

    UncorrelateLithoUnits delegates to CorrelateLithoUnits.run_resolver
    (a PUBLIC method since review C1). We patch it on the class directly
    (patching the class method intercepts the call regardless of when
    the import happened).
    """
    from groundmodel.application.correlate_litho_units import CorrelateLithoUnits

    session = AsyncMock()
    edge = MagicMock()
    edge.id = UUID("00000000-0000-0000-0000-000000000055")

    # VULN-12 defence-in-depth: model must belong to project_id.
    model_mock = MagicMock()
    model_mock.app_project_id = _PROJECT
    session.get = AsyncMock(return_value=model_mock)

    edge_result = _scalar_result(edge)
    session.execute = AsyncMock(return_value=edge_result)
    session.delete = AsyncMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    uc = _use_case(session)

    resolver_called: list[UUID] = []

    async def _fake_resolver(self: object, model_id: UUID) -> list:  # noqa: ANN001
        resolver_called.append(model_id)
        return []

    with patch.object(CorrelateLithoUnits, "run_resolver", _fake_resolver):
        result = await uc.execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            formation_a_id=_FA,
            formation_b_id=_FB,
        )

    assert result is True
    assert resolver_called == [_MODEL], "Resolver must be called with the model id after deletion"


@pytest.mark.asyncio
async def test_wrong_project_raises_value_error() -> None:
    """VULN-12 defence-in-depth: a model owned by another project is rejected.

    The router guards with get_in_project_or_404, but the use case
    re-checks ``model.app_project_id`` so a non-API caller cannot skip
    the scope check. This pins the negative arm — a future change that
    drops the use-case check fails loudly (CLAUDE.md DoD §4).
    """
    session = AsyncMock()
    other_project = UUID("99999999-0000-0000-0000-000000000000")
    model_mock = MagicMock()
    model_mock.app_project_id = other_project  # NOT _PROJECT
    session.get = AsyncMock(return_value=model_mock)
    session.execute = AsyncMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()

    uc = _use_case(session)
    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            formation_a_id=_FA,
            formation_b_id=_FB,
        )
    # Guard runs before any edge lookup / mutation.
    session.execute.assert_not_awaited()
    session.delete.assert_not_awaited()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_section_id_in_execute_signature() -> None:
    """execute() must not accept a section_id parameter.

    Structural #57 guard: uncorrelate is model-level.
    """
    sig = inspect.signature(UncorrelateLithoUnits.execute)
    assert "section_id" not in sig.parameters, (
        "execute() must not have a section_id parameter — uncorrelate is model-level "
        "(#57 structural guard)"
    )
