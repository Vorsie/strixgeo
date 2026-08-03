"""A geotech section export actually carries geotech content.

Audit 2026-08-02: both section export verbs fell through to
``activeGeologicalModel`` regardless of the axis, so an engineer looking at NAD
sub-bands got a DXF full of Quartair / Boom / Diest formation surfaces and zero
geotech units — a plausible, correctly-named, completely wrong deliverable. The
renderer half of that fix is pinned by
``SectionsToolbar.axisExport.test.tsx``, which mocks the export handlers — so
nothing verified the OTHER half.

That half rests on an assumption worth an explicit test:
``build_section_snapshot`` reads ``geology_repo.list_contacts(model_id)`` —
``formation_contact`` rows — and a GEOTECH model has no formation contacts of
its own. Its boundaries live in ``litho_layer``, and the ``formation_contact``
rows exist ONLY as the LL→FC mirror the DB trigger maintains. Routing the export
to the geotech model turns a wrong-but-populated DXF into an EMPTY one the day
that assumption breaks, and an empty DXF is the same class of silent lie.

The rule, in the rule's own words: exporting a section on the geotechnical axis
writes the geotech units, named as the engineer named them.
"""

from __future__ import annotations

import io

import ezdxf
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# The two geotech units the fixture writes, top-down, with their NAD classes.
# Named the way the geotech stage names them so the DXF layer assertion is
# about a real identifier, not a placeholder.
_GEOTECH_UNITS: tuple[tuple[str, int], ...] = (
    ("Zand — NAD 14", 14),
    ("Zand — NAD 6", 6),
)

# Band boundaries per CPT: (depth_top_m, depth_base_m) for unit 0 and unit 1.
_BANDS_LEFT = ((0.0, 5.0), (5.0, 12.0))
_BANDS_RIGHT = ((0.0, 6.5), (6.5, 14.0))


@pytest_asyncio.fixture
async def seeded_geotech_section(db_session: AsyncSession) -> dict:
    """Seed a project + section + 2 CPTs + a geological→litho→geotech chain.

    The geotech model carries its boundaries as ``litho_layer`` rows with
    ``status='accepted'``; the FC rows the exporter reads are produced by the
    LL→FC mirror trigger, never written here. That is the whole point of the
    test: if the trigger stops mirroring, this fixture yields no contacts and
    the assertions below fail.

    Returns
    -------
    dict
        Ids for the project, the section, and each of the three models.
    """
    project = ProjectOrm(id=uuid7(), name="Geotech-Export-Test", status="active")
    db_session.add(project)

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="G-G'",
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
    for index, (name, along) in enumerate((("CPT-L", 150050.0), ("CPT-R", 150150.0))):
        cpt = CptOrm(
            id=uuid7(),
            name=name,
            cpt_type="CPTU",
            project_id="GEF",
            test_id=f"GEF/geotech-{index}",
            app_project_id=project.id,
            location_x=along,
            location_y=200005.0,
            elevation_m=12.0 - index * 0.5,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=20.0,
        )
        db_session.add(cpt)
        cpts.append(cpt)

    # The three-level chain: geological ← lithostratigraphic ← geotechnical.
    # The parent links are what the creation endpoint enforces; a geotech model
    # is never parentless.
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

    # A geological formation, so the geological model has content of its own —
    # the export must NOT fall back to it.
    boom = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Boom Klei",
        code="BmK",
        color="#ff8800",
        display_order=0,
    )
    db_session.add(boom)

    geotech_formations = []
    for order, (name, nad_class) in enumerate(_GEOTECH_UNITS):
        formation = GeologicalFormationOrm(
            id=uuid7(),
            app_project_id=project.id,
            name=name,
            code=f"NAD{nad_class}",
            color="#33aa44",
            display_order=order,
            lithology="ZAND",
            nad_class=nad_class,
            parent_formation_id=boom.id,
        )
        db_session.add(formation)
        geotech_formations.append(formation)

    await db_session.flush()

    # The geological model gets one contact per CPT so it is genuinely
    # populated — an export routed to the wrong model would succeed and be
    # wrong, which is exactly the bug.
    for cpt in cpts:
        db_session.add(
            FormationContactOrm(
                id=uuid7(),
                model_id=geo_model.id,
                formation_id=boom.id,
                cpt_id=cpt.id,
                depth_top_m=3.0,
                source="manual_pick",
                confidence="medium",
            )
        )

    # Geotech bands — written as litho_layer rows ONLY. The FC rows the
    # exporter reads must come from the mirror trigger.
    for cpt, bands in zip(cpts, (_BANDS_LEFT, _BANDS_RIGHT)):
        for formation, (top, base) in zip(geotech_formations, bands):
            db_session.add(
                LithoLayerOrm(
                    id=uuid7(),
                    model_id=geotech_model.id,
                    formation_id=formation.id,
                    cpt_id=cpt.id,
                    depth_top_m=top,
                    depth_base_m=base,
                    status="accepted",
                    # The source whitelist the geotech subdivision itself writes
                    # (SubdivideAllBodies uses 'segmenter' for its bands).
                    source="segmenter",
                    confidence="medium",
                )
            )

    await db_session.commit()

    return {
        "project_id": project.id,
        "section_id": section.id,
        "geo_model_id": geo_model.id,
        "geotech_model_id": geotech_model.id,
        "geotech_formation_names": [name for name, _ in _GEOTECH_UNITS],
    }


