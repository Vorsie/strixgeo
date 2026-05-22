"""Unit tests for PropagateLithoAdmixtures (admixture propagation use case).

Cases
-----
P1  Seed-only (no edges) — updates exactly the seed formation.
P2  Linear chain A-B-C — all three formations get the new admixtures.
P3  Model not in project → ValueError.
P4  Model wrong kind (geological) → ValueError.
P5  Seed formation not in project → ValueError.
P6  Seed has no litho_main_soil_code → ValueError.
P7  Empty admixtures list → clears admixtures on every formation in the component.
P8  Commit is called once after the flush (single transaction).

No DB or network I/O — session and all DB objects are Mocks.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch
from uuid import UUID

import pytest

from groundmodel.application.propagate_litho_admixtures import PropagateLithoAdmixtures

_PROJECT = UUID("00000000-0000-0000-0000-000000000001")
_MODEL = UUID("00000000-0000-0000-0000-000000000002")
_FA = UUID("aaaaaaaa-0000-0000-0000-000000000000")
_FB = UUID("bbbbbbbb-0000-0000-0000-000000000000")
_FC = UUID("cccccccc-0000-0000-0000-000000000000")

_ADMIXTURES = [{"soil_code": "KL", "amount": "M", "locally": False}]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_model(kind: str = "lithostratigraphic", project_id: UUID = _PROJECT) -> MagicMock:
    m = MagicMock()
    m.app_project_id = project_id
    m.kind = kind
    return m


def _make_formation(fid: UUID, project_id: UUID = _PROJECT, soil: str = "ZAND") -> MagicMock:
    f = MagicMock()
    f.id = fid
    f.app_project_id = project_id
    f.litho_main_soil_code = soil
    f.litho_admixtures = None
    return f


def _make_edge(a: UUID, b: UUID) -> MagicMock:
    e = MagicMock()
    e.formation_a_id = a
    e.formation_b_id = b
    return e


def _scalar_list_result(values: list) -> MagicMock:
    """Mock for session.execute() returning a scalars().all() list."""
    r = MagicMock()
    r.scalars.return_value.all.return_value = values
    return r


def _make_session(
    model: object,
    seed_formation: object,
    edge_rows: list,
    formation_rows: list,
) -> AsyncMock:
    """Build an AsyncMock session that returns the supplied objects in order."""
    session = AsyncMock()

    # session.get(ModelCls, pk) — first call = model, second call = seed.
    session.get = AsyncMock(side_effect=[model, seed_formation])

    # session.execute() — first call = edges query, second call = formations query.
    session.execute = AsyncMock(
        side_effect=[
            _scalar_list_result(edge_rows),
            _scalar_list_result(formation_rows),
        ]
    )
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _use_case(session: AsyncMock) -> PropagateLithoAdmixtures:
    return PropagateLithoAdmixtures(session)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_p1_seed_only_no_edges() -> None:
    """P1: No edges → component = {seed}; only the seed is updated."""
    seed = _make_formation(_FA)
    session = _make_session(
        model=_make_model(),
        seed_formation=seed,
        edge_rows=[],
        formation_rows=[seed],
    )
    result = await _use_case(session).execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        seed_formation_id=_FA,
        admixtures=_ADMIXTURES,
    )
    assert result.component_size == 1
    assert len(result.updated_formations) == 1
    # The seed's admixtures were written.
    assert seed.litho_admixtures == [dict(a) for a in _ADMIXTURES]
    session.flush.assert_called_once()
    session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_p2_linear_chain_three_formations() -> None:
    """P2: A-B-C chain — all three get the new admixtures."""
    fa = _make_formation(_FA)
    fb = _make_formation(_FB)
    fc = _make_formation(_FC)
    session = _make_session(
        model=_make_model(),
        seed_formation=fa,
        edge_rows=[_make_edge(_FA, _FB), _make_edge(_FB, _FC)],
        formation_rows=[fa, fb, fc],
    )
    result = await _use_case(session).execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        seed_formation_id=_FA,
        admixtures=_ADMIXTURES,
    )
    assert result.component_size == 3
    assert len(result.updated_formations) == 3
    for f in [fa, fb, fc]:
        assert f.litho_admixtures == [dict(a) for a in _ADMIXTURES]


@pytest.mark.asyncio
async def test_p3_model_not_in_project() -> None:
    """P3: Model belonging to another project → ValueError."""
    session = AsyncMock()
    other = UUID("00000000-0000-0000-0000-999999999999")
    session.get = AsyncMock(return_value=_make_model(project_id=other))
    with pytest.raises(ValueError, match="not found in project"):
        await _use_case(session).execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            seed_formation_id=_FA,
            admixtures=_ADMIXTURES,
        )


@pytest.mark.asyncio
async def test_p4_geological_model_rejected() -> None:
    """P4: Model of kind 'geological' → ValueError."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=_make_model(kind="geological"))
    with pytest.raises(ValueError, match="lithostratigraphic"):
        await _use_case(session).execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            seed_formation_id=_FA,
            admixtures=_ADMIXTURES,
        )


@pytest.mark.asyncio
async def test_p5_seed_not_in_project() -> None:
    """P5: Seed formation belonging to another project → ValueError."""
    other = UUID("00000000-0000-0000-0000-999999999999")
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[_make_model(), _make_formation(_FA, project_id=other)])
    with pytest.raises(ValueError, match="not found in project"):
        await _use_case(session).execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            seed_formation_id=_FA,
            admixtures=_ADMIXTURES,
        )


@pytest.mark.asyncio
async def test_p6_seed_has_no_litho_main_soil_code() -> None:
    """P6: Seed with null litho_main_soil_code (geological row) → ValueError."""
    geo_row = _make_formation(_FA)
    geo_row.litho_main_soil_code = None
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[_make_model(), geo_row])
    with pytest.raises(ValueError, match="litho_main_soil_code"):
        await _use_case(session).execute(
            project_id=_PROJECT,
            model_id=_MODEL,
            seed_formation_id=_FA,
            admixtures=_ADMIXTURES,
        )


@pytest.mark.asyncio
async def test_p7_empty_admixtures_clears() -> None:
    """P7: Empty admixtures list → clears admixtures on the formation."""
    seed = _make_formation(_FA)
    seed.litho_admixtures = [{"soil_code": "KL", "amount": "S", "locally": False}]
    session = _make_session(
        model=_make_model(),
        seed_formation=seed,
        edge_rows=[],
        formation_rows=[seed],
    )
    result = await _use_case(session).execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        seed_formation_id=_FA,
        admixtures=[],
    )
    assert seed.litho_admixtures == []
    assert result.component_size == 1


@pytest.mark.asyncio
async def test_p8_single_commit_called_once() -> None:
    """P8: Exactly one flush and one commit regardless of component size."""
    fa = _make_formation(_FA)
    fb = _make_formation(_FB)
    session = _make_session(
        model=_make_model(),
        seed_formation=fa,
        edge_rows=[_make_edge(_FA, _FB)],
        formation_rows=[fa, fb],
    )
    await _use_case(session).execute(
        project_id=_PROJECT,
        model_id=_MODEL,
        seed_formation_id=_FA,
        admixtures=_ADMIXTURES,
    )
    session.flush.assert_called_once()
    session.commit.assert_called_once()
