"""Pin the trigger that mirrors litho-model FormationContact writes into litho_layer.

Migration ``o9i0j1k2l3m4_mirror_litho_contact_writes`` installs the
trigger that lets the FE keep writing through the legacy contact
endpoints during the A3 cut-over while the read path uses ``/layers``.
Without this trigger every litho write would produce a stale read.

Covered:
* INSERT → litho_layer materialises with the same UUID + derived
  depth_base_m
* UPDATE depth_top_m → mirror row's depth_top_m moves AND the
  previous-neighbour's depth_base_m moves with it
* UPDATE formation_id → mirror row's formation_id mirrors
* DELETE → mirror row gone, previous-neighbour's depth_base_m extends
* GEOLOGICAL model writes are NOT mirrored (Shape A is litho-only)
* synthetic pinch-out contacts (no anchor) are skipped
"""

from __future__ import annotations

import pytest
import pytest_asyncio
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
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def setup(db_session: AsyncSession) -> dict:
    """Project + 1 litho model + 1 geo model + 1 BH + 2 formations."""
    project = ProjectOrm(id=uuid7(), name="Trigger test", status="active")
    db_session.add(project)
    await db_session.flush()
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="T",
        test_id="T",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="G", kind="geological"
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    clay = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="CLAY", color="#74b9ff"
    )
    db_session.add_all([bh, litho_model, geo_model, sand, clay])
    await db_session.commit()
    return {
        "project": project,
        "bh": bh,
        "litho_model": litho_model,
        "geo_model": geo_model,
        "sand": sand,
        "clay": clay,
    }


@pytest.mark.asyncio
async def test_insert_contact_materialises_layer(db_session: AsyncSession, setup: dict) -> None:
    """INSERT into formation_contact → trigger upserts litho_layer with same id."""
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()

    layer = await db_session.get(LithoLayerOrm, contact.id)
    assert layer is not None
    assert layer.depth_top_m == 2.0
    # No next contact → terminal-anchor fallback → borehole.total_depth_m = 10
    assert layer.depth_base_m == 10.0
    assert layer.status == "accepted"