async def test_geotech_layers_are_mirrored_into_contacts_the_exporter_reads(
    seeded_geotech_section: dict, db_session: AsyncSession
) -> None:
    """The snapshot's contact source is populated for a geotech model.

    ``build_section_snapshot`` reads ``formation_contact``; a geotech model's
    boundaries are ``litho_layer`` rows. The LL→FC mirror is the only thing
    bridging the two, so it is asserted directly — a failure here explains an
    empty DXF instead of leaving it a mystery.
    """
    contacts = (
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.model_id == seeded_geotech_section["geotech_model_id"]
                )
            )
        )
        .scalars()
        .all()
    )

    # Two CPTs × two accepted bands = four mirrored boundaries.
    assert len(contacts) == 4
    assert {round(c.depth_top_m, 3) for c in contacts} == {0.0, 5.0, 0.0, 6.5}


async def test_geotech_dxf_carries_the_geotech_units_not_the_geological_ones(
    async_client: AsyncClient, seeded_geotech_section: dict
) -> None:
    """Exporting with the GEOTECH model_id writes geotech unit layers."""
    resp = await async_client.get(
        f"/projects/{seeded_geotech_section['project_id']}"
        f"/sections/{seeded_geotech_section['section_id']}/export/dxf",
        params={"model_id": str(seeded_geotech_section["geotech_model_id"])},
    )
    assert resp.status_code == 200, resp.text

    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    layer_names = {layer.dxf.name for layer in doc.layers}

    # The engineer's own unit names ride into CAD, one layer each.
    for name in seeded_geotech_section["geotech_formation_names"]:
        assert f"GeoModel-{name}" in layer_names, layer_names
    # And the geological model's formation — which the buggy routing exported
    # instead — is absent.
    assert "GeoModel-Boom Klei" not in layer_names

    # One polyline per geotech unit, each with a vertex on both CPTs.
    polylines = list(doc.modelspace().query("LWPOLYLINE"))
    assert len(polylines) == len(seeded_geotech_section["geotech_formation_names"])
    for poly in polylines:
        assert len(list(poly.get_points())) == 2


async def test_the_geological_export_is_unchanged_by_the_geotech_model(
    async_client: AsyncClient, seeded_geotech_section: dict
) -> None:
    """Exporting the geological model still writes only its own formation."""
    resp = await async_client.get(
        f"/projects/{seeded_geotech_section['project_id']}"
        f"/sections/{seeded_geotech_section['section_id']}/export/dxf",
        params={"model_id": str(seeded_geotech_section["geo_model_id"])},
    )
    assert resp.status_code == 200, resp.text

    doc = ezdxf.read(io.StringIO(resp.content.decode("utf-8")))
    layer_names = {layer.dxf.name for layer in doc.layers}

    assert "GeoModel-Boom Klei" in layer_names
    for name in seeded_geotech_section["geotech_formation_names"]:
        assert f"GeoModel-{name}" not in layer_names
