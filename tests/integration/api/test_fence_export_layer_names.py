"""The fence DXF names its layers by the UNIT IDENTIFIER, resolved from the DB.

Owner ruling 2026-08-28, verbatim: *"use unit identifier for layer names you
can do that already"*.

Why this test exists at the INTEGRATION level: the identity the layer name is
built from (``nad_class`` + ``litho_main_soil_code``) is NOT in the POSTed
payload — the renderer sends only ``formation_id``, a display name, a colour
and triangles. The route looks the identity up in the database. That lookup is
the whole feature, and a unit test cannot exercise it: if the query filter is
wrong the export silently falls back to display names and the DXF looks
plausible while carrying the old, uninformative layers.

The lookup is also scoped by project, which makes it a security boundary as
well as a naming one — FL3 pins that a formation belonging to a DIFFERENT
project is never resolved.
"""

from __future__ import annotations

import ezdxf
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


def _panel(formation_id: str, name: str, color: str, base_z: float) -> dict:
    """One square wall panel, two triangles, at a distinct elevation."""
    return {
        "formation_id": formation_id,
        "name": name,
        "color": color,
        "vertices": [
            [100.0, 200.0, base_z],
            [110.0, 200.0, base_z],
            [110.0, 200.0, base_z + 2.0],
            [100.0, 200.0, base_z + 2.0],
        ],
        "triangles": [[0, 1, 2], [0, 2, 3]],
    }


async def _layers_of(client: AsyncClient, project_id, model_id, panels) -> set[str]:
    """POST the panels and return the layer names the DXF came back with."""
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{model_id}/export/fence-dxf",
        json={"panels": panels},
    )
    assert resp.status_code == 200, resp.text
    doc = ezdxf.read(__import__("io").StringIO(resp.content.decode("utf-8")))
    return {e.dxf.layer for e in doc.modelspace() if e.dxftype() == "3DFACE"}


@pytest_asyncio.fixture
async def project_with_units(db_session: AsyncSession):
    """A project with two geotech rows of the SAME class+soil, and one litho row.

    The two geotech rows are the shape that produced 13 indistinguishable
    ``Fence-SAND`` layers in the owner's export: same NAD class, same soil,
    different rows (they differ only by their derived geological label).
    """
    project = ProjectOrm(id=uuid7(), name="fence layer naming", status="active")
    db_session.add(project)
    await db_session.flush()

    twin_a = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND (NAD 6) A",
        color="#d4b84a",
        display_order=0,
        nad_class=6,
        litho_main_soil_code="ZAND",
    )
    twin_b = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND (NAD 6) B",
        color="#d4b84a",
        display_order=1,
        nad_class=6,
        litho_main_soil_code="ZAND",
    )
    litho = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI",
        color="#b0bec8",
        display_order=2,
        nad_class=None,
        litho_main_soil_code="KLEI",
    )
    # The three-level chain the schema enforces
    # (ck_geological_model_kind_parent_null): a geological model has NO parent,
    # while a litho and a geotech model must each carry theirs.
    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="geological",
        kind="geological",
    )
    db_session.add(geo_model)
    await db_session.flush()
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="litho",
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    db_session.add(litho_model)
    await db_session.flush()
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="geotech",
        kind="geotechnical",
        parent_model_id=litho_model.id,
    )
    db_session.add_all([twin_a, twin_b, litho, model])
    await db_session.commit()
    return project, twin_a, twin_b, litho, model


async def test_fl1_two_rows_of_one_identifier_land_on_one_layer(
    async_client: AsyncClient,
    project_with_units,
) -> None:
    """The 13-SAND-layers defect: same class + soil is ONE material layer."""
    project, twin_a, twin_b, _litho, model = project_with_units
    layers = await _layers_of(
        async_client,
        project.id,
        model.id,
        [
            _panel(str(twin_a.id), "ZAND (NAD 6) A", "#d4b84a", 0.0),
            _panel(str(twin_b.id), "ZAND (NAD 6) B", "#d4b84a", 5.0),
        ],
    )
    assert layers == {"Fence-NAD-06_ZAND"}


async def test_fl2_a_litho_unit_is_named_by_its_soil_code(
    async_client: AsyncClient,
    project_with_units,
) -> None:
    """A unit with no NAD class is identified by the soil it is."""
    project, _a, _b, litho, model = project_with_units
    layers = await _layers_of(
        async_client,
        project.id,
        model.id,
        [_panel(str(litho.id), "KLEI", "#b0bec8", 0.0)],
    )
    assert layers == {"Fence-KLEI"}


async def test_fl3_a_formation_from_another_project_is_never_resolved(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_units,
) -> None:
    """The lookup is project-scoped, so a foreign id falls back to the name.

    A leak here would be worse than a naming bug: it would mean one project's
    export could read another project's units.
    """
    project, _a, _b, _litho, model = project_with_units
    other = ProjectOrm(id=uuid7(), name="someone else", status="active")
    db_session.add(other)
    await db_session.flush()
    foreign = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=other.id,
        name="ZAND (NAD 8)",
        color="#d4b84a",
        display_order=0,
        nad_class=8,
        litho_main_soil_code="ZAND",
    )
    db_session.add(foreign)
    await db_session.commit()

    layers = await _layers_of(
        async_client,
        project.id,
        model.id,
        [_panel(str(foreign.id), "ZAND (NAD 8)", "#d4b84a", 0.0)],
    )
    # Falls back to the display name — NOT the foreign project's identifier.
    assert layers == {"Fence-ZAND (NAD 8)"}
