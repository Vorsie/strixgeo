"""Pin ClearLithoModel step 3.5 — pending/rejected layer cleanup (A4 cleanup).

Step 3's contact DELETE cascades to ACCEPTED litho_layer rows via the
FC→LL trigger (which scopes its DELETE-NOT-IN clause to
``status='accepted'`` post-slice-2). Pending and rejected LL rows have
no FC counterpart by Shape A, so they survive the cascade. A "Clear
litho model" gesture must wipe those too — otherwise stale suggestion
ghosts re-appear when the user clicks Suggest again on a "cleared" model.

Also covered:
* BodyOrm rows for the model are deleted by ClearLithoModel (step 4b).
  Bodies reference layers via body_id (SET NULL) and
  extent_*_anchor_layer_id (SET NULL), so the layer delete leaves them
  as stale orphans without the explicit body DELETE.

Covered:
* Pending LL rows are deleted by ClearLithoModel
* Rejected LL rows are deleted by ClearLithoModel
* Mixed (accepted + pending + rejected) → all gone after clear
* Other models' layers untouched
* BodyOrm rows for the model are deleted by ClearLithoModel
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.clear_litho_model import ClearLithoModel
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
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
    """Project + 2 litho models + 1 BH + 1 formation."""
    project = ProjectOrm(id=uuid7(), name="Clear pending", status="active")
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
        id=uuid7(),
        app_project_id=project.id,
        name="G",
        kind="geological",
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    other_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="L2",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="SAND",
        color="#fdcb6e",
        litho_main_soil_code="Z",
    )
    db_session.add_all([bh, geo_model, model, other_model, sand])
    await db_session.commit()
    return {
        "project": project,
        "bh": bh,
        "model": model,
        "other_model": other_model,
        "sand": sand,
    }


@pytest.mark.asyncio
async def test_clear_removes_pending_layers(db_session: AsyncSession, setup: dict) -> None:
    """A pending LL row survives the FC delete cascade and must be wiped
    by step 3.5."""
    pending = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["model"].id,
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

    use_case = ClearLithoModel(db_session)
    await use_case.execute(setup["project"].id, setup["model"].id)
    await db_session.commit()

    rows = list(
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == setup["model"].id)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


@pytest.mark.asyncio
async def test_clear_removes_rejected_layers(db_session: AsyncSession, setup: dict) -> None:
    """Same as pending — rejected LL rows are layer-only and must be cleared."""
    rejected = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=3.0,
        depth_base_m=4.0,
        status="rejected",
        source="segmenter",
        confidence="low",
    )
    db_session.add(rejected)
    await db_session.commit()

    use_case = ClearLithoModel(db_session)
    await use_case.execute(setup["project"].id, setup["model"].id)
    await db_session.commit()

    rows = list(
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == setup["model"].id)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


@pytest.mark.asyncio
async def test_clear_wipes_mixed_status_layers(db_session: AsyncSession, setup: dict) -> None:
    """Accepted + pending + rejected → after clear, zero LL rows remain."""
    accepted = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=0.0,
        depth_base_m=1.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    pending = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    rejected = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=3.0,
        depth_base_m=4.0,
        status="rejected",
        source="segmenter",
        confidence="low",
    )
    db_session.add_all([accepted, pending, rejected])
    await db_session.commit()

    await ClearLithoModel(db_session).execute(setup["project"].id, setup["model"].id)
    await db_session.commit()

    rows = list(
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.model_id == setup["model"].id)
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


@pytest.mark.asyncio
async def test_clear_leaves_other_models_layers_untouched(
    db_session: AsyncSession, setup: dict
) -> None:
    """A pending LL on a SIBLING litho model must survive a clear of the first."""
    on_target = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    on_other = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["other_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=1.0,
        depth_base_m=2.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    db_session.add_all([on_target, on_other])
    await db_session.commit()

    await ClearLithoModel(db_session).execute(setup["project"].id, setup["model"].id)
    await db_session.commit()

    # Target wiped.
    assert (
        await db_session.execute(select(LithoLayerOrm.id).where(LithoLayerOrm.id == on_target.id))
    ).first() is None
    # Sibling survives.
    assert (
        await db_session.execute(select(LithoLayerOrm.id).where(LithoLayerOrm.id == on_other.id))
    ).first() is not None


@pytest.mark.asyncio
async def test_clear_drops_body_rows(db_session: AsyncSession, setup: dict) -> None:
    """ClearLithoModel step 4b: BodyOrm rows for the model are deleted.

    Bodies reference litho_layer rows via body_id (SET NULL on litho_layer)
    and extent_*_anchor_layer_id (SET NULL).  Those FKs become null when the
    layer is deleted, but the body row itself survives — only the explicit
    body DELETE in step 4b removes it.  A Clear must leave zero BodyOrm rows
    for the model; bodies on sibling models are untouched.

    ``source_investigation_id`` is a polymorphic UUID with no FK constraint
    (mirrors the ``formation_contact.borehole_id`` / ``cpt_id`` pattern), so
    we use the fixture's borehole id as a valid UUID without needing an extra
    CPT insert.
    """
    inv_id = setup["bh"].id  # polymorphic, no FK — reuse the fixture borehole

    # Add a pending layer on the sibling model so that the orphan-formation
    # check keeps ``sand`` alive after clearing model A's contacts.
    # Without this, the clear would orphan ``sand`` (no contacts/layers in
    # any model) and cascade-delete BOTH body rows via formation_id FK.
    sibling_layer = LithoLayerOrm(
        id=uuid7(),
        model_id=setup["other_model"].id,
        formation_id=setup["sand"].id,
        borehole_id=setup["bh"].id,
        depth_top_m=0.0,
        depth_base_m=1.0,
        status="pending",
        source="segmenter",
        confidence="low",
    )
    body = BodyOrm(
        id=uuid7(),
        app_project_id=setup["project"].id,
        model_id=setup["model"].id,
        formation_id=setup["sand"].id,
        body_ordinal=0,
        source_investigation_id=inv_id,
    )
    body_on_other = BodyOrm(
        id=uuid7(),
        app_project_id=setup["project"].id,
        model_id=setup["other_model"].id,
        formation_id=setup["sand"].id,
        body_ordinal=0,
        source_investigation_id=inv_id,
    )
    db_session.add_all([sibling_layer, body, body_on_other])
    await db_session.commit()

    await ClearLithoModel(db_session).execute(setup["project"].id, setup["model"].id)
    await db_session.commit()

    # Body on the cleared model is gone.
    assert (
        await db_session.execute(select(BodyOrm.id).where(BodyOrm.id == body.id))
    ).first() is None
    # Body on the sibling model survives.
    assert (
        await db_session.execute(select(BodyOrm.id).where(BodyOrm.id == body_on_other.id))
    ).first() is not None
