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

The use case now issues three execute() calls in order:
  1. contact_edges_stmt  → scalars().all() → list[LithoContactCorrelationEdgeOrm]
  2. contacts_stmt       → .all()          → list[(contact_id, formation_id)]
  3. formations_stmt     → scalars().all() → list[GeologicalFormationOrm]
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from groundmodel.application.propagate_litho_admixtures import PropagateLithoAdmixtures

_PROJECT = UUID("00000000-0000-0000-0000-000000000001")
_MODEL = UUID("00000000-0000-0000-0000-000000000002")
_FA = UUID("aaaaaaaa-0000-0000-0000-000000000000")
_FB = UUID("bbbbbbbb-0000-0000-0000-000000000000")
_FC = UUID("cccccccc-0000-0000-0000-000000000000")

# Contact ids — one per formation for simplicity.
_CA = UUID("aaaaaaaa-cccc-0000-0000-000000000000")
_CB = UUID("bbbbbbbb-cccc-0000-0000-000000000000")
_CC = UUID("cccccccc-cccc-0000-0000-000000000000")

_ADMIXTURES = [{"soil_code": "KL", "amount": "M", "locally": False}]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_model(kind: str = "lithostratigraphic", project_id: UUID = _PROJECT) -> MagicMock:
    """Return a mock GeologicalModelOrm."""
    m = MagicMock()
    m.app_project_id = project_id
    m.kind = kind
    return m


def _make_formation(fid: UUID, project_id: UUID = _PROJECT, soil: str = "ZAND") -> MagicMock:
    """Return a mock GeologicalFormationOrm."""
    f = MagicMock()
    f.id = fid
    f.app_project_id = project_id
    f.litho_main_soil_code = soil
    f.litho_admixtures = None
    return f


def _make_contact_edge(contact_a: UUID, contact_b: UUID) -> MagicMock:
    """Return a mock LithoContactCorrelationEdgeOrm (contact-level edge)."""
    e = MagicMock()
    e.contact_a_id = contact_a
    e.contact_b_id = contact_b
    return e


def _scalar_list_result(values: list) -> MagicMock:
    """Mock for session.execute() returning a scalars().all() list."""
    r = MagicMock()
    r.scalars.return_value.all.return_value = values
    return r


def _tuple_list_result(pairs: list[tuple]) -> MagicMock:
    """Mock for session.execute() returning .all() → list of (id, formation_id) tuples."""
    r = MagicMock()
    r.all.return_value = pairs
    return r


def _make_session(
    model: object,
    seed_formation: object,
    contact_edge_rows: list,
    contact_map_pairs: list[tuple],
    formation_rows: list,
) -> AsyncMock:
    """Build an AsyncMock session that returns the supplied objects in the correct call order.

    Parameters
    ----------
    model : object
        Mock GeologicalModelOrm returned by session.get() first call.
    seed_formation : object
        Mock GeologicalFormationOrm returned by session.get() second call.
    contact_edge_rows : list
        Mock LithoContactCorrelationEdgeOrm rows for the contact-edge query.
    contact_map_pairs : list[tuple]
        (contact_id, formation_id) pairs for the contact→formation map query.
    formation_rows : list
        Mock GeologicalFormationOrm rows for the component formation query.
    """
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[model, seed_formation])
    session.execute = AsyncMock(
        side_effect=[
            _scalar_list_result(contact_edge_rows),  # call 1: contact_edges_stmt
            _tuple_list_result(contact_map_pairs),  # call 2: contacts_stmt (map)
            _scalar_list_result(formation_rows),  # call 3: formations_stmt
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
    """P1: No contact edges → component = {seed}; only the seed is updated."""
    seed = _make_formation(_FA)
    session = _make_session(
        model=_make_model(),
        seed_formation=seed,
        contact_edge_rows=[],
        contact_map_pairs=[(_CA, _FA)],
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
    """P2: A-B-C chain via contact edges — all three get the new admixtures."""
    fa = _make_formation(_FA)
    fb = _make_formation(_FB)
    fc = _make_formation(_FC)
    # Contact edges: CA↔CB (links FA↔FB) and CB↔CC (links FB↔FC).
    session = _make_session(
        model=_make_model(),
        seed_formation=fa,
        contact_edge_rows=[
            _make_contact_edge(_CA, _CB),
            _make_contact_edge(_CB, _CC),
        ],
        contact_map_pairs=[(_CA, _FA), (_CB, _FB), (_CC, _FC)],
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
        contact_edge_rows=[],
        contact_map_pairs=[(_CA, _FA)],
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
        contact_edge_rows=[_make_contact_edge(_CA, _CB)],
        contact_map_pairs=[(_CA, _FA), (_CB, _FB)],
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