@pytest.mark.asyncio
async def test_update_depth_moves_both_self_and_previous_neighbour(
    db_session: AsyncSession, setup: dict
) -> None:
    """Move contact-2 down → its layer's depth_top moves AND contact-1's
    layer's depth_base extends to follow (LEAD recompute)."""
    c1 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=0.0,
        source="manual_pick",
        confidence="medium",
    )
    c2 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["clay"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add_all([c1, c2])
    await db_session.commit()

    # Sanity: both layers materialised.
    layer1 = await db_session.get(LithoLayerOrm, c1.id)
    layer2 = await db_session.get(LithoLayerOrm, c2.id)
    assert layer1 is not None and layer2 is not None
    assert layer1.depth_base_m == 2.0  # bounded by c2's top

    # Move c2 down to 4.0.
    c2.depth_top_m = 4.0
    await db_session.commit()

    await db_session.refresh(layer1)
    await db_session.refresh(layer2)
    assert layer2.depth_top_m == 4.0
    assert layer1.depth_base_m == 4.0  # neighbour follows


@pytest.mark.asyncio
async def test_update_formation_id_mirrors(db_session: AsyncSession, setup: dict) -> None:
    """Formation change on contact → mirror layer's formation_id mirrors."""
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=1.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()

    contact.formation_id = setup["clay"].id
    await db_session.commit()
    layer = await db_session.get(LithoLayerOrm, contact.id)
    assert layer is not None
    assert layer.formation_id == setup["clay"].id


@pytest.mark.asyncio
async def test_delete_contact_prunes_layer_and_extends_neighbour(
    db_session: AsyncSession, setup: dict
) -> None:
    """DELETE middle contact → mirror layer gone, upper neighbour's
    depth_base_m extends to fill."""
    c1 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=0.0,
        source="manual_pick",
        confidence="medium",
    )
    c2 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["clay"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    c3 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=5.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add_all([c1, c2, c3])
    await db_session.commit()

    await db_session.delete(c2)
    await db_session.commit()

    assert await db_session.get(LithoLayerOrm, c2.id) is None
    layer1 = await db_session.get(LithoLayerOrm, c1.id)
    assert layer1 is not None
    # c1's base now bounded by c3 (the next surviving contact).
    assert layer1.depth_base_m == 5.0


@pytest.mark.asyncio
async def test_geological_model_writes_are_not_mirrored(
    db_session: AsyncSession, setup: dict
) -> None:
    """Geological (kind='geological') contacts must not leak into litho_layer."""
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=setup["geo_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()

    assert await db_session.get(LithoLayerOrm, contact.id) is None


@pytest.mark.asyncio
async def test_synthetic_pinch_out_skipped(db_session: AsyncSession, setup: dict) -> None:
    """Anchor-less synthetic contacts don't fit Shape A → trigger skips."""
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=None,
        cpt_id=None,
        depth_top_m=2.0,
        source="pinch_out_extrapolation",
        confidence="low",
        synthetic_x=0.0,
        synthetic_y=0.0,
        synthetic_elevation_m=-1.5,
    )
    db_session.add(contact)
    await db_session.commit()

    assert await db_session.get(LithoLayerOrm, contact.id) is None


@pytest.mark.asyncio
async def test_trigger_does_not_disturb_other_anchors(
    db_session: AsyncSession, setup: dict
) -> None:
    """Mutation on BH-1 must not touch layers under any other anchor."""
    bh2 = BoreholeOrm(
        id=uuid7(),
        name="BH-2",
        app_project_id=setup["project"].id,
        project_id="T",
        test_id="T2",
        location_x=10.0,
        location_y=0.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(bh2)
    await db_session.flush()
    c1 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    c2_bh2 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["clay"].id,
        borehole_id=bh2.id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add_all([c1, c2_bh2])
    await db_session.commit()

    # Now mutate c1; c2_bh2's layer must not change.
    layer_bh2_before = await db_session.get(LithoLayerOrm, c2_bh2.id)
    assert layer_bh2_before is not None
    base_before = layer_bh2_before.depth_base_m
    c1.depth_top_m = 5.0
    await db_session.commit()
    await db_session.refresh(layer_bh2_before)
    assert layer_bh2_before.depth_base_m == base_before
    # Sanity: c1's own layer did get updated.
    layer1 = await db_session.get(LithoLayerOrm, c1.id)
    assert layer1 is not None and layer1.depth_top_m == 5.0


@pytest.mark.asyncio
async def test_inserting_contact_recomputes_neighbour_base(
    db_session: AsyncSession, setup: dict
) -> None:
    """Insert a NEW contact between c1 and c3 → c1's base shortens to the new top."""
    c1 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=0.0,
        source="manual_pick",
        confidence="medium",
    )
    c3 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=5.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add_all([c1, c3])
    await db_session.commit()
    layer1 = await db_session.get(LithoLayerOrm, c1.id)
    assert layer1 is not None
    assert layer1.depth_base_m == 5.0

    # Insert c2 between them.
    c2 = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["clay"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.5,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(c2)
    await db_session.commit()

    await db_session.refresh(layer1)
    assert layer1.depth_base_m == 2.5
    layer2 = await db_session.get(LithoLayerOrm, c2.id)
    assert layer2 is not None
    assert layer2.depth_top_m == 2.5
    assert layer2.depth_base_m == 5.0


@pytest.mark.asyncio
async def test_trigger_preserves_correlation_resolution(
    db_session: AsyncSession, setup: dict
) -> None:
    """The contact UUID survives mutation → any correlation row pointing
    at it continues to resolve through the trigger (the load-bearing
    invariant for A3)."""
    contact_id = uuid7()
    contact = FormationContactOrm(
        id=contact_id,
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(contact)
    await db_session.commit()

    # Drag.
    contact.depth_top_m = 3.5
    await db_session.commit()
    # Same UUID still resolves to a layer.
    layer = await db_session.get(LithoLayerOrm, contact_id)
    assert layer is not None
    assert layer.id == contact_id
    assert layer.depth_top_m == 3.5
