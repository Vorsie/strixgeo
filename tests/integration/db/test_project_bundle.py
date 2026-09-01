"""Integration tests for the project bundle round-trip.

Exercise ``build_project_bundle`` and ``restore_project_bundle`` end-to-
end against a real PostgreSQL session. The bundle is the on-disk shape
of the .gmproj v2 file format — a full project + every CPT (with
series) + every borehole (with its complete child tree) serialised to
a JSON-friendly dict.

Why these tests live here (integration, not unit): the serialiser uses
``__mapper__.column_attrs`` to enumerate columns dynamically, and the
restore path needs the SQLAlchemy session to materialise relationships
through cascade. A mocked session wouldn't catch column-type drift
between serialise and restore.

Requires the Docker DB on localhost:5433.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    _MAX_SURFACE_SOURCE_CONTACTS,
    build_project_bundle,
    restore_project_bundle,
)
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)


async def _make_source_project(db_session: AsyncSession) -> ProjectOrm:
    """Build a project with one CPT (with series) and one rich borehole tree."""
    repo = ProjectRepository(db_session)
    project = ProjectOrm(
        id=uuid7(),
        name="Bundle source",
        client="ACME",
        site_label="Antwerp port",
        description="Foundation study",
        tags=["foundation", "marine"],
        default_horizontal_epsg=31370,
        default_vertical_epsg=5710,
        phase="design",
        status="active",
    )
    await repo.save(project)

    cpt = CptOrm(
        id=uuid7(),
        name="CPT-1",
        cpt_type="CPTU",
        app_project_id=project.id,
        project_id="DOV",
        test_id="GEO-001",
        location_x=150000.0,
        location_y=200000.0,
        elevation_m=12.34,
        epsg=31370,
        z_epsg=5710,
        cone_area_ratio=0.8,
    )
    cpt.series = CptSeriesOrm(
        depths_m=[0.0, 0.5, 1.0],
        qc_mpa=[1.2, 2.4, 3.6],
        fs_mpa=[0.01, 0.02, 0.03],
        u2_mpa=[0.05, 0.10, 0.15],
        rf_pct=[0.8, 0.8, 0.8],
        rf_source="measured",
    )
    db_session.add(cpt)

    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-001",
        location_x=160000.0,
        location_y=210000.0,
        epsg=31370,
        total_depth_m=5.0,
        drill_method="rotary",
    )
    bh.drill_segments = [
        DrillSegmentOrm(id=uuid7(), top_m=0.0, base_m=2.0, method="spade"),
        DrillSegmentOrm(id=uuid7(), top_m=2.0, base_m=5.0, method="auger"),
    ]
    obs = ObservationOrm(
        id=uuid7(),
        observation_type="lithologie",
        author="J. Driller",
    )
    layer = ObservationLayerOrm(
        id=uuid7(),
        top_m=0.0,
        base_m=2.0,
        layer_index=0,
        main_soil_codes=["KL"],
    )
    layer.admixtures = [AdmixtureOrm(id=uuid7(), soil_code="ZS", amount="weinig", locally=False)]
    obs.layers = [layer]
    bh.observations = [obs]

    sample = SampleOrm(
        id=uuid7(),
        depth_top_m=1.0,
        depth_base_m=2.0,
        description="Sample from upper layer",
    )
    sample.grain_sizes = [
        GrainSizeOrm(
            id=uuid7(),
            diameters_mm=[0.063, 0.125],
            pct_larger=[95.0, 70.0],
            method="Zeving",
        )
    ]
    sample.atterberg_limits_tests = [
        AtterbergLimitsOrm(id=uuid7(), liquid_limit_pct=42.0, plastic_limit_pct=22.0)
    ]
    bh.samples = [sample]

    db_session.add(bh)
    await db_session.commit()
    return project


async def test_build_bundle_captures_full_tree(db_session: AsyncSession) -> None:
    """Bundle response carries the project + 1 CPT (with series) + 1 borehole tree."""
    project = await _make_source_project(db_session)

    bundle = await build_project_bundle(db_session, project)

    assert bundle["format_version"] == 4
    assert bundle["project"]["name"] == "Bundle source"
    assert bundle["project"]["client"] == "ACME"
    assert bundle["project"]["tags"] == ["foundation", "marine"]
    # ``archived_at`` is intentionally excluded from the bundle.
    assert "archived_at" not in bundle["project"]
    # Server-managed timestamps are also excluded.
    assert "created_at" not in bundle["project"]

    assert len(bundle["cpts"]) == 1
    cpt_bundle = bundle["cpts"][0]
    assert cpt_bundle["name"] == "CPT-1"
    assert cpt_bundle["cpt_type"] == "CPTU"
    # UUID stringified.
    assert isinstance(cpt_bundle["id"], str)
    # Series nested under "series" with arrays preserved verbatim.
    assert cpt_bundle["series"]["depths_m"] == [0.0, 0.5, 1.0]
    assert cpt_bundle["series"]["qc_mpa"] == [1.2, 2.4, 3.6]
    assert cpt_bundle["series"]["rf_source"] == "measured"
    # Geometry is dropped — reconstructed on restore.
    assert "location" not in cpt_bundle

    assert len(bundle["boreholes"]) == 1
    bh_bundle = bundle["boreholes"][0]
    assert bh_bundle["name"] == "BH-1"
    assert len(bh_bundle["drill_segments"]) == 2
    assert bh_bundle["drill_segments"][0]["method"] == "spade"
    assert len(bh_bundle["observations"]) == 1
    assert len(bh_bundle["observations"][0]["layers"]) == 1
    layer_bundle = bh_bundle["observations"][0]["layers"][0]
    assert layer_bundle["main_soil_codes"] == ["KL"]
    assert len(layer_bundle["admixtures"]) == 1
    assert layer_bundle["admixtures"][0]["soil_code"] == "ZS"
    assert len(bh_bundle["samples"]) == 1
    sample_bundle = bh_bundle["samples"][0]
    assert sample_bundle["depth_top_m"] == 1.0
    assert len(sample_bundle["grain_sizes"]) == 1
    assert sample_bundle["grain_sizes"][0]["pct_larger"] == [95.0, 70.0]
    assert len(sample_bundle["atterberg_limits_tests"]) == 1


async def test_restore_bundle_recreates_full_project_with_original_ids(
    db_session: AsyncSession,
) -> None:
    """Bundle → restore round-trip preserves ids and every column value."""
    source = await _make_source_project(db_session)
    bundle = await build_project_bundle(db_session, source)

    # Capture original ids so we can assert preservation.
    original_project_id = source.id
    cpts_stmt = (
        select(CptOrm)
        .where(CptOrm.app_project_id == original_project_id)
        .options(selectinload(CptOrm.series))
    )
    original_cpts = list((await db_session.execute(cpts_stmt)).scalars().all())
    original_cpt_id = original_cpts[0].id
    bhs_stmt = select(BoreholeOrm).where(BoreholeOrm.app_project_id == original_project_id)
    original_bh_id = (await db_session.execute(bhs_stmt)).scalar_one().id

    # Simulate a DB wipe. ``app_project_id`` is a plain UUID column (no
    # ForeignKey by design — projects are an app-level scope), so
    # deleting the project row does NOT cascade to CPTs / boreholes. We
    # have to drop them explicitly.
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == original_project_id))
    await db_session.execute(
        delete(BoreholeOrm).where(BoreholeOrm.app_project_id == original_project_id)
    )
    await db_session.delete(source)
    await db_session.commit()
    # Clear the identity map — the DELETEd rows are still cached because
    # ``expire_on_commit=False`` and bulk ``delete()`` skips per-instance
    # eviction. Without this, the next INSERT under the same ids would
    # trigger SAWarning about replacing identity-map entries.
    db_session.expunge_all()

    restored = await restore_project_bundle(
        db_session,
        original_project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
    )
    await db_session.commit()

    # Project shell restored under the SAME id.
    assert restored.id == original_project_id
    assert restored.name == "Bundle source"
    assert restored.client == "ACME"
    assert restored.tags == ["foundation", "marine"]
    # Restored projects come back active even if archived before wipe.
    assert restored.archived_at is None

    # CPT restored with original id + series + geometry rebuilt.
    cpts_after = list((await db_session.execute(cpts_stmt)).scalars().all())
    assert len(cpts_after) == 1
    new_cpt = cpts_after[0]
    assert new_cpt.id == original_cpt_id
    assert new_cpt.name == "CPT-1"
    assert new_cpt.cone_area_ratio == 0.8
    assert new_cpt.location is not None, "geometry should be reconstructed from x/y/epsg"
    assert new_cpt.series is not None
    assert new_cpt.series.depths_m == [0.0, 0.5, 1.0]
    assert new_cpt.series.qc_mpa == [1.2, 2.4, 3.6]
    assert new_cpt.series.rf_source == "measured"

    # Borehole + full tree restored.
    bh_after_stmt = (
        select(BoreholeOrm)
        .where(BoreholeOrm.app_project_id == original_project_id)
        .options(
            selectinload(BoreholeOrm.drill_segments),
            selectinload(BoreholeOrm.observations)
            .selectinload(ObservationOrm.layers)
            .selectinload(ObservationLayerOrm.admixtures),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.grain_sizes),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.atterberg_limits_tests),
        )
    )
    bh_after = (await db_session.execute(bh_after_stmt)).scalar_one()
    assert bh_after.id == original_bh_id
    assert bh_after.name == "BH-1"
    assert len(bh_after.drill_segments) == 2
    assert {seg.method for seg in bh_after.drill_segments} == {"spade", "auger"}
    assert len(bh_after.observations) == 1
    assert len(bh_after.observations[0].layers) == 1
    assert bh_after.observations[0].layers[0].main_soil_codes == ["KL"]
    assert len(bh_after.observations[0].layers[0].admixtures) == 1
    assert bh_after.observations[0].layers[0].admixtures[0].soil_code == "ZS"
    assert len(bh_after.samples) == 1
    assert len(bh_after.samples[0].grain_sizes) == 1
    assert bh_after.samples[0].grain_sizes[0].pct_larger == [95.0, 70.0]
    assert len(bh_after.samples[0].atterberg_limits_tests) == 1
    assert bh_after.samples[0].atterberg_limits_tests[0].liquid_limit_pct == 42.0


async def test_restore_is_idempotent_no_duplicates(db_session: AsyncSession) -> None:
    """Calling restore twice with the same bundle doesn't duplicate rows."""
    source = await _make_source_project(db_session)
    bundle = await build_project_bundle(db_session, source)
    project_id = source.id

    # Wipe — see note in the round-trip test about no FK cascade from
    # project_id to CPTs / boreholes.
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == project_id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await db_session.delete(source)
    await db_session.commit()
    # Clear the identity map — the DELETEd rows are still cached because
    # ``expire_on_commit=False`` and bulk ``delete()`` skips per-instance
    # eviction. Without this, the next INSERT under the same ids would
    # trigger SAWarning about replacing identity-map entries.
    db_session.expunge_all()

    await restore_project_bundle(
        db_session, project_id, bundle["project"], bundle["cpts"], bundle["boreholes"]
    )
    await db_session.commit()

    # Second restore — same bundle. Should be a no-op (existing rows kept).
    await restore_project_bundle(
        db_session, project_id, bundle["project"], bundle["cpts"], bundle["boreholes"]
    )
    await db_session.commit()

    cpts_count = len(
        (await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .all()
    )
    bhs_count = len(
        (
            await db_session.execute(
                select(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    assert cpts_count == 1
    assert bhs_count == 1


async def test_restore_into_existing_project_does_not_mutate_metadata(
    db_session: AsyncSession,
) -> None:
    """If the project row already exists, restore returns it without rewriting metadata."""
    source = await _make_source_project(db_session)
    bundle = await build_project_bundle(db_session, source)
    project_id = source.id

    # Mutate the live project so we can prove restore left it alone.
    source.name = "Live edit — should win"
    await db_session.commit()

    # Re-restore: the bundle's "Bundle source" name must NOT overwrite.
    restored = await restore_project_bundle(
        db_session, project_id, bundle["project"], bundle["cpts"], bundle["boreholes"]
    )
    await db_session.commit()
    await db_session.refresh(restored)

    assert restored.name == "Live edit — should win"


# ---------------------------------------------------------------------------
# Geological-model round-trip — the user's interpretation work survives a
# save → DB-wipe → restore cycle. This is the load-bearing test for the
# "open a .gmproj on a different device and keep working" promise.
# ---------------------------------------------------------------------------


async def test_bundle_carries_geological_formations_models_contacts(
    db_session: AsyncSession,
) -> None:
    """Build + restore round-trips geological vocabulary + models + contacts."""
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )

    source = await _make_source_project(db_session)
    # The borehole was already created by _make_source_project — grab it
    # so the contact has an investigation anchor.
    bh = (
        await db_session.execute(select(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    ).scalar_one()

    # Set up a small geological model. Two formations, one model, three
    # contacts at the existing borehole — covers depth 0 → 5 m without
    # gaps (Quaternary 0-2, Boom Klei 2-5; the third contact is the
    # "below test depth" sentinel we'd add in the editor as a confidence
    # check).
    quaternary = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Quaternary",
        code="Q",
        color="#d4b896",
        display_order=0,
    )
    boom_klei = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Boom Klei",
        code="Bm",
        color="#5a4a3a",
        display_order=1,
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Main interpretation",
        is_active=True,
        excluded_borehole_ids=[],
    )
    db_session.add_all([quaternary, boom_klei, model])
    await db_session.flush()

    contact_quaternary_top = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=quaternary.id,
        borehole_id=bh.id,
        depth_top_m=0.0,
        source="manual_pick",
        confidence="high",
    )
    contact_boom_top = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=boom_klei.id,
        borehole_id=bh.id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="medium",
        notes="Picked from observation layer 0-2 m KL",
    )
    db_session.add_all([contact_quaternary_top, contact_boom_top])
    await db_session.commit()

    original_formation_ids = {quaternary.id, boom_klei.id}
    original_model_id = model.id
    original_contact_ids = {contact_quaternary_top.id, contact_boom_top.id}

    # ---- Build the bundle, assert the geology is in it -----------------
    bundle = await build_project_bundle(db_session, source)

    assert "geological_formations" in bundle
    assert "geological_models" in bundle
    formations_in_bundle = {f["name"] for f in bundle["geological_formations"]}
    assert formations_in_bundle == {"Quaternary", "Boom Klei"}

    assert len(bundle["geological_models"]) == 1
    model_in_bundle = bundle["geological_models"][0]
    assert model_in_bundle["name"] == "Main interpretation"
    assert model_in_bundle["is_active"] is True
    # Contacts nested under the model — same convention as series under
    # CPT and layers under observation.
    assert len(model_in_bundle["contacts"]) == 2
    bundled_depths = sorted(c["depth_top_m"] for c in model_in_bundle["contacts"])
    assert bundled_depths == [0.0, 2.0]
    # Notes survive the JSON round-trip.
    notes = [c.get("notes") for c in model_in_bundle["contacts"] if c.get("notes")]
    assert notes == ["Picked from observation layer 0-2 m KL"]

    # ---- Wipe the project end-to-end (simulate "fresh DB on a new
    # device") ----------------------------------------------------------
    await db_session.execute(
        delete(FormationContactOrm).where(FormationContactOrm.model_id == model.id)
    )
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore from the bundle ---------------------------------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
    )
    await db_session.commit()

    # ---- Verify every id round-tripped --------------------------------
    formations_after = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm).where(
                    GeologicalFormationOrm.app_project_id == source.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert {f.id for f in formations_after} == original_formation_ids
    # Colors / display_order survived.
    by_name = {f.name: f for f in formations_after}
    assert by_name["Quaternary"].color == "#d4b896"
    assert by_name["Boom Klei"].display_order == 1

    models_after = list(
        (
            await db_session.execute(
                select(GeologicalModelOrm)
                .where(GeologicalModelOrm.app_project_id == source.id)
                .options(selectinload(GeologicalModelOrm.contacts))
            )
        )
        .scalars()
        .all()
    )
    assert len(models_after) == 1
    restored_model = models_after[0]
    assert restored_model.id == original_model_id
    assert restored_model.is_active is True
    assert {c.id for c in restored_model.contacts} == original_contact_ids
    # FK rewrites — contacts point at the restored model + the original
    # formation ids (preserved) + the original borehole id.
    for c in restored_model.contacts:
        assert c.model_id == original_model_id
        assert c.borehole_id == bh.id
        assert c.formation_id in original_formation_ids
    # Notes round-tripped through JSON.
    notes_after = [c.notes for c in restored_model.contacts if c.notes]
    assert notes_after == ["Picked from observation layer 0-2 m KL"]


async def test_restore_skips_geology_when_payload_omits_it(
    db_session: AsyncSession,
) -> None:
    """Old clients without geology in their bundle still restore the rest cleanly."""
    source = await _make_source_project(db_session)
    project_id = source.id

    # Build a bundle and strip the geology fields to simulate an older
    # client that doesn't know about them.
    bundle = await build_project_bundle(db_session, source)
    bundle.pop("geological_formations", None)
    bundle.pop("geological_models", None)

    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == project_id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # Restore via the older-shape call (geology kwargs default to None).
    await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
    )
    await db_session.commit()

    # Project + CPT + borehole came back. No geology rows for this
    # project (none were in the payload).

    formations_after = (
        (
            await db_session.execute(
                select(GeologicalFormationOrm.id).where(
                    GeologicalFormationOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert list(formations_after) == []


# ---------------------------------------------------------------------------
# Cross-section round-trip — sections defined by the user survive a save →
# DB-wipe → restore cycle. Same load-bearing promise as the geology round-
# trip: open the .gmproj on a different machine and the section definitions
# come back with the line endpoints, buffer, exaggeration, exclusion arrays,
# and view-window depths intact.
# ---------------------------------------------------------------------------


async def test_bundle_carries_cross_sections(db_session: AsyncSession) -> None:
    """Build + restore round-trips cross-section definitions verbatim."""
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm

    source = await _make_source_project(db_session)

    # One realistic section + one minimal section so the test exercises
    # both populated optional fields and the defaults.
    excluded_bh = uuid7()
    # P2-I: a seeded contact id — simulates a section that has been
    # Seed-from-stratigraphy'd so seeded_formation_contact_ids is non-empty.
    seeded_contact_id = uuid7()
    section_a = CrossSectionOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="A - East/West",
        description="Profile through the port area",
        start_x=150000.0,
        start_y=200000.0,
        end_x=151000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=75.0,
        vertical_exaggeration=2.5,
        excluded_borehole_ids=[excluded_bh],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[seeded_contact_id],
        min_depth_m=-5.0,
        max_depth_m=40.0,
        display_order=0,
    )
    section_b = CrossSectionOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="B - cross-cut",
        start_x=150500.0,
        start_y=199500.0,
        end_x=150500.0,
        end_y=200500.0,
        epsg=31370,
        projection_buffer_m=50.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        display_order=1,
    )
    db_session.add_all([section_a, section_b])
    await db_session.commit()
    original_ids = {section_a.id, section_b.id}

    bundle = await build_project_bundle(db_session, source)
    assert "cross_sections" in bundle
    assert len(bundle["cross_sections"]) == 2
    by_name = {s["name"]: s for s in bundle["cross_sections"]}
    assert by_name["A - East/West"]["projection_buffer_m"] == 75.0
    assert by_name["A - East/West"]["vertical_exaggeration"] == 2.5
    assert by_name["A - East/West"]["min_depth_m"] == -5.0
    assert by_name["A - East/West"]["max_depth_m"] == 40.0
    # UUID arrays serialise as string lists.
    assert by_name["A - East/West"]["excluded_borehole_ids"] == [str(excluded_bh)]

    # Wipe everything to simulate a fresh DB on another machine.
    await db_session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # Restore from the bundle.
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
    )
    await db_session.commit()

    sections_after = list(
        (
            await db_session.execute(
                select(CrossSectionOrm).where(CrossSectionOrm.app_project_id == source.id)
            )
        )
        .scalars()
        .all()
    )
    assert {s.id for s in sections_after} == original_ids
    restored_a = next(s for s in sections_after if s.name == "A - East/West")
    # Every column value survived the JSON round-trip with no precision
    # loss for the floats.
    assert restored_a.start_x == 150000.0
    assert restored_a.end_x == 151000.0
    assert restored_a.projection_buffer_m == 75.0
    assert restored_a.vertical_exaggeration == 2.5
    assert restored_a.excluded_borehole_ids == [excluded_bh]
    assert restored_a.min_depth_m == -5.0
    assert restored_a.max_depth_m == 40.0
    assert restored_a.description == "Profile through the port area"
    # P2-I: seeded_formation_contact_ids (UUID array) must survive the
    # _column_to_json → _apply_json_to_kwargs round-trip.  The explicit-
    # content invariant depends on this: if the set were silently dropped
    # every re-open would show zero contacts even on a seeded section.
    assert restored_a.seeded_formation_contact_ids == [seeded_contact_id], (
        "seeded_formation_contact_ids must survive the bundle JSON round-trip"
    )


async def test_cold_restore_reattaches_companion_lens_section_after_bodies(
    db_session: AsyncSession,
) -> None:
    """A lens-companion section restores after its body, FK intact (#196).

    ``cross_section.companion_body_id`` is an FK → ``body.id``. Sections restore
    in Phase 6, bodies in Phase 8, so a cold restore of any project that ran
    "Materialise lens companions" would FK-violate when the section row was
    inserted before its body existed. The restore must defer the link and
    re-attach it once bodies are present.
    """
    from groundmodel.infrastructure.db.models.body_orm import BodyOrm
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )

    source = await _make_source_project(db_session)
    cpt = (
        await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == source.id))
    ).scalar_one()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Sand",
        code="S",
        color="#f0d080",
        display_order=0,
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho",
        is_active=True,
        excluded_borehole_ids=[],
    )
    db_session.add_all([formation, model])
    await db_session.flush()

    body = BodyOrm(
        id=uuid7(),
        app_project_id=source.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=cpt.id,
    )
    db_session.add(body)
    await db_session.flush()

    companion = CrossSectionOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Lens companion",
        start_x=150000.0,
        start_y=200000.0,
        end_x=151000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        companion_body_id=body.id,
        is_body_companion=True,
        display_order=0,
    )
    db_session.add(companion)
    await db_session.commit()

    body_id = body.id
    companion_id = companion.id

    bundle = await build_project_bundle(db_session, source)
    csec = next(s for s in bundle["cross_sections"] if s["id"] == str(companion_id))
    assert csec["companion_body_id"] == str(body_id)
    assert csec["is_body_companion"] is True

    # Wipe end-to-end (fresh DB on another machine).
    await db_session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(BodyOrm).where(BodyOrm.app_project_id == source.id))
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # Cold restore — must NOT FK-violate, and must re-attach the link.
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bodies_payload=bundle["bodies"],
    )
    await db_session.commit()

    restored = (
        await db_session.execute(select(CrossSectionOrm).where(CrossSectionOrm.id == companion_id))
    ).scalar_one()
    assert restored.is_body_companion is True
    assert restored.companion_body_id == body_id, (
        "companion_body_id must be re-attached after the bodies phase"
    )


