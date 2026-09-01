"""File → Save As must copy the whole project, not just the investigations.

``ProjectRepository.duplicate`` backs the desktop's File → Save As.  What
the engineer asks for when he picks it is a snapshot of *his project* — the
raw CPTs and boreholes AND the interpretation he built on top of them: the
geological formations and contacts, the litho layers, the cross-sections,
the bodies, the correlation edges.  A copy that quietly contains only the
raw investigations is worse than a failure, because the app adopts it
immediately and reports "saved as".

The gate here is deliberately driven from the bundle registry rather than
from a list written out in this file: every collection ``bundle_build``
knows how to serialise is checked, so a collection added to the model tree
tomorrow is checked tomorrow, whether or not anyone remembers to come back
here.  The fixture must seed every registered collection — an empty one on
both sides would make the comparison vacuously true, so that is asserted
too.

Requires the Docker DB.  Run via the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/db/test_project_duplicate_full_tree.py
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import (
    GeotechTieTombstoneOrm,
)
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.project_bundle import build_project_bundle
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_collections import (
    BUNDLE_COLLECTION_KEYS,
    count_rows_per_collection,
    fingerprint_cpt_series,
)
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository


async def _make_project_with_every_collection(db_session: AsyncSession) -> ProjectOrm:
    """Build a project that has at least one row in every bundle collection.

    One CPT (with series), one borehole (with a child tree), a geological
    model with a contact and a cached surface, a litho child model with two
    accepted layers tied by a correlation edge, a cross-section, a review, a
    body with a boundary shape + node, a formation absence, and a cached
    body solid.

    Parameters
    ----------
    db_session : AsyncSession
        Session the rows are written through (committed before returning).

    Returns
    -------
    ProjectOrm
        The source project.
    """
    project = ProjectOrm(
        id=uuid7(),
        name="Save-As source",
        client="ACME",
        site_label="Antwerp port",
        tags=["foundation"],
        default_horizontal_epsg=31370,
        status="active",
        view_state={"dem_overlay": {"enabled": True}},
    )
    db_session.add(project)
    await db_session.flush()

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-1",
        cpt_type="CPTU",
        app_project_id=project.id,
        project_id="DUP",
        test_id="DUP/CPT-1",
        location_x=150_000.0,
        location_y=200_000.0,
        elevation_m=5.0,
        epsg=31370,
        z_epsg=5710,
    )
    cpt.series = CptSeriesOrm(depths_m=[0.0, 0.5, 1.0], qc_mpa=[1.2, 2.4, 3.6])
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DUP",
        test_id="DUP/BH-1",
        location_x=150_200.0,
        location_y=200_000.0,
        elevation_m=5.0,
        epsg=31370,
        z_epsg=5710,
        total_depth_m=8.0,
    )
    borehole.drill_segments = [DrillSegmentOrm(id=uuid7(), top_m=0.0, base_m=8.0, method="auger")]
    observation = ObservationOrm(id=uuid7(), observation_type="lithologie")
    observation.layers = [
        ObservationLayerOrm(
            id=uuid7(), top_m=0.0, base_m=8.0, layer_index=0, main_soil_codes=["ZA"]
        )
    ]
    borehole.observations = [observation]
    borehole.samples = [SampleOrm(id=uuid7(), depth_top_m=1.0, depth_base_m=2.0)]
    db_session.add_all([cpt, borehole])

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Zand van Mol",
        code="ZM",
        color="#e8c26a",
        display_order=1,
        lithology="ZAND",
        litho_main_soil_code="ZAND",
    )
    db_session.add(formation)

    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo model",
        kind="geological",
        is_active=True,
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho model",
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    db_session.add_all([geo_model, litho_model])
    await db_session.flush()

    # Geological model: one contact + one cached TIN surface.
    db_session.add(
        FormationContactOrm(
            id=uuid7(),
            model_id=geo_model.id,
            formation_id=formation.id,
            cpt_id=cpt.id,
            depth_top_m=1.5,
            source="manual_pick",
            confidence="high",
        )
    )
    db_session.add(
        FormationSurfaceOrm(
            id=uuid7(),
            model_id=geo_model.id,
            formation_id=formation.id,
            method="tin",
            vertices=[[0.0, 0.0, 0.0]],
            triangles=[[0, 0, 0]],
            source_contact_count=1,
            source_contact_checksum=b"\x01\x02\x03",
        )
    )

    # Litho model: one accepted layer per investigation, tied by an edge.
    cpt_layer = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        cpt_id=cpt.id,
        depth_top_m=0.0,
        depth_base_m=8.0,
        status="accepted",
        source="segmenter",
        confidence="high",
    )
    bh_layer = LithoLayerOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=0.0,
        depth_base_m=8.0,
        status="accepted",
        source="observation_layer",
        confidence="high",
    )
    db_session.add_all([cpt_layer, bh_layer])

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Section A",
        start_x=149_900.0,
        start_y=200_000.0,
        end_x=150_300.0,
        end_y=200_000.0,
        epsg=31370,
        projection_buffer_m=60.0,
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
    )
    db_session.add(section)
    await db_session.flush()

    db_session.add(
        LithoContactCorrelationEdgeOrm(
            id=uuid7(),
            model_id=litho_model.id,
            section_id=section.id,
            layer_a_id=min(cpt_layer.id, bh_layer.id),
            layer_b_id=max(cpt_layer.id, bh_layer.id),
            layer_a_side="top",
            layer_b_side="top",
            source="manual",
            user_approved=True,
        )
    )
    # One geometry fact (owner ruling 2026-08-12) so the registry guard below
    # actually checks the collection's copy path.
    db_session.add(
        BodyGeometryFactOrm(
            id=uuid7(),
            model_id=litho_model.id,
            layer_a_id=min(cpt_layer.id, bh_layer.id),
            layer_b_id=max(cpt_layer.id, bh_layer.id),
        )
    )
    # One "Separate" ruling (owner 2026-08-31, debt #278 R5) and one "Join with…"
    # ruling (debt #278) so the registry guard checks BOTH pair-ruling copy paths.
    # The fixture has only two litho layers, so the two rulings share the pair.
    # That coexistence is fine SPECIFICALLY because this test never runs the
    # resolver: Save-As (``ProjectRepository.duplicate``) serialises rows and
    # bulk-inserts them, and the ``a<b`` CHECK is all that gates a pair row here —
    # nothing re-derives body identity, so the contradiction is never evaluated.
    # Where the resolver DOES run — a restore/reconcile, or the create endpoint —
    # cannot-link wins: the separation stands and the join is suppressed (see the
    # API test's UNI7 restore-time contradiction). This is not Save-As skipping a
    # check the product needs; it is Save-As having no body-identity check TO run.
    db_session.add(
        BodySeparationOrm(
            id=uuid7(),
            model_id=litho_model.id,
            layer_a_id=min(cpt_layer.id, bh_layer.id),
            layer_b_id=max(cpt_layer.id, bh_layer.id),
        )
    )
    db_session.add(
        BodyUnionOrm(
            id=uuid7(),
            model_id=litho_model.id,
            layer_a_id=min(cpt_layer.id, bh_layer.id),
            layer_b_id=max(cpt_layer.id, bh_layer.id),
        )
    )
    # One tie tombstone (owner ruling 2026-08-17: "a tie I delete stays
    # deleted") so the registry guard actually checks its copy path too —
    # the collection was registered without a fixture row, and the guard
    # stayed silent until the first FULL run (2026-08-18).
    db_session.add(
        GeotechTieTombstoneOrm(
            id=uuid7(),
            model_id=litho_model.id,
            section_id=section.id,
            a_x=1.0,
            a_y=2.0,
            a_z=3.0,
            b_x=4.0,
            b_y=5.0,
            b_z=6.0,
        )
    )
    db_session.add(
        InvestigationReviewOrm(
            id=uuid7(),
            app_project_id=project.id,
            target_kind="cpt",
            target_id=cpt.id,
            review_status="reviewed",
            review_notes="looks fine",
        )
    )

    body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho_model.id,
        formation_id=formation.id,
        body_ordinal=1,
        source_investigation_id=cpt.id,
        name="Sand body 1",
        primary_section_id=section.id,
    )
    db_session.add(body)
    await db_session.flush()

    shape = BodyBoundaryShapeOrm(
        id=uuid7(), body_id=body.id, model_id=litho_model.id, render_style="straight"
    )
    db_session.add(shape)
    await db_session.flush()
    db_session.add(
        BodyBoundaryNodeOrm(
            id=uuid7(),
            shape_id=shape.id,
            boundary="upper",
            node_index=0,
            along_m=0.0,
            elevation_m=4.0,
        )
    )
    db_session.add(
        FormationAbsenceOrm(
            id=uuid7(),
            formation_id=formation.id,
            investigation_id=borehole.id,
            investigation_kind="borehole",
            source="inferred",
        )
    )
    db_session.add(
        LithoBodySolidOrm(
            id=uuid7(),
            model_id=litho_model.id,
            body_id=body.id,
            formation_id=formation.id,
            method="tin",
            vertices=[[0.0, 0.0, 0.0]],
            triangles=[[0, 0, 0]],
            source_pick_count=2,
            source_pick_checksum=b"\x04\x05\x06",
        )
    )

    await db_session.commit()
    return project


@pytest_asyncio.fixture
async def duplicated_bundles(db_session: AsyncSession) -> tuple[dict[str, Any], dict[str, Any]]:
    """Duplicate a fully-populated project and return (source, copy) bundles.

    Parameters
    ----------
    db_session : AsyncSession
        Integration session.

    Returns
    -------
    tuple[dict[str, Any], dict[str, Any]]
        The source project's bundle and the copy's bundle.
    """
    source = await _make_project_with_every_collection(db_session)
    source_bundle = await build_project_bundle(db_session, source)

    repo = ProjectRepository(db_session)
    copy = await repo.duplicate(source.id, new_name="Save-As copy")
    await db_session.commit()
    assert copy is not None

    copy_bundle = await build_project_bundle(db_session, copy)
    return source_bundle, copy_bundle


async def test_the_fixture_populates_every_registered_collection(
    duplicated_bundles: tuple[dict[str, Any], dict[str, Any]],
) -> None:
    """No collection may be empty in the source, or its check proves nothing.

    This is the guard that keeps the parametrised test below honest: a
    collection added to the bundle but never seeded here would compare 0
    against 0 and pass while carrying nothing.
    """
    source_bundle, _copy = duplicated_bundles
    counts = count_rows_per_collection(source_bundle)
    empty = sorted(key for key, n in counts.items() if n == 0)
    assert not empty, (
        f"the Save-As source fixture carries no rows for {empty} — seed them in "
        "_make_project_with_every_collection so the copy is actually checked"
    )


@pytest.mark.parametrize("collection", BUNDLE_COLLECTION_KEYS)
async def test_save_as_copies_every_row_of_every_collection(
    duplicated_bundles: tuple[dict[str, Any], dict[str, Any]],
    collection: str,
) -> None:
    """The copy carries as many rows as the source, collection by collection.

    Counted at every depth, so a copy that kept the boreholes but dropped
    their samples, or kept the models but dropped their litho layers, is a
    failure here too.
    """
    source_bundle, copy_bundle = duplicated_bundles
    source_rows = count_rows_per_collection(source_bundle)[collection]
    copy_rows = count_rows_per_collection(copy_bundle)[collection]
    assert copy_rows == source_rows, (
        f"File → Save As dropped {collection}: the source has {source_rows} row(s), "
        f"the copy has {copy_rows}"
    )


async def test_the_copy_shares_no_row_id_with_the_source(
    duplicated_bundles: tuple[dict[str, Any], dict[str, Any]],
) -> None:
    """A copy is a new project: every row in it is a new row.

    Sharing an id would mean the two projects point at the same row, so
    editing the copy would edit the original — the opposite of what Save As
    is for.
    """
    from groundmodel.infrastructure.db.repositories.project_bundle.bundle_collections import (
        collect_row_ids,
    )

    source_bundle, copy_bundle = duplicated_bundles
    source_ids = collect_row_ids([source_bundle[k] for k in BUNDLE_COLLECTION_KEYS])
    copy_ids = collect_row_ids([copy_bundle[k] for k in BUNDLE_COLLECTION_KEYS])
    shared = sorted(source_ids & copy_ids)
    assert not shared, f"the copy re-used {len(shared)} source row id(s): {shared[:5]}"


async def test_the_copy_carries_the_cpt_depth_series(
    duplicated_bundles: tuple[dict[str, Any], dict[str, Any]],
) -> None:
    """The depth arrays travel too — the row counts cannot see them.

    ``cpt_series`` has no ``id`` column (its primary key is ``cpt_id``), so it
    contributes nothing to ``count_rows_per_collection``: a copy that carried
    every CPT row and dropped every series would report ``cpts 1/1`` and pass
    the parametrised check above. The largest and most load-bearing payload a
    CPT carries needs its own assertion.
    """
    source_bundle, copy_bundle = duplicated_bundles
    source_series = fingerprint_cpt_series(source_bundle)
    copy_series = fingerprint_cpt_series(copy_bundle)

    assert source_series, "the fixture CPT has no id — the check below proves nothing"
    assert sorted(source_series.values()) == [3], (
        "the fixture CPT must carry a real series for this check to bite"
    )
    assert sorted(copy_series.values()) == sorted(source_series.values()), (
        f"File → Save As dropped the CPT depth series: source {source_series}, copy {copy_series}"
    )
