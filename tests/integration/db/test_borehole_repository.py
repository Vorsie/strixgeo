"""Integration tests for BoreholeRepository — full save / get / find / delete cycle.

Requires Docker DB running on localhost:5433 (``docker compose up -d``). No DOV
data files are needed — these tests use synthetic ORM rows.

Tests verify the full migration + ORM + repository stack end-to-end:
* Round-trip save → get_by_id with selectinload of children.
* Cascade insert: attaching ``drill_segments`` / ``field_log_intervals`` /
  observations / samples / lab tests to a Borehole and saving once persists
  them all.
* Cascade delete: deleting the borehole removes its full child tree
  automatically via the chained FK ``ondelete="CASCADE"``.
* Batch dedup: ``find_existing_test_ids`` returns one map for many ids in a
  single round-trip.
* App project scoping: the same (project_id, test_id) lives independently in
  different ``app_project_id`` namespaces.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.caco3_content_orm import CaCO3ContentOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import (
    FieldLogIntervalOrm,
)
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import (
    ObservationLayerOrm,
)
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.organic_content_orm import OrganicContentOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.models.water_content_orm import WaterContentOrm
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
)


def _borehole(
    *,
    name: str = "BH-1",
    project_id: str = "DOV",
    test_id: str = "GEO-25/001-B1",
    app_project_id: UUID | None = None,
    location_x: float = 200000.0,
    location_y: float = 200000.0,
    epsg: int = 31370,
) -> BoreholeOrm:
    """Build a minimal BoreholeOrm with sensible defaults for synthetic tests."""
    return BoreholeOrm(
        id=uuid7(),
        name=name,
        project_id=project_id,
        test_id=test_id,
        app_project_id=app_project_id,
        location_x=location_x,
        location_y=location_y,
        epsg=epsg,
        z_epsg=5710,
    )


# ---------------------------------------------------------------------------
# Smoke — round-trip
# ---------------------------------------------------------------------------


async def test_save_and_get_by_id(db_session: AsyncSession) -> None:
    """Saving a borehole then reading it back returns equal field values."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(name="round-trip", test_id="GEO-25/001-B1")
    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id)
    assert got is not None
    assert got.id == bh.id
    assert got.name == "round-trip"
    assert got.test_id == "GEO-25/001-B1"
    assert got.epsg == 31370


async def test_get_by_id_returns_none_for_missing(db_session: AsyncSession) -> None:
    repo = BoreholeRepository(db_session)
    assert await repo.get_by_id(uuid7()) is None


# ---------------------------------------------------------------------------
# Cascade — children travel with the parent in both directions
# ---------------------------------------------------------------------------


async def test_save_persists_drill_segments_and_field_log(
    db_session: AsyncSession,
) -> None:
    """Children attached to the parent are inserted in the same flush via cascade."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="cascade-insert")
    bh.drill_segments = [
        DrillSegmentOrm(id=uuid7(), top_m=0.0, base_m=0.5, method="spade"),
        DrillSegmentOrm(id=uuid7(), top_m=0.5, base_m=2.0, method="edelmanboring"),
    ]
    bh.field_log_intervals = [
        FieldLogIntervalOrm(id=uuid7(), top_m=0.0, base_m=1.5, kind="color", value="groenbruin"),
        FieldLogIntervalOrm(
            id=uuid7(), top_m=0.0, base_m=2.5, kind="moisture", value="weinig vochtig"
        ),
    ]
    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id)
    assert got is not None
    assert len(got.drill_segments) == 2
    # Loaded in top_m order via the relationship's order_by clause.
    assert got.drill_segments[0].method == "spade"
    assert got.drill_segments[1].method == "edelmanboring"
    assert len(got.field_log_intervals) == 2
    kinds = {f.kind for f in got.field_log_intervals}
    assert kinds == {"color", "moisture"}


async def test_delete_cascades_to_children(db_session: AsyncSession) -> None:
    """Deleting a borehole removes its drill_segments and field_log_intervals."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="cascade-delete")
    bh.drill_segments = [DrillSegmentOrm(id=uuid7(), top_m=0.0, base_m=1.0, method="spade")]
    bh.field_log_intervals = [
        FieldLogIntervalOrm(id=uuid7(), top_m=0.0, base_m=1.0, kind="color", value="bruin")
    ]
    await repo.save(bh)
    await db_session.commit()
    bh_id = bh.id

    await repo.delete(bh_id)
    await db_session.commit()

    assert await repo.get_by_id(bh_id) is None
    # Parent is gone; children were cascaded by the ON DELETE CASCADE on the FK.
    # Verify by counting via raw SELECT — repository has no read-children-without-parent API.
    from sqlalchemy import select

    seg_count = (
        await db_session.execute(
            select(DrillSegmentOrm).where(DrillSegmentOrm.borehole_id == bh_id)
        )
    ).all()
    log_count = (
        await db_session.execute(
            select(FieldLogIntervalOrm).where(FieldLogIntervalOrm.borehole_id == bh_id)
        )
    ).all()
    assert seg_count == []
    assert log_count == []


