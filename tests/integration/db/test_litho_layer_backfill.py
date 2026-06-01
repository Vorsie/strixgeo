"""Pin the FormationContact → LithoLayer backfill semantics.

Migration ``n8h9i0j1k2l3_backfill_litho_layer_from_contacts`` is the
A2.5 step that ports per-project litho data from the contact-shape
table to the layer-shape table BEFORE the A3 FE re-shape lands. The
critical invariant — UUIDs are preserved end-to-end so
``litho_correlation_edge`` rows continue to resolve without a schema
change — is the load-bearing piece exercised here.

Covered:
* multi-anchor, multi-formation contiguous fixture → one layer per
  contact, depth_base_m derived from the next contact at the same
  anchor
* terminal-anchor contact (no next) → falls back to anchor total depth
* parent_geo_contact_id is mirrored onto the layer row
* ``litho_correlation_edge.contact_a_id`` still resolves to a
  ``litho_layer`` row after backfill (same UUID)
* synthetic pinch-out contacts (no anchor) are skipped
* contacts on geological (kind='geological') models are skipped
* idempotency: running the SQL twice produces the same row count
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.migrations.versions.n8h9i0j1k2l3_backfill_litho_layer_from_contacts import (  # noqa: E501
    _BACKFILL_SQL,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
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
async def litho_project(db_session: AsyncSession) -> ProjectOrm:
    """Project + 1 litho model + 1 geo model + BH + CPT + 2 formations."""
    project = ProjectOrm(id=uuid7(), name="Backfill test", status="active")
    db_session.add(project)
    await db_session.flush()

    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="TEST",
        test_id="BH-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    cpt = CptOrm(
        id=uuid7(),
        name="CPT-1",
        cpt_type="CPTU",
        app_project_id=project.id,
        project_id="TEST",
        test_id="CPT-001",
        location_x=150010.0,
        location_y=200000.0,
        epsg=31370,
        max_depth_m=12.0,
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo M",
        kind="geological",
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho M",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    sand = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="SAND", color="#fdcb6e"
    )
    clay = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="CLAY", color="#74b9ff"
    )
    db_session.add_all([bh, cpt, litho_model, geo_model, sand, clay])
    await db_session.commit()

    # Stash on the project for the test bodies — keeps the fixture
    # surface terse + dataclass-y. Tests reach for whatever they need.
    project.bh = bh  # type: ignore[attr-defined]
    project.cpt = cpt  # type: ignore[attr-defined]
    project.litho_model = litho_model  # type: ignore[attr-defined]
    project.geo_model = geo_model  # type: ignore[attr-defined]
    project.sand = sand  # type: ignore[attr-defined]
    project.clay = clay  # type: ignore[attr-defined]
    return project


@pytest.mark.asyncio
async def test_backfill_emits_one_layer_per_contact_with_derived_base(
    db_session: AsyncSession, litho_project: ProjectOrm
) -> None:
    """Contiguous BH contacts at [0, 2, 5] (10 m hole) become layers
    [0,2], [2,5], [5,10]."""
    p = litho_project
    contacts = [
        FormationContactOrm(
            id=uuid7(),
            model_id=p.litho_model.id,  # type: ignore[attr-defined]
            formation_id=p.sand.id,  # type: ignore[attr-defined]
            borehole_id=p.bh.id,  # type: ignore[attr-defined]
            depth_top_m=0.0,
            source="borehole_observation",
            confidence="high",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=p.litho_model.id,  # type: ignore[attr-defined]
            formation_id=p.clay.id,  # type: ignore[attr-defined]
            borehole_id=p.bh.id,  # type: ignore[attr-defined]
            depth_top_m=2.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=p.litho_model.id,  # type: ignore[attr-defined]
            formation_id=p.sand.id,  # type: ignore[attr-defined]
            borehole_id=p.bh.id,  # type: ignore[attr-defined]
            depth_top_m=5.0,
            source="interpolated",
            confidence="low",
        ),
    ]
    db_session.add_all(contacts)
    await db_session.commit()

    await db_session.execute(text(_BACKFILL_SQL))
    await db_session.commit()

    layers = list(
        (
            await db_session.execute(
                select(LithoLayerOrm)
                .where(LithoLayerOrm.borehole_id == p.bh.id)  # type: ignore[attr-defined]
                .order_by(LithoLayerOrm.depth_top_m)
            )
        )
        .scalars()
        .all()
    )
    assert len(layers) == 3
    assert layers[0].id == contacts[0].id  # UUID preserved
    assert (layers[0].depth_top_m, layers[0].depth_base_m) == (0.0, 2.0)
    assert (layers[1].depth_top_m, layers[1].depth_base_m) == (2.0, 5.0)
    # terminal contact → falls back to borehole.total_depth_m = 10.0
    assert (layers[2].depth_top_m, layers[2].depth_base_m) == (5.0, 10.0)
    # source map: borehole_observation → observation_layer; rest → manual
    assert layers[0].source == "observation_layer"
    assert layers[1].source == "manual"
    assert layers[2].source == "manual"
    # status defaults to accepted (existing contacts ARE accepted)
    assert all(layer.status == "accepted" for layer in layers)


@pytest.mark.asyncio
async def test_correlation_edge_still_resolves_after_backfill(
    db_session: AsyncSession, litho_project: ProjectOrm
) -> None:
    """The critical regression-prevention test for A3.

    A ``litho_correlation_edge`` row pointing at two FormationContact
    UUIDs MUST resolve to two LithoLayer rows after backfill — same
    UUIDs, different table. This is what lets the FE re-shape land
    without a correlation-table schema change.
    """
    p = litho_project
    # Two anchors, same formation, same depth — a "correlation" worth pinning.
    bh_top = FormationContactOrm(
        id=uuid7(),
        model_id=p.litho_model.id,  # type: ignore[attr-defined]
        formation_id=p.sand.id,  # type: ignore[attr-defined]
        borehole_id=p.bh.id,  # type: ignore[attr-defined]
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    cpt_top = FormationContactOrm(
        id=uuid7(),
        model_id=p.litho_model.id,  # type: ignore[attr-defined]
        formation_id=p.sand.id,  # type: ignore[attr-defined]
        cpt_id=p.cpt.id,  # type: ignore[attr-defined]
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    # Edge requires canonical ordering: contact_a_id < contact_b_id.
    a_id, b_id = sorted([bh_top.id, cpt_top.id])
    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=p.litho_model.id,  # type: ignore[attr-defined]
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=True,
    )
    db_session.add_all([bh_top, cpt_top, edge])
    await db_session.commit()

    await db_session.execute(text(_BACKFILL_SQL))
    await db_session.commit()

    # The edge's contact ids must now resolve as layer ids.
    layer_a = await db_session.get(LithoLayerOrm, edge.contact_a_id)
    layer_b = await db_session.get(LithoLayerOrm, edge.contact_b_id)
    assert layer_a is not None, "edge.contact_a_id orphaned after backfill"
    assert layer_b is not None, "edge.contact_b_id orphaned after backfill"
    assert layer_a.borehole_id == p.bh.id  # type: ignore[attr-defined]
    assert layer_b.cpt_id == p.cpt.id  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_backfill_mirrors_parent_geo_contact_id(
    db_session: AsyncSession, litho_project: ProjectOrm
) -> None:
    """#162 couple survives the backfill — litho_layer.parent_geo_contact_id
    is copied from the source contact."""
    p = litho_project
    geo_contact = FormationContactOrm(
        id=uuid7(),
        model_id=p.geo_model.id,  # type: ignore[attr-defined]
        formation_id=p.sand.id,  # type: ignore[attr-defined]
        borehole_id=p.bh.id,  # type: ignore[attr-defined]
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(geo_contact)
    await db_session.flush()
    litho_contact = FormationContactOrm(
        id=uuid7(),
        model_id=p.litho_model.id,  # type: ignore[attr-defined]
        formation_id=p.sand.id,  # type: ignore[attr-defined]
        borehole_id=p.bh.id,  # type: ignore[attr-defined]
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
        parent_geo_contact_id=geo_contact.id,
    )
    db_session.add(litho_contact)
    await db_session.commit()

    await db_session.execute(text(_BACKFILL_SQL))
    await db_session.commit()

    layer = await db_session.get(LithoLayerOrm, litho_contact.id)
    assert layer is not None
    assert layer.parent_geo_contact_id == geo_contact.id


@pytest.mark.asyncio
async def test_backfill_skips_synthetic_pinch_out_contacts(
    db_session: AsyncSession, litho_project: ProjectOrm
) -> None:
    """Anchor-less contacts (synthetic pinch-outs) don't fit Shape A —
    they're skipped, not stuck in the table with a NULL anchor that
    would violate the XOR CHECK."""
    p = litho_project
    synthetic = FormationContactOrm(
        id=uuid7(),
        model_id=p.litho_model.id,  # type: ignore[attr-defined]
        formation_id=p.sand.id,  # type: ignore[attr-defined]
        borehole_id=None,
        cpt_id=None,
        depth_top_m=2.0,
        source="pinch_out_extrapolation",
        confidence="low",
        synthetic_x=150005.0,
        synthetic_y=200000.0,
        synthetic_elevation_m=-1.5,
    )
    db_session.add(synthetic)
    await db_session.commit()

    await db_session.execute(text(_BACKFILL_SQL))
    await db_session.commit()

    layer = await db_session.get(LithoLayerOrm, synthetic.id)
    assert layer is None


@pytest.mark.asyncio
async def test_backfill_ignores_geological_models(
    db_session: AsyncSession, litho_project: ProjectOrm
) -> None:
    """Geological (kind='geological') models don't migrate. The litho_layer
    table is litho-only by Shape A; their contacts stay in formation_contact."""
    p = litho_project
    geo_contact = FormationContactOrm(
        id=uuid7(),
        model_id=p.geo_model.id,  # type: ignore[attr-defined]
        formation_id=p.sand.id,  # type: ignore[attr-defined]
        borehole_id=p.bh.id,  # type: ignore[attr-defined]
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(geo_contact)
    await db_session.commit()

    await db_session.execute(text(_BACKFILL_SQL))
    await db_session.commit()

    layer = await db_session.get(LithoLayerOrm, geo_contact.id)
    assert layer is None


@pytest.mark.asyncio
async def test_backfill_is_idempotent(db_session: AsyncSession, litho_project: ProjectOrm) -> None:
    """ON CONFLICT DO NOTHING — running twice yields the same row count."""
    p = litho_project
    db_session.add(
        FormationContactOrm(
            id=uuid7(),
            model_id=p.litho_model.id,  # type: ignore[attr-defined]
            formation_id=p.sand.id,  # type: ignore[attr-defined]
            borehole_id=p.bh.id,  # type: ignore[attr-defined]
            depth_top_m=1.0,
            source="manual_pick",
            confidence="medium",
        )
    )
    await db_session.commit()

    await db_session.execute(text(_BACKFILL_SQL))
    await db_session.commit()
    first_count = await db_session.scalar(
        select(LithoLayerOrm.id).where(LithoLayerOrm.borehole_id == p.bh.id)  # type: ignore[attr-defined]
    )
    assert first_count is not None

    await db_session.execute(text(_BACKFILL_SQL))
    await db_session.commit()
    rows = list(
        (
            await db_session.execute(
                select(LithoLayerOrm).where(LithoLayerOrm.borehole_id == p.bh.id)  # type: ignore[attr-defined]
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1, "ON CONFLICT DO NOTHING should keep row count at 1"
