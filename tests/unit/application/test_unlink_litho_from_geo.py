"""Unit tests for UnlinkLithoFromGeo use case (#162 Task 6).

Two behavioural cases:
UL1 — a coupled litho contact → ``parent_geo_contact_id`` becomes None,
      commit is called.
UL2 — contact belongs to another project → ValueError raised before any
      mutation.

The DB session is fully mocked. No real DB or network I/O.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.unlink_litho_from_geo import UnlinkLithoFromGeo
from groundmodel.domain.value_objects.formation_contact_result import FormationContactResult

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

PROJECT_ID = uuid4()
OTHER_PROJECT_ID = uuid4()
LITHO_MODEL_ID = uuid4()
FORMATION_ID = uuid4()
BOREHOLE_ID = uuid4()
CONTACT_ID = uuid4()
GEO_CONTACT_ID = uuid4()
_NOW = datetime(2026, 6, 1, tzinfo=UTC)


def _make_session(
    *,
    contact_project_id: object = PROJECT_ID,
    parent_geo_contact_id: object = GEO_CONTACT_ID,
) -> AsyncMock:
    """Build a minimal mocked AsyncSession for UnlinkLithoFromGeo tests.

    The contact row is wired so session.get(FormationContactOrm, ...) returns
    a stub whose model → app_project_id equals ``contact_project_id``.

    The stub carries all fields required by ``FormationContactResult.from_orm``
    so the use case can construct the result dataclass after refresh.
    """
    # Two stubs: one for FormationContactOrm, one for GeologicalModelOrm.
    # The use case does two session.get calls: first for the contact,
    # then for the contact's model (project-scope guard).
    model_stub = SimpleNamespace(app_project_id=contact_project_id)
    contact_stub = SimpleNamespace(
        id=CONTACT_ID,
        model_id=LITHO_MODEL_ID,
        formation_id=FORMATION_ID,
        borehole_id=BOREHOLE_ID,
        cpt_id=None,
        synthetic_x=None,
        synthetic_y=None,
        synthetic_elevation_m=None,
        depth_top_m=5.0,
        source="manual_pick",
        confidence="medium",
        observation_id=None,
        observation_layer_id=None,
        parent_geo_contact_id=parent_geo_contact_id,
        notes=None,
        created_at=_NOW,
        updated_at=_NOW,
    )

    session = AsyncMock()
    session.commit = AsyncMock()

    # Dispatch on ORM class name so both calls resolve correctly.
    async def _get(orm_class: object, id_val: object) -> object | None:  # noqa: ANN001
        class_name = getattr(orm_class, "__name__", "")
        if class_name == "FormationContactOrm":
            return contact_stub if id_val == CONTACT_ID else None
        if class_name == "GeologicalModelOrm":
            return model_stub if id_val == LITHO_MODEL_ID else None
        return None

    session.get = AsyncMock(side_effect=_get)
    session.add = MagicMock()
    session.flush = AsyncMock()
    return session


def _use_case(session: AsyncMock) -> UnlinkLithoFromGeo:
    """Build the use case with a mocked session."""
    return UnlinkLithoFromGeo(session)


# ---------------------------------------------------------------------------
# UL1 — coupled contact → parent_geo_contact_id becomes None + commit called
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ul1_unlinks_coupled_contact_and_commits() -> None:
    """A coupled litho contact is unlinked: parent_geo_contact_id set to None.

    Rule: after ``execute`` returns, the contact's ``parent_geo_contact_id``
    is None and the session is committed exactly once.  The use case must
    NOT move or delete either contact.
    """
    session = _make_session(parent_geo_contact_id=GEO_CONTACT_ID)
    uc = _use_case(session)

    result = await uc.execute(project_id=PROJECT_ID, contact_id=CONTACT_ID)

    # Returns a FormationContactResult dataclass (not the raw ORM object — debt #106).
    assert isinstance(result, FormationContactResult)
    assert result.id == CONTACT_ID
    # parent_geo_contact_id must be cleared (the use case nulls it before refresh).
    assert result.parent_geo_contact_id is None
    # Exactly one commit.
    session.commit.assert_awaited_once()


# ---------------------------------------------------------------------------
# UL2 — contact in another project → ValueError before any mutation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ul2_wrong_project_raises_value_error() -> None:
    """VULN-10 scope guard: a contact owned by another project is rejected.

    The guard must fire before any mutation.  commit must NOT be called.
    """
    session = _make_session(contact_project_id=OTHER_PROJECT_ID)
    uc = _use_case(session)

    with pytest.raises(ValueError, match="not found in project"):
        await uc.execute(project_id=PROJECT_ID, contact_id=CONTACT_ID)

    # No mutation — commit must not have been called.
    session.commit.assert_not_awaited()