# ---------------------------------------------------------------------------
# Dedup — find_by_project_test, find_existing_test_ids
# ---------------------------------------------------------------------------


async def test_find_by_project_test(db_session: AsyncSession) -> None:
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="dedup-1")
    await repo.save(bh)
    await db_session.commit()

    got = await repo.find_by_project_test("DOV", "dedup-1")
    assert got is not None
    assert got.id == bh.id

    miss = await repo.find_by_project_test("DOV", "no-such-id")
    assert miss is None


async def test_find_existing_test_ids_batch(db_session: AsyncSession) -> None:
    """One query returns the existing-id map for any number of test_ids."""
    repo = BoreholeRepository(db_session)
    a = _borehole(test_id="batch-a")
    b = _borehole(test_id="batch-b")
    await repo.save(a)
    await repo.save(b)
    await db_session.commit()

    found = await repo.find_existing_test_ids("DOV", ["batch-a", "batch-b", "batch-missing"])
    assert set(found.keys()) == {"batch-a", "batch-b"}
    assert found["batch-a"] == a.id
    assert found["batch-b"] == b.id


async def test_find_existing_test_ids_empty_input(db_session: AsyncSession) -> None:
    """Empty input short-circuits to an empty result without hitting the DB."""
    repo = BoreholeRepository(db_session)
    assert await repo.find_existing_test_ids("DOV", []) == {}


# ---------------------------------------------------------------------------
# App project scoping — same (project_id, test_id) in different namespaces
# ---------------------------------------------------------------------------


async def test_app_project_scoping(db_session: AsyncSession) -> None:
    """The same source borehole imports cleanly into different app projects."""
    repo = BoreholeRepository(db_session)
    p1 = uuid7()
    p2 = uuid7()
    bh1 = _borehole(test_id="scoped", app_project_id=p1)
    bh2 = _borehole(test_id="scoped", app_project_id=p2)
    await repo.save(bh1)
    await repo.save(bh2)
    await db_session.commit()

    in_p1 = await repo.find_existing_test_ids("DOV", ["scoped"], app_project_id=p1)
    assert list(in_p1.keys()) == ["scoped"]
    assert in_p1["scoped"] == bh1.id

    in_p2 = await repo.find_existing_test_ids("DOV", ["scoped"], app_project_id=p2)
    assert list(in_p2.keys()) == ["scoped"]
    assert in_p2["scoped"] == bh2.id


async def test_list_all_filters_by_app_project(db_session: AsyncSession) -> None:
    repo = BoreholeRepository(db_session)
    p1 = uuid7()
    p2 = uuid7()
    await repo.save(_borehole(test_id="lst-1", app_project_id=p1))
    await repo.save(_borehole(test_id="lst-2", app_project_id=p2))
    await db_session.commit()

    only_p1 = await repo.list_all(app_project_id=p1)
    assert {bh.test_id for bh in only_p1} == {"lst-1"}


# ---------------------------------------------------------------------------
# Bulk write — flush=False does not flush per row
# ---------------------------------------------------------------------------


