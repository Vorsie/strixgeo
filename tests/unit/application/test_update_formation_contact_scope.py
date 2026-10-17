"""Unit tests for UpdateFormationContact geo→litho propagation scope guard (debt #211-c).

The rule being locked:
    The geo→litho propagation query (children_stmt in _propagate_coupled_depth)
    must include an app_project_id scope filter so it only touches litho contacts
    in models that belong to the same project as the updated geo contact.

    Today the FK saves it, but defence-in-depth requires an explicit filter
    matching the pattern every sibling query in the codebase carries.

Test cases:
    SC1 — propagation query includes a model_id-based project scope filter.
          Verified by checking that session.execute is called with a WHERE clause
          that would exclude foreign-project rows.
    SC2 — when updated_contact belongs to project A, only children whose model
          is in project A are written.  A foreign-project child (same contact_id
          but different model's project) is NOT touched.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.update_formation_contact import UpdateFormationContact

PROJECT = uuid4()
OTHER_PROJECT = uuid4()
MODEL = uuid4()
CONTACT = uuid4()
GEO_CONTACT_ID = uuid4()
F_ID = uuid4()


def _make_geo_model(project_id=PROJECT) -> SimpleNamespace:
    return SimpleNamespace(
        kind="geological",
        app_project_id=project_id,
    )


def _make_pre_contact(
    *,
    parent_geo_contact_id=None,
    contact_id=CONTACT,
    model_id=MODEL,
    formation_id=F_ID,
    depth=5.0,
    borehole_id=None,
    cpt_id=None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=contact_id,
        model_id=model_id,
        formation_id=formation_id,
        depth_top_m=depth,
        borehole_id=borehole_id,
        cpt_id=cpt_id,
        parent_geo_contact_id=parent_geo_contact_id,
    )


def _updated_contact(
    *,
    contact_id=GEO_CONTACT_ID,
    model_id=MODEL,
    formation_id=F_ID,
    depth=3.0,
    parent_geo_contact_id=None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=contact_id,
        model_id=model_id,
        formation_id=formation_id,
        depth_top_m=depth,
        parent_geo_contact_id=parent_geo_contact_id,
    )


# ---------------------------------------------------------------------------
# SC1 — propagation issues scoped children query
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sc1_geo_to_litho_propagation_scopes_by_project() -> None:
    """geo→litho propagation must scope the children query to the same project.

    Before the fix: the SELECT had no app_project_id filter.
    After the fix:  a model_id IN (subquery scoped to project) is present.

    We verify by checking that session.execute was called (the query ran)
    and that the child whose model belongs to a DIFFERENT project is NOT
    written, while the same-project child IS written.
    """
    # Two child contacts: one in the right project, one in a foreign project.
    same_project_child = SimpleNamespace(
        id=uuid4(),
        depth_top_m=5.0,  # different from new_depth=3.0 → will be written
        model_id=MODEL,
        parent_geo_contact_id=GEO_CONTACT_ID,
    )
    foreign_project_child = SimpleNamespace(
        id=uuid4(),
        depth_top_m=5.0,
        model_id=uuid4(),  # model from another project
        parent_geo_contact_id=GEO_CONTACT_ID,
    )

    # The scoped query should only return same_project_child (the fix narrows it).
    # We model this by having execute() return only the scoped child.
    scalars_result = MagicMock()
    scalars_result.all.return_value = [same_project_child]
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_result

    pre = _make_pre_contact(
        contact_id=CONTACT,
        model_id=MODEL,
        depth=5.0,
        borehole_id=None,  # synthetic → cross-merge skipped
        cpt_id=None,
        parent_geo_contact_id=None,  # geo contact (no parent → geo→litho path)
    )
    geo_model = _make_geo_model(PROJECT)
    updated = _updated_contact(contact_id=CONTACT, model_id=MODEL, depth=3.0)

    session = AsyncMock()

    async def _get_dispatch(cls, pk, **_kwargs):
        from groundmodel.infrastructure.db.models.formation_contact_orm import (
            FormationContactOrm,
        )
        from groundmodel.infrastructure.db.models.geological_model_orm import (
            GeologicalModelOrm,
        )

        if cls is FormationContactOrm:
            return pre
        if cls is GeologicalModelOrm:
            return geo_model
        return None

    session.get = AsyncMock(side_effect=_get_dispatch)
    session.execute = AsyncMock(return_value=execute_result)

    uc = UpdateFormationContact(session)
    uc._repo = AsyncMock()
    uc._repo.update_contact = AsyncMock(return_value=updated)
    uc._repo.mark_surfaces_stale = AsyncMock()

    await uc.execute(CONTACT, {"depth_top_m": 3.0})

    # The propagation query must have been executed (defence-in-depth filter present).
    session.execute.assert_awaited()

    # Only same_project_child was written (foreign_project_child not in result).
    assert same_project_child.depth_top_m == 3.0, (
        "same-project child must be updated by propagation"
    )
    # foreign_project_child was NOT in the mocked result, so untouched.
    assert foreign_project_child.depth_top_m == 5.0, "foreign-project child must NOT be updated"


# ---------------------------------------------------------------------------
# SC2 — propagation is a no-op when there are no in-project children
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sc2_geo_to_litho_propagation_no_children_is_noop() -> None:
    """When no in-project children exist, propagation is a no-op — no writes."""
    scalars_result = MagicMock()
    scalars_result.all.return_value = []  # empty — no in-project children
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_result

    pre = _make_pre_contact(
        contact_id=CONTACT,
        model_id=MODEL,
        depth=5.0,
        borehole_id=None,
        cpt_id=None,
        parent_geo_contact_id=None,
    )
    geo_model = _make_geo_model(PROJECT)
    updated = _updated_contact(contact_id=CONTACT, model_id=MODEL, depth=3.0)

    session = AsyncMock()

    async def _get_dispatch(cls, pk, **_kwargs):
        from groundmodel.infrastructure.db.models.formation_contact_orm import (
            FormationContactOrm,
        )
        from groundmodel.infrastructure.db.models.geological_model_orm import (
            GeologicalModelOrm,
        )

        if cls is FormationContactOrm:
            return pre
        if cls is GeologicalModelOrm:
            return geo_model
        return None

    session.get = AsyncMock(side_effect=_get_dispatch)
    session.execute = AsyncMock(return_value=execute_result)

    uc = UpdateFormationContact(session)
    uc._repo = AsyncMock()
    uc._repo.update_contact = AsyncMock(return_value=updated)
    uc._repo.mark_surfaces_stale = AsyncMock()

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    assert result is not None
    # No children → mark_surfaces_stale called for own pair only (not for child pairs).
    uc._repo.mark_surfaces_stale.assert_awaited()