async def test_restore_skips_sections_when_payload_omits_them(
    db_session: AsyncSession,
) -> None:
    """Older bundles without a ``cross_sections`` array still restore cleanly."""
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm

    source = await _make_source_project(db_session)
    project_id = source.id

    # Build a bundle without ever creating any cross-sections.
    bundle = await build_project_bundle(db_session, source)

    # Wipe and restore via the older-shape call (cross_sections kwarg
    # defaults to None).
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == project_id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        # Geology kwargs given, sections omitted — exercises the
        # default-to-empty path in restore_project_bundle.
        bundle["geological_formations"],
        bundle["geological_models"],
    )
    await db_session.commit()

    sections_after = (
        (
            await db_session.execute(
                select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    assert list(sections_after) == []


async def test_bundle_round_trips_kind_parent_lithology_nad_class(
    db_session: AsyncSession,
) -> None:
    """Senior-review S7: the four slice-1/2 columns survive build→restore,
    and S6: a bundled model with an unknown ``kind`` restores coerced to
    'geological' (never silently mis-behaving in the crossing validator).
    """

    source = await _make_source_project(db_session)
    geo = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Geo backbone",
        is_active=True,
        excluded_borehole_ids=[],
        kind="geological",
    )
    db_session.add(geo)
    await db_session.flush()
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho refinement",
        is_active=True,
        excluded_borehole_ids=[],
        kind="lithostratigraphic",
        parent_model_id=geo.id,
    )
    sand_unit = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="ZAND unit",
        code=None,
        color="#e8d44a",
        display_order=0,
        lithology="ZAND",
        nad_class=7,
    )
    db_session.add_all([litho, sand_unit])
    await db_session.commit()
    geo_id, litho_id, unit_id = geo.id, litho.id, sand_unit.id

    bundle = await build_project_bundle(db_session, source)

    # S6: inject an unknown kind into the bundled payload before restore.
    bundle["geological_models"].append(
        {
            "id": str(uuid7()),
            "app_project_id": str(source.id),
            "name": "Bogus kind",
            "is_active": False,
            "excluded_borehole_ids": [],
            "kind": "totally-not-a-kind",
            "parent_model_id": None,
            "contacts": [],
        }
    )
    bogus_id = bundle["geological_models"][-1]["id"]

    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
    )
    await db_session.commit()

    models = {
        m.id: m
        for m in (
            await db_session.execute(
                select(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
            )
        )
        .scalars()
        .all()
    }
    # S7: kind + parent FK survived verbatim.
    assert models[geo_id].kind == "geological"
    assert models[geo_id].parent_model_id is None
    assert models[litho_id].kind == "lithostratigraphic"
    assert models[litho_id].parent_model_id == geo_id
    # S6: the unknown kind was coerced to the safe geological default.
    assert models[UUID(bogus_id)].kind == "geological"

    # S7: lithology + nad_class survived verbatim.
    unit = (
        await db_session.execute(
            select(GeologicalFormationOrm).where(GeologicalFormationOrm.id == unit_id)
        )
    ).scalar_one()
    assert unit.lithology == "ZAND"
    assert unit.nad_class == 7


async def test_restore_caps_oversized_surface_tin_blobs(
    db_session: AsyncSession,
) -> None:
    """Debt #19: an oversized surface has its TIN geometry dropped + is_stale
    forced on restore; a normal surface in the same bundle restores intact.

    A surface whose claimed ``source_contact_count`` exceeds
    ``_MAX_SURFACE_SOURCE_CONTACTS`` stands in for the whole oversize family
    (the ``vertices`` / ``triangles`` length caps share the exact same guard
    branch — testing the count path proves the mechanism without allocating a
    200k-element array in the test DB).
    """
    from groundmodel.infrastructure.db.models.formation_surface_orm import (
        FormationSurfaceOrm,
    )

    source = await _make_source_project(db_session)
    f_big = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="BigSurf",
        code="BG",
        color="#111111",
        display_order=0,
    )
    f_ok = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="OkSurf",
        code="OK",
        color="#222222",
        display_order=1,
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="M",
        is_active=True,
        excluded_borehole_ids=[],
    )
    db_session.add_all([f_big, f_ok, model])
    await db_session.flush()

    big_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f_big.id,
        method="tin",
        vertices=[[1.0, 2.0, 3.0]],
        triangles=[[0, 0, 0]],
        # Over the cap — the restore guard must drop the geometry.
        source_contact_count=_MAX_SURFACE_SOURCE_CONTACTS + 1,
        source_contact_checksum=b"",
        is_stale=False,
    )
    ok_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f_ok.id,
        method="tin",
        vertices=[[4.0, 5.0, 6.0]],
        triangles=[[0, 0, 0]],
        source_contact_count=0,
        source_contact_checksum=b"",
        is_stale=False,
    )
    db_session.add_all([big_surface, ok_surface])
    await db_session.commit()
    big_id, ok_id = big_surface.id, ok_surface.id

    bundle = await build_project_bundle(db_session, source)

    # Wipe end-to-end (simulate restoring onto a fresh DB).
    await db_session.execute(
        delete(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
    )
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
    )
    await db_session.commit()

    big = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.id == big_id)
        )
    ).scalar_one()
    ok = (
        await db_session.execute(select(FormationSurfaceOrm).where(FormationSurfaceOrm.id == ok_id))
    ).scalar_one()

    # Oversized surface: geometry dropped, forced stale, row survives.
    assert big.vertices == []
    assert big.triangles == []
    assert big.is_stale is True
    # Normal control surface in the same bundle: untouched.
    assert ok.vertices == [[4.0, 5.0, 6.0]]
    assert ok.is_stale is False


