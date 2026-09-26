"""End-to-end tests for the D-Series section exports (v1.0 gate, ballot 2026-08-26).

Exercises the full HTTP + DB + partition-resolution + GEOLib path for
``POST /projects/{pid}/sections/{sid}/export/dstability`` and
``.../export/dsheetpiling``.

These two exports differ from every other section export in their input:
D-Stability needs the section's closed POLYGONS and D-Sheet needs a 1-D
column through them, and the fill that produces both is computed in the
renderer. So the request carries the drawn partition — the same payload
shape the 3-D voxel build POSTs — and the route resolves it against the
project's formations. That resolution is what this file covers; the
exporters' own behaviour (soil naming, dropped regions, the
parameters-stay-blank rule) is pinned by the unit suite in
``tests/unit/infrastructure/exporters/``.
"""

from __future__ import annotations

import io
import json
import zipfile
from io import BytesIO
from uuid import UUID

import ezdxf
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# The two geotech units the fixture draws, top-down, with their NAD
# classes and soil codes — the identifiers the export must carry.
_UNITS: tuple[tuple[str, int, str], ...] = (
    ("Zand — NAD 6", 6, "ZAND"),
    ("Klei — NAD 21", 21, "KLEI"),
)


@pytest_asyncio.fixture
async def seeded_dseries_section(db_session: AsyncSession) -> dict:
    """Seed a project + a 200 m section + 2 CPTs + a NAD-classed geotech model.

    No contacts are written: these exports read their geometry from the
    POSTed partition, not from ``formation_contact``. The snapshot is
    still built (it supplies the section metadata and the scope guards),
    which is exactly the coupling worth exercising.
    """
    project = ProjectOrm(id=uuid7(), name="D-Series-Export-Test", status="active")
    db_session.add(project)

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="D-D'",
        description=None,
        start_x=150000.0,
        start_y=200000.0,
        end_x=150200.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=25.0,
        vertical_exaggeration=1.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
    )
    db_session.add(section)

    cpts = []
    for index, easting in enumerate((150050.0, 150150.0)):
        cpt = CptOrm(
            id=uuid7(),
            name=f"CPT-{index}",
            cpt_type="CPTU",
            project_id="GEF",
            test_id=f"GEF/dseries-{index}",
            app_project_id=project.id,
            location_x=easting,
            location_y=200005.0,
            elevation_m=12.0 - index * 0.5,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=20.0,
        )
        db_session.add(cpt)
        cpts.append(cpt)

    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Main",
        description=None,
        is_active=True,
        kind="geological",
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        description=None,
        is_active=True,
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    geotech_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geotech",
        description=None,
        is_active=True,
        kind="geotechnical",
        parent_model_id=litho_model.id,
    )
    db_session.add_all([geo_model, litho_model, geotech_model])

    formations = []
    for order, (name, nad_class, soil) in enumerate(_UNITS):
        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project.id,
            name=name,
            code=f"NAD{nad_class}",
            color="#33aa44",
            display_order=order,
            lithology=soil,
            nad_class=nad_class,
            litho_main_soil_code=soil,
        )
        db_session.add(formation)
        formations.append(formation)

    await db_session.commit()

    # The partition the renderer would POST: two columns at 50 m and
    # 150 m along the line, one gap, one region per unit. Fractions are
    # gap-local; the route resolves them to 50..150 m.
    partition = {
        "start_x": 150000.0,
        "start_y": 200000.0,
        "end_x": 150200.0,
        "end_y": 200000.0,
        "columns": [
            {
                "investigation_id": str(cpts[0].id),
                "along_m": 50.0,
                "world_x": 150050.0,
                "world_y": 200000.0,
            },
            {
                "investigation_id": str(cpts[1].id),
                "along_m": 150.0,
                "world_x": 150150.0,
                "world_y": 200000.0,
            },
        ],
        "regions": [
            {
                "formation_id": str(formations[0].id),
                "body_id": "body-sand",
                "polygon": [[0.0, 12.0], [1.0, 11.5], [1.0, 5.5], [0.0, 6.0]],
                "gap_index": 0,
            },
            {
                "formation_id": str(formations[1].id),
                "body_id": "body-clay",
                "polygon": [[0.0, 6.0], [1.0, 5.5], [1.0, -2.5], [0.0, -2.0]],
                "gap_index": 0,
            },
        ],
    }

    return {
        "project_id": project.id,
        "section_id": section.id,
        "geotech_model_id": geotech_model.id,
        "geo_model_id": geo_model.id,
        "partition": partition,
    }