async def test_bulk_save_with_flush_false(db_session: AsyncSession) -> None:
    """flush=False defers the INSERT until commit; commit persists everything."""
    repo = BoreholeRepository(db_session)
    bhs = [_borehole(test_id=f"bulk-{i}") for i in range(5)]
    for bh in bhs:
        await repo.save(bh, flush=False)
    # Before commit nothing has hit the DB.
    pre_commit = await repo.find_existing_test_ids("DOV", [bh.test_id for bh in bhs])
    # In SQLAlchemy, find_existing_test_ids issues a SELECT which auto-flushes
    # the pending session — so this returns the rows even pre-commit. The real
    # property we care about is that ONE commit at the end persists everything.
    await db_session.commit()

    found = await repo.find_existing_test_ids("DOV", [bh.test_id for bh in bhs])
    assert len(found) == 5
    # Sanity: pre_commit should already see the rows because of the auto-flush
    assert len(pre_commit) == 5


# ---------------------------------------------------------------------------
# Observation tree — observation → layers → admixtures cascade
# ---------------------------------------------------------------------------


async def test_save_persists_observation_tree(db_session: AsyncSession) -> None:
    """Attaching observations + layers + admixtures all persists in one save."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="obs-tree")
    obs = ObservationOrm(
        id=uuid7(),
        observation_type="coded_lithology",
        author="Scheirlynck, Victor (Geolab)",
        reliability="goed",
        score_category="zeer goed",
        layers=[
            ObservationLayerOrm(
                id=uuid7(),
                top_m=0.0,
                base_m=0.5,
                color="groenbruin",
                main_soil_codes=["FZ"],
                layer_index=0,
                admixtures=[
                    AdmixtureOrm(id=uuid7(), soil_code="KL", amount="Z", locally=False),
                    AdmixtureOrm(id=uuid7(), soil_code="GL", amount="M", locally=True),
                ],
            ),
            ObservationLayerOrm(
                id=uuid7(),
                top_m=0.5,
                base_m=2.0,
                main_soil_codes=["XZ", "KL"],  # equally-dominant main soils
                layer_index=1,
            ),
        ],
    )
    bh.observations = [obs]
    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id)
    assert got is not None
    assert len(got.observations) == 1
    loaded = got.observations[0]
    assert loaded.observation_type == "coded_lithology"
    assert loaded.author == "Scheirlynck, Victor (Geolab)"
    assert len(loaded.layers) == 2
    # Layers come back in layer_index order.
    assert loaded.layers[0].layer_index == 0
    assert loaded.layers[1].layer_index == 1
    # ARRAY round-trips with order preserved.
    assert loaded.layers[0].main_soil_codes == ["FZ"]
    assert loaded.layers[1].main_soil_codes == ["XZ", "KL"]
    # Admixtures attached to the right layer.
    layer0_admixtures = loaded.layers[0].admixtures
    assert len(layer0_admixtures) == 2
    by_code = {a.soil_code: a for a in layer0_admixtures}
    assert by_code["KL"].amount == "Z"
    assert by_code["KL"].locally is False
    assert by_code["GL"].amount == "M"
    assert by_code["GL"].locally is True
    # Layer 1 has no admixtures.
    assert loaded.layers[1].admixtures == []


async def test_main_soil_codes_default_empty_array(db_session: AsyncSession) -> None:
    """Stratigraphy layers leave main_soil_codes empty — defaults to []."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="strat-layer")
    obs = ObservationOrm(
        id=uuid7(),
        observation_type="formal_stratigraphy",
        layers=[
            ObservationLayerOrm(
                id=uuid7(),
                top_m=3.0,
                base_m=8.5,
                description="HyEg - Lid van Egem (Formatie van Hyon)",
                layer_index=0,
            ),
        ],
    )
    bh.observations = [obs]
    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id)
    assert got is not None
    layer = got.observations[0].layers[0]
    assert layer.main_soil_codes == []
    assert layer.description == "HyEg - Lid van Egem (Formatie van Hyon)"