async def test_restore_drops_structurally_malformed_surface_tin(
    db_session: AsyncSession,
) -> None:
    """Debt #112: a structurally malformed TIN (an out-of-range triangle
    index here) has its geometry dropped + ``is_stale`` forced on restore;
    a well-formed surface in the same bundle restores intact.

    NOTE (Session B, parallel run): this integration test was authored
    alongside the structural-validation fix but NOT executed in the parallel
    session — running ``tests/integration`` truncates the shared
    ``groundmodel_integration`` DB and would break Session A's concurrent
    e2e. It mirrors ``test_restore_caps_oversized_surface_tin_blobs`` exactly
    (same build→restore round-trip, same blank+force-stale assertions),
    changing only the malformation. Verify it green in the serial
    integration pass after the branches merge.
    """
    from groundmodel.infrastructure.db.models.formation_surface_orm import (
        FormationSurfaceOrm,
    )

    source = await _make_source_project(db_session)
    f_bad = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="BadSurf",
        code="BD",
        color="#111111",
        display_order=0,
    )
    f_ok = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="OkSurf",
        code="OK",
        color="#222222",
        display_order=1,
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="M",
        is_active=True,
        excluded_borehole_ids=[],
    )
    db_session.add_all([f_bad, f_ok, model])
    await db_session.flush()

    bad_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f_bad.id,
        method="tin",
        # One vertex but a triangle that references indices 1 and 2 — out of
        # range. Within all size caps, so only the structural check can catch
        # it. Indexing this downstream would IndexError.
        vertices=[[1.0, 2.0, 3.0]],
        triangles=[[0, 1, 2]],
        source_contact_count=0,
        source_contact_checksum=b"",
        is_stale=False,
    )
    ok_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f_ok.id,
        method="tin",
        vertices=[[4.0, 5.0, 6.0]],
        triangles=[[0, 0, 0]],
        source_contact_count=0,
        source_contact_checksum=b"",
        is_stale=False,
    )
    db_session.add_all([bad_surface, ok_surface])
    await db_session.commit()
    bad_id, ok_id = bad_surface.id, ok_surface.id

    bundle = await build_project_bundle(db_session, source)

    # Wipe end-to-end (simulate restoring onto a fresh DB).
    await db_session.execute(
        delete(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
    )
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
    )
    await db_session.commit()

    bad = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.id == bad_id)
        )
    ).scalar_one()
    ok = (
        await db_session.execute(select(FormationSurfaceOrm).where(FormationSurfaceOrm.id == ok_id))
    ).scalar_one()

    # Malformed surface: geometry dropped, forced stale, row survives.
    assert bad.vertices == []
    assert bad.triangles == []
    assert bad.is_stale is True
    # Well-formed control surface in the same bundle: untouched.
    assert ok.vertices == [[4.0, 5.0, 6.0]]
    assert ok.is_stale is False


