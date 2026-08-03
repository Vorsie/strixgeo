"""Editing a collar elevation must stale the 3-D solids, not only the TINs.

A contact's absolute z is ``elevation_m − depth_top_m``, so correcting a wrong
collar Z moves every piece of geometry anchored at that investigation. Debt #34
closed that hole for the geological TINs (``formation_surface``); the voxel
litho/geotech build caches its bodies in a different table
(``litho_body_solid``), and no elevation path ever touched it — so the 3-D
viewer kept drawing the old bodies with no "needs rebuild" signal while the
2-D sections showed the corrected geometry.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def built_model_scene(db_session: AsyncSession) -> dict:
    """A project whose litho model has a built (fresh) 3-D solid and TIN.

    Both a CPT and a borehole carry a contact in the litho model, so either
    elevation endpoint is enough to invalidate the cached geometry.
    """
    project = ProjectOrm(id=uuid7(), name="Elevation staleness", status="active")
    db_session.add(project)
    await db_session.flush()

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-1",
        cpt_type="CPTU",
        app_project_id=project.id,
        project_id="ELEV",
        test_id="ELEV/CPT-1",
        location_x=150_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        epsg=31370,
        z_epsg=5710,
    )
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="ELEV",
        test_id="ELEV/BH-1",
        location_x=150_050.0,
        location_y=200_050.0,
        elevation_m=5.2,
        epsg=31370,
        total_depth_m=10.0,
    )
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Geo", kind="geological"
    )
    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="ZAND", color="#fdcb6e"
    )
    db_session.add_all([cpt, borehole, geo_model, formation])
    await db_session.flush()

    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    db_session.add(litho_model)
    await db_session.flush()

    db_session.add_all(
        [
            FormationContactOrm(
                id=uuid7(),
                model_id=litho_model.id,
                formation_id=formation.id,
                cpt_id=cpt.id,
                depth_top_m=1.0,
                source="manual_pick",
            ),
            FormationContactOrm(
                id=uuid7(),
                model_id=litho_model.id,
                formation_id=formation.id,
                borehole_id=borehole.id,
                depth_top_m=1.5,
                source="manual_pick",
            ),
        ]
    )
    solid = LithoBodySolidOrm(
        id=uuid7(),
        model_id=litho_model.id,
        body_id=uuid7(),
        formation_id=formation.id,
        method="tin",
        vertices=[],
        triangles=[],
        source_pick_count=2,
        source_pick_checksum=b"",
        is_stale=False,
    )
    surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        method="tin",
        vertices=[],
        triangles=[],
        source_contact_count=2,
        source_contact_checksum=b"",
        is_stale=False,
    )
    db_session.add_all([solid, surface])
    await db_session.commit()
    return {
        "project": project,
        "cpt": cpt,
        "borehole": borehole,
        "solid_id": solid.id,
        "surface_id": surface.id,
    }


async def _staleness(db_session: AsyncSession, scene: dict) -> tuple[bool, bool]:
    """Re-read (solid, surface) staleness from the DB, bypassing the identity map."""
    db_session.expunge_all()
    solid = await db_session.get(LithoBodySolidOrm, scene["solid_id"])
    surface = await db_session.get(FormationSurfaceOrm, scene["surface_id"])
    assert solid is not None and surface is not None
    return solid.is_stale, surface.is_stale


async def test_correcting_a_cpt_collar_z_marks_the_3d_solids_for_rebuild(
    async_client: AsyncClient,
    built_model_scene: dict,
    db_session: AsyncSession,
) -> None:
    """The engineer fixes a wrong CPT elevation — the 3-D model must say "rebuild me"."""
    scene = built_model_scene
    resp = await async_client.patch(
        f"/cpt/{scene['cpt'].id}/elevation?project_id={scene['project'].id}",
        json={"elevation_m": 6.4},
    )
    assert resp.status_code == 200

    solid_stale, surface_stale = await _staleness(db_session, scene)
    assert surface_stale is True, "regression: the geological TIN staleness (debt #34) broke"
    assert solid_stale is True, (
        "the 3-D litho solids still read as fresh after the collar Z moved — "
        "the viewer would keep drawing the old bodies with no rebuild prompt"
    )


async def test_correcting_a_borehole_collar_z_marks_the_3d_solids_for_rebuild(
    async_client: AsyncClient,
    built_model_scene: dict,
    db_session: AsyncSession,
) -> None:
    """Same rule on the borehole endpoint — the two paths must not diverge."""
    scene = built_model_scene
    resp = await async_client.patch(
        f"/borehole/{scene['borehole'].id}/elevation?project_id={scene['project'].id}",
        json={"elevation_m": 4.1},
    )
    assert resp.status_code == 200

    solid_stale, surface_stale = await _staleness(db_session, scene)
    assert surface_stale is True
    assert solid_stale is True


async def test_an_investigation_with_no_contacts_stales_nothing(
    async_client: AsyncClient,
    built_model_scene: dict,
    db_session: AsyncSession,
) -> None:
    """A collar edit on an uninterpreted investigation must not nag about a rebuild."""
    scene = built_model_scene
    lonely = CptOrm(
        id=uuid7(),
        name="CPT-2",
        cpt_type="CPTU",
        app_project_id=scene["project"].id,
        project_id="ELEV",
        test_id="ELEV/CPT-2",
        location_x=151_000.0,
        location_y=201_000.0,
        elevation_m=5.0,
        epsg=31370,
        z_epsg=5710,
    )
    db_session.add(lonely)
    await db_session.commit()

    resp = await async_client.patch(
        f"/cpt/{lonely.id}/elevation?project_id={scene['project'].id}",
        json={"elevation_m": 7.0},
    )
    assert resp.status_code == 200

    solid_stale, surface_stale = await _staleness(db_session, scene)
    assert solid_stale is False
    assert surface_stale is False
