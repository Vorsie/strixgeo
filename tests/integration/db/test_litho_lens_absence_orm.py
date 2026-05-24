"""Integration tests for the LithoLensAbsenceOrm + its constraints (#101 Slice 2).

Exercises the Slice-2 schema migration (``f6a7b8c9d0e1``):

* Round-trip INSERT → SELECT for both ``investigation_kind`` values
* CHECK constraint rejects an unknown ``investigation_kind``
* UNIQUE constraint blocks duplicate (lens, kind, investigation) triple
* CASCADE from ``litho_lens``: deleting the lens removes its absence rows
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_lens_absence_orm import LithoLensAbsenceOrm
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Shared fixture helpers
# ---------------------------------------------------------------------------


async def _make_fixture(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, GeologicalModelOrm, GeologicalFormationOrm, LithoLensOrm]:
    """Project + lithostratigraphic model + formation + one lens."""
    project = ProjectOrm(id=uuid7(), name="Lens absence slice-2 test", status="active")
    db_session.add(project)
    await db_session.flush()

    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho M",
        kind="lithostratigraphic",
    )
    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="KLEI", color="#8b5cf6"
    )
    db_session.add_all([model, formation])
    await db_session.flush()

    lens = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        parent_formation_id=formation.id,
        name="Clay drape",
    )
    db_session.add(lens)
    await db_session.commit()
    return project, model, formation, lens


# ---------------------------------------------------------------------------
# Round-trip INSERT → SELECT for both investigation_kind values
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absence_round_trip_borehole(db_session: AsyncSession) -> None:
    """A borehole absence record round-trips through INSERT → SELECT."""
    _, _, _, lens = await _make_fixture(db_session)

    borehole_id = uuid7()
    absence = LithoLensAbsenceOrm(
        id=uuid7(),
        lens_id=lens.id,
        investigation_id=borehole_id,
        investigation_kind="borehole",
    )
    db_session.add(absence)
    await db_session.commit()

    loaded = (
        await db_session.execute(
            select(LithoLensAbsenceOrm).where(LithoLensAbsenceOrm.id == absence.id)
        )
    ).scalar_one()
    assert loaded.lens_id == lens.id
    assert loaded.investigation_id == borehole_id
    assert loaded.investigation_kind == "borehole"
    assert loaded.created_at is not None


@pytest.mark.asyncio
async def test_absence_round_trip_cpt(db_session: AsyncSession) -> None:
    """A CPT absence record round-trips through INSERT → SELECT."""
    _, _, _, lens = await _make_fixture(db_session)

    cpt_id = uuid7()
    absence = LithoLensAbsenceOrm(
        id=uuid7(),
        lens_id=lens.id,
        investigation_id=cpt_id,
        investigation_kind="cpt",
    )
    db_session.add(absence)
    await db_session.commit()

    loaded = (
        await db_session.execute(
            select(LithoLensAbsenceOrm).where(LithoLensAbsenceOrm.id == absence.id)
        )
    ).scalar_one()
    assert loaded.lens_id == lens.id
    assert loaded.investigation_id == cpt_id
    assert loaded.investigation_kind == "cpt"


# ---------------------------------------------------------------------------
# CHECK constraint — bad investigation_kind is rejected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absence_check_constraint_rejects_bad_kind(db_session: AsyncSession) -> None:
    """The CHECK constraint on investigation_kind must reject values not in
    ('borehole', 'cpt') — e.g. 'sample' or 'pressuremeter'."""
    _, _, _, lens = await _make_fixture(db_session)

    db_session.add(
        LithoLensAbsenceOrm(
            id=uuid7(),
            lens_id=lens.id,
            investigation_id=uuid7(),
            investigation_kind="sample",  # invalid
        )
    )
    with pytest.raises(IntegrityError, match="ck_litho_lens_absence_investigation_kind"):
        await db_session.flush()

    await db_session.rollback()


# ---------------------------------------------------------------------------
# UNIQUE constraint — duplicate (lens, kind, investigation) triple
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absence_unique_constraint_blocks_duplicate(db_session: AsyncSession) -> None:
    """The UNIQUE constraint on (lens_id, investigation_kind, investigation_id)
    must reject a second row with the same triple."""
    _, _, _, lens = await _make_fixture(db_session)
    investigation_id = uuid7()

    db_session.add(
        LithoLensAbsenceOrm(
            id=uuid7(),
            lens_id=lens.id,
            investigation_id=investigation_id,
            investigation_kind="borehole",
        )
    )
    await db_session.flush()

    db_session.add(
        LithoLensAbsenceOrm(
            id=uuid7(),
            lens_id=lens.id,
            investigation_id=investigation_id,  # same triple
            investigation_kind="borehole",
        )
    )
    with pytest.raises(IntegrityError, match="uq_litho_lens_absence_lens_investigation"):
        await db_session.flush()

    await db_session.rollback()


@pytest.mark.asyncio
async def test_absence_unique_allows_same_investigation_different_kind(
    db_session: AsyncSession,
) -> None:
    """The same investigation_id may appear with different investigation_kind values —
    the UNIQUE constraint is on the triple, not the pair (lens_id, investigation_id)."""
    _, _, _, lens = await _make_fixture(db_session)
    investigation_id = uuid7()

    db_session.add(
        LithoLensAbsenceOrm(
            id=uuid7(),
            lens_id=lens.id,
            investigation_id=investigation_id,
            investigation_kind="borehole",
        )
    )
    db_session.add(
        LithoLensAbsenceOrm(
            id=uuid7(),
            lens_id=lens.id,
            investigation_id=investigation_id,
            investigation_kind="cpt",
        )
    )
    # Should not raise — different kind means different triple.
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(LithoLensAbsenceOrm).where(
                    LithoLensAbsenceOrm.lens_id == lens.id,
                    LithoLensAbsenceOrm.investigation_id == investigation_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2


# ---------------------------------------------------------------------------
# CASCADE — deleting the lens removes its absence rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lens_delete_cascades_to_absences(db_session: AsyncSession) -> None:
    """ON DELETE CASCADE on lens_id: deleting the lens evaporates all of
    its absence records — the absence set has no meaning without the lens."""
    _, _, _, lens = await _make_fixture(db_session)
    lens_id = lens.id

    absence_ids = []
    for kind in ("borehole", "cpt"):
        a = LithoLensAbsenceOrm(
            id=uuid7(),
            lens_id=lens_id,
            investigation_id=uuid7(),
            investigation_kind=kind,
        )
        db_session.add(a)
        absence_ids.append(a.id)
    await db_session.commit()

    # Confirm absences are present before the delete.
    pre_delete = (
        (
            await db_session.execute(
                select(LithoLensAbsenceOrm).where(LithoLensAbsenceOrm.lens_id == lens_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(pre_delete) == 2

    # Delete the lens — the cascade fires.
    await db_session.delete(lens)
    await db_session.commit()

    # Refresh each absence row from the DB to bypass the SQLAlchemy
    # identity-map cache (Slice-1 taught us this pattern).
    for aid in absence_ids:
        post_row = (
            await db_session.execute(
                select(LithoLensAbsenceOrm).where(LithoLensAbsenceOrm.id == aid)
            )
        ).scalar_one_or_none()
        assert post_row is None, f"absence {aid} survived lens deletion — cascade failed"


@pytest.mark.asyncio
async def test_multiple_lenses_absences_are_independent(db_session: AsyncSession) -> None:
    """Deleting one lens must not affect the absence rows of a sibling lens
    that targets the same investigation."""
    project, model, formation, lens_a = await _make_fixture(db_session)

    lens_b = LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        parent_formation_id=formation.id,
        name="Second clay drape",
    )
    db_session.add(lens_b)
    await db_session.flush()

    shared_bh_id = uuid7()

    absence_a = LithoLensAbsenceOrm(
        id=uuid7(),
        lens_id=lens_a.id,
        investigation_id=shared_bh_id,
        investigation_kind="borehole",
    )
    absence_b = LithoLensAbsenceOrm(
        id=uuid7(),
        lens_id=lens_b.id,
        investigation_id=shared_bh_id,
        investigation_kind="borehole",
    )
    db_session.add_all([absence_a, absence_b])
    await db_session.commit()

    absence_b_id = absence_b.id

    # Delete only lens_a — lens_b's absence must survive.
    await db_session.delete(lens_a)
    await db_session.commit()

    # Use identity-aware refresh to bypass identity-map cache.
    await db_session.refresh(absence_b)
    assert absence_b.id == absence_b_id
    assert absence_b.lens_id == lens_b.id
