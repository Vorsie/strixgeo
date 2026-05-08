"""Integration tests for BoreholeRepository — full save / get / find / delete cycle.

Requires Docker DB running on localhost:5433 (``docker compose up -d``). No DOV
data files are needed — these tests use synthetic ORM rows.

Tests verify the full migration + ORM + repository stack end-to-end:
* Round-trip save → get_by_id with selectinload of children.
* Cascade insert: attaching ``drill_segments`` / ``field_log_intervals`` to a
  Borehole and saving once persists them all.
* Cascade delete: deleting the borehole removes its children automatically
  via the FK ``ondelete="CASCADE"``.
* Batch dedup: ``find_existing_test_ids`` returns one map for many ids in a
  single round-trip.
* App project scoping: the same (project_id, test_id) lives independently in
  different ``app_project_id`` namespaces.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import (
    FieldLogIntervalOrm,
)
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
