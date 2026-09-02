"""End-to-end tests for the DXF section export endpoint (v1.0 MVP #5).

Sets up: project → section → CPTs + boreholes near the section line
→ active geological model → formation contacts → calls
``GET /projects/{pid}/sections/{sid}/export/dxf`` → asserts response
shape + parses the returned DXF.

Single 200 happy-path test + 404 paths for missing section / model.
The exporter's own behaviour (entity counts, layer colours, sorting)
is pinned by the unit suite in
``tests/unit/infrastructure/exporters/``; here we exercise the
full HTTP + DB + projection + export round trip.
"""

from __future__ import annotations

import io

import ezdxf
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.model_kind import (
    MODEL_KIND_GEOTECHNICAL,
    MODEL_KIND_LITHOSTRATIGRAPHIC,
)


@pytest_asyncio.fixture
async def seeded_section(db_session: AsyncSession) -> dict:
    """Seed a project + section + investigations + active model +
    contacts. Returns a dict of the relevant ids so each test can
    address the URLs without re-querying."""
    project = ProjectOrm(id=uuid7(), name="Export-Test", status="active")
    db_session.add(project)

    # Section is a 200 m east-west line through y=200000.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="A-A'",
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

    # Two CPTs on / near the line.
    cpt_left = CptOrm(
        id=uuid7(),
        name="CPT-L",
        cpt_type="CPTU",
        project_id="GEF",
        test_id="GEF/01",
        app_project_id=project.id,
        location_x=150050.0,  # along ≈ 50 m
        location_y=200005.0,  # offset 5 m → inside the 25 m buffer
        elevation_m=12.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=18.0,
    )
    cpt_right = CptOrm(
        id=uuid7(),
        name="CPT-R",
        cpt_type="CPTU",
        project_id="GEF",
        test_id="GEF/02",
        app_project_id=project.id,
        location_x=150150.0,  # along ≈ 150 m
        location_y=200002.0,
        elevation_m=11.5,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=22.0,
    )
    db_session.add(cpt_left)
    db_session.add(cpt_right)

    # One borehole between them.
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="boornummer-1",
        location_x=150100.0,  # along ≈ 100 m
        location_y=199998.0,
        elevation_m=11.8,
        z_epsg=5710,
        epsg=31370,
        total_depth_m=25.0,
    )
    db_session.add(bh)

    # One CPT FAR off the section line — should be filtered out.
    cpt_far = CptOrm(
        id=uuid7(),
        name="CPT-far",
        cpt_type="CPTU",
        project_id="GEF",
        test_id="GEF/far",
        app_project_id=project.id,
        location_x=150100.0,
        location_y=200500.0,  # offset 500 m, way past the buffer
        elevation_m=10.0,
        z_epsg=5710,
        epsg=31370,
        max_depth_m=10.0,
    )
    db_session.add(cpt_far)

    # Active geological model + 2 formations.
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Main",
        description=None,
        is_active=True,
    )
    db_session.add(model)
    boom = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Boom Klei",
        code="BmK",
        color="#ff8800",
        display_order=0,
    )
    diest = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Diest Zand",
        code="Di",
        color="#33aa44",
        display_order=1,
    )
    db_session.add(boom)
    db_session.add(diest)

    # Two contacts per investigation: a Boom Klei top and a Diest
    # top. The polylines should connect them left-to-right.
    contacts = [
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            cpt_id=cpt_left.id,
            depth_top_m=3.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            cpt_id=cpt_left.id,
            depth_top_m=10.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            borehole_id=bh.id,
            depth_top_m=3.5,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            borehole_id=bh.id,
            depth_top_m=11.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=boom.id,
            cpt_id=cpt_right.id,
            depth_top_m=4.0,
            source="manual_pick",
            confidence="medium",
        ),
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=diest.id,
            cpt_id=cpt_right.id,
            depth_top_m=12.0,
            source="manual_pick",
            confidence="medium",
        ),
    ]
    for c in contacts:
        db_session.add(c)

    # Seed every contact id on the section. As of the 2026-06-08
    # "classification follows the test" directive this no longer GATES the
    # export (BuildSectionSnapshot now renders every in-corridor contact
    # regardless), but the production flows still maintain the seeded set for
    # bundle compat, so the fixture keeps it populated to mirror a real
    # post-seed section. test_export_includes_in_corridor_contacts_without_seeding
    # proves the gate is gone by clearing this set.
    section.seeded_formation_contact_ids = [c.id for c in contacts]

    await db_session.commit()

    return {
        "project_id": project.id,
        "section_id": section.id,
        "model_id": model.id,
        "cpt_left_id": cpt_left.id,
        "cpt_right_id": cpt_right.id,
        "bh_id": bh.id,
        "cpt_far_id": cpt_far.id,
    }


