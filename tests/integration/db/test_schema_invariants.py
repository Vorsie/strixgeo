"""Schema integrity hardening — debt #107.

Pins the CHECK constraints + partial-unique indexes added by migrations
``a1c2d3e4f5a6`` (domain-invariant CHECKs), ``b2d3e4f5a6b7`` (kind/parent
NULL-discriminated invariant), and ``c3e4f5a6b7c8`` (partial-unique dedup
indexes on cpt + borehole).

Setup uses ORM helpers so Python-side defaults (``excluded_borehole_ids``,
``pre_drill_m``, etc) get applied. The constraint-violating mutation is
the raw SQL — that's the only behaviour under test.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare project row for tests that need a parent project."""
    p = ProjectOrm(id=uuid7(), name="schema-invariants", status="active")
    db_session.add(p)
    await db_session.flush()
    return p


@pytest_asyncio.fixture
async def geo_model(db_session: AsyncSession, project: ProjectOrm) -> GeologicalModelOrm:
    """A geological model (parent-kind) under the project."""
    m = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="m", kind="geological")
    db_session.add(m)
    await db_session.flush()
    return m


@pytest_asyncio.fixture
async def formation(db_session: AsyncSession, project: ProjectOrm) -> GeologicalFormationOrm:
    """A project-scoped formation for body fixtures."""
    f = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="F",
        display_order=0,
        color="#ffffff",
    )
    db_session.add(f)
    await db_session.flush()
    return f


# ---------------------------------------------------------------------------
# Migration a1c2d3e4f5a6 — domain-invariant CHECKs
# ---------------------------------------------------------------------------


async def test_geological_model_kind_invalid_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """``kind='invalid'`` violates ``ck_geological_model_kind_*``.

    An invalid ``kind`` also fails the ``kind_parent_null`` CHECK (because
    neither branch of its expression matches), so EITHER constraint name
    is a valid rejection signature; PG picks whichever it evaluates first.
    """
    bad = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="bad-kind", kind="invalid")
    db_session.add(bad)
    with pytest.raises(IntegrityError, match=r"ck_geological_model_kind_"):
        await db_session.flush()


async def test_geological_model_kind_all_three_valid(
    db_session: AsyncSession, project: ProjectOrm, geo_model: GeologicalModelOrm
) -> None:
    """Each of the three documented kinds inserts cleanly."""
    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="litho",
            kind="lithostratigraphic",
            parent_geological_model_id=geo_model.id,
        )
    )
    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="gt",
            kind="geotechnical",
            parent_geological_model_id=geo_model.id,
        )
    )
    await db_session.flush()


async def test_body_ordinal_negative_rejected(
    db_session: AsyncSession,
    project: ProjectOrm,
    geo_model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
) -> None:
    """``body_ordinal = -1`` violates ``ck_body_ordinal_non_negative``."""
    with pytest.raises(IntegrityError, match="ck_body_ordinal_non_negative"):
        await db_session.execute(
            text(
                "INSERT INTO body (id, app_project_id, model_id, formation_id,"
                " body_ordinal, source_investigation_id)"
                " VALUES (:id, :pid, :mid, :fid, -1, :inv)"
            ),
            {
                "id": uuid7(),
                "pid": project.id,
                "mid": geo_model.id,
                "fid": formation.id,
                "inv": uuid7(),
            },
        )
        await db_session.flush()


async def test_body_extent_left_kind_invalid_rejected(
    db_session: AsyncSession,
    project: ProjectOrm,
    geo_model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
) -> None:
    """``extent_left_kind='bogus'`` violates ``ck_body_extent_left_kind_valid``."""
    with pytest.raises(IntegrityError, match="ck_body_extent_left_kind_valid"):
        await db_session.execute(
            text(
                "INSERT INTO body (id, app_project_id, model_id, formation_id,"
                " body_ordinal, source_investigation_id, extent_left_kind)"
                " VALUES (:id, :pid, :mid, :fid, 0, :inv, 'bogus')"
            ),
            {
                "id": uuid7(),
                "pid": project.id,
                "mid": geo_model.id,
                "fid": formation.id,
                "inv": uuid7(),
            },
        )
        await db_session.flush()


async def test_body_extent_kinds_null_accepted(
    db_session: AsyncSession,
    project: ProjectOrm,
    geo_model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
) -> None:
    """``extent_left_kind = extent_right_kind = NULL`` is the default and must pass."""
    await db_session.execute(
        text(
            "INSERT INTO body (id, app_project_id, model_id, formation_id,"
            " body_ordinal, source_investigation_id)"
            " VALUES (:id, :pid, :mid, :fid, 0, :inv)"
        ),
        {
            "id": uuid7(),
            "pid": project.id,
            "mid": geo_model.id,
            "fid": formation.id,
            "inv": uuid7(),
        },
    )
    await db_session.flush()


