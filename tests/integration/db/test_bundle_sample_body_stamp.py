"""A bundle whose samples carry a ``geotech_body_id`` stamp restores cleanly.

Owner's ``test3.strix`` (saved by the packaged app, 2026-09-04) could not be
restored by a fresh backend: ``sample.geotech_body_id`` is an FK → ``body``,
samples are inserted in Phase 2 (with the boreholes) and bodies only in Phase 8,
so the first query-invoked autoflush raised ``ForeignKeyViolationError`` and
the restore answered 500. The same deferred-link rule the cross-section
companion FK already follows applies: strip the stamp on insert, re-attach it
once the bodies exist, and DROP (count + warn) a stamp whose body is not in
the restored project — the "stale window" a re-minted body id leaves behind.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
    restore_project_bundle,
)
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_restore_drops import (
    BundleRestoreDrops,
)

# The litho-solids scene carries real bodies; reuse it rather than rebuild one.
from tests.integration.db.test_project_bundle_litho_solids import built_solid_scene  # noqa: F401


@pytest.mark.asyncio
async def test_sample_body_stamps_survive_a_restore_and_dangling_ones_are_dropped(
    db_session: AsyncSession,
    built_solid_scene: dict,  # noqa: F811 — the imported fixture is injected by name
) -> None:
    """Stamp → body in the bundle: kept. Stamp → no such body: dropped, counted, never a 500."""
    project = built_solid_scene["project"]
    litho = built_solid_scene["litho"]
    project_id = project.id
    formation_id = (
        await db_session.execute(
            select(GeologicalFormationOrm.id)
            .where(GeologicalFormationOrm.app_project_id == project_id)
            .limit(1)
        )
    ).scalar_one()
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-STAMP",
        app_project_id=project_id,
        project_id="STAMP",
        test_id="BH-STAMP",
        location_x=160_010.0,
        location_y=200_010.0,
        epsg=31370,
        total_depth_m=12.0,
    )
    db_session.add(borehole)
    await db_session.flush()
    body = BodyOrm(
        id=uuid7(),
        app_project_id=project_id,
        model_id=litho.id,
        formation_id=formation_id,
        body_ordinal=0,
        source_investigation_id=borehole.id,
    )
    db_session.add(body)
    await db_session.flush()
    body_id = body.id
    kept = SampleOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        depth_top_m=1.0,
        depth_base_m=1.5,
        geotech_body_id=body_id,
    )
    dangling = SampleOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        depth_top_m=2.0,
        depth_base_m=2.5,
        # No live stamp: the FK refuses a dangling id on the row itself; the
        # stale stamp is injected into the BUNDLE below, as a saved file has it.
        geotech_body_id=None,
    )
    db_session.add_all([kept, dangling])
    await db_session.commit()
    # The DB refuses the dangling stamp on the live row (FK); write the bundle
    # with it by hand: this is exactly what a stale stamp in a saved file is.
    bundle = await build_project_bundle(db_session, project)
    stale_body_id = str(uuid4())
    for bh in bundle["boreholes"]:
        for s in bh.get("samples", []):
            if s["id"] == str(dangling.id):
                s["geotech_body_id"] = stale_body_id
    assert any(
        s["geotech_body_id"] == str(body_id)
        for bh in bundle["boreholes"]
        for s in bh.get("samples", [])
    ), "precondition: the bundle carries the kept stamp"

    # Wipe like a cold restore.
    for kind in ("lithostratigraphic", "geological"):
        await db_session.execute(
            delete(GeologicalModelOrm).where(
                GeologicalModelOrm.app_project_id == project_id,
                GeologicalModelOrm.kind == kind,
            )
        )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == project_id)
    )
    await db_session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == project_id)
    )
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await db_session.delete(project)
    await db_session.commit()

    drops = BundleRestoreDrops()
    await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bundle["investigation_reviews"],
        bodies_payload=bundle["bodies"],
        formation_absences_payload=bundle["formation_absences"],
        litho_contact_correlation_edges_payload=bundle["litho_contact_correlation_edges"],
        body_boundary_shapes_payload=bundle["body_boundary_shapes"],
        body_boundary_nodes_payload=bundle["body_boundary_nodes"],
        litho_solids_payload=bundle["litho_solids"],
        drops=drops,
    )
    await db_session.commit()

    rows = {
        r.id: r.geotech_body_id
        for r in (
            await db_session.execute(select(SampleOrm).where(SampleOrm.borehole_id == borehole.id))
        )
        .scalars()
        .all()
    }
    assert rows[kept.id] == body_id, "a stamp whose body is in the bundle survives the restore"
    assert rows[dangling.id] is None, "a stamp whose body is gone is dropped, not a 500"
    assert drops.sample_body_stamps_dropped == 1