# ---------------------------------------------------------------------------
# Should-fix 3 — formation_absences round-trip (#101 fix-up 2)
# ---------------------------------------------------------------------------


async def test_bundle_carries_formation_absences(db_session: AsyncSession) -> None:
    """formation_absences rows survive build → wipe → restore.

    Covers both source='inferred' (engine-emitted) and source='manual'
    (user-confirmed) rows, and verifies both the shape of the serialised
    dict and the in-DB values after restore.
    """
    from uuid6 import uuid7 as _u

    from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm

    source = await _make_source_project(db_session)

    formation = GeologicalFormationOrm(
        id=_u(),
        app_project_id=source.id,
        name="KLEI A",
        color="#8b5cf6",
        display_order=0,
    )
    db_session.add(formation)
    await db_session.flush()

    # Anchor the absences at the project's REAL investigations. The restore
    # IDOR guard (commit 101676ca8, 2026-07-01) drops any absence whose
    # investigation_id is not a CPT/borehole of this project — correct for
    # crafted bundles, and real bundles always carry the anchoring
    # investigations. The fixture's original random-UUID anchors pinned the
    # pre-guard behaviour and made this test the attack case by accident.
    inv_inferred = (
        await db_session.execute(
            select(BoreholeOrm.id).where(BoreholeOrm.app_project_id == source.id)
        )
    ).scalar_one()
    inv_manual = (
        await db_session.execute(select(CptOrm.id).where(CptOrm.app_project_id == source.id))
    ).scalar_one()

    absence_inferred = FormationAbsenceOrm(
        id=_u(),
        formation_id=formation.id,
        investigation_id=inv_inferred,
        investigation_kind="borehole",
        source="inferred",
    )
    absence_manual = FormationAbsenceOrm(
        id=_u(),
        formation_id=formation.id,
        investigation_id=inv_manual,
        investigation_kind="cpt",
        source="manual",
    )
    db_session.add_all([absence_inferred, absence_manual])
    await db_session.commit()

    original_inferred_id = absence_inferred.id
    original_manual_id = absence_manual.id

    # ---- Build -----------------------------------------------------------
    bundle = await build_project_bundle(db_session, source)
    assert "formation_absences" in bundle, "bundle must carry formation_absences key"
    assert len(bundle["formation_absences"]) == 2

    # Check that both source values are preserved verbatim in the bundle.
    sources = {ab["source"] for ab in bundle["formation_absences"]}
    assert sources == {"inferred", "manual"}, (
        f"Expected {{'inferred', 'manual'}} in bundle formation_absences; got {sources}"
    )
    kinds = {ab["investigation_kind"] for ab in bundle["formation_absences"]}
    assert kinds == {"borehole", "cpt"}

    # ---- Wipe ------------------------------------------------------------
    await db_session.execute(
        delete(FormationAbsenceOrm).where(FormationAbsenceOrm.formation_id == formation.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore ---------------------------------------------------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        formation_absences_payload=bundle["formation_absences"],
    )
    await db_session.commit()

    restored = list(
        (
            await db_session.execute(
                select(FormationAbsenceOrm).where(FormationAbsenceOrm.formation_id == formation.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(restored) == 2, f"Expected 2 restored absences; got {len(restored)}"

    by_id = {r.id: r for r in restored}
    assert original_inferred_id in by_id, "inferred absence must survive restore"
    assert original_manual_id in by_id, "manual absence must survive restore"
    assert by_id[original_inferred_id].source == "inferred"
    assert by_id[original_manual_id].source == "manual"
    assert by_id[original_manual_id].investigation_kind == "cpt"

    # ---- Second restore is idempotent (no duplicate rows) ----------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        formation_absences_payload=bundle["formation_absences"],
    )
    await db_session.commit()
    count_twice = len(
        list(
            (
                await db_session.execute(
                    select(FormationAbsenceOrm).where(
                        FormationAbsenceOrm.formation_id == formation.id
                    )
                )
            )
            .scalars()
            .all()
        )
    )
    assert count_twice == 2, f"Second restore must not duplicate rows; got {count_twice}"


# ---------------------------------------------------------------------------
# Contact-level correlation edges round-trip (#133 Phase 2+3)
# ---------------------------------------------------------------------------


async def test_bundle_roundtrip_includes_contact_correlation_edges(
    db_session: AsyncSession,
) -> None:
    """litho_contact_correlation_edges survive build → wipe → restore.

    A project with one litho model, two contacts on that model, and one
    LithoContactCorrelationEdge (user_approved=True) is bundled then
    restored onto a clean DB.  The edge row must come back with the same
    id, contact endpoints, and user_approved flag.  A second restore is
    idempotent (no duplicate row).  A contact-edge whose model_id points
    outside the project is silently dropped (bundle-injection guard).
    """
    from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm as _BH
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm,
    )

    source = await _make_source_project(db_session)
    # Use the borehole created by the helper as the investigation anchor.
    bh = (await db_session.execute(select(_BH).where(_BH.app_project_id == source.id))).scalar_one()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="ZAND unit",
        color="#e8d44a",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    geo_parent = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Geo parent",
        kind="geological",
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho model",
        kind="lithostratigraphic",
        is_active=True,
        excluded_borehole_ids=[],
        parent_model_id=geo_parent.id,
    )
    db_session.add_all([formation, geo_parent, model])
    await db_session.flush()

    # Two contacts at different depths on the same borehole — canonical
    # ordering (a_id < b_id) is enforced by the CHECK constraint.
    contact_a = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=1.0,
        source="manual_pick",
        confidence="high",
    )
    contact_b = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="high",
    )
    db_session.add_all([contact_a, contact_b])
    await db_session.flush()

    # Minimal section so edge.section_id satisfies the NOT NULL FK.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Sec-Bundle",
        start_x=150000.0,
        start_y=200000.0,
        end_x=165000.0,
        end_y=215000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=[],
    )
    db_session.add(section)
    await db_session.flush()

    # Canonical ordering: a_id < b_id (CHECK constraint).
    a_id, b_id = sorted([contact_a.id, contact_b.id])
    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        layer_a_id=a_id,
        layer_b_id=b_id,
        source="manual",
        user_approved=True,
        section_id=section.id,
    )
    db_session.add(edge)
    await db_session.commit()
    original_edge_id = edge.id

    # ---- Build: the edge is in the bundle --------------------------------
    bundle = await build_project_bundle(db_session, source)
    assert "litho_contact_correlation_edges" in bundle, (
        "bundle must carry litho_contact_correlation_edges key"
    )
    assert len(bundle["litho_contact_correlation_edges"]) == 1
    bundled = bundle["litho_contact_correlation_edges"][0]
    assert bundled["layer_a_id"] == str(a_id)
    assert bundled["layer_b_id"] == str(b_id)
    assert bundled["user_approved"] is True

    # ---- Wipe (simulate fresh DB on a new device) ------------------------
    await db_session.execute(
        delete(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.model_id == model.id
        )
    )
    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm as _FC,
    )

    await db_session.execute(delete(_FC).where(_FC.model_id == model.id))
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore ---------------------------------------------------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        litho_contact_correlation_edges_payload=bundle["litho_contact_correlation_edges"],
    )
    await db_session.commit()

    edges_after = list(
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == model.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(edges_after) == 1
    assert edges_after[0].id == original_edge_id
    assert edges_after[0].layer_a_id == a_id
    assert edges_after[0].layer_b_id == b_id
    assert edges_after[0].user_approved is True

    # ---- Second restore is idempotent ------------------------------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        litho_contact_correlation_edges_payload=bundle["litho_contact_correlation_edges"],
    )
    await db_session.commit()
    count_twice = len(
        list(
            (
                await db_session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == model.id
                    )
                )
            )
            .scalars()
            .all()
        )
    )
    assert count_twice == 1, "second restore must not duplicate the contact edge"

    # ---- Injection guard: alien model_id is dropped silently -------------
    alien = dict(bundle["litho_contact_correlation_edges"][0])
    alien["id"] = str(uuid7())
    alien["model_id"] = str(uuid7())  # model that does not exist in this project
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        litho_contact_correlation_edges_payload=[
            bundle["litho_contact_correlation_edges"][0],
            alien,
        ],
    )
    await db_session.commit()
    count_guarded = len(
        list(
            (
                await db_session.execute(
                    select(LithoContactCorrelationEdgeOrm).where(
                        LithoContactCorrelationEdgeOrm.model_id == model.id
                    )
                )
            )
            .scalars()
            .all()
        )
    )
    assert count_guarded == 1, "alien-model_id edge must be dropped, not restored"