# ---------------------------------------------------------------------------
# Migration b2d3e4f5a6b7 — kind / parent_geological_model_id NULL invariant
# ---------------------------------------------------------------------------


async def test_geological_model_with_parent_rejected(
    db_session: AsyncSession, project: ProjectOrm, geo_model: GeologicalModelOrm
) -> None:
    """``kind='geological'`` MUST have ``parent_geological_model_id IS NULL``."""
    bad = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="g-with-parent",
        kind="geological",
        parent_geological_model_id=geo_model.id,
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError, match="ck_geological_model_kind_parent_null"):
        await db_session.flush()


async def test_litho_model_without_parent_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """``kind='lithostratigraphic'`` MUST have a non-NULL parent."""
    bad = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="orphan-litho",
        kind="lithostratigraphic",
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError, match="ck_geological_model_kind_parent_null"):
        await db_session.flush()


async def test_geotech_model_without_parent_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """``kind='geotechnical'`` MUST have a non-NULL parent."""
    bad = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="orphan-gt",
        kind="geotechnical",
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError, match="ck_geological_model_kind_parent_null"):
        await db_session.flush()


# ---------------------------------------------------------------------------
# Migration c3e4f5a6b7c8 — partial-unique dedup indexes
# ---------------------------------------------------------------------------


async def test_cpt_dedup_partial_unique(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Two CPTs with the same (app_project_id, project_id, test_id) → 2nd raises."""
    db_session.add(
        CptOrm(
            id=uuid7(),
            name="one",
            cpt_type="CPTU",
            app_project_id=project.id,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    await db_session.flush()

    db_session.add(
        CptOrm(
            id=uuid7(),
            name="two",
            cpt_type="CPTU",
            app_project_id=project.id,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    with pytest.raises(IntegrityError, match="uq_cpt_app_project_source_test"):
        await db_session.flush()


# ---------------------------------------------------------------------------
# Migration t4u5v6w7x8y9 — is_active partial UNIQUE per (app_project_id, kind)
# ---------------------------------------------------------------------------


async def test_two_active_geological_models_same_project_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """Two is_active=True geological models in the same project raises IntegrityError.

    Invariant: at most one active model per (app_project_id, kind).
    The partial unique uq_geological_model_one_active_per_kind enforces this at the DB level.
    """
    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="G1",
            kind="geological",
            is_active=True,
        )
    )
    await db_session.flush()

    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="G2",
            kind="geological",
            is_active=True,
        )
    )
    with pytest.raises(IntegrityError, match="uq_geological_model_one_active_per_kind"):
        await db_session.flush()


async def test_active_geological_and_active_litho_same_project_accepted(
    db_session: AsyncSession, project: ProjectOrm, geo_model: GeologicalModelOrm
) -> None:
    """One active geological + one active lithostratigraphic in the same project is allowed.

    Different kinds have independent active pointers (CLAUDE.md three-level hierarchy).
    The partial unique covers (app_project_id, kind) — same project but different kind
    means no conflict.
    """
    # Activate the geo_model fixture.
    geo_model.is_active = True
    await db_session.flush()

    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho refinement",
        kind="lithostratigraphic",
        is_active=True,
        parent_geological_model_id=geo_model.id,
    )
    db_session.add(litho)
    await db_session.flush()  # must not raise — different kinds


async def test_inactive_models_not_constrained(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """Multiple INACTIVE models of the same kind in the same project is allowed.

    The partial unique applies only WHERE is_active = TRUE.
    """
    for i in range(3):
        db_session.add(
            GeologicalModelOrm(
                id=uuid7(),
                app_project_id=project.id,
                name=f"inactive-{i}",
                kind="geological",
                is_active=False,
            )
        )
    await db_session.flush()  # must not raise — all inactive


async def test_cpt_dedup_partial_unique_ignores_null_project(
    db_session: AsyncSession,
) -> None:
    """Partial-unique excludes ``app_project_id IS NULL``; legacy duplicates allowed."""
    db_session.add(
        CptOrm(
            id=uuid7(),
            name="one",
            cpt_type="CPTU",
            app_project_id=None,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    db_session.add(
        CptOrm(
            id=uuid7(),
            name="two",
            cpt_type="CPTU",
            app_project_id=None,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    await db_session.flush()
