"""Integration tests for ``ProjectRepository`` — CRUD + soft archive lifecycle.

Requires Docker DB on localhost:5433 (``docker compose up -d``). No data
fixtures needed — all rows are synthetic ORM instances.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_repository import (
    ProjectRepository,
)


def _project(*, name: str = "Test Project", **overrides: object) -> ProjectOrm:
    """Build a minimal ProjectOrm with sensible defaults.

    ``status`` defaults to ``active`` but is overridable — tests for the
    duplicate operation set it to a non-default value to verify the
    lifecycle resets on the new project.
    """
    overrides.setdefault("status", "active")
    return ProjectOrm(id=uuid7(), name=name, **overrides)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Smoke — round-trip
# ---------------------------------------------------------------------------


async def test_save_and_get_by_id(db_session: AsyncSession) -> None:
    """Saving a project then reading it back returns equal field values."""
    repo = ProjectRepository(db_session)
    project = _project(
        name="Site investigation A",
        client="ACME",
        site_label="Antwerp port",
        description="Foundation study for new quay",
        tags=["foundation", "marine"],
        default_horizontal_epsg=31370,
        default_vertical_epsg=5710,
        phase="design",
    )
    await repo.save(project)
    await db_session.commit()

    got = await repo.get_by_id(project.id)
    assert got is not None
    assert got.name == "Site investigation A"
    assert got.client == "ACME"
    assert got.tags == ["foundation", "marine"]
    assert got.default_horizontal_epsg == 31370
    assert got.phase == "design"
    assert got.status == "active"
    assert got.archived_at is None


async def test_get_by_id_returns_none_for_missing(db_session: AsyncSession) -> None:
    """Unknown project id resolves to None (router maps to 404)."""
    repo = ProjectRepository(db_session)
    assert await repo.get_by_id(uuid7()) is None


# ---------------------------------------------------------------------------
# Listing — active vs archived partitioning
# ---------------------------------------------------------------------------


async def test_list_all_hides_archived_by_default(db_session: AsyncSession) -> None:
    """``list_all()`` excludes rows where ``archived_at`` is set."""
    repo = ProjectRepository(db_session)
    active = _project(name="Active project")
    archived = _project(name="Archived project")
    await repo.save(active)
    await repo.save(archived)
    await db_session.commit()
    await repo.archive(archived.id)
    await db_session.commit()

    rows = await repo.list_all()
    names = {r.name for r in rows}
    assert "Active project" in names
    assert "Archived project" not in names


async def test_list_all_includes_archived_when_requested(
    db_session: AsyncSession,
) -> None:
    """``include_archived=True`` returns both active and archived rows."""
    repo = ProjectRepository(db_session)
    active = _project(name="Active for include")
    archived = _project(name="Archived for include")
    await repo.save(active)
    await repo.save(archived)
    await db_session.commit()
    await repo.archive(archived.id)
    await db_session.commit()

    rows = await repo.list_all(include_archived=True)
    names = {r.name for r in rows}
    assert {"Active for include", "Archived for include"} <= names


async def test_list_archived_returns_only_archived(db_session: AsyncSession) -> None:
    """``list_archived`` is the inverse view of the default list."""
    repo = ProjectRepository(db_session)
    active = _project(name="Active for archived-view")
    archived = _project(name="Archived for archived-view")
    await repo.save(active)
    await repo.save(archived)
    await db_session.commit()
    await repo.archive(archived.id)
    await db_session.commit()

    rows = await repo.list_archived()
    names = {r.name for r in rows}
    assert "Archived for archived-view" in names
    assert "Active for archived-view" not in names


# ---------------------------------------------------------------------------
# Archive / unarchive lifecycle
# ---------------------------------------------------------------------------


async def test_archive_sets_archived_at(db_session: AsyncSession) -> None:
    """Archiving stamps a timezone-aware ``archived_at``."""
    repo = ProjectRepository(db_session)
    project = _project(name="To archive")
    await repo.save(project)
    await db_session.commit()
    assert project.archived_at is None

    updated = await repo.archive(project.id)
    await db_session.commit()
    assert updated is not None
    assert updated.archived_at is not None
    # archived_at is timezone-aware UTC.
    assert updated.archived_at.tzinfo is not None


async def test_unarchive_clears_archived_at(db_session: AsyncSession) -> None:
    """Unarchiving clears ``archived_at`` back to None."""
    repo = ProjectRepository(db_session)
    project = _project(name="To unarchive")
    await repo.save(project)
    await db_session.commit()
    await repo.archive(project.id)
    await db_session.commit()
    assert project.archived_at is not None

    updated = await repo.unarchive(project.id)
    await db_session.commit()
    assert updated is not None
    assert updated.archived_at is None


async def test_archive_returns_none_for_missing_id(db_session: AsyncSession) -> None:
    """Archiving a non-existent id returns None — handler maps to 404."""
    repo = ProjectRepository(db_session)
    assert await repo.archive(uuid7()) is None


async def test_unarchive_returns_none_for_missing_id(db_session: AsyncSession) -> None:
    """Unarchiving a non-existent id returns None — handler maps to 404."""
    repo = ProjectRepository(db_session)
    assert await repo.unarchive(uuid7()) is None


# ---------------------------------------------------------------------------
# duplicate — deep clone of CPTs + boreholes (Save As)
# ---------------------------------------------------------------------------


async def test_duplicate_returns_none_for_missing_source(db_session: AsyncSession) -> None:
    """Duplicating a non-existent project id returns None (router maps to 404)."""
    repo = ProjectRepository(db_session)
    assert await repo.duplicate(uuid7()) is None


async def test_duplicate_copies_metadata_under_a_new_id(db_session: AsyncSession) -> None:
    """The new project carries every metadata field forward; status resets to active."""
    repo = ProjectRepository(db_session)
    source = _project(
        name="Source",
        project_number="GEO-2026-001",
        client="ACME",
        site_label="Quay 7",
        description="Foundation study",
        tags=["foundation", "marine"],
        default_horizontal_epsg=31370,
        default_vertical_epsg=5710,
        phase="design",
        status="completed",  # source's lifecycle does NOT carry across.
    )
    await repo.save(source)
    await db_session.commit()

    duplicate = await repo.duplicate(source.id)
    await db_session.commit()
    assert duplicate is not None
    assert duplicate.id != source.id
    assert duplicate.name == "Copy of Source"
    assert duplicate.project_number == "GEO-2026-001"
    assert duplicate.client == "ACME"
    assert duplicate.tags == ["foundation", "marine"]
    assert duplicate.default_horizontal_epsg == 31370
    assert duplicate.phase == "design"
    # Lifecycle resets — a fresh duplicate is always active.
    assert duplicate.status == "active"
    assert duplicate.archived_at is None


async def test_duplicate_uses_explicit_new_name_when_supplied(
    db_session: AsyncSession,
) -> None:
    """``new_name`` overrides the default ``"Copy of …"`` name."""
    repo = ProjectRepository(db_session)
    source = _project(name="Source")
    await repo.save(source)
    await db_session.commit()

    duplicate = await repo.duplicate(source.id, new_name="Branch A")
    await db_session.commit()
    assert duplicate is not None
    assert duplicate.name == "Branch A"


async def test_duplicate_deep_clones_cpt_with_series(db_session: AsyncSession) -> None:
    """Source CPT + its series end up under the new project with fresh ids."""
    from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
    from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm

    repo = ProjectRepository(db_session)
    source = _project(name="Source with CPT")
    await repo.save(source)

    src_cpt = CptOrm(
        id=uuid7(),
        name="CPT-1",
        cpt_type="CPTU",
        app_project_id=source.id,
        location_x=200000.0,
        location_y=200000.0,
        epsg=31370,
    )
    # CptSeriesOrm has no separate ``id`` — its PK is ``cpt_id`` (1:1
    # relationship to its parent). Cascade sets the FK on attach.
    src_cpt.series = CptSeriesOrm(
        depths_m=[0.0, 0.5, 1.0],
        qc_mpa=[1.2, 2.4, 3.6],
    )
    db_session.add(src_cpt)
    await db_session.commit()

    duplicate = await repo.duplicate(source.id)
    await db_session.commit()
    assert duplicate is not None

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    new_cpts_stmt = (
        select(CptOrm)
        .where(CptOrm.app_project_id == duplicate.id)
        .options(selectinload(CptOrm.series))
    )
    new_cpts = list((await db_session.execute(new_cpts_stmt)).scalars().all())
    assert len(new_cpts) == 1
    new_cpt = new_cpts[0]
    assert new_cpt.id != src_cpt.id
    assert new_cpt.name == "CPT-1"
    assert new_cpt.cpt_type == "CPTU"
    assert new_cpt.app_project_id == duplicate.id
    assert new_cpt.series is not None
    # cpt_series PK is cpt_id; verify the FK got rewritten to the new
    # parent CPT id (not the source's).
    assert new_cpt.series.cpt_id == new_cpt.id
    assert new_cpt.series.cpt_id != src_cpt.id
    assert new_cpt.series.depths_m == [0.0, 0.5, 1.0]
    assert new_cpt.series.qc_mpa == [1.2, 2.4, 3.6]


async def test_duplicate_deep_clones_full_borehole_tree(db_session: AsyncSession) -> None:
    """Borehole + drill segments + observations + layers + admixtures + samples + lab tests."""
    from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
    from groundmodel.infrastructure.db.models.atterberg_limits_orm import (
        AtterbergLimitsOrm,
    )
    from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
    from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
    from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
    from groundmodel.infrastructure.db.models.sample_orm import SampleOrm

    repo = ProjectRepository(db_session)
    source = _project(name="Source with borehole")
    await repo.save(source)

    src_bh = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=source.id,
        location_x=200000.0,
        location_y=200000.0,
        epsg=31370,
    )
    src_bh.drill_segments = [DrillSegmentOrm(id=uuid7(), top_m=0.0, base_m=2.0, method="spade")]
    obs = ObservationOrm(id=uuid7(), observation_type="lithologie")
    layer = ObservationLayerOrm(
        id=uuid7(), top_m=0.0, base_m=2.0, layer_index=0, main_soil_codes=["KL"]
    )
    layer.admixtures = [AdmixtureOrm(id=uuid7(), soil_code="ZS", amount="weinig", locally=False)]
    obs.layers = [layer]
    src_bh.observations = [obs]

    sample = SampleOrm(id=uuid7(), depth_top_m=1.0, depth_base_m=2.0)
    sample.grain_sizes = [
        GrainSizeOrm(id=uuid7(), diameters_mm=[0.063], pct_larger=[95.0], method="Zeving")
    ]
    sample.atterberg_limits_tests = [AtterbergLimitsOrm(id=uuid7(), liquid_limit_pct=42.0)]
    src_bh.samples = [sample]

    db_session.add(src_bh)
    await db_session.commit()

    duplicate = await repo.duplicate(source.id)
    await db_session.commit()
    assert duplicate is not None

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    bhs_stmt = (
        select(BoreholeOrm)
        .where(BoreholeOrm.app_project_id == duplicate.id)
        .options(
            selectinload(BoreholeOrm.drill_segments),
            selectinload(BoreholeOrm.observations)
            .selectinload(ObservationOrm.layers)
            .selectinload(ObservationLayerOrm.admixtures),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.grain_sizes),
            selectinload(BoreholeOrm.samples).selectinload(SampleOrm.atterberg_limits_tests),
        )
    )
    bhs = list((await db_session.execute(bhs_stmt)).scalars().all())
    assert len(bhs) == 1
    new_bh = bhs[0]
    assert new_bh.id != src_bh.id
    assert new_bh.name == "BH-1"
    assert len(new_bh.drill_segments) == 1
    assert new_bh.drill_segments[0].id != src_bh.drill_segments[0].id
    assert new_bh.drill_segments[0].method == "spade"
    assert len(new_bh.observations) == 1
    new_obs = new_bh.observations[0]
    assert new_obs.id != obs.id
    assert len(new_obs.layers) == 1
    new_layer = new_obs.layers[0]
    assert new_layer.id != layer.id
    assert new_layer.main_soil_codes == ["KL"]
    assert len(new_layer.admixtures) == 1
    assert new_layer.admixtures[0].soil_code == "ZS"
    assert len(new_bh.samples) == 1
    new_sample = new_bh.samples[0]
    assert new_sample.id != sample.id
    assert len(new_sample.grain_sizes) == 1
    assert new_sample.grain_sizes[0].pct_larger == [95.0]
    assert len(new_sample.atterberg_limits_tests) == 1
    assert new_sample.atterberg_limits_tests[0].liquid_limit_pct == 42.0


async def test_duplicate_leaves_source_untouched(db_session: AsyncSession) -> None:
    """Source project + its rows are not mutated by the duplicate operation."""
    from groundmodel.infrastructure.db.models.cpt_orm import CptOrm

    repo = ProjectRepository(db_session)
    source = _project(name="Source", description="original")
    await repo.save(source)
    src_cpt = CptOrm(
        id=uuid7(),
        name="CPT-source",
        cpt_type="CPTE",
        app_project_id=source.id,
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
    )
    db_session.add(src_cpt)
    await db_session.commit()

    await repo.duplicate(source.id)
    await db_session.commit()

    # Re-fetch the source project + its CPT and confirm nothing changed.
    refreshed = await repo.get_by_id(source.id)
    assert refreshed is not None
    assert refreshed.description == "original"

    from sqlalchemy import select

    src_cpts = list(
        (await db_session.execute(select(CptOrm).where(CptOrm.app_project_id == source.id)))
        .scalars()
        .all()
    )
    assert len(src_cpts) == 1
    assert src_cpts[0].id == src_cpt.id
    assert src_cpts[0].name == "CPT-source"