# ---------------------------------------------------------------------------
# Body "Join with…" rulings round-trip (debt #278 — body_union)
# ---------------------------------------------------------------------------


async def test_bundle_roundtrip_includes_body_unions(db_session: AsyncSession) -> None:
    """body_union rows survive build → wipe → restore.

    A project with one litho model and two accepted litho layers (one on the CPT,
    one on the borehole) plus one ``body_union`` joining them is bundled, wiped,
    and restored onto a clean DB. The union row must come back with the same id
    and canonical anchor pair — a lost union would silently split bodies the
    engineer joined (the ruling is "permanent"). A second restore is idempotent.
    """
    from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm

    source = await _make_source_project(db_session)
    cpt = (
        await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == source.id))
    ).scalar_one()
    bh = (
        await db_session.execute(select(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    ).scalar_one()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="ZAND unit",
        color="#e8d44a",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    geo_parent = GeologicalModelOrm(
        id=uuid7(), app_project_id=source.id, name="Geo parent", kind="geological"
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho model",
        kind="lithostratigraphic",
        is_active=True,
        excluded_borehole_ids=[],
        parent_model_id=geo_parent.id,
    )
    db_session.add_all([formation, geo_parent, model])
    await db_session.flush()

    cpt_layer = LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
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
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=0.0,
        depth_base_m=8.0,
        status="accepted",
        source="observation_layer",
        confidence="high",
    )
    db_session.add_all([cpt_layer, bh_layer])
    await db_session.flush()

    a_id, b_id = sorted([cpt_layer.id, bh_layer.id])
    union = BodyUnionOrm(id=uuid7(), model_id=model.id, layer_a_id=a_id, layer_b_id=b_id)
    db_session.add(union)
    await db_session.commit()
    original_union_id = union.id

    # ---- Build: the union is in the bundle -------------------------------
    bundle = await build_project_bundle(db_session, source)
    assert "body_unions" in bundle, "bundle must carry the body_unions key"
    assert len(bundle["body_unions"]) == 1
    bundled = bundle["body_unions"][0]
    assert bundled["layer_a_id"] == str(a_id)
    assert bundled["layer_b_id"] == str(b_id)

    # ---- Wipe (simulate a fresh DB on a new device) ----------------------
    await db_session.execute(delete(BodyUnionOrm).where(BodyUnionOrm.model_id == model.id))
    await db_session.execute(delete(LithoLayerOrm).where(LithoLayerOrm.model_id == model.id))
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore: the union comes back on its restored anchors -----------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        body_unions_payload=bundle["body_unions"],
    )
    await db_session.commit()

    unions_after = list(
        (await db_session.execute(select(BodyUnionOrm).where(BodyUnionOrm.model_id == model.id)))
        .scalars()
        .all()
    )
    assert len(unions_after) == 1
    assert unions_after[0].id == original_union_id
    assert unions_after[0].layer_a_id == a_id
    assert unions_after[0].layer_b_id == b_id

    # ---- Second restore is idempotent ------------------------------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        body_unions_payload=bundle["body_unions"],
    )
    await db_session.commit()
    count_twice = len(
        list(
            (
                await db_session.execute(
                    select(BodyUnionOrm).where(BodyUnionOrm.model_id == model.id)
                )
            )
            .scalars()
            .all()
        )
    )
    assert count_twice == 1, "second restore must not duplicate the body union"


# ---------------------------------------------------------------------------
# Section-scoped correlation edges round-trip (Task 7 — section_id column)
# ---------------------------------------------------------------------------


async def test_bundle_roundtrips_edge_section_id(db_session: AsyncSession) -> None:
    """build → wipe → restore preserves the section_id on a correlation edge.

    A project with one litho model, two litho layers, one cross-section,
    and one edge stamped with that section is bundled then restored onto a
    clean DB.  The restored edge must carry the SAME section_id — NULL
    here would mean the column was stripped somewhere in the round-trip and
    the FK NOT-NULL constraint would blow up on next use.
    """
    from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm as _BH2
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm,
    )

    source = await _make_source_project(db_session)
    bh = (
        await db_session.execute(select(_BH2).where(_BH2.app_project_id == source.id))
    ).scalar_one()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="SAND-section-id",
        color="#aabbcc",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    geo_parent = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Geo parent SID",
        kind="geological",
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho model SID",
        kind="lithostratigraphic",
        is_active=True,
        excluded_borehole_ids=[],
        parent_model_id=geo_parent.id,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Sec-SID",
        start_x=150000.0,
        start_y=200000.0,
        end_x=165000.0,
        end_y=215000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=[],
    )
    db_session.add_all([formation, geo_parent, model, section])
    await db_session.flush()

    contact_a = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=1.0,
        source="manual_pick",
        confidence="high",
    )
    contact_b = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=4.0,
        source="manual_pick",
        confidence="high",
    )
    db_session.add_all([contact_a, contact_b])
    await db_session.flush()

    a_id, b_id = sorted([contact_a.id, contact_b.id])
    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        section_id=section.id,
        layer_a_id=a_id,
        layer_b_id=b_id,
        source="manual",
        user_approved=True,
    )
    db_session.add(edge)
    await db_session.commit()
    original_section_id = section.id
    original_edge_id = edge.id

    # ---- Build: section_id is in the bundled edge dict ----------------------
    bundle = await build_project_bundle(db_session, source)
    bundled_edges = bundle["litho_contact_correlation_edges"]
    assert len(bundled_edges) == 1
    assert bundled_edges[0]["section_id"] == str(original_section_id), (
        "bundle must carry section_id on the edge dict"
    )

    # ---- Wipe ----------------------------------------------------------------
    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm as _FC2,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm as _E,
    )

    await db_session.execute(delete(_E).where(_E.model_id == model.id))
    await db_session.execute(delete(_FC2).where(_FC2.model_id == model.id))
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore -------------------------------------------------------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        cross_sections_payload=bundle["cross_sections"],
        litho_contact_correlation_edges_payload=bundle["litho_contact_correlation_edges"],
    )
    await db_session.commit()

    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm as _E2,
    )

    restored_edges = list(
        (await db_session.execute(select(_E2).where(_E2.id == original_edge_id))).scalars().all()
    )
    assert len(restored_edges) == 1, "edge must be restored"
    assert restored_edges[0].section_id == original_section_id, (
        "section_id must survive the bundle JSON round-trip"
    )


