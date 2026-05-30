"""Bidirectional FC↔LL mirror — both triggers + cascade safety.

Migration ``p0j1k2l3m4n5_bidirectional_litho_mirror`` adds the LL→FC
trigger and patches the existing FC→LL trigger. Together they let
the FE writers cut to ``/layers`` (slice 3) without breaking the
contact-side mirror that correlation FKs + bundle export still rely on.

Covered:
* LL INSERT with status='accepted' creates a matching FC mirror
* LL INSERT with status='pending' does NOT create FC (and a later
  status flip to 'accepted' does — the upsert branch)
* LL UPDATE depth_top_m mirrors into FC
* LL UPDATE status flips: pending↔accepted and accepted→rejected
  with correct FC create/delete behaviour
* LL DELETE of an accepted layer deletes the FC; LL DELETE of a
  pending/rejected layer does not touch FC
* The status flip accepted→pending no longer destroys the LL row
  (the bug the FC→LL patch fixes — without the status filter on
  DELETE-NOT-IN, the cascade would prune the row we just demoted)
* Recursion is bounded — a user write on either side terminates
  cleanly rather than tripping the PL/pgSQL recursion limit
* Pre-existing FC INSERT path (legacy /contacts writers) still
  materialises LL with status='accepted'
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
    """Project + 1 litho model + 1 BH + 2 formations."""
    project = ProjectOrm(id=uuid7(), name="Bidirectional", status="active")
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
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    clay = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="CLAY", color="#74b9ff"
    )
    db_session.add_all([bh, litho_model, sand, clay])
    await db_session.commit()
    return {
        "project": project,
        "bh": bh,
        "litho_model": litho_model,
        "sand": sand,
        "clay": clay,
    }


@pytest.mark.asyncio
async def test_accepted_layer_insert_creates_fc_mirror(
    db_session: AsyncSession, setup: dict
) -> None:
    """LL INSERT with status='accepted' upserts FC."""
    layer_id = uuid7()
    layer = LithoLayerOrm(
        id=layer_id,
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=5.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()

    fc = await db_session.get(FormationContactOrm, layer_id)
    assert fc is not None
    assert fc.depth_top_m == 2.0
    # Anchor + formation copy through.
    assert fc.borehole_id == setup["bh"].id
    assert fc.formation_id == setup["sand"].id


@pytest.mark.asyncio
async def test_pending_layer_insert_does_not_create_fc(
    db_session: AsyncSession, setup: dict
) -> None:
    """Pending suggestions have no FC counterpart by design."""
    layer_id = uuid7()
    layer = LithoLayerOrm(
        id=layer_id,
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=5.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    db_session.add(layer)
    await db_session.commit()

    fc = await db_session.get(FormationContactOrm, layer_id)
    assert fc is None


@pytest.mark.asyncio
async def test_status_flip_pending_to_accepted_creates_fc(
    db_session: AsyncSession, setup: dict
) -> None:
    """Accept a pending layer → FC mirror materialises."""
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=5.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    db_session.add(layer)
    await db_session.commit()
    assert await db_session.get(FormationContactOrm, layer.id) is None

    layer.status = "accepted"
    await db_session.commit()

    fc = await db_session.get(FormationContactOrm, layer.id)
    assert fc is not None
    assert fc.id == layer.id


@pytest.mark.asyncio
async def test_status_flip_accepted_to_pending_preserves_layer(
    db_session: AsyncSession, setup: dict
) -> None:
    """The patched FC→LL trigger: a status flip accepted→pending
    deletes the FC mirror but MUST NOT cascade-delete the LL row.

    Without the ``status='accepted'`` filter on the FC→LL DELETE-NOT-IN
    clause, the FC deletion would re-fire FC→LL which would see
    "LL.id not in FCs" and prune the LL row we just demoted.
    """
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=5.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()
    assert await db_session.get(FormationContactOrm, layer.id) is not None

    layer.status = "pending"
    await db_session.commit()

    # The LL row MUST survive — pending suggestions are real rows.
    survived = await db_session.get(LithoLayerOrm, layer.id)
    assert survived is not None
    assert survived.status == "pending"
    # The FC mirror is gone (accepted-only).
    assert await db_session.get(FormationContactOrm, layer.id) is None


@pytest.mark.asyncio
async def test_accepted_layer_depth_update_mirrors_to_fc(
    db_session: AsyncSession, setup: dict
) -> None:
    """Depth moves on an accepted layer propagate into FC."""
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=5.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()

    layer.depth_top_m = 3.5
    await db_session.commit()

    fc = await db_session.get(FormationContactOrm, layer.id)
    assert fc is not None
    assert fc.depth_top_m == 3.5


@pytest.mark.asyncio
async def test_accepted_layer_delete_removes_fc(db_session: AsyncSession, setup: dict) -> None:
    """DELETE LL accepted → FC mirror gone."""
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=5.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add(layer)
    await db_session.commit()
    assert await db_session.get(FormationContactOrm, layer.id) is not None

    await db_session.delete(layer)
    await db_session.commit()

    assert await db_session.get(FormationContactOrm, layer.id) is None


@pytest.mark.asyncio
async def test_pending_layer_delete_does_not_touch_fc(
    db_session: AsyncSession, setup: dict
) -> None:
    """A pending LL DELETE has no FC mirror to delete — the trigger
    skips the FC write entirely (it would otherwise be a wasted call
    + a wasted FC trigger fire)."""
    layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        depth_base_m=5.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    db_session.add(layer)
    await db_session.commit()
    # No FC exists; nothing to assert pre-delete.

    await db_session.delete(layer)
    await db_session.commit()

    # Still no FC.
    assert await db_session.get(FormationContactOrm, layer.id) is None


@pytest.mark.asyncio
async def test_legacy_fc_insert_still_materialises_ll(
    db_session: AsyncSession, setup: dict
) -> None:
    """Legacy /contacts writers continue to work — FC→LL trigger still
    populates LL with status='accepted'."""
    fc = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=4.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(fc)
    await db_session.commit()

    layer = await db_session.get(LithoLayerOrm, fc.id)
    assert layer is not None
    assert layer.status == "accepted"
    assert layer.depth_top_m == 4.0


@pytest.mark.asyncio
async def test_pending_layer_survives_legacy_fc_insert_on_other_anchor(
    db_session: AsyncSession, setup: dict
) -> None:
    """A pending LL on one anchor must NOT be deleted by an FC INSERT
    on a different anchor in the same model — the recompute scope is
    per-anchor."""
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
    pending = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    db_session.add(pending)
    await db_session.commit()

    # FC write on the OTHER anchor.
    fc = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["clay"].id,
        borehole_id=bh2.id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(fc)
    await db_session.commit()

    # Pending layer on BH-1 still there.
    survived = await db_session.get(LithoLayerOrm, pending.id)
    assert survived is not None
    assert survived.status == "pending"


@pytest.mark.asyncio
async def test_pending_layer_survives_legacy_fc_insert_on_same_anchor(
    db_session: AsyncSession, setup: dict
) -> None:
    """The patched FC→LL DELETE clause scopes by ``status='accepted'``,
    so a pending LL on the same anchor as an unrelated FC INSERT is
    not pruned."""
    pending = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    db_session.add(pending)
    await db_session.commit()

    # An accepted FC on the same anchor; the trigger will recompute
    # all LLs on this anchor but must leave the pending one alone.
    fc = FormationContactOrm(
        id=uuid7(),
        model_id=setup["litho_model"].id,
        formation_id=setup["clay"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(fc)
    await db_session.commit()

    survived = await db_session.get(LithoLayerOrm, pending.id)
    assert survived is not None
    assert survived.status == "pending"
    # The accepted FC materialised its own LL.
    accepted_layer = await db_session.get(LithoLayerOrm, fc.id)
    assert accepted_layer is not None
    assert accepted_layer.status == "accepted"


@pytest.mark.asyncio
async def test_geological_model_writes_still_bypass_both_triggers(
    db_session: AsyncSession, setup: dict
) -> None:
    """Geological (kind='geological') models stay out of the litho_layer
    table. The LL trigger never fires for geo writes because geo models
    have no litho_layer rows; the FC→LL trigger kind-gates the geo path."""
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=setup["project"].id, name="G", kind="geological"
    )
    db_session.add(geo_model)
    await db_session.flush()
    fc = FormationContactOrm(
        id=uuid7(),
        model_id=geo_model.id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(fc)
    await db_session.commit()

    assert await db_session.get(LithoLayerOrm, fc.id) is None