async def test_dxf_export_happy_path(async_client: AsyncClient, seeded_section: dict) -> None:
    """A real export round-trip — section through 2 CPTs + 1 borehole
    with 2 formations × 3 contacts each → DXF with 2 polylines + 3
    column lines + title block."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/dxf")
    # Content-Disposition proposes a filename based on the section
    # name. "A-A'" sanitises to "A-A_" (single quote → underscore).
    assert "filename=" in resp.headers["content-disposition"]

    payload = resp.content
    assert payload, "empty body"

    doc = ezdxf.read(io.StringIO(payload.decode("utf-8")))
    msp = doc.modelspace()

    # 3 investigation columns (left CPT, BH, right CPT). Far CPT is
    # outside the projection buffer → filtered out.
    lines = list(msp.query("LINE[layer=='Investigations']"))
    assert len(lines) == 3

    # 2 formation polylines (Boom Klei + Diest Zand), each with 3
    # vertices (one per anchor with that contact).
    polylines = list(msp.query("LWPOLYLINE"))
    assert len(polylines) == 2
    for poly in polylines:
        assert len(list(poly.get_points())) == 3

    # The layer namespace carries both formations.
    layer_names = {layer.dxf.name for layer in doc.layers}
    assert "GeoModel-Boom Klei" in layer_names
    assert "GeoModel-Diest Zand" in layer_names
    # Investigations layer was registered by the exporter.
    assert "Investigations" in layer_names

    # Far CPT must NOT have produced a column line. Total of 3
    # already asserts this; double-check by name absence in labels.
    labels = [e.dxf.text for e in msp.query("TEXT[layer=='Investigations']")]
    assert "CPT-far" not in labels


async def test_export_includes_in_corridor_contacts_without_seeding(
    async_client: AsyncClient, seeded_section: dict, db_session: AsyncSession
) -> None:
    """Classification follows the test (owner directive 2026-06-08): clearing
    the section's seeded set must NOT strip formation content from the export.

    Every contact whose anchor projects into the corridor still renders — the
    seeded set no longer gates the section-scoped export. This is the explicit
    end-to-end proof that the 2026-05-17 explicit-content gate was lifted for
    classification.
    """
    # Wipe the seeded set entirely, then export.
    section = await db_session.get(CrossSectionOrm, seeded_section["section_id"])
    assert section is not None
    section.seeded_formation_contact_ids = []
    await db_session.commit()

    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 200, resp.text

    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    msp = doc.modelspace()
    # Same content as the seeded happy path — both formation polylines and all
    # three in-corridor investigation columns, despite zero seeded ids.
    assert len(list(msp.query("LWPOLYLINE"))) == 2
    assert len(list(msp.query("LINE[layer=='Investigations']"))) == 3


async def test_export_404_when_section_does_not_exist(
    async_client: AsyncClient, seeded_section: dict
) -> None:
    """Missing section id → 404 with a helpful message."""
    bogus_section = uuid7()
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{bogus_section}/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


async def test_export_404_when_model_does_not_exist(
    async_client: AsyncClient, seeded_section: dict
) -> None:
    """Missing model id → 404."""
    bogus_model = uuid7()
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(bogus_model)},
    )
    assert resp.status_code == 404


async def test_export_404_when_section_in_different_project(
    async_client: AsyncClient,
    seeded_section: dict,
    db_session: AsyncSession,
) -> None:
    """Section that belongs to another project → 404.

    Cross-project scope guard — the section repo's app_project_id
    check inside BuildSectionSnapshot is what stops a section from
    one project being exported as if it belonged to another. The
    test pins that guard.
    """
    # Create a second project; ask for the FIRST project's section
    # under the SECOND project's URL prefix.
    other = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(other)
    await db_session.commit()

    resp = await async_client.get(
        f"/projects/{other.id}/sections/{seeded_section['section_id']}/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Geotech-axis export — the unit identifiers survive the DB round trip.
#
# MISSING-LINK REGRESSION TEST (debt #104, added 2026-08-26). The naming
# scheme itself is pinned at unit level (the exporters are pure
# ``SectionSnapshot -> bytes`` transforms, so that is the right layer), and a
# non-circular guard pins the snapshot fields against the real ORM columns.
# Neither proves the MIDDLE link: that ``geological_formation.nad_class`` /
# ``litho_main_soil_code`` actually reach a downloaded artefact through
# BuildSectionSnapshot on a real geotech model. Every other export
# integration test seeds a GEOLOGICAL model, where both columns are NULL by
# definition — so a regression that dropped the identifiers on the way out
# would have left the whole suite green. That is the gap these three close.
#
# NOTE ON TDD SHAPE: these pins were written AFTER the implementation. A
# red-first run is impractical at integration level — the RED state needs a
# checkout of develop without the change plus its own migrate-and-seed cycle
# against the integration DB, and the wrapper holds an exclusive lock. The
# unit-level pins in tests/unit/infrastructure/exporters/ WERE written
# red-first (9 failed / 2 passed on the first run, the 2 green being the
# geological control pins).
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seeded_geotech_model(db_session: AsyncSession, seeded_section: dict) -> dict:
    """Add a litho + geotech model to the seeded section's project.

    Mirrors the real hierarchy — geological -> lithostratigraphic ->
    geotechnical — with the geotech unit carrying the identity tuple
    ``SubdivideAllBodies`` writes (``nad_class`` +
    ``litho_main_soil_code`` + ``source_litho_formation_id``).

    Seeds TWO geotech units on purpose, one classified and one
    unclassified skeleton band, so a single round trip exercises both
    halves of the naming rule: a class renames the unit, no class leaves
    the name byte-identical.
    """
    project_id = seeded_section["project_id"]

    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Litho",
        description=None,
        is_active=False,
        kind=MODEL_KIND_LITHOSTRATIGRAPHIC,
        parent_model_id=seeded_section["model_id"],
    )
    db_session.add(litho_model)
    await db_session.flush()
    geotech_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Geotech",
        description=None,
        is_active=False,
        kind=MODEL_KIND_GEOTECHNICAL,
        parent_model_id=litho_model.id,
    )
    db_session.add(geotech_model)

    # The litho unit the geotech units subdivide.
    litho_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Zand van Diest",
        code=None,
        color="#e8c86a",
        display_order=10,
        litho_main_soil_code="ZAND",
    )
    db_session.add(litho_sand)
    await db_session.flush()

    # Classified geotech unit — the case debt #104 exists for.
    geotech_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Zand van Diest (NAD 6)",
        code=None,
        color="#e8c86a",
        display_order=20,
        nad_class=6,
        litho_main_soil_code="ZAND",
        source_litho_formation_id=litho_sand.id,
    )
    # Unclassified skeleton band — carries a soil code but no class, so
    # its NAME must stay exactly what it is today.
    geotech_skeleton = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Boom Klei skeleton",
        code=None,
        color="#8899aa",
        display_order=15,
        nad_class=None,
        litho_main_soil_code="KLEI",
        source_litho_formation_id=litho_sand.id,
    )
    db_session.add(geotech_sand)
    db_session.add(geotech_skeleton)

    # One contact per unit at each of the two in-corridor CPTs, so both
    # units get a real surface polyline in the drawing.
    for formation, depth in ((geotech_skeleton, 2.0), (geotech_sand, 6.0)):
        for anchor in (seeded_section["cpt_left_id"], seeded_section["cpt_right_id"]):
            db_session.add(
                FormationContactOrm(
                    id=uuid7(),
                    model_id=geotech_model.id,
                    formation_id=formation.id,
                    cpt_id=anchor,
                    depth_top_m=depth,
                    source="manual_pick",
                    confidence="medium",
                )
            )

    await db_session.commit()

    return {
        "geotech_model_id": geotech_model.id,
        "geotech_sand_id": geotech_sand.id,
        "geotech_skeleton_id": geotech_skeleton.id,
    }


async def test_geotech_dxf_export_carries_the_nad_unit_identifiers(
    async_client: AsyncClient, seeded_section: dict, seeded_geotech_model: dict
) -> None:
    """A geotech-model DXF must name its layers by NAD class + soil.

    End-to-end proof of debt #104: the identifiers live only on
    ``geological_formation``, and before this slice nothing carried them
    from that row into a downloaded artefact.
    """
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(seeded_geotech_model["geotech_model_id"])},
    )
    assert resp.status_code == 200, resp.text

    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    layer_names = {layer.dxf.name for layer in doc.layers}

    # The classified unit leads with its machine identifier.
    assert "GeoModel-NAD-06_ZAND - Zand van Diest (NAD 6)" in layer_names
    # ...and the class + soil are readable in CAD's layer properties.
    classified = doc.layers.get("GeoModel-NAD-06_ZAND - Zand van Diest (NAD 6)")
    assert "NAD class 6" in classified.description
    assert "soil ZAND" in classified.description

    # The unclassified skeleton band keeps its name byte-identical —
    # a unit is renamed ONLY when it carries a nad_class.
    assert "GeoModel-Boom Klei skeleton" in layer_names
    assert not any(n.startswith("GeoModel-NAD-") and "skeleton" in n for n in layer_names)

    # The drawing states its own mapping, naming the formation UUID so a
    # downstream script can resolve two units that share a class.
    text = "\n".join(e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT")
    assert "UNIT MAPPING TABLE" in text
    assert "NAD-06_ZAND" in text
    assert str(seeded_geotech_model["geotech_sand_id"]) in text


async def test_geotech_plaxis2d_export_carries_the_mapping_block(
    async_client: AsyncClient, seeded_section: dict, seeded_geotech_model: dict
) -> None:
    """Same round trip for the Plaxis 2D script — material identity plus
    the mapping block an engineer reads to assign materials."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/plaxis2d",
        params={"model_id": str(seeded_geotech_model["geotech_model_id"])},
    )
    assert resp.status_code == 200, resp.text
    script = resp.content.decode("utf-8")

    assert "mat_nad_06_zand = g_i.soilmat()" in script
    assert "mat_nad_06_zand.Identification = 'NAD-06_ZAND - Zand van Diest (NAD 6)'" in script
    # The skeleton band keeps its display-name-only identification.
    assert "mat_boom_klei_skeleton.Identification = 'Boom Klei skeleton'" in script

    header = script.split('"""')[1]
    assert "UNIT MAPPING TABLE" in header
    sand_row = next(line for line in header.splitlines() if "NAD-06_ZAND" in line)
    assert "ZAND" in sand_row
    assert str(seeded_geotech_model["geotech_sand_id"]) in sand_row

    # The emitted script must still be valid Python.
    compile(script, "<plaxis2d>", "exec")