async def test_dseries1_the_stix_carries_the_drawn_units_under_their_identifiers(
    async_client: AsyncClient, seeded_dseries_section: dict
) -> None:
    """The engineer's two geotech units arrive as NAD-06_ZAND / NAD-21_KLEI."""
    resp = await async_client.post(
        f"/projects/{seeded_dseries_section['project_id']}"
        f"/sections/{seeded_dseries_section['section_id']}/export/dstability",
        params={"model_id": str(seeded_dseries_section["geotech_model_id"])},
        json={"partition": seeded_dseries_section["partition"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-disposition"].endswith('.stix"')

    with zipfile.ZipFile(BytesIO(resp.content)) as archive:
        soils = json.loads(archive.read("soils.json").decode("utf-8"))
        geometry = json.loads(archive.read("geometries/geometry.json").decode("utf-8"))

    codes = {soil["Code"] for soil in soils["Soils"]}
    assert "NAD-06_ZAND" in codes
    assert "NAD-21_KLEI" in codes
    assert len(geometry["Layers"]) == 2


async def test_dseries2_gap_fractions_resolve_to_the_columns_along_distances(
    async_client: AsyncClient, seeded_dseries_section: dict
) -> None:
    """Fraction 0 is the left column at 50 m, fraction 1 the right at 150 m.

    The same mapping the 3-D voxel builder uses, so a D-Stability export
    and a 3-D build of one section describe the same ground.
    """
    resp = await async_client.post(
        f"/projects/{seeded_dseries_section['project_id']}"
        f"/sections/{seeded_dseries_section['section_id']}/export/dstability",
        params={"model_id": str(seeded_dseries_section["geotech_model_id"])},
        json={"partition": seeded_dseries_section["partition"]},
    )
    assert resp.status_code == 200, resp.text

    with zipfile.ZipFile(BytesIO(resp.content)) as archive:
        geometry = json.loads(archive.read("geometries/geometry.json").decode("utf-8"))

    xs = {round(point["X"], 3) for layer in geometry["Layers"] for point in layer["Points"]}
    assert xs == {50.0, 150.0}


async def test_dseries3_a_section_with_no_drawn_fill_is_refused_not_emptied(
    async_client: AsyncClient, seeded_dseries_section: dict
) -> None:
    """An empty .stix is a plausible, correctly-named, completely wrong file."""
    empty = dict(seeded_dseries_section["partition"], regions=[])
    resp = await async_client.post(
        f"/projects/{seeded_dseries_section['project_id']}"
        f"/sections/{seeded_dseries_section['section_id']}/export/dstability",
        params={"model_id": str(seeded_dseries_section["geotech_model_id"])},
        json={"partition": empty},
    )

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "dstability_export_refused"


async def test_dseries4_the_shi_carries_the_profile_at_the_requested_fraction(
    async_client: AsyncClient, seeded_dseries_section: dict
) -> None:
    """At the section start the sand top is +12.0; at mid-section +11.75."""
    resp = await async_client.post(
        f"/projects/{seeded_dseries_section['project_id']}"
        f"/sections/{seeded_dseries_section['section_id']}/export/dsheetpiling",
        params={"model_id": str(seeded_dseries_section["geotech_model_id"]), "fraction": 0.25},
        json={"partition": seeded_dseries_section["partition"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-disposition"].endswith('.shi"')

    text = resp.content.decode("cp1252")
    profile = text[text.index("[SOIL PROFILES]") : text.index("[END OF SOIL PROFILES]")]

    # fraction 0.25 of a 200 m section is 50 m — the LEFT column exactly,
    # where the fixture's sand runs +12.0 down to +6.0.
    assert "NAD-06_ZAND" in profile
    assert "12.00" in profile
    assert "TODO" in text


async def test_dseries5_a_position_with_no_drawn_ground_is_refused(
    async_client: AsyncClient, seeded_dseries_section: dict
) -> None:
    """The drawn fill spans 50..150 m; the section's start endpoint is bare."""
    resp = await async_client.post(
        f"/projects/{seeded_dseries_section['project_id']}"
        f"/sections/{seeded_dseries_section['section_id']}/export/dsheetpiling",
        params={"model_id": str(seeded_dseries_section["geotech_model_id"]), "fraction": 0.0},
        json={"partition": seeded_dseries_section["partition"]},
    )

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "dsheetpiling_export_refused"


async def test_dseries6_a_section_in_another_project_is_not_exportable(
    async_client: AsyncClient, seeded_dseries_section: dict
) -> None:
    """The project_id in the URL is the scope guard, same as every export."""
    resp = await async_client.post(
        f"/projects/{uuid7()}/sections/{seeded_dseries_section['section_id']}/export/dstability",
        params={"model_id": str(seeded_dseries_section["geotech_model_id"])},
        json={"partition": seeded_dseries_section["partition"]},
    )

    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# DXF with the fill (owner 2026-09-26: "it should literally look like litho
# fill in app if i export a litho fill")
# ---------------------------------------------------------------------------


async def test_dxf_fill1_the_posted_partition_becomes_hatches_and_the_cpt_series_a_curve(
    seeded_dseries_section: dict, async_client: AsyncClient, db_session: AsyncSession
) -> None:
    """One HATCH per drawn region on the unit's layer, one qc polyline per CPT with a series."""
    from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

    first_cpt = UUID(seeded_dseries_section["partition"]["columns"][0]["investigation_id"])
    db_session.add(
        CptSeriesOrm(
            cpt_id=first_cpt,
            depths_m=[0.0, 1.0, 2.0],
            qc_mpa=[2.0, 8.0, 20.0],
            fs_mpa=None,
            u2_mpa=None,
            rf_pct=[1.0, 2.0, 3.0],
            q_total_mpa=None,
            rf_source=None,
        )
    )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{seeded_dseries_section['project_id']}/sections/"
        f"{seeded_dseries_section['section_id']}/export/dxf"
        f"?model_id={seeded_dseries_section['geotech_model_id']}",
        json={"partition": seeded_dseries_section["partition"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/dxf")
    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    msp = doc.modelspace()
    hatches = list(msp.query("HATCH"))
    assert len(hatches) == 2
    assert sorted(h.dxf.layer.split(" - ")[0] for h in hatches) == [
        "GeoModel-NAD-06_ZAND",
        "GeoModel-NAD-21_KLEI",
    ]
    qc = list(msp.query("LWPOLYLINE[layer=='Investigations-CPT-qc']"))
    assert len(qc) == 1
    # The CPT-1 column has no series, so no second curve.
    assert len(list(msp.query("LWPOLYLINE[layer=='Investigations-CPT-Rf']"))) == 1


async def test_dxf_fill2_the_old_get_still_answers_the_contact_lines_only(
    seeded_dseries_section: dict, async_client: AsyncClient
) -> None:
    """Additive API: the GET a 0.1.x client calls keeps working, without a fill."""
    resp = await async_client.get(
        f"/projects/{seeded_dseries_section['project_id']}/sections/"
        f"{seeded_dseries_section['section_id']}/export/dxf"
        f"?model_id={seeded_dseries_section['geotech_model_id']}"
    )
    assert resp.status_code == 200, resp.text
    # The app-id table names HATCHBACKGROUNDCOLOR, so count entities, not bytes.
    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    assert not list(doc.modelspace().query("HATCH"))


async def test_dxf_fill3_no_partition_posts_the_line_drawing_with_the_curves(
    seeded_dseries_section: dict, async_client: AsyncClient
) -> None:
    """The stratigraphy axis has no litho partition: it posts none and still gets a DXF."""
    resp = await async_client.post(
        f"/projects/{seeded_dseries_section['project_id']}/sections/"
        f"{seeded_dseries_section['section_id']}/export/dxf"
        f"?model_id={seeded_dseries_section['geotech_model_id']}",
        json={},
    )
    assert resp.status_code == 200, resp.text
    # The app-id table names HATCHBACKGROUNDCOLOR, so count entities, not bytes.
    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    assert not list(doc.modelspace().query("HATCH"))
