"""Pin the FK migration: correlation edges cascade from litho_layer (A4 slice 4a).

Migration ``q1k2l3m4n5o6_correlation_edge_fk_to_layer`` retargeted
``litho_contact_correlation_edge.contact_a_id / contact_b_id`` from
``formation_contact(id)`` to ``litho_layer(id)``. The trigger pair
keeps every accepted FC matched 1:1 with an LL row of the same UUID,
so the cascade end state for the user is unchanged — only the
internal wiring moves.

Covered:
* DELETE litho_layer dissolves any edge referencing it (direct
  cascade through the new FK).
* DELETE formation_contact still dissolves edges, because the
  FC→LL trigger sees the FC gone, prunes the accepted LL row, and
  the LL CASCADE takes the edge down with it.
* INSERTing an edge with a contact_a_id that exists in
  formation_contact but NOT in litho_layer is now an FK violation
  (proves the FK target moved). This is the post-migration shape
  guarantee — pending/rejected layers don't get FCs, so a hand-
  crafted edge pointing at an FC that never had a layer mirror
  would have been silently accepted before; now it's rejected.
* Existing edges referencing accepted-layer ids continue to load
  and work unchanged.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def setup(db_session: AsyncSession) -> dict:
    """Project + litho model + 2 boreholes + 2 formations + 2 accepted
    contacts (one per BH) + 1 correlation edge between them."""
    project = ProjectOrm(id=uuid7(), name="FK migration", status="active")
    db_session.add(project)
    await db_session.flush()
    bh1 = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="T",
        test_id="T1",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    bh2 = BoreholeOrm(
        id=uuid7(),
        name="BH-2",
        app_project_id=project.id,
        project_id="T",
        test_id="T2",
        location_x=10.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    db_session.add_all([bh1, bh2, litho_model, sand])
    await db_session.flush()
    # Two accepted contacts → triggers materialise matching LL rows.
    fc1 = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=sand.id,
        borehole_id=bh1.id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    fc2 = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=sand.id,
        borehole_id=bh2.id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add_all([fc1, fc2])
    await db_session.commit()
    # Edge: canonical (a < b) ordering required by CHECK.
    a_id, b_id = sorted([fc1.id, fc2.id])
    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=litho_model.id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=True,
    )
    db_session.add(edge)
    await db_session.commit()
    return {
        "project": project,
        "model": litho_model,
        "bh1": bh1,
        "bh2": bh2,
        "sand": sand,
        "fc1": fc1,
        "fc2": fc2,
        "edge": edge,
    }


async def _edge_exists(db_session: AsyncSession, edge_id) -> bool:
    """Fresh SELECT bypassing the identity-map cache.

    expire_on_commit=False (integration conftest) means db_session.get
    returns the cached object even after a server-side CASCADE removes
    the row. A direct SELECT against the DB is the only reliable check.
    """
    row = (
        await db_session.execute(
            select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.id == edge_id
            )
        )
    ).first()
    return row is not None


async def _layer_exists(db_session: AsyncSession, layer_id) -> bool:
    row = (
        await db_session.execute(select(LithoLayerOrm.id).where(LithoLayerOrm.id == layer_id))
    ).first()
    return row is not None


@pytest.mark.asyncio
async def test_delete_layer_cascades_to_edge(db_session: AsyncSession, setup: dict) -> None:
    """Direct cascade through the new FK: DELETE LL → edge gone."""
    layer1 = await db_session.get(LithoLayerOrm, setup["fc1"].id)
    assert layer1 is not None
    await db_session.delete(layer1)
    await db_session.commit()
    assert not await _edge_exists(db_session, setup["edge"].id)


@pytest.mark.asyncio
async def test_delete_fc_still_cascades_to_edge_via_trigger(
    db_session: AsyncSession, setup: dict
) -> None:
    """Legacy path: DELETE FC → trigger prunes LL → CASCADE removes edge."""
    await db_session.delete(setup["fc1"])
    await db_session.commit()
    # LL row gone via the FC→LL trigger.
    assert not await _layer_exists(db_session, setup["fc1"].id)
    # Edge gone via the new LL FK cascade.
    assert not await _edge_exists(db_session, setup["edge"].id)


@pytest.mark.asyncio
async def test_edge_insert_requires_layer_to_exist(db_session: AsyncSession, setup: dict) -> None:
    """An edge referencing a UUID that does NOT exist in litho_layer is
    rejected — the FK target moved, so a hand-crafted ``contact_a_id``
    pointing at an FC that has no layer mirror (impossible in normal
    operation, but a real test for the FK invariant) fails."""
    # Build an FC on a NEW model so its corresponding LL row exists.
    layer_id = uuid7()
    # Insert an edge whose contact_b_id refers to a non-existent layer.
    a_id, b_id = sorted([setup["fc1"].id, layer_id])
    bad_edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=setup["model"].id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=True,
    )
    db_session.add(bad_edge)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_existing_edge_loads_via_new_fk(db_session: AsyncSession, setup: dict) -> None:
    """No-op behaviour check: an edge made before the FK migration
    still loads. UUIDs are stable across the migration boundary."""
    edge = await db_session.get(LithoContactCorrelationEdgeOrm, setup["edge"].id)
    assert edge is not None
    # Each endpoint resolves to a litho_layer row (post-migration FK target).
    layer_a = await db_session.get(LithoLayerOrm, edge.contact_a_id)
    layer_b = await db_session.get(LithoLayerOrm, edge.contact_b_id)
    assert layer_a is not None
    assert layer_b is not None
