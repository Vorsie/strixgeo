"""Integration tests for FormationAbsenceOrm + constraints (#101 R1).

Exercises the renamed + reshaped ``formation_absence`` table (was
``litho_lens_absence``):

* Round-trip INSERT → SELECT for both ``investigation_kind`` values
* CHECK constraint rejects unknown ``investigation_kind``
* CHECK constraint rejects unknown ``source``
* UNIQUE constraint blocks duplicate (formation, kind, investigation) triple
* CASCADE from ``geological_formation``: deleting the formation removes
  its absence rows
* Multiple formations' absences are independent
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Shared fixture helpers
# ---------------------------------------------------------------------------


async def _make_fixture(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalFormationOrm]:
    """Project + one formation."""
    project = ProjectOrm(id=uuid7(), name="FormationAbsence test", status="active")
    db_session.add(project)
    await db_session.flush()

    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="KLEI", color="#8b5cf6"
    )
    db_session.add(formation)
    await db_session.commit()
    return project, formation


# ---------------------------------------------------------------------------
# Round-trip INSERT → SELECT for both investigation_kind values
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absence_round_trip_borehole_inferred(db_session: AsyncSession) -> None:
    """A borehole absence record with source='inferred' round-trips."""
    _, formation = await _make_fixture(db_session)

    borehole_id = uuid7()
    absence = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=formation.id,
        investigation_id=borehole_id,
        investigation_kind="borehole",
        source="inferred",
    )
    db_session.add(absence)
    await db_session.commit()

    loaded = (
        await db_session.execute(
            select(FormationAbsenceOrm).where(FormationAbsenceOrm.id == absence.id)
        )
    ).scalar_one()
    assert loaded.formation_id == formation.id
    assert loaded.investigation_id == borehole_id
    assert loaded.investigation_kind == "borehole"
    assert loaded.source == "inferred"
    assert loaded.created_at is not None


@pytest.mark.asyncio
async def test_absence_round_trip_cpt_manual(db_session: AsyncSession) -> None:
    """A CPT absence record with source='manual' round-trips."""
    _, formation = await _make_fixture(db_session)

    cpt_id = uuid7()
    absence = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=formation.id,
        investigation_id=cpt_id,
        investigation_kind="cpt",
        source="manual",
    )
    db_session.add(absence)
    await db_session.commit()

    loaded = (
        await db_session.execute(
            select(FormationAbsenceOrm).where(FormationAbsenceOrm.id == absence.id)
        )
    ).scalar_one()
    assert loaded.investigation_kind == "cpt"
    assert loaded.source == "manual"


@pytest.mark.asyncio
async def test_absence_round_trip_observed(db_session: AsyncSession) -> None:
    """A borehole absence with source='observed' round-trips."""
    _, formation = await _make_fixture(db_session)

    absence = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=formation.id,
        investigation_id=uuid7(),
        investigation_kind="borehole",
        source="observed",
    )
    db_session.add(absence)
    await db_session.commit()

    loaded = (
        await db_session.execute(
            select(FormationAbsenceOrm).where(FormationAbsenceOrm.id == absence.id)
        )
    ).scalar_one()
    assert loaded.source == "observed"


# ---------------------------------------------------------------------------
# CHECK constraints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absence_check_constraint_rejects_bad_kind(db_session: AsyncSession) -> None:
    """The CHECK on investigation_kind rejects unknown values."""
    _, formation = await _make_fixture(db_session)

    db_session.add(
        FormationAbsenceOrm(
            id=uuid7(),
            formation_id=formation.id,
            investigation_id=uuid7(),
            # `sample` is short enough to fit the VARCHAR(10) column —
            # the test must trip the CHECK constraint, not the column
            # length limit (`pressuremeter` would do the latter).
            investigation_kind="sample",  # invalid
            source="inferred",
        )
    )
    with pytest.raises(IntegrityError, match="ck_formation_absence_investigation_kind"):
        await db_session.flush()

    await db_session.rollback()


@pytest.mark.asyncio
async def test_absence_check_constraint_rejects_bad_source(db_session: AsyncSession) -> None:
    """The CHECK on source rejects values outside the allowed set."""
    _, formation = await _make_fixture(db_session)

    db_session.add(
        FormationAbsenceOrm(
            id=uuid7(),
            formation_id=formation.id,
            investigation_id=uuid7(),
            investigation_kind="borehole",
            source="fault",  # Phase 5+ only — not in v1.0 CHECK
        )
    )
    with pytest.raises(IntegrityError, match="ck_formation_absence_source"):
        await db_session.flush()

    await db_session.rollback()


# ---------------------------------------------------------------------------
# UNIQUE constraint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absence_unique_constraint_blocks_duplicate(db_session: AsyncSession) -> None:
    """UNIQUE on (formation_id, investigation_kind, investigation_id) blocks a
    second row with the same triple."""
    _, formation = await _make_fixture(db_session)
    investigation_id = uuid7()

    db_session.add(
        FormationAbsenceOrm(
            id=uuid7(),
            formation_id=formation.id,
            investigation_id=investigation_id,
            investigation_kind="borehole",
            source="inferred",
        )
    )
    await db_session.flush()

    db_session.add(
        FormationAbsenceOrm(
            id=uuid7(),
            formation_id=formation.id,
            investigation_id=investigation_id,  # same triple
            investigation_kind="borehole",
            source="manual",
        )
    )
    with pytest.raises(IntegrityError, match="uq_formation_absence_formation_investigation"):
        await db_session.flush()

    await db_session.rollback()


@pytest.mark.asyncio
async def test_absence_unique_allows_same_investigation_different_kind(
    db_session: AsyncSession,
) -> None:
    """Same investigation_id may appear with different investigation_kind values —
    the UNIQUE constraint is on the triple, not the pair."""
    _, formation = await _make_fixture(db_session)
    investigation_id = uuid7()

    db_session.add_all(
        [
            FormationAbsenceOrm(
                id=uuid7(),
                formation_id=formation.id,
                investigation_id=investigation_id,
                investigation_kind="borehole",
                source="inferred",
            ),
            FormationAbsenceOrm(
                id=uuid7(),
                formation_id=formation.id,
                investigation_id=investigation_id,
                investigation_kind="cpt",
                source="inferred",
            ),
        ]
    )
    # Should not raise — different kind means different triple.
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(FormationAbsenceOrm).where(
                    FormationAbsenceOrm.formation_id == formation.id,
                    FormationAbsenceOrm.investigation_id == investigation_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2


# ---------------------------------------------------------------------------
# CASCADE — deleting the formation removes its absence rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_formation_delete_cascades_to_absences(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on formation_id: deleting the formation evaporates
    all of its absence records."""
    _, formation = await _make_fixture(db_session)
    formation_id = formation.id

    absence_ids = []
    for kind in ("borehole", "cpt"):
        a = FormationAbsenceOrm(
            id=uuid7(),
            formation_id=formation_id,
            investigation_id=uuid7(),
            investigation_kind=kind,
            source="inferred",
        )
        db_session.add(a)
        absence_ids.append(a.id)
    await db_session.commit()

    # Confirm absences are present before the delete.
    pre_delete = (
        (
            await db_session.execute(
                select(FormationAbsenceOrm).where(FormationAbsenceOrm.formation_id == formation_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(pre_delete) == 2

    await db_session.delete(formation)
    await db_session.commit()

    for aid in absence_ids:
        post_row = (
            await db_session.execute(
                select(FormationAbsenceOrm).where(FormationAbsenceOrm.id == aid)
            )
        ).scalar_one_or_none()
        assert post_row is None, f"absence {aid} survived formation deletion — cascade failed"


@pytest.mark.asyncio
async def test_multiple_formations_absences_are_independent(
    db_session: AsyncSession,
) -> None:
    """Deleting one formation must not affect the absence rows of a sibling
    formation targeting the same investigation."""
    project, formation_a = await _make_fixture(db_session)

    formation_b = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="ZAND", color="#fceb9a"
    )
    db_session.add(formation_b)
    await db_session.flush()

    shared_inv_id = uuid7()

    absence_a = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=formation_a.id,
        investigation_id=shared_inv_id,
        investigation_kind="borehole",
        source="inferred",
    )
    absence_b = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=formation_b.id,
        investigation_id=shared_inv_id,
        investigation_kind="borehole",
        source="inferred",
    )
    db_session.add_all([absence_a, absence_b])
    await db_session.commit()

    absence_b_id = absence_b.id

    # Delete only formation_a — formation_b's absence must survive.
    await db_session.delete(formation_a)
    await db_session.commit()

    await db_session.refresh(absence_b)
    assert absence_b.id == absence_b_id
    assert absence_b.formation_id == formation_b.id


# ---------------------------------------------------------------------------
# Blocker 4 — UPSERT WHERE guard preserves manual/observed rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upsert_where_guard_preserves_manual_row(db_session: AsyncSession) -> None:
    """The inference UPSERT's WHERE clause must not overwrite source='manual'.

    Regression for Blocker 4 fix-up 2: the on_conflict_do_update clause now
    carries ``where=FormationAbsenceOrm.source == 'inferred'`` so a pre-existing
    'manual' or 'observed' row is left untouched if the engine emits 'inferred'
    for the same key.

    Uses the raw pg_insert path to test the SQL expression in isolation,
    without wiring the full RecomputeFormationAbsencesForBody use case.
    """
    from sqlalchemy import func
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from uuid6 import uuid7 as _uuid7

    _, formation = await _make_fixture(db_session)

    investigation_id = _uuid7()

    # Pre-insert a 'manual' row.
    manual_row = FormationAbsenceOrm(
        id=_uuid7(),
        formation_id=formation.id,
        investigation_id=investigation_id,
        investigation_kind="borehole",
        source="manual",
    )
    db_session.add(manual_row)
    await db_session.commit()
    manual_row_id = manual_row.id

    # Now run the UPSERT that the inference engine would run — emitting
    # source='inferred' for the same (formation, kind, investigation) triple.
    now = func.now()
    stmt = (
        pg_insert(FormationAbsenceOrm)
        .values(
            id=_uuid7(),
            formation_id=formation.id,
            investigation_id=investigation_id,
            investigation_kind="borehole",
            source="inferred",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_formation_absence_formation_investigation",
            set_={"source": "inferred", "updated_at": func.now()},
            # The WHERE guard: only overwrite when the existing row is inferred.
            where=FormationAbsenceOrm.source == "inferred",
        )
    )
    await db_session.execute(stmt)
    await db_session.commit()

    # The row must still have source='manual' — the WHERE guard blocked the update.
    await db_session.refresh(manual_row)
    assert manual_row.source == "manual", (
        f"Expected source='manual' to survive the inferred UPSERT; "
        f"got source={manual_row.source!r} (WHERE guard not working)"
    )
    assert manual_row.id == manual_row_id, "Row id must not change (should not have been replaced)"