async def test_geological_dxf_layer_names_are_unaffected_by_the_geotech_model(
    async_client: AsyncClient, seeded_section: dict, seeded_geotech_model: dict
) -> None:
    """Control pin: with geotech units present in the SAME project, the
    geological-model export must still name its layers exactly as before
    and emit no mapping table."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(seeded_section["model_id"])},
    )
    assert resp.status_code == 200, resp.text

    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    model_layers = {n.dxf.name for n in doc.layers if n.dxf.name.startswith("GeoModel-")}
    assert model_layers == {"GeoModel-Boom Klei", "GeoModel-Diest Zand"}
    assert doc.layers.get("GeoModel-Boom Klei").description == "Formation 'Boom Klei' (code BmK)"
    text = "\n".join(e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT")
    assert "UNIT MAPPING TABLE" not in text


# ---------------------------------------------------------------------------
# Same-NAD thinning (debt #104b).
#
# Owner ruling 2026-08-26, verbatim: "thin in dxf and pdf, keep plaxis exact,
# shallower parent name wins." The merge rule itself is pinned at unit level in
# tests/unit/application/test_thin_export_units.py; these pins prove the ROUTING
# — that the DXF and PDF handlers opt in and the Plaxis handler does not.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seeded_stacked_same_class(db_session: AsyncSession, seeded_section: dict) -> dict:
    """Two NAD-6 sand units stacked directly on each other, plus a clay above.

    Two stacked units of one class means two different litho / geological
    parents — which is exactly how the geotech stage produces them, since
    its find-or-create keys on ``(nad_class, litho parent, geo parent)``.
    """
    project_id = seeded_section["project_id"]

    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Litho-thin",
        description=None,
        is_active=False,
        kind=MODEL_KIND_LITHOSTRATIGRAPHIC,
        parent_model_id=seeded_section["model_id"],
    )
    db_session.add(litho_model)
    await db_session.flush()
    geotech_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Geotech-thin",
        description=None,
        is_active=False,
        kind=MODEL_KIND_GEOTECHNICAL,
        parent_model_id=litho_model.id,
    )
    db_session.add(geotech_model)

    clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Klei dek (NAD 21)",
        code=None,
        color="#8899aa",
        display_order=30,
        nad_class=21,
        litho_main_soil_code="KLEI",
    )
    shallow_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Zand Quartair (NAD 6)",
        code=None,
        color="#e8c86a",
        display_order=20,
        nad_class=6,
        litho_main_soil_code="ZAND",
    )
    deep_sand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Zand Diest (NAD 6)",
        code=None,
        color="#d8b85a",
        display_order=10,
        nad_class=6,
        litho_main_soil_code="ZAND",
    )
    db_session.add_all([clay, shallow_sand, deep_sand])

    for formation, depth in ((clay, 1.0), (shallow_sand, 4.0), (deep_sand, 8.0)):
        for anchor in (seeded_section["cpt_left_id"], seeded_section["cpt_right_id"]):
            db_session.add(
                FormationContactOrm(
                    id=uuid7(),
                    model_id=geotech_model.id,
                    formation_id=formation.id,
                    cpt_id=anchor,
                    depth_top_m=depth,
                    source="manual_pick",
                    confidence="medium",
                )
            )

    await db_session.commit()
    return {
        "geotech_model_id": geotech_model.id,
        "shallow_name": shallow_sand.name,
        "deep_name": deep_sand.name,
        "clay_name": clay.name,
    }


async def test_dxf_thins_adjacent_same_nad_units_by_default(
    async_client: AsyncClient, seeded_section: dict, seeded_stacked_same_class: dict
) -> None:
    """Two stacked NAD-6 sands read as one material — the DXF shows one,
    named after the SHALLOWER unit, and says what it absorbed."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={"model_id": str(seeded_stacked_same_class["geotech_model_id"])},
    )
    assert resp.status_code == 200, resp.text

    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    sand_layers = [n.dxf.name for n in doc.layers if "NAD-06" in n.dxf.name]
    assert len(sand_layers) == 1, sand_layers
    # Shallower parent name wins.
    assert seeded_stacked_same_class["shallow_name"] in sand_layers[0]
    assert seeded_stacked_same_class["deep_name"] not in sand_layers[0]
    # The clay is a different class and must survive untouched.
    assert any("NAD-21" in n.dxf.name for n in doc.layers)

    # The merge erased a litho/geo boundary — the table keeps it auditable.
    text = "\n".join(e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT")
    assert "Absorbed units" in text
    assert seeded_stacked_same_class["deep_name"] in text


async def test_dxf_thinning_can_be_opted_out_of(
    async_client: AsyncClient, seeded_section: dict, seeded_stacked_same_class: dict
) -> None:
    """A client whose CAD deliverable must show the parent boundaries can
    ask for the exact model without a code change."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/dxf",
        params={
            "model_id": str(seeded_stacked_same_class["geotech_model_id"]),
            "thin_units": "false",
        },
    )
    assert resp.status_code == 200, resp.text

    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    sand_layers = [n.dxf.name for n in doc.layers if "NAD-06" in n.dxf.name]
    assert len(sand_layers) == 2, sand_layers


async def test_plaxis_export_stays_exact_when_the_dxf_thins(
    async_client: AsyncClient, seeded_section: dict, seeded_stacked_same_class: dict
) -> None:
    """Owner ruling: "keep plaxis exact". The script's global soillayer
    stack cannot express an interleaved merge, so it never thins — both
    NAD-6 units keep their own material and their own global layer."""
    resp = await async_client.get(
        f"/projects/{seeded_section['project_id']}/sections/{seeded_section['section_id']}"
        "/export/plaxis2d",
        params={"model_id": str(seeded_stacked_same_class["geotech_model_id"])},
    )
    assert resp.status_code == 200, resp.text
    script = resp.content.decode("utf-8")

    assert seeded_stacked_same_class["shallow_name"] in script
    assert seeded_stacked_same_class["deep_name"] in script
    # One soilmat per unit — three units, none merged.
    declared = [line for line in script.splitlines() if line.endswith("= g_i.soilmat()")]
    assert len(declared) == 3, declared
    # And the exact script never grows the thinning column.
    assert "Absorbed units" not in script
    compile(script, "<plaxis2d>", "exec")
