"""Integration test for refresh-on-duplicate dedup against a real PostgreSQL DB.

Locks in the load-bearing assertion behind PR #1 (refresh-on-duplicate):
the per-row dedup against ``dov_permkey`` plus the partial UNIQUE index
together guarantee that re-importing the same DOV bbox attaches **zero**
duplicate child rows to existing parents.

Scope:
* Pre-populates a borehole + sample + atterberg + scalar-lab-test row,
  all with non-NULL permkeys, then commits.
* Verifies ``existing_dov_permkeys`` and ``existing_dov_permkey_to_id``
  return the populated permkeys when queried against the real session.
* Verifies the partial UNIQUE index actually blocks a duplicate
  ``(parent_id, dov_permkey)`` insert at the database layer (defence-
  in-depth; if the orchestrator's dedup query misses for any reason,
  the index is the safety net).
* Verifies a NEW permkey for the SAME parent is allowed (the index is
  scoped per-parent, not global).
* Verifies legacy NULL-permkey rows do NOT participate in dedup
  (documented trade-off, debt #12).

Requires:
* Docker DB running on localhost:5433 (``docker compose up -d``).
"""

from __future__ import annotations

from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.models.scalar_lab_test_orm import ScalarLabTestOrm
from groundmodel.infrastructure.db.repositories.dov_dedup import (
    existing_dov_permkey_to_id,
    existing_dov_permkeys,
)

# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


async def _seed_borehole_with_lab_tests(
    session: AsyncSession,
    *,
    atterberg_permkey: str = "2024-50000001",
    scalar_permkey: str = "2024-50000002",
) -> tuple[UUID, UUID]:
    """Insert one borehole + one sample + one Atterberg + one scalar lab test.

    Returns ``(borehole_id, sample_id)`` so the test can issue dedup
    queries scoped to those parents.
    """
    project_id = uuid4()

    borehole = BoreholeOrm(
        id=uuid7(),
        app_project_id=project_id,
        project_id="DOV",
        test_id="GEO-FIXTURE-001",
        name="GEO-FIXTURE-001",
        location_x=100000.0,
        location_y=200000.0,
        epsg=31370,
    )
    session.add(borehole)

    sample = SampleOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        depth_top_m=1.0,
        depth_base_m=1.5,
        description="fixture sample",
        sample_number="M1",
        dov_permkey="2024-90000001",
    )
    session.add(sample)

    atterberg = AtterbergLimitsOrm(
        id=uuid7(),
        sample_id=sample.id,
        dov_permkey=atterberg_permkey,
        liquid_limit_pct=35.0,
        plastic_limit_pct=20.0,
        non_plastic=False,
        method="Casagrande",
        test_date=date(2024, 1, 15),
    )
    session.add(atterberg)

    scalar = ScalarLabTestOrm(
        id=uuid7(),
        sample_id=sample.id,
        dov_permkey=scalar_permkey,
        parameter_group="Onderkenning-grondsoort",
        parameter="Grondsoort volgens ASTM, de code (ASTM_code)",
        value_numeric=None,
        value_text="CL",
        unit=None,
        method=None,
        test_date=date(2024, 1, 15),
        detection_condition=None,
    )
    session.add(scalar)

    await session.commit()
    return borehole.id, sample.id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_existing_dov_permkeys_returns_populated_set(db_session: AsyncSession):
    """``existing_dov_permkeys`` returns the permkey of pre-existing rows."""
    _, sample_id = await _seed_borehole_with_lab_tests(
        db_session,
        atterberg_permkey="2024-50000010",
    )

    permkeys = await existing_dov_permkeys(db_session, AtterbergLimitsOrm, "sample_id", [sample_id])
    assert permkeys == {"2024-50000010"}


@pytest.mark.asyncio
async def test_existing_dov_permkey_to_id_returns_mapping(db_session: AsyncSession):
    """``existing_dov_permkey_to_id`` returns ``{permkey: row_id}``."""
    borehole_id, _ = await _seed_borehole_with_lab_tests(db_session)

    mapping = await existing_dov_permkey_to_id(db_session, SampleOrm, "borehole_id", [borehole_id])
    assert mapping.keys() == {"2024-90000001"}
    # The value is the persisted SampleOrm.id — confirm it round-trips.
    sample_id = mapping["2024-90000001"]
    fetched = await db_session.execute(select(SampleOrm).where(SampleOrm.id == sample_id))
    assert fetched.scalar_one().dov_permkey == "2024-90000001"


@pytest.mark.asyncio
async def test_partial_unique_index_blocks_duplicate_permkey(db_session: AsyncSession):
    """Inserting a second row with the same (parent_id, dov_permkey) must fail.

    This is the safety net: if the orchestrator's dedup query ever misses
    a row for any reason (race, bug, partial result), the partial UNIQUE
    index makes the duplicate impossible at the DB layer.
    """
    _, sample_id = await _seed_borehole_with_lab_tests(
        db_session,
        atterberg_permkey="2024-50000020",
    )

    # Duplicate (sample_id, dov_permkey) → must raise IntegrityError.
    duplicate = AtterbergLimitsOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey="2024-50000020",
        liquid_limit_pct=99.9,  # different value to prove it's the index, not equality
        plastic_limit_pct=11.1,
        non_plastic=False,
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_new_permkey_for_same_parent_is_allowed(db_session: AsyncSession):
    """The unique index is scoped per-parent, not global — a different permkey lands."""
    _, sample_id = await _seed_borehole_with_lab_tests(
        db_session,
        atterberg_permkey="2024-50000030",
    )

    second = AtterbergLimitsOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey="2024-50000031",  # different permkey, same sample
        liquid_limit_pct=42.0,
        plastic_limit_pct=18.0,
        non_plastic=False,
    )
    db_session.add(second)
    await db_session.commit()

    permkeys = await existing_dov_permkeys(db_session, AtterbergLimitsOrm, "sample_id", [sample_id])
    assert permkeys == {"2024-50000030", "2024-50000031"}


@pytest.mark.asyncio
async def test_null_permkey_does_not_participate_in_dedup(db_session: AsyncSession):
    """Legacy rows with NULL dov_permkey are excluded from the dedup set.

    Documented trade-off (CLAUDE.md debt #12): the partial unique index
    only constrains non-NULL permkeys, and the dedup helpers filter NULL
    out of the returned set. Without this, legacy rows would either
    block all new inserts (if NULL collided in the index) or appear in
    the dedup set under a sentinel that the orchestrator doesn't know
    how to interpret.
    """
    _, sample_id = await _seed_borehole_with_lab_tests(
        db_session,
        atterberg_permkey="2024-50000040",
    )

    # Manually insert a "legacy" NULL-permkey row and a second NULL-permkey
    # row — both must persist (no index conflict) and neither must show
    # up in the dedup set.
    legacy_a = ScalarLabTestOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey=None,
        parameter_group="legacy",
        parameter="legacy_param",
        value_numeric=1.0,
        value_text=None,
        unit=None,
        method=None,
        test_date=None,
        detection_condition=None,
    )
    legacy_b = ScalarLabTestOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey=None,
        parameter_group="legacy",
        parameter="legacy_param_two",
        value_numeric=2.0,
        value_text=None,
        unit=None,
        method=None,
        test_date=None,
        detection_condition=None,
    )
    db_session.add_all([legacy_a, legacy_b])
    await db_session.commit()

    permkeys = await existing_dov_permkeys(db_session, ScalarLabTestOrm, "sample_id", [sample_id])
    # The two legacy NULL rows landed but don't participate in dedup —
    # only the seeded scalar row's permkey is returned.
    assert permkeys == {"2024-50000002"}
