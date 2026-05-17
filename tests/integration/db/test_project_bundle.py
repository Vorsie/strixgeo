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
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
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

    assert bundle["format_version"] == 3
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
    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm,
    )
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.geological_model_orm import (
        GeologicalModelOrm,
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
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )

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


async def test_bundle_carries_geotechnical_units(db_session: AsyncSession) -> None:
    """Build + restore round-trips geotechnical units alongside their parent formation."""
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.geotechnical_unit_orm import (
        GeotechnicalUnitOrm,
    )

    source = await _make_source_project(db_session)
    project_id = source.id

    boom = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="Boom Klei",
        code="Bm",
        color="#5a4a3a",
        display_order=0,
    )
    db_session.add(boom)
    await db_session.flush()

    crust = GeotechnicalUnitOrm(
        id=uuid7(),
        app_project_id=project_id,
        geological_formation_id=boom.id,
        name="Weathered crust",
        code="BmK-wc",
        color="#a0805f",
        display_order=0,
    )
    undisturbed = GeotechnicalUnitOrm(
        id=uuid7(),
        app_project_id=project_id,
        geological_formation_id=boom.id,
        name="Undisturbed",
        code="BmK-u",
        color="#5a4a3a",
        display_order=1,
        description="Below the crust, intact clay.",
    )
    db_session.add_all([crust, undisturbed])
    await db_session.commit()

    original_unit_ids = {crust.id, undisturbed.id}

    # ---- Build the bundle, assert the units are in it ------------------
    bundle = await build_project_bundle(db_session, source)
    assert "geotechnical_units" in bundle
    unit_names = {u["name"] for u in bundle["geotechnical_units"]}
    assert unit_names == {"Weathered crust", "Undisturbed"}
    # Free-text description survives JSON.
    descriptions = [u.get("description") for u in bundle["geotechnical_units"]]
    assert "Below the crust, intact clay." in descriptions

    # ---- Wipe and restore ---------------------------------------------
    await db_session.execute(
        delete(GeotechnicalUnitOrm).where(GeotechnicalUnitOrm.app_project_id == project_id)
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == project_id)
    )
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
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bundle["investigation_reviews"],
        geotechnical_units_payload=bundle["geotechnical_units"],
    )
    await db_session.commit()

    units_after = list(
        (
            await db_session.execute(
                select(GeotechnicalUnitOrm).where(GeotechnicalUnitOrm.app_project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    assert {u.id for u in units_after} == original_unit_ids
    by_name = {u.name: u for u in units_after}
    assert by_name["Weathered crust"].geological_formation_id == boom.id
    assert by_name["Undisturbed"].description == "Below the crust, intact clay."


async def test_restore_skips_units_when_payload_omits_them(
    db_session: AsyncSession,
) -> None:
    """Older bundles without a ``geotechnical_units`` kwarg still restore cleanly."""
    from groundmodel.infrastructure.db.models.geotechnical_unit_orm import (
        GeotechnicalUnitOrm,
    )

    source = await _make_source_project(db_session)
    project_id = source.id
    bundle = await build_project_bundle(db_session, source)

    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == project_id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await db_session.delete(source)
    await db_session.commit()
    db_session.expunge_all()

    # geotechnical_units_payload omitted entirely — defaults to [] inside
    # restore_project_bundle. Mirrors how a pre-this-build .gmproj will
    # round-trip through the new code path.
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
    )
    await db_session.commit()

    units_after = (
        (
            await db_session.execute(
                select(GeotechnicalUnitOrm.id).where(
                    GeotechnicalUnitOrm.app_project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert list(units_after) == []


async def test_bundle_round_trips_kind_parent_lithology_nad_class(
    db_session: AsyncSession,
) -> None:
    """Senior-review S7: the four slice-1/2 columns survive build→restore,
    and S6: a bundled model with an unknown ``kind`` restores coerced to
    'geological' (never silently mis-behaving in the crossing validator).
    """
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.geological_model_orm import (
        GeologicalModelOrm,
    )

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
        parent_geological_model_id=geo.id,
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
            "parent_geological_model_id": None,
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
    assert models[geo_id].parent_geological_model_id is None
    assert models[litho_id].kind == "lithostratigraphic"
    assert models[litho_id].parent_geological_model_id == geo_id
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
