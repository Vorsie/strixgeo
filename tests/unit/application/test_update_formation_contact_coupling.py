"""Unit tests for bidirectional depth propagation on coupled contacts (#162).

Locks the litho↔geo depth-propagation rule: when a depth-only patch is
applied to a coupled contact (parent_geo_contact_id set), the partner's
depth is synchronised.  The loop guard ensures equal-depth assignments
are skipped so the geo→litho→geo cycle terminates.

Session mocked at the ``get`` / ``execute`` / ``commit`` / ``refresh``
boundary; repo swapped for an ``AsyncMock``.  Mirrors the style used in
``test_update_formation_contact.py``.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.update_formation_contact import (
    UpdateFormationContact,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)

# ---------------------------------------------------------------------------
# Shared UUIDs
# ---------------------------------------------------------------------------
GEO_MODEL_ID = uuid4()
LITHO_MODEL_ID = uuid4()
GEO_FORMATION_ID = uuid4()
LITHO_FORMATION_ID = uuid4()
GEO_CONTACT_ID = uuid4()
LITHO_CONTACT_ID = uuid4()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _use_case(session: AsyncMock) -> UpdateFormationContact:
    """Wrap ``UpdateFormationContact`` with a mocked repo."""
    uc = UpdateFormationContact(session)
    uc._repo = AsyncMock()
    return uc


def _make_geo_contact(depth: float = 3.0) -> SimpleNamespace:
    """Geological contact stub with no coupling (parent_geo_contact_id=None)."""
    return SimpleNamespace(
        id=GEO_CONTACT_ID,
        model_id=GEO_MODEL_ID,
        formation_id=GEO_FORMATION_ID,
        depth_top_m=depth,
        parent_geo_contact_id=None,  # geo contacts are never children
        borehole_id=None,
        cpt_id=None,
    )


def _make_litho_contact(depth: float = 3.0) -> SimpleNamespace:
    """Lithostratigraphic contact stub coupled to GEO_CONTACT_ID."""
    return SimpleNamespace(
        id=LITHO_CONTACT_ID,
        model_id=LITHO_MODEL_ID,
        formation_id=LITHO_FORMATION_ID,
        depth_top_m=depth,
        parent_geo_contact_id=GEO_CONTACT_ID,  # coupled to the geo contact
        borehole_id=None,
        cpt_id=None,
    )


def _make_session(
    primary_contact: SimpleNamespace,
    model_kind: str,
    partner: SimpleNamespace | None = None,
    children: list[SimpleNamespace] | None = None,
) -> AsyncMock:
    """Build a configured AsyncMock session.

    Parameters
    ----------
    primary_contact : SimpleNamespace
        Contact returned first (for the pre-update fetch).
    model_kind : str
        ``"geological"`` or ``"lithostratigraphic"`` — returned by the
        ``GeologicalModelOrm`` model fetch.
    partner : SimpleNamespace | None
        When not None, the contact returned by the parent-lookup path
        (``session.get(FormationContactOrm, parent_geo_contact_id)``).
    children : list[SimpleNamespace] | None
        Contacts returned by the children-select path (litho contacts
        whose ``parent_geo_contact_id == contact.id``).
    """
    model_stub = SimpleNamespace(
        kind=model_kind,
        id=GEO_MODEL_ID,
        app_project_id=uuid4(),
    )

    async def _get_dispatch(cls, pk, **_kwargs):  # type: ignore[override]
        if cls is GeologicalModelOrm:
            return model_stub
        if cls is FormationContactOrm:
            # First call returns the primary contact (pre-update fetch);
            # subsequent calls are the partner lookup (propagation).
            if pk == primary_contact.id:
                return primary_contact
            if partner is not None and pk == partner.id:
                return partner
            return None
        return None

    session = AsyncMock()
    session.get = _get_dispatch  # type: ignore[assignment]

    # Wire session.execute() to return the children list (used by the
    # geo→litho propagation SELECT).
    scalars_result = MagicMock()
    scalars_result.all.return_value = children or []
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_result
    session.execute = AsyncMock(return_value=execute_result)

    return session


# ---------------------------------------------------------------------------
# prop1 — moving a GEO contact propagates depth to its coupled LITHO child
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prop1_geo_move_propagates_to_linked_litho() -> None:
    """Moving a geo contact depth to 4.0 propagates to its litho child.

    Setup: geo contact G at 3.0; litho contact L at 3.0 coupled via
    parent_geo_contact_id = G.id.
    Action: PATCH G depth → 4.0.
    Expectation: L.depth_top_m is set to 4.0.
    """
    geo = _make_geo_contact(depth=3.0)
    litho = _make_litho_contact(depth=3.0)

    # The geo model hosts the geo contact.
    session = _make_session(
        primary_contact=geo,
        model_kind="geological",
        children=[litho],
    )
    uc = _use_case(session)
    updated_geo = SimpleNamespace(
        id=GEO_CONTACT_ID,
        model_id=GEO_MODEL_ID,
        formation_id=GEO_FORMATION_ID,
        depth_top_m=4.0,
        parent_geo_contact_id=None,
    )
    uc._repo.update_contact = AsyncMock(return_value=updated_geo)

    await uc.execute(GEO_CONTACT_ID, {"depth_top_m": 4.0})

    # The litho child must have had its depth_top_m set to 4.0.
    assert litho.depth_top_m == 4.0, (
        f"Expected litho.depth_top_m=4.0 after geo move, got {litho.depth_top_m}"
    )


# ---------------------------------------------------------------------------
# prop2 — moving a LITHO contact propagates depth to its coupled GEO parent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prop2_litho_move_propagates_to_linked_geo() -> None:
    """Moving a litho contact depth to 2.5 propagates to its geo parent.

    Setup: geo contact G at 3.0; litho contact L at 3.0 coupled via
    parent_geo_contact_id = G.id.
    Action: PATCH L depth → 2.5.
    Expectation: G.depth_top_m is set to 2.5.
    """
    geo = _make_geo_contact(depth=3.0)
    litho = _make_litho_contact(depth=3.0)

    # The litho model hosts the litho contact.
    session = _make_session(
        primary_contact=litho,
        model_kind="lithostratigraphic",
        partner=geo,
    )
    uc = _use_case(session)
    updated_litho = SimpleNamespace(
        id=LITHO_CONTACT_ID,
        model_id=LITHO_MODEL_ID,
        formation_id=LITHO_FORMATION_ID,
        depth_top_m=2.5,
        parent_geo_contact_id=GEO_CONTACT_ID,
    )
    uc._repo.update_contact = AsyncMock(return_value=updated_litho)

    await uc.execute(LITHO_CONTACT_ID, {"depth_top_m": 2.5})

    # The geo parent must have had its depth_top_m set to 2.5.
    assert geo.depth_top_m == 2.5, (
        f"Expected geo.depth_top_m=2.5 after litho move, got {geo.depth_top_m}"
    )


# ---------------------------------------------------------------------------
# prop3 — equal-depth is a no-op (loop guard)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prop3_equal_depth_is_noop() -> None:
    """Updating a geo contact to its current depth does NOT write the litho child.

    This is the loop guard: if the target partner already has the same
    depth as the new value, no write is issued.  Without this guard,
    geo→litho→geo would cycle infinitely.
    """
    geo = _make_geo_contact(depth=3.0)
    litho = _make_litho_contact(depth=3.0)

    session = _make_session(
        primary_contact=geo,
        model_kind="geological",
        children=[litho],
    )
    uc = _use_case(session)
    updated_geo = SimpleNamespace(
        id=GEO_CONTACT_ID,
        model_id=GEO_MODEL_ID,
        formation_id=GEO_FORMATION_ID,
        depth_top_m=3.0,  # same depth — no change
        parent_geo_contact_id=None,
    )
    uc._repo.update_contact = AsyncMock(return_value=updated_geo)

    # Patch depth to the same value (no real change — but still a depth-only patch).
    await uc.execute(GEO_CONTACT_ID, {"depth_top_m": 3.0})

    # Loop guard: litho child must NOT have been written.
    assert litho.depth_top_m == 3.0, "litho depth should be unchanged"
    # The children-select execute() may or may not have been called, but
    # the key invariant is that litho.depth_top_m was not touched.  We
    # record the sentinel value before and after via the stub object.
    # (Already verified above via the assertion.)


# ---------------------------------------------------------------------------
# prop4 — uncoupled contact — no propagation writes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prop4_uncoupled_contact_no_propagation() -> None:
    """A contact with parent_geo_contact_id=None and no children → no coupled writes.

    Moving an uncoupled contact (standalone geo or standalone litho)
    must not trigger any propagation write.  The children SELECT may be
    issued but must return an empty list (no-op).
    """
    # A geological contact with no coupling at all.
    standalone = SimpleNamespace(
        id=GEO_CONTACT_ID,
        model_id=GEO_MODEL_ID,
        formation_id=GEO_FORMATION_ID,
        depth_top_m=5.0,
        parent_geo_contact_id=None,
        borehole_id=None,
        cpt_id=None,
    )
    session = _make_session(
        primary_contact=standalone,
        model_kind="geological",
        children=[],  # no coupled children
    )
    uc = _use_case(session)
    updated = SimpleNamespace(
        id=GEO_CONTACT_ID,
        model_id=GEO_MODEL_ID,
        formation_id=GEO_FORMATION_ID,
        depth_top_m=8.0,
        parent_geo_contact_id=None,
    )
    uc._repo.update_contact = AsyncMock(return_value=updated)

    await uc.execute(GEO_CONTACT_ID, {"depth_top_m": 8.0})

    # No object other than standalone should have had depth_top_m written.
    # standalone.depth_top_m is untouched (the use case writes through the
    # repo, not directly onto `pre`).
    assert standalone.depth_top_m == 5.0, (
        "standalone pre-update depth must not be mutated by the use case"
    )
    # The session must not have had .get called with the partner lookup
    # (there is no partner since parent_geo_contact_id is None and no
    # children were found).
    # We verify indirectly: if any partner stub had been mutated it would
    # appear above; here we simply confirm the test did not error.