async def test_restore_drops_edge_without_section_id(db_session: AsyncSession) -> None:
    """A bundle edge dict missing section_id (legacy) is silently dropped.

    Restore must not raise, and zero edge rows appear in the DB.
    """
    from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm as _BH3
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm,
    )

    source = await _make_source_project(db_session)
    bh = (
        await db_session.execute(select(_BH3).where(_BH3.app_project_id == source.id))
    ).scalar_one()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="CLAY-no-section",
        color="#334455",
        display_order=0,
        litho_main_soil_code="KL",
    )
    geo_parent = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Geo parent NS",
        kind="geological",
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho model NS",
        kind="lithostratigraphic",
        is_active=True,
        excluded_borehole_ids=[],
        parent_model_id=geo_parent.id,
    )
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Sec-NS",
        start_x=150000.0,
        start_y=200000.0,
        end_x=165000.0,
        end_y=215000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=[],
    )
    db_session.add_all([formation, geo_parent, model, section])
    await db_session.flush()

    contact_a = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="high",
    )
    contact_b = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=5.0,
        source="manual_pick",
        confidence="high",
    )
    db_session.add_all([contact_a, contact_b])
    await db_session.flush()

    a_id, b_id = sorted([contact_a.id, contact_b.id])
    edge = LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        section_id=section.id,
        layer_a_id=a_id,
        layer_b_id=b_id,
        source="manual",
        user_approved=True,
    )
    db_session.add(edge)
    await db_session.commit()

    bundle = await build_project_bundle(db_session, source)

    # Simulate a legacy bundle by stripping section_id from the edge dict.
    legacy_edge_payload = dict(bundle["litho_contact_correlation_edges"][0])
    del legacy_edge_payload["section_id"]

    # Also test with an unknown (alien) section_id — must also be dropped.
    alien_edge_payload = dict(bundle["litho_contact_correlation_edges"][0])
    alien_edge_payload["id"] = str(uuid7())
    alien_edge_payload["section_id"] = str(uuid7())  # not in this project

    # ---- Wipe ----------------------------------------------------------------
    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm as _FC3,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm as _E3,
    )

    await db_session.execute(delete(_E3).where(_E3.model_id == model.id))
    await db_session.execute(delete(_FC3).where(_FC3.model_id == model.id))
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore with legacy (no section_id) and alien section_id edges -----
    # Must not raise; both edges must be silently dropped.
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        cross_sections_payload=bundle["cross_sections"],
        litho_contact_correlation_edges_payload=[legacy_edge_payload, alien_edge_payload],
    )
    await db_session.commit()

    from groundmodel.infrastructure.db.models.geological_model_orm import (
        GeologicalModelOrm as _GM,
    )
    from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
        LithoContactCorrelationEdgeOrm as _E4,
    )

    # Find the restored model to scope the query.
    restored_models = list(
        (await db_session.execute(select(_GM).where(_GM.app_project_id == source.id)))
        .scalars()
        .all()
    )
    all_model_ids = {m.id for m in restored_models}

    all_edges = list(
        (await db_session.execute(select(_E4).where(_E4.model_id.in_(all_model_ids))))
        .scalars()
        .all()
    )
    assert len(all_edges) == 0, (
        "edges with missing or unknown section_id must be dropped, not restored"
    )


# ---------------------------------------------------------------------------
# parent_geo_contact_id round-trip (#162 Task 2)
# ---------------------------------------------------------------------------


async def test_bundle_roundtrip_preserves_parent_geo_contact_id(
    db_session: AsyncSession,
) -> None:
    """A litho contact's parent_geo_contact_id survives build → wipe → restore.

    A litho contact carrying parent_geo_contact_id (pointing at a geo contact
    in a different model) is bundled then restored onto a clean DB.  The column
    must round-trip verbatim — NULL after restore would silently break the
    litho↔geo coupling established by the user.

    The restore is stressed by reversing the geological_models array so the
    lithostratigraphic model (whose contact carries the self-referential FK) is
    processed before the geological model (the FK target).  SQLAlchemy's
    unit-of-work topological sort resolves the in-session dependency correctly
    for plain FK columns on self-referential tables, so no manual backfill step
    is required.  This test pins that the column is included by the
    column-attr enumeration path and that no code strips it between build and
    restore.
    """
    from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm as _BH
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )

    source = await _make_source_project(db_session)
    bh = (await db_session.execute(select(_BH).where(_BH.app_project_id == source.id))).scalar_one()

    # Two models: one geological, one lithostratigraphic.
    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Geo backbone",
        kind="geological",
        is_active=True,
        excluded_borehole_ids=[],
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho refinement",
        kind="lithostratigraphic",
        is_active=True,
        excluded_borehole_ids=[],
        parent_model_id=geo_model.id,
    )
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="KLEI unit",
        color="#4a4a8a",
        display_order=0,
        lithology="KLEI",
    )
    db_session.add_all([geo_model, litho_model, formation])
    await db_session.flush()

    # One geo contact (the coupling target) and one litho contact that
    # references the geo contact via parent_geo_contact_id.
    geo_contact = FormationContactOrm(
        id=uuid7(),
        model_id=geo_model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="high",
    )
    db_session.add(geo_contact)
    await db_session.flush()

    litho_contact = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        borehole_id=bh.id,
        depth_top_m=2.0,
        source="manual_pick",
        confidence="high",
        parent_geo_contact_id=geo_contact.id,
    )
    db_session.add(litho_contact)
    await db_session.commit()

    original_geo_contact_id = geo_contact.id
    original_litho_contact_id = litho_contact.id

    # ---- Build: parent_geo_contact_id appears in the bundled layers -----
    # A4 slice 4c: litho models emit empty ``contacts`` in v4; the
    # parent_geo_contact_id rides along on the layer row instead
    # (mirrored from FC via the LL→FC trigger). Restore re-creates the
    # FC mirror with the same coupling because the trigger copies
    # parent_geo_contact_id on every accepted-layer INSERT.
    bundle = await build_project_bundle(db_session, source)

    assert len(bundle["geological_models"]) == 2
    by_kind = {m["kind"]: m for m in bundle["geological_models"]}
    assert by_kind["lithostratigraphic"]["contacts"] == [], (
        "v4 litho models emit empty contacts; layers are the truth"
    )
    litho_layers_in_bundle = by_kind["lithostratigraphic"]["litho_layers"]
    assert len(litho_layers_in_bundle) == 1, "litho model should carry one layer"
    assert litho_layers_in_bundle[0]["parent_geo_contact_id"] == str(original_geo_contact_id), (
        "parent_geo_contact_id must ride along on the layer in the bundle"
    )

    # ---- Wipe the DB (simulate opening on a fresh machine) ----------------
    await db_session.execute(
        delete(FormationContactOrm).where(
            FormationContactOrm.model_id.in_([geo_model.id, litho_model.id])
        )
    )
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore with reversed model order (stress test) ---------------
    #
    # Put the lithostratigraphic model (whose contact carries
    # parent_geo_contact_id) first so it is processed before the geological
    # model (the FK target).  SQLAlchemy's unit-of-work handles the
    # self-referential FK ordering at flush time, so no user-space backfill
    # is needed — but the reversed order proves the column is not silently
    # stripped or nulled somewhere in the restore path.
    models_reversed = list(reversed(bundle["geological_models"]))
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        models_reversed,
    )
    await db_session.commit()

    restored_litho_contact = (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == original_litho_contact_id)
        )
    ).scalar_one()

    assert restored_litho_contact.parent_geo_contact_id == original_geo_contact_id, (
        "parent_geo_contact_id must survive build → wipe → restore; "
        "NULL here means the column was stripped somewhere in the round-trip"
    )


