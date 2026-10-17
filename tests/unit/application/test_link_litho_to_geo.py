"""Unit tests for LinkLithoToGeo use case (#162).

Behavioural cases:
LL1 — litho contact near a geo contact on the same investigation → coupled +
      geo contact snapped + geo surface marked stale.
LL2 — no geo contact within tolerance → None returned, no mutation.
LL3 — contact belongs to another project → ValueError raised before any mutation.
LL4 — litho model has no parent geological model → None returned, no mutation.

The DB session is fully mocked.  No real DB or network I/O.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.link_litho_to_geo import LinkLithoToGeo

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

PROJECT_ID = uuid4()
OTHER_PROJECT_ID = uuid4()
LITHO_MODEL_ID = uuid4()
GEO_MODEL_ID = uuid4()
CONTACT_ID = uuid4()
GEO_CONTACT_ID = uuid4()
GEO_FORMATION_ID = uuid4()
BOREHOLE_ID = uuid4()


def _make_session(
    *,
    contact_project_id: object = PROJECT_ID,
    litho_contact_depth: float = 3.0,
    geo_contact_depth: float = 3.05,
    parent_geo_model_id: object = GEO_MODEL_ID,
    geo_contacts_rows: list | None = None,
    mark_surfaces_stale_count: int = 0,
) -> AsyncMock:
    """Build a minimal mocked AsyncSession for LinkLithoToGeo tests.

    Wires up:
    - session.get(FormationContactOrm, CONTACT_ID) → litho contact stub
    - session.get(GeologicalModelOrm, LITHO_MODEL_ID) → litho model stub
      with parent_model_id = parent_geo_model_id
    - session.get(FormationContactOrm, GEO_CONTACT_ID) → geo contact stub
    - session.execute(...) → geo contacts at investigation
    """
    litho_model_stub = SimpleNamespace(
        app_project_id=contact_project_id,
        parent_model_id=parent_geo_model_id,
        id=LITHO_MODEL_ID,
    )
    litho_contact_stub = SimpleNamespace(
        id=CONTACT_ID,
        model_id=LITHO_MODEL_ID,
        depth_top_m=litho_contact_depth,
        borehole_id=BOREHOLE_ID,
        cpt_id=None,
        parent_geo_contact_id=None,
    )
    geo_contact_stub = SimpleNamespace(
        id=GEO_CONTACT_ID,
        model_id=GEO_MODEL_ID,
        formation_id=GEO_FORMATION_ID,
        depth_top_m=geo_contact_depth,
    )

    session = AsyncMock()
    session.commit = AsyncMock()

    async def _get(orm_class: object, id_val: object) -> object | None:  # noqa: ANN001
        class_name = getattr(orm_class, "__name__", "")
        if class_name == "FormationContactOrm":
            if id_val == CONTACT_ID:
                return litho_contact_stub
            if id_val == GEO_CONTACT_ID:
                return geo_contact_stub
            return None
        if class_name == "GeologicalModelOrm":
            if id_val == LITHO_MODEL_ID:
                return litho_model_stub
            return None
        return None

    session.get = AsyncMock(side_effect=_get)
    session.add = MagicMock()
    session.flush = AsyncMock()

    # session.execute returns a result with .all() producing rows of
    # (depth_top_m, formation_id, id).  Default: one geo contact.
    if geo_contacts_rows is None:
        geo_contacts_rows = [
            SimpleNamespace(
                depth_top_m=geo_contact_depth,
                formation_id=GEO_FORMATION_ID,
                id=GEO_CONTACT_ID,
            )
        ]
    execute_result = MagicMock()
    execute_result.all = MagicMock(return_value=geo_contacts_rows)
    session.execute = AsyncMock(return_value=execute_result)

    return session


def _use_case(session: AsyncMock) -> LinkLithoToGeo:
    """Build the use case with a mocked session."""
    return LinkLithoToGeo(session)


# ---------------------------------------------------------------------------
# LL1 — litho contact within tolerance → coupled + geo snapped + stale
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ll1_links_nearest_geo_and_snaps_and_marks_stale() -> None:
    """A litho contact within tolerance couples to the nearest geo contact.

    Rule: after ``execute`` returns the updated contact,
    - ``parent_geo_contact_id`` is set to the geo contact id,
    - the geo contact's ``depth_top_m`` is snapped to the litho depth,
    - the geo formation's surface is marked stale (does NOT auto-rebuild),
    - commit is called exactly once.
    """
    litho_depth = 3.0
    geo_depth = 3.05  # delta 0.05 m — within 0.20 m default tolerance
    session = _make_session(
        litho_contact_depth=litho_depth,
        geo_contact_depth=geo_depth,
    )

    with patch.object(
        LinkLithoToGeo,
        "_mark_geo_surface_stale",
        new_callable=AsyncMock,
    ) as mock_stale:
        uc = _use_case(session)
        result = await uc.execute(project_id=PROJECT_ID, contact_id=CONTACT_ID)

    # Contact returned.
    assert result is not None
    # parent_geo_contact_id must be set.
    assert result.parent_geo_contact_id == GEO_CONTACT_ID
    # Geo contact depth snapped to litho depth.
    await session.get(None.__class__, GEO_CONTACT_ID)  # type: ignore[arg-type]
    # Access via the session.get side_effect stub directly:
    # re-fetch the geo contact stub from the _make_session closure.
    # The geo_contact_stub is mutable (SimpleNamespace) — the use case
    # mutates it in-place via session.get(..., GEO_CONTACT_ID).depth_top_m.
    # We verify by checking session.get was called with GEO_CONTACT_ID.
    get_calls = session.get.call_args_list
    geo_get_calls = [c for c in get_calls if c[0][1] == GEO_CONTACT_ID]
    assert geo_get_calls, "session.get(FormationContactOrm, GEO_CONTACT_ID) must be called"
    # Stale marker must have been called.
    mock_stale.assert_awaited_once()
    # Exactly one commit.
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_ll1_geo_depth_snapped_to_litho() -> None:
    """Geo contact depth_top_m is set to the litho depth after linking.

    Separate assertion so we can inspect the mutable stub directly.
    """
    litho_depth = 2.95
    geo_depth = 3.0  # delta 0.05 m — within tolerance
    session = _make_session(
        litho_contact_depth=litho_depth,
        geo_contact_depth=geo_depth,
    )
    # Build a simple geo_contact_stub we can inspect after the call.
    # The _make_session closure already creates one; we access it via get.
    geo_contact_seen: list[object] = []

    original_get = session.get.side_effect

    async def _patched_get(orm_class: object, id_val: object) -> object | None:  # noqa: ANN001
        result = await original_get(orm_class, id_val)
        if id_val == GEO_CONTACT_ID and result is not None:
            geo_contact_seen.append(result)
        return result

    session.get.side_effect = _patched_get

    with patch.object(LinkLithoToGeo, "_mark_geo_surface_stale", new_callable=AsyncMock):
        uc = _use_case(session)
        await uc.execute(project_id=PROJECT_ID, contact_id=CONTACT_ID)

    assert geo_contact_seen, "geo contact must have been fetched"
    geo_stub = geo_contact_seen[0]
    assert hasattr(geo_stub, "depth_top_m"), "geo contact stub must have depth_top_m"
    assert geo_stub.depth_top_m == pytest.approx(litho_depth, abs=1e-9), (  # type: ignore[union-attr]
        f"Geo contact depth must be snapped to litho depth {litho_depth}; "
        f"got {geo_stub.depth_top_m}"  # type: ignore[union-attr]
    )


# ---------------------------------------------------------------------------
# LL2 — no geo contact within tolerance → None
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ll2_no_geo_within_tolerance_returns_none() -> None:
    """When no geo contact is within tolerance the use case returns None.

    No mutation (parent_geo_contact_id unchanged, no stale call, no commit).
    """
    litho_depth = 1.0
    geo_depth = 10.0  # delta 9.0 m — well outside 0.20 m tolerance
    session = _make_session(
        litho_contact_depth=litho_depth,
        geo_contact_depth=geo_depth,
    )
    with patch.object(
        LinkLithoToGeo, "_mark_geo_surface_stale", new_callable=AsyncMock
    ) as mock_stale:
        uc = _use_case(session)
        result = await uc.execute(project_id=PROJECT_ID, contact_id=CONTACT_ID)

    assert result is None, "Must return None when no geo contact is within tolerance"
    # No mutation — commit must NOT be called.
    session.commit.assert_not_awaited()
    mock_stale.assert_not_awaited()


# ---------------------------------------------------------------------------
# LL3 — contact belongs to another project → ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ll3_wrong_project_raises_value_error() -> None:
    """Scope guard: a contact owned by another project is rejected.

    The guard must fire before any mutation.  commit must NOT be called.
    """
    session = _make_session(contact_project_id=OTHER_PROJECT_ID)
    uc = _use_case(session)

    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(project_id=PROJECT_ID, contact_id=CONTACT_ID)

    session.commit.assert_not_awaited()


# ---------------------------------------------------------------------------
# LL4 — litho model has no parent geological model → None
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ll4_no_parent_geo_model_returns_none() -> None:
    """When the litho model has no parent geological model, None is returned.

    The use case cannot know which geo contacts to search — the safe
    answer is None (no link) rather than a crash.
    """
    session = _make_session(parent_geo_model_id=None)
    uc = _use_case(session)

    result = await uc.execute(project_id=PROJECT_ID, contact_id=CONTACT_ID)

    assert result is None, "Must return None when litho model has no parent geological model"
    session.commit.assert_not_awaited()