async def test_delete_cascades_through_observation_tree(
    db_session: AsyncSession,
) -> None:
    """Deleting a borehole removes observations, layers, and admixtures via cascade."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="cascade-obs")
    layer = ObservationLayerOrm(
        id=uuid7(),
        top_m=0.0,
        base_m=1.0,
        main_soil_codes=["FZ"],
        layer_index=0,
        admixtures=[AdmixtureOrm(id=uuid7(), soil_code="GL", amount="M")],
    )
    obs = ObservationOrm(id=uuid7(), observation_type="coded_lithology", layers=[layer])
    bh.observations = [obs]
    await repo.save(bh)
    await db_session.commit()
    bh_id, obs_id, layer_id = bh.id, obs.id, layer.id

    await repo.delete(bh_id)
    await db_session.commit()

    from sqlalchemy import select

    obs_rows = (
        await db_session.execute(select(ObservationOrm).where(ObservationOrm.id == obs_id))
    ).all()
    layer_rows = (
        await db_session.execute(
            select(ObservationLayerOrm).where(ObservationLayerOrm.id == layer_id)
        )
    ).all()
    admixture_rows = (
        await db_session.execute(
            select(AdmixtureOrm).where(AdmixtureOrm.observation_layer_id == layer_id)
        )
    ).all()
    assert obs_rows == []
    assert layer_rows == []
    assert admixture_rows == []


# ---------------------------------------------------------------------------
# Sample — cascade from borehole
# ---------------------------------------------------------------------------


async def test_save_persists_samples(db_session: AsyncSession) -> None:
    """Samples attach to a borehole via cascade and load back via get_by_id."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="samples-1")
    bh.samples = [
        SampleOrm(
            id=uuid7(),
            depth_top_m=2.0,
            depth_base_m=3.0,
            sample_number="1",
            sample_type="geroerd",
            instrument="edelmanboor",
        ),
        # Spot sample — top == base — must be allowed (DOV ships these).
        SampleOrm(
            id=uuid7(),
            depth_top_m=18.0,
            depth_base_m=18.0,
            sample_number="2",
            sample_type="ongeroerd",
        ),
    ]
    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id)
    assert got is not None
    assert len(got.samples) == 2
    # Loaded in depth_top_m order via the relationship's order_by clause.
    assert got.samples[0].depth_top_m == 2.0
    assert got.samples[1].depth_top_m == 18.0
    assert got.samples[1].depth_base_m == 18.0
    assert got.samples[0].instrument == "edelmanboor"


async def test_delete_cascades_to_samples(db_session: AsyncSession) -> None:
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="cascade-samples")
    sample_id = uuid7()
    bh.samples = [SampleOrm(id=sample_id, depth_top_m=1.0, depth_base_m=2.0)]
    await repo.save(bh)
    await db_session.commit()
    bh_id = bh.id

    await repo.delete(bh_id)
    await db_session.commit()

    from sqlalchemy import select

    rows = (await db_session.execute(select(SampleOrm).where(SampleOrm.id == sample_id))).all()
    assert rows == []


# ---------------------------------------------------------------------------
# Lab tests — cascade insert from sample, load on get_by_id, cascade delete
# ---------------------------------------------------------------------------