async def test_replace_restore_reverts_mutations_creates_and_deletes(
    db_session: AsyncSession,
) -> None:
    """``replace=True`` reverts the project to the bundle EXACTLY (debt #160).

    A save-then-mutate-then-revert cycle: snapshot the bundle, then mutate a
    contact depth, add a new contact, and rename the CPT, then replace-restore
    from the snapshot. Every change must be undone — mutation reverted, created
    row gone, renamed field back.

    Also exercises the RESTRICT-ordered ``geological_model`` wipe: a litho model
    pins its geological parent via ``parent_model_id``
    (``ON DELETE RESTRICT``), so the wipe must delete child models (by ``kind``)
    before the backbone, or the DELETE raises.
    """
    source = await _make_source_project(db_session)
    project_id = source.id

    cpt = (
        (await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == project_id)))
        .scalars()
        .first()
    )
    assert cpt is not None

    # A geological backbone + a litho child (RESTRICT parent link) + a
    # formation + one contact on the litho model.
    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Geo backbone",
        kind="geological",
        is_active=True,
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Litho",
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="ZAND",
        code="Z",
        color="#ddcc88",
        display_order=0,
    )
    contact = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        cpt_id=cpt.id,
        depth_top_m=3.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add_all([geo_model, litho_model, formation, contact])
    await db_session.commit()
    contact_id = contact.id
    geo_model_id = geo_model.id

    # SAVE point — snapshot the bundle the user would persist to .gmproj.
    snapshot = await build_project_bundle(db_session, source)

    # MUTATE after save: change the contact depth, add a contact, rename CPT.
    contact.depth_top_m = 9.0
    cpt.name = "MUTATED"
    added_contact = FormationContactOrm(
        id=uuid7(),
        model_id=litho_model.id,
        formation_id=formation.id,
        cpt_id=cpt.id,
        depth_top_m=5.0,
        source="manual_pick",
        confidence="medium",
    )
    db_session.add(added_contact)
    await db_session.commit()
    added_contact_id = added_contact.id

    # Avoid SAWarning on identity-map replacement when the wipe deletes rows
    # the session still tracks (expire_on_commit=False).
    db_session.expunge_all()

    # REVERT — replace-restore from the snapshot.
    await restore_project_bundle(
        db_session,
        project_id,
        snapshot["project"],
        snapshot["cpts"],
        snapshot["boreholes"],
        snapshot["geological_formations"],
        snapshot["geological_models"],
        snapshot["cross_sections"],
        snapshot["investigation_reviews"],
        bodies_payload=snapshot["bodies"],
        formation_absences_payload=snapshot["formation_absences"],
        litho_contact_correlation_edges_payload=snapshot["litho_contact_correlation_edges"],
        body_boundary_shapes_payload=snapshot["body_boundary_shapes"],
        body_boundary_nodes_payload=snapshot["body_boundary_nodes"],
        replace=True,
    )
    await db_session.commit()

    # Mutation reverted — the contact is back at its saved depth.
    reverted = (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == contact_id)
        )
    ).scalar_one()
    assert reverted.depth_top_m == 3.0

    # Create reverted — the post-save contact is gone.
    assert (
        await db_session.execute(
            select(FormationContactOrm).where(FormationContactOrm.id == added_contact_id)
        )
    ).scalar_one_or_none() is None

    # Mutation reverted on the CPT — name back to the saved value.
    cpt_after = (
        await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == project_id))
    ).scalar_one()
    assert cpt_after.name == "CPT-1"

    # RESTRICT-ordered model wipe + re-insert succeeded: both models are back
    # and the litho child still pins its geological parent.
    models = list(
        (
            await db_session.execute(
                select(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    assert {m.kind for m in models} == {"geological", "lithostratigraphic"}
    litho_after = next(m for m in models if m.kind == "lithostratigraphic")
    assert litho_after.parent_model_id == geo_model_id


# ---------------------------------------------------------------------------
# Bundle-strip step: extent field retirement
# ---------------------------------------------------------------------------


async def test_restore_ignores_legacy_extent_fields(db_session: AsyncSession) -> None:
    """A legacy .strix bundle with stale extent_* keys on body dicts restores
    cleanly — the body row and its boundary nodes round-trip correctly and no
    FK-violation or UnexpectedField error is raised.

    The extent system is retired (partition-fill replaces it).  Bundles saved
    before this commit carry ``extent_left_kind``, ``extent_right_kind``,
    ``extent_left_target_contact_id``, etc. on every body dict.  After the
    strip step these keys must be silently dropped so that projects saved by
    an older build open in a new one without error.
    """
    from groundmodel.infrastructure.db.models.body_boundary_node_orm import BodyBoundaryNodeOrm
    from groundmodel.infrastructure.db.models.body_boundary_shape_orm import BodyBoundaryShapeOrm
    from groundmodel.infrastructure.db.models.body_orm import BodyOrm

    source = await _make_source_project(db_session)
    cpt = (
        await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == source.id))
    ).scalar_one()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="ZAND",
        code="ZD",
        color="#f5e642",
        display_order=0,
    )
    # A lithostratigraphic model requires a parent geological model (DB
    # constraint ck_geological_model_kind_parent_null).
    geo_backbone = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Geo backbone",
        is_active=True,
        excluded_borehole_ids=[],
        kind="geological",
    )
    db_session.add_all([formation, geo_backbone])
    await db_session.flush()

    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho",
        is_active=True,
        excluded_borehole_ids=[],
        kind="lithostratigraphic",
        parent_model_id=geo_backbone.id,
    )
    db_session.add(model)
    await db_session.flush()

    body = BodyOrm(
        id=uuid7(),
        app_project_id=source.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=cpt.id,
    )
    db_session.add(body)
    await db_session.flush()

    # Add a boundary shape + node so we can verify they also round-trip.
    shape = BodyBoundaryShapeOrm(
        id=uuid7(),
        model_id=model.id,
        body_id=body.id,
        render_style="straight",
    )
    db_session.add(shape)
    await db_session.flush()

    node = BodyBoundaryNodeOrm(
        id=uuid7(),
        shape_id=shape.id,
        boundary="upper",
        node_index=0,
        along_m=12.5,
        elevation_m=-3.0,
    )
    db_session.add(node)
    await db_session.commit()

    body_id = body.id
    shape_id = shape.id
    node_id = node.id

    # Build a genuine bundle, then inject legacy extent_* keys onto the body
    # dict to simulate a bundle written by an older build.
    bundle = await build_project_bundle(db_session, source)
    assert len(bundle["bodies"]) == 1
    # Verify the new serialize path already omits extent fields.
    assert not any(k.startswith("extent_") for k in bundle["bodies"][0])

    # Now inject the legacy keys — this is what an old .strix on-disk looks like.
    bundle["bodies"][0]["extent_left_kind"] = "to_target"
    bundle["bodies"][0]["extent_left_target_contact_id"] = str(uuid7())
    bundle["bodies"][0]["extent_left_neighbour_inv_id"] = None
    bundle["bodies"][0]["extent_left_anchor_layer_id"] = str(uuid7())
    bundle["bodies"][0]["extent_left_provenance"] = "user"
    bundle["bodies"][0]["extent_right_kind"] = "open"
    bundle["bodies"][0]["extent_right_target_contact_id"] = None
    bundle["bodies"][0]["extent_right_neighbour_inv_id"] = None
    bundle["bodies"][0]["extent_right_anchor_layer_id"] = None
    bundle["bodies"][0]["extent_right_provenance"] = "auto"

    # Wipe end-to-end (simulate a cold restore on a fresh DB).
    await db_session.execute(
        delete(BodyBoundaryNodeOrm).where(BodyBoundaryNodeOrm.shape_id == shape_id)
    )
    await db_session.execute(
        delete(BodyBoundaryShapeOrm).where(BodyBoundaryShapeOrm.body_id == body_id)
    )
    await db_session.execute(delete(BodyOrm).where(BodyOrm.app_project_id == source.id))
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # Restore must succeed even though the bundle has legacy extent_* keys.
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bodies_payload=bundle["bodies"],
        body_boundary_shapes_payload=bundle["body_boundary_shapes"],
        body_boundary_nodes_payload=bundle["body_boundary_nodes"],
    )
    await db_session.commit()

    # Body round-tripped with correct id and no extent state.
    restored_body = (
        await db_session.execute(select(BodyOrm).where(BodyOrm.id == body_id))
    ).scalar_one()
    assert restored_body.id == body_id
    assert restored_body.formation_id == formation.id
    assert restored_body.body_ordinal == 0
    # The extent columns are retired — the ORM no longer maps them, so a legacy
    # bundle's stale extent_* keys have nowhere to land (silently dropped by
    # _apply_json_to_kwargs's unknown-key filter).
    assert not hasattr(restored_body, "extent_left_kind")
    assert not hasattr(restored_body, "extent_right_kind")
    assert not hasattr(restored_body, "extent_left_target_contact_id")
    assert not hasattr(restored_body, "extent_right_anchor_layer_id")

    # Boundary shape + node also round-tripped correctly.
    restored_node = (
        await db_session.execute(
            select(BodyBoundaryNodeOrm).where(BodyBoundaryNodeOrm.id == node_id)
        )
    ).scalar_one()
    assert restored_node.along_m == 12.5
    assert restored_node.elevation_m == -3.0
    assert restored_node.node_index == 0


# ---------------------------------------------------------------------------
# body.display_color bundle round-trip (Task 3 — litho-3D milestone-2)
# ---------------------------------------------------------------------------