async def test_save_persists_full_lab_test_battery(db_session: AsyncSession) -> None:
    """All five lab tests cascade-insert via Sample and load back via get_by_id."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="lab-battery")
    sample = SampleOrm(
        id=uuid7(),
        depth_top_m=2.0,
        depth_base_m=3.0,
        sample_number="1",
    )
    sample.grain_sizes = [
        GrainSizeOrm(
            id=uuid7(),
            diameters_mm=[0.063, 0.125, 0.25, 0.5, 1.0, 2.0],
            pct_larger=[95.0, 87.0, 45.0, 8.0, 3.0, 1.0],
            method="Zeving",
            lime_removed=False,
            organics_removed=False,
        )
    ]
    sample.atterberg_limits_tests = [
        AtterbergLimitsOrm(
            id=uuid7(),
            liquid_limit_pct=45.0,
            plastic_limit_pct=22.0,
            non_plastic=False,
            method="Casagrande",
        )
    ]
    sample.caco3_content_tests = [
        CaCO3ContentOrm(id=uuid7(), content_pct=15.0, method="Calcimetrie")
    ]
    sample.organic_content_tests = [OrganicContentOrm(id=uuid7(), carbon_pct=2.5, matter_pct=4.3)]
    sample.water_content_tests = [
        # Peat-range value (>100%) accepted at the DB layer; domain entity
        # validates the upper bound separately.
        WaterContentOrm(id=uuid7(), content_pct=180.0, method="Oven drying")
    ]
    bh.samples = [sample]

    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id)
    assert got is not None
    assert len(got.samples) == 1
    s = got.samples[0]
    assert len(s.grain_sizes) == 1
    assert s.grain_sizes[0].diameters_mm == [0.063, 0.125, 0.25, 0.5, 1.0, 2.0]
    assert s.grain_sizes[0].pct_larger == [95.0, 87.0, 45.0, 8.0, 3.0, 1.0]
    assert s.grain_sizes[0].method == "Zeving"
    assert len(s.atterberg_limits_tests) == 1
    assert s.atterberg_limits_tests[0].liquid_limit_pct == 45.0
    assert s.atterberg_limits_tests[0].plastic_limit_pct == 22.0
    assert s.atterberg_limits_tests[0].non_plastic is False
    assert len(s.caco3_content_tests) == 1
    assert s.caco3_content_tests[0].content_pct == 15.0
    assert len(s.organic_content_tests) == 1
    assert s.organic_content_tests[0].carbon_pct == 2.5
    assert s.organic_content_tests[0].matter_pct == 4.3
    assert len(s.water_content_tests) == 1
    assert s.water_content_tests[0].content_pct == 180.0


async def test_get_by_id_scoped_include_lab_tests(db_session: AsyncSession) -> None:
    """``include_lab_tests`` loads only listed families; others stamp empty.

    Debt #2 — verifies the scoped path:

    * Requested families come back with their actual rows.
    * Excluded families come back as ``[]`` (no ``MissingGreenlet``
      lazy load when Pydantic walks the relationship).
    * Always-loaded children (drill segments, observations) stay
      intact.

    The "default (None) loads everything" path is already covered by
    ``test_save_persists_samples_with_lab_tests`` above, so we only
    test the new scoped behaviour here.
    """
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="include-scoped")
    sample = SampleOrm(id=uuid7(), depth_top_m=1.0, depth_base_m=2.0)
    sample.grain_sizes = [
        GrainSizeOrm(
            id=uuid7(),
            diameters_mm=[0.063, 1.0],
            pct_larger=[95.0, 5.0],
            method="Zeving",
            lime_removed=False,
            organics_removed=False,
        )
    ]
    sample.atterberg_limits_tests = [
        AtterbergLimitsOrm(
            id=uuid7(),
            liquid_limit_pct=40.0,
            plastic_limit_pct=20.0,
            non_plastic=False,
            method="Casagrande",
        )
    ]
    sample.caco3_content_tests = [CaCO3ContentOrm(id=uuid7(), content_pct=10.0, method="C")]
    sample.organic_content_tests = [OrganicContentOrm(id=uuid7(), carbon_pct=1.0, matter_pct=2.0)]
    sample.water_content_tests = [WaterContentOrm(id=uuid7(), content_pct=25.0, method="Oven")]
    bh.samples = [sample]

    await repo.save(bh)
    await db_session.commit()

    # Scoped to two families — others stamp empty.
    got = await repo.get_by_id(
        bh.id,
        include_lab_tests={"grain_sizes", "atterberg_limits_tests"},
    )
    assert got is not None
    s = got.samples[0]
    assert len(s.grain_sizes) == 1
    assert len(s.atterberg_limits_tests) == 1
    assert s.caco3_content_tests == []
    assert s.organic_content_tests == []
    assert s.water_content_tests == []
    assert s.scalar_lab_tests == []
    # Always-loaded children survive the scoped path.
    assert isinstance(got.drill_segments, list)
    assert isinstance(got.observations, list)


async def test_get_by_id_empty_include_set_skips_all_lab_tests(
    db_session: AsyncSession,
) -> None:
    """Empty ``include_lab_tests`` set loads zero families.

    Distinct test (not bundled with the scoped-subset case) so the
    session is fresh — re-querying the same borehole on the same
    session after a stamping pass hits SQLAlchemy's identity map +
    async greenlet trap. Production never does that (1:1 session per
    request), but the test must isolate to avoid the false failure.
    """
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="include-empty-set")
    sample = SampleOrm(id=uuid7(), depth_top_m=1.0, depth_base_m=2.0)
    sample.grain_sizes = [
        GrainSizeOrm(
            id=uuid7(),
            diameters_mm=[0.5],
            pct_larger=[50.0],
            method="Zeving",
            lime_removed=False,
            organics_removed=False,
        )
    ]
    bh.samples = [sample]
    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id, include_lab_tests=set())
    assert got is not None
    s = got.samples[0]
    assert s.grain_sizes == []
    assert s.atterberg_limits_tests == []
    assert s.caco3_content_tests == []
    assert s.organic_content_tests == []
    assert s.water_content_tests == []
    assert s.scalar_lab_tests == []


async def test_get_by_id_rejects_unknown_lab_test_relationship(
    db_session: AsyncSession,
) -> None:
    """Unknown relationship names raise ``ValueError`` before SQL runs.

    Defensive: callers should validate input upstream (the router
    does), but a hard error inside the repository is the loud failure
    mode the API rule promises (debt #2).
    """
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="include-unknown")
    await repo.save(bh)
    await db_session.commit()

    import pytest

    with pytest.raises(ValueError, match="Unknown lab-test relationship"):
        await repo.get_by_id(bh.id, include_lab_tests={"made_up_family"})


async def test_organic_content_independent_oc_om(db_session: AsyncSession) -> None:
    """Setting one of OC / OM does NOT auto-populate the other."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="oc-om")
    sample = SampleOrm(id=uuid7(), depth_top_m=1.0, depth_base_m=2.0)
    sample.organic_content_tests = [
        # Lab reported only OC.
        OrganicContentOrm(id=uuid7(), carbon_pct=3.0, matter_pct=None),
        # Different lab reported only OM.
        OrganicContentOrm(id=uuid7(), carbon_pct=None, matter_pct=5.0),
    ]
    bh.samples = [sample]
    await repo.save(bh)
    await db_session.commit()

    got = await repo.get_by_id(bh.id)
    assert got is not None
    tests = got.samples[0].organic_content_tests
    assert len(tests) == 2
    by_carbon = {t.carbon_pct for t in tests}
    by_matter = {t.matter_pct for t in tests}
    assert by_carbon == {3.0, None}
    assert by_matter == {5.0, None}


async def test_delete_cascades_through_sample_to_lab_tests(
    db_session: AsyncSession,
) -> None:
    """Deleting a borehole removes lab tests via borehole → sample → lab cascade."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="cascade-lab")
    sample = SampleOrm(id=uuid7(), depth_top_m=1.0, depth_base_m=2.0)
    grain_size_id = uuid7()
    atterberg_id = uuid7()
    caco3_id = uuid7()
    organic_id = uuid7()
    water_id = uuid7()
    sample.grain_sizes = [
        GrainSizeOrm(
            id=grain_size_id,
            diameters_mm=[0.063],
            pct_larger=[95.0],
            method="Zeving",
        )
    ]
    sample.atterberg_limits_tests = [AtterbergLimitsOrm(id=atterberg_id, liquid_limit_pct=40.0)]
    sample.caco3_content_tests = [CaCO3ContentOrm(id=caco3_id, content_pct=10.0)]
    sample.organic_content_tests = [OrganicContentOrm(id=organic_id, carbon_pct=2.0)]
    sample.water_content_tests = [WaterContentOrm(id=water_id, content_pct=30.0)]
    bh.samples = [sample]
    await repo.save(bh)
    await db_session.commit()
    bh_id = bh.id

    await repo.delete(bh_id)
    await db_session.commit()

    from sqlalchemy import select

    # Each lab table should have zero rows for the deleted ids.
    for cls, row_id in (
        (GrainSizeOrm, grain_size_id),
        (AtterbergLimitsOrm, atterberg_id),
        (CaCO3ContentOrm, caco3_id),
        (OrganicContentOrm, organic_id),
        (WaterContentOrm, water_id),
    ):
        rows = (await db_session.execute(select(cls).where(cls.id == row_id))).all()
        assert rows == [], f"{cls.__name__} row {row_id} should be cascaded out"


# ---------------------------------------------------------------------------
# Phase 3a — manual surface-elevation editor (set_elevation)
# ---------------------------------------------------------------------------


async def test_set_elevation_writes_value_and_z_epsg(db_session: AsyncSession) -> None:
    """Setting elevation persists both the value and the supplied vertical CRS."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="set-elev")
    bh.elevation_m = None
    bh.z_epsg = None
    await repo.save(bh)
    await db_session.commit()

    updated = await repo.set_elevation(bh.id, 12.34, 5710)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m == 12.34
    assert updated.z_epsg == 5710


async def test_set_elevation_clears_zepsg_when_value_cleared(
    db_session: AsyncSession,
) -> None:
    """Clearing elevation must drop z_epsg too — keeps the column pair consistent."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="clear-elev")
    bh.elevation_m = 10.0
    bh.z_epsg = 5710
    await repo.save(bh)
    await db_session.commit()

    updated = await repo.set_elevation(bh.id, None, 5710)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m is None
    # Repository drops z_epsg when elevation is cleared regardless of the
    # supplied z_epsg value, so the UI never sees a CRS without a value.
    assert updated.z_epsg is None


async def test_set_elevation_returns_none_for_missing_id(
    db_session: AsyncSession,
) -> None:
    """Patching a non-existent borehole returns None — handler maps to 404."""
    repo = BoreholeRepository(db_session)
    assert await repo.set_elevation(uuid7(), 5.0, 5710) is None


async def test_set_elevation_stamps_manual_provenance(
    db_session: AsyncSession,
) -> None:
    """``set_elevation`` always stamps MANUAL when a value is set.

    Debt #8 — the source flag is the entire point of the column;
    refresh-on-duplicate paths will consult it to decide whether to
    overwrite an imported Z. The test pins the stamp so a future
    refactor that drops it surfaces as a failure.
    """
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="stamp-manual")
    bh.elevation_m = 10.0
    bh.z_epsg = 5710
    bh.elevation_source = "dov"  # imagine: row was DOV-imported
    await repo.save(bh)
    await db_session.commit()

    updated = await repo.set_elevation(bh.id, 12.5, 5710)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_source == "manual"


async def test_set_elevation_clear_resets_source_to_none(
    db_session: AsyncSession,
) -> None:
    """Clearing the elevation flips the source back to NONE.

    Debt #8 — when the user hits Clear we don't keep "manual" stamped
    on a row whose Z is now null; the row is back to "no Z known"
    and should surface that way through every consumer that reads
    elevation_source.
    """
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="clear-source")
    bh.elevation_m = 8.0
    bh.z_epsg = 5710
    bh.elevation_source = "manual"
    await repo.save(bh)
    await db_session.commit()

    updated = await repo.set_elevation(bh.id, None, None)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m is None
    assert updated.elevation_source == "none"


async def test_set_elevation_clear_restores_imported_z(
    db_session: AsyncSession,
) -> None:
    """Clearing a manual override of an imported DOV Z restores the surveyed
    value + source instead of nulling the row (debt #21)."""
    repo = BoreholeRepository(db_session)
    bh = _borehole(test_id="rollback-elev")
    bh.elevation_m = 12.34
    bh.z_epsg = 5710
    bh.elevation_source = "dov"  # imagine: row came from DOV import
    await repo.save(bh)
    await db_session.commit()

    # Manual override → MANUAL, upstream DOV triple snapshotted.
    updated = await repo.set_elevation(bh.id, 15.0, None)
    await db_session.commit()
    assert updated is not None
    assert updated.elevation_m == 15.0
    assert updated.elevation_source == "manual"
    assert updated.original_elevation_m == 12.34
    assert updated.original_z_epsg == 5710
    assert updated.original_elevation_source == "dov"

    # Clear → restored to the DOV value + source, snapshot consumed.
    cleared = await repo.set_elevation(bh.id, None, None)
    await db_session.commit()
    assert cleared is not None
    assert cleared.elevation_m == 12.34
    assert cleared.z_epsg == 5710
    assert cleared.elevation_source == "dov"
    assert cleared.original_elevation_source is None
    assert cleared.original_elevation_m is None