async def test_body_display_color_round_trips_in_bundle(db_session: AsyncSession) -> None:
    """``body.display_color`` survives build → wipe → restore (Task 3).

    A body with an explicit hex display_color is bundled, the project is wiped,
    and the bundle is restored.  The restored body must carry the same
    display_color — confirming the per-project engineering decision travels
    in the .gmproj/.strix bundle as required.

    Two cases are verified in a single test to keep setup overhead low:
    (1) display_color set to a hex string → value survives the round-trip.
    (2) display_color omitted from the bundle payload → restores as None
        (legacy tolerance — bundles saved before this column existed must
        open cleanly on the new schema).

    Parameters
    ----------
    db_session : AsyncSession
        Injected by the integration conftest.
    """
    from groundmodel.infrastructure.db.models.body_orm import BodyOrm as _BodyOrm
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )

    source = await _make_source_project(db_session)
    cpt = (
        await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == source.id))
    ).scalar_one()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="KLEI-DC",
        code="KL",
        color="#8b5cf6",
        display_order=0,
    )
    geo_backbone = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Geo DC",
        is_active=True,
        excluded_borehole_ids=[],
        kind="geological",
    )
    db_session.add_all([formation, geo_backbone])
    await db_session.flush()

    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Litho DC",
        is_active=True,
        excluded_borehole_ids=[],
        kind="lithostratigraphic",
        parent_model_id=geo_backbone.id,
    )
    db_session.add(model)
    await db_session.flush()

    # Case (1): body with an explicit display_color.
    body_with_color = _BodyOrm(
        id=uuid7(),
        app_project_id=source.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=cpt.id,
        display_color="#ff6600",
    )
    # Case (2): body without a display_color (null — fall back to formation colour).
    body_no_color = _BodyOrm(
        id=uuid7(),
        app_project_id=source.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=1,
        source_investigation_id=cpt.id,
        display_color=None,
    )
    db_session.add_all([body_with_color, body_no_color])

    # Need a cross-section for the bodies restore FK validation (section scope).
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=source.id,
        name="Sec-DC",
        start_x=150000.0,
        start_y=200000.0,
        end_x=151000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
        display_order=0,
    )
    db_session.add(section)
    await db_session.commit()

    with_color_id = body_with_color.id
    no_color_id = body_no_color.id

    # ---- Build: display_color must appear in the bundle body payload -------
    bundle = await build_project_bundle(db_session, source)
    assert "bodies" in bundle
    by_id = {b["id"]: b for b in bundle["bodies"]}
    assert str(with_color_id) in by_id, "body with display_color must appear in bundle"
    assert str(no_color_id) in by_id, "body without display_color must appear in bundle"
    assert by_id[str(with_color_id)]["display_color"] == "#ff6600", (
        "display_color must be serialised into the bundle verbatim"
    )
    assert by_id[str(no_color_id)]["display_color"] is None, (
        "null display_color must serialise as None"
    )

    # ---- Wipe end-to-end (simulate restoring onto a fresh DB) -------------
    await db_session.execute(delete(_BodyOrm).where(_BodyOrm.app_project_id == source.id))
    await db_session.execute(
        delete(GeologicalModelOrm).where(GeologicalModelOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == source.id)
    )
    await db_session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == source.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == source.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == source.id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore: display_color must survive the round-trip ---------------
    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bodies_payload=bundle["bodies"],
    )
    await db_session.commit()

    restored_with = (
        await db_session.execute(select(_BodyOrm).where(_BodyOrm.id == with_color_id))
    ).scalar_one()
    restored_no = (
        await db_session.execute(select(_BodyOrm).where(_BodyOrm.id == no_color_id))
    ).scalar_one()
    assert restored_with.display_color == "#ff6600", (
        "display_color must survive build → restore unchanged"
    )
    assert restored_no.display_color is None, "null display_color must restore as None"

    # ---- Legacy tolerance: a bundle payload WITHOUT the key restores to None
    # This simulates opening a .gmproj saved by an older build that pre-dates
    # the display_color column.  _apply_json_to_kwargs silently skips keys
    # absent from the data dict, so display_color gets no value in the ORM
    # constructor kwargs and the nullable column defaults to None.
    legacy_payload = dict(by_id[str(with_color_id)])
    del legacy_payload["display_color"]
    # Fresh id + a distinct body_ordinal so the legacy row doesn't collide with
    # the two bodies already restored in the DB (ordinals 0 and 1).
    legacy_payload["id"] = str(uuid7())
    legacy_payload["body_ordinal"] = 2
    bundle_legacy = dict(bundle)
    bundle_legacy["bodies"] = [legacy_payload]

    await restore_project_bundle(
        db_session,
        source.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bodies_payload=bundle_legacy["bodies"],
    )
    await db_session.commit()

    from uuid import UUID as _UUID

    legacy_id = legacy_payload["id"]
    restored_legacy = (
        await db_session.execute(select(_BodyOrm).where(_BodyOrm.id == _UUID(legacy_id)))
    ).scalar_one()
    assert restored_legacy.display_color is None, (
        "legacy bundle without display_color key must restore to None (additive tolerance)"
    )


# ---------------------------------------------------------------------------
# Geotech source-FK round-trip (Task B2 — spec §3 / §11)
# ---------------------------------------------------------------------------


async def test_bundle_round_trips_geotech_source_fks(
    db_session: AsyncSession,
) -> None:
    """source_litho_formation_id and source_geo_formation_id survive build → restore.

    A geotech-unit formation that has both provenance FK columns set must
    carry those values verbatim through the bundle JSON round-trip.  A
    legacy bundle payload that is missing both keys must restore the
    formation with ``None`` on both columns (additive tolerance — old
    .gmproj files open cleanly on a new build).
    """
    source = await _make_source_project(db_session)
    project_id = source.id

    # Three formations:
    #   geo_f  — a geological parent (source_geo_formation_id target)
    #   litho_f — a lithostratigraphic parent (source_litho_formation_id target)
    #   geotech_f — the geotech unit that references both
    geo_f = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Geo parent",
        color="#aaaaaa",
        display_order=0,
    )
    litho_f = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Litho parent",
        color="#bbbbbb",
        display_order=1,
    )
    geotech_f = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Geotech unit",
        color="#cccccc",
        display_order=2,
        source_litho_formation_id=litho_f.id,
        source_geo_formation_id=geo_f.id,
    )
    db_session.add_all([geo_f, litho_f, geotech_f])
    await db_session.commit()

    geo_id = geo_f.id
    litho_id = litho_f.id
    geotech_id = geotech_f.id

    # ---- Build bundle, assert FK columns appear in the formation payload ---
    bundle = await build_project_bundle(db_session, source)
    by_name = {f["name"]: f for f in bundle["geological_formations"]}
    assert "Geotech unit" in by_name, "geotech formation must appear in the bundle"
    geotech_payload = by_name["Geotech unit"]
    assert geotech_payload.get("source_litho_formation_id") == str(litho_id), (
        "source_litho_formation_id must be serialised as a UUID string in the bundle"
    )
    assert geotech_payload.get("source_geo_formation_id") == str(geo_id), (
        "source_geo_formation_id must be serialised as a UUID string in the bundle"
    )

    # ---- Wipe end-to-end (simulate restoring onto a fresh DB) -------------
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == project_id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == project_id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # ---- Restore and verify both FK columns survived ----------------------
    await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
    )
    await db_session.commit()

    restored_geotech = (
        await db_session.execute(
            select(GeologicalFormationOrm).where(GeologicalFormationOrm.id == geotech_id)
        )
    ).scalar_one()
    assert restored_geotech.source_litho_formation_id == litho_id, (
        "source_litho_formation_id must survive the bundle round-trip"
    )
    assert restored_geotech.source_geo_formation_id == geo_id, (
        "source_geo_formation_id must survive the bundle round-trip"
    )

    # ---- Legacy tolerance: a bundle payload without the keys restores to None
    # Simulates opening a .gmproj saved before the geotech stage added these
    # columns.  _apply_json_to_kwargs silently skips keys absent from the
    # data dict, so both columns default to None in the ORM constructor.
    legacy_geotech = dict(geotech_payload)
    legacy_geotech.pop("source_litho_formation_id", None)
    legacy_geotech.pop("source_geo_formation_id", None)
    # Use a fresh id so it doesn't collide with the already-restored row.
    legacy_geotech["id"] = str(uuid7())
    legacy_geotech["name"] = "Geotech unit (legacy)"

    legacy_bundle = dict(bundle)
    # Replace formations with three rows: original geo + litho (needed so
    # the legacy row has valid FK targets in the DB), plus the legacy row.
    legacy_bundle["geological_formations"] = [
        by_name["Geo parent"],
        by_name["Litho parent"],
        legacy_geotech,
    ]
    await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        legacy_bundle["geological_formations"],
        bundle["geological_models"],
    )
    await db_session.commit()

    restored_legacy = (
        await db_session.execute(
            select(GeologicalFormationOrm).where(
                GeologicalFormationOrm.id == UUID(legacy_geotech["id"])
            )
        )
    ).scalar_one()
    assert restored_legacy.source_litho_formation_id is None, (
        "source_litho_formation_id must be None when absent from legacy bundle payload"
    )
    assert restored_legacy.source_geo_formation_id is None, (
        "source_geo_formation_id must be None when absent from legacy bundle payload"
    )
