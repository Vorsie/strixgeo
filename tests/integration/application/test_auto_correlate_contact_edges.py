"""Integration tests for AutoCorrelateContactEdges (#133 Phase 2+3).

Three cases:
1. Two columns with a matching boundary → ≥1 auto edge inserted with
   ``source='auto'`` and ``user_approved=False``.
2. Calling execute twice → second call skips every candidate
   (``edges_skipped_existing >= edges_created`` from the first call).
3. Auto-correlate does NOT touch ``instance_ordinal`` on any formation —
   the resolver is not triggered.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.auto_correlate_contact_edges import (
    AutoCorrelateContactEdges,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Private fixture helpers
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved ``BoreholeOrm`` at the given x coordinate."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="ACCE",
        test_id=f"BH-ACCE-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _geo_model(project: ProjectOrm) -> GeologicalModelOrm:
    """Return an unsaved geological ``GeologicalModelOrm``."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-ACCE",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic ``GeologicalModelOrm``."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-ACCE",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )


def _geo_formation(project: ProjectOrm, *, name: str = "Quaternary") -> GeologicalFormationOrm:
    """Return an unsaved geological-level formation (no litho parent)."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#cccccc",
        display_order=0,
    )


def _litho_formation(
    project: ProjectOrm,
    parent: GeologicalFormationOrm,
    *,
    name: str,
    soil_code: str,
    display_order: int = 0,
) -> GeologicalFormationOrm:
    """Return an unsaved litho-level formation with a geological parent."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#aabbcc",
        display_order=display_order,
        parent_formation_id=parent.id,
        litho_main_soil_code=soil_code,
    )


def _contact(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth: float,
) -> FormationContactOrm:
    """Return an unsaved ``FormationContactOrm``."""
    return FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth,
        source="borehole_observation",
        confidence="medium",
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for auto-correlate tests."""
    proj = ProjectOrm(id=uuid7(), name="auto-correlate contact test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: auto edges inserted with source='auto', user_approved=False
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_inserts_auto_edges_with_user_approved_false(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Two columns with a matching ZAND-on-KLEI boundary at similar depth
    must produce ≥1 auto edge with source='auto' and user_approved=False.

    Setup: two boreholes 200 m apart (within MAX_COLUMN_DISTANCE_M=500),
    each with a ZAND contact at ~3 m depth in the same geological parent.
    The depth residual is 0.3 m, well within BASE_DEPTH_THRESHOLD_M=1.0.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary AC1")
    # Two litho formations with the same soil code — the algorithm groups by
    # (parent_formation_id, litho_main_soil_code, litho_below_code).
    f_zand_a = _litho_formation(
        project, geo_parent, name="ZAND A", soil_code="ZAND", display_order=1
    )
    f_zand_b = _litho_formation(
        project, geo_parent, name="ZAND B", soil_code="ZAND", display_order=2
    )
    f_klei_a = _litho_formation(
        project, geo_parent, name="KLEI A", soil_code="KLEI", display_order=3
    )
    f_klei_b = _litho_formation(
        project, geo_parent, name="KLEI B", soil_code="KLEI", display_order=4
    )
    bh_a = _borehole(project.id, suffix="A1", x=150000.0)
    bh_b = _borehole(project.id, suffix="A2", x=150200.0)  # 200 m apart

    db_session.add_all([geo, litho, geo_parent, f_zand_a, f_zand_b, f_klei_a, f_klei_b, bh_a, bh_b])
    await db_session.flush()

    # Column A: ZAND at 0 m, KLEI at 3.0 m
    ca_zand = _contact(litho, f_zand_a, bh_a, depth=0.0)
    ca_klei = _contact(litho, f_klei_a, bh_a, depth=3.0)
    # Column B: ZAND at 0 m, KLEI at 3.2 m  (0.2 m residual — within window)
    cb_zand = _contact(litho, f_zand_b, bh_b, depth=0.0)
    cb_klei = _contact(litho, f_klei_b, bh_b, depth=3.2)

    db_session.add_all([ca_zand, ca_klei, cb_zand, cb_klei])
    await db_session.commit()

    result = await AutoCorrelateContactEdges(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    assert result.edges_created >= 1, (
        f"Expected ≥1 edge to be created; got edges_created={result.edges_created}"
    )

    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == litho.id
                )
            )
        )
        .scalars()
        .all()
    )

    auto_rows = [r for r in rows if r.source == "auto"]
    assert len(auto_rows) >= 1, f"Expected auto rows; got sources={[r.source for r in rows]}"
    assert all(r.user_approved is False for r in auto_rows), (
        f"All auto edges must be unapproved; got {[r.user_approved for r in auto_rows]}"
    )


# ---------------------------------------------------------------------------
# Test 2: second run is idempotent (skips existing edges)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rerun_is_idempotent(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Calling execute twice must not double-insert edges.

    The second call must report ``edges_skipped_existing`` equal to
    ``edges_created`` from the first call, and ``edges_created=0``.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary AC2")
    f_zand_a = _litho_formation(
        project, geo_parent, name="ZAND A", soil_code="ZAND", display_order=1
    )
    f_zand_b = _litho_formation(
        project, geo_parent, name="ZAND B", soil_code="ZAND", display_order=2
    )
    f_klei_a = _litho_formation(
        project, geo_parent, name="KLEI A", soil_code="KLEI", display_order=3
    )
    f_klei_b = _litho_formation(
        project, geo_parent, name="KLEI B", soil_code="KLEI", display_order=4
    )
    bh_a = _borehole(project.id, suffix="B1", x=150000.0)
    bh_b = _borehole(project.id, suffix="B2", x=150200.0)

    db_session.add_all([geo, litho, geo_parent, f_zand_a, f_zand_b, f_klei_a, f_klei_b, bh_a, bh_b])
    await db_session.flush()

    ca_zand = _contact(litho, f_zand_a, bh_a, depth=0.0)
    ca_klei = _contact(litho, f_klei_a, bh_a, depth=3.0)
    cb_zand = _contact(litho, f_zand_b, bh_b, depth=0.0)
    cb_klei = _contact(litho, f_klei_b, bh_b, depth=3.1)

    db_session.add_all([ca_zand, ca_klei, cb_zand, cb_klei])
    await db_session.commit()

    first = await AutoCorrelateContactEdges(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    assert first.edges_created >= 1, f"First run must create ≥1 edge; got {first.edges_created}"

    second = await AutoCorrelateContactEdges(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    assert second.edges_created == 0, f"Second run must create 0 edges; got {second.edges_created}"
    assert second.edges_skipped_existing == first.edges_created, (
        f"Second run must skip exactly {first.edges_created} edge(s); "
        f"got edges_skipped_existing={second.edges_skipped_existing}"
    )


# ---------------------------------------------------------------------------
# Test 3: resolver is NOT triggered — instance_ordinal unchanged
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolver_not_triggered_by_auto_run(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Auto-correlate must NOT update instance_ordinal on any formation.

    The resolver only fires in the Accept flow; auto edges are unapproved
    and must not drive the connectivity graph.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary AC3")
    f_zand_a = _litho_formation(
        project, geo_parent, name="ZAND A", soil_code="ZAND", display_order=1
    )
    f_zand_b = _litho_formation(
        project, geo_parent, name="ZAND B", soil_code="ZAND", display_order=2
    )
    bh_a = _borehole(project.id, suffix="C1", x=150000.0)
    bh_b = _borehole(project.id, suffix="C2", x=150200.0)

    # Pre-set distinct ordinals to detect any accidental resolver run.
    f_zand_a.instance_ordinal = 7
    f_zand_b.instance_ordinal = 8

    db_session.add_all([geo, litho, geo_parent, f_zand_a, f_zand_b, bh_a, bh_b])
    await db_session.flush()

    ca = _contact(litho, f_zand_a, bh_a, depth=2.0)
    cb = _contact(litho, f_zand_b, bh_b, depth=2.1)

    db_session.add_all([ca, cb])
    await db_session.commit()

    await AutoCorrelateContactEdges(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    # Reload from DB to verify no side-effect on ordinals.
    await db_session.refresh(f_zand_a)
    await db_session.refresh(f_zand_b)

    assert f_zand_a.instance_ordinal == 7, (
        f"instance_ordinal of f_zand_a must not change; got {f_zand_a.instance_ordinal}"
    )
    assert f_zand_b.instance_ordinal == 8, (
        f"instance_ordinal of f_zand_b must not change; got {f_zand_b.instance_ordinal}"
    )


# ---------------------------------------------------------------------------
# Test 4: a correlation crossing is dropped from persistence + reported as a
#         pinch-out lens candidate (auto-lens, drop + lens)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_crossing_edges_dropped_and_surfaced_as_pinch_out(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When two same-lithology correlations cross, both edges are withheld and
    one pinch-out lens candidate is returned.

    Column A: ZAND at 1 m over KLEI at 5 m. Column B (200 m away): the beds
    interfinger — ZAND drops to 5 m and KLEI rises to 1 m. Auto-correlate would
    draw ZAND-A↔ZAND-B (1→5) and KLEI-A↔KLEI-B (5→1) — both within the 4% window
    at 200 m — but they CROSS. Drop + lens: neither edge persists, and one
    ``CrossingPinchOut`` is reported instead.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _geo_formation(project, name="Quaternary AC4")
    f_zand_a = _litho_formation(
        project, geo_parent, name="ZAND A4", soil_code="ZAND", display_order=1
    )
    f_zand_b = _litho_formation(
        project, geo_parent, name="ZAND B4", soil_code="ZAND", display_order=2
    )
    f_klei_a = _litho_formation(
        project, geo_parent, name="KLEI A4", soil_code="KLEI", display_order=3
    )
    f_klei_b = _litho_formation(
        project, geo_parent, name="KLEI B4", soil_code="KLEI", display_order=4
    )
    bh_a = _borehole(project.id, suffix="X1", x=150000.0)
    bh_b = _borehole(project.id, suffix="X2", x=150200.0)  # 200 m apart

    db_session.add_all([geo, litho, geo_parent, f_zand_a, f_zand_b, f_klei_a, f_klei_b, bh_a, bh_b])
    await db_session.flush()

    # A: ZAND@1 over KLEI@5.  B: ZAND@5 over KLEI@1 (interfingered → crossing).
    ca_zand = _contact(litho, f_zand_a, bh_a, depth=1.0)
    ca_klei = _contact(litho, f_klei_a, bh_a, depth=5.0)
    cb_zand = _contact(litho, f_zand_b, bh_b, depth=5.0)
    cb_klei = _contact(litho, f_klei_b, bh_b, depth=1.0)
    db_session.add_all([ca_zand, ca_klei, cb_zand, cb_klei])
    await db_session.commit()

    result = await AutoCorrelateContactEdges(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    # Both crossing edges withheld; one pinch-out surfaced; nothing persisted.
    assert len(result.crossing_pinch_outs) == 1, (
        f"Expected 1 crossing pinch-out; got {result.crossing_pinch_outs}"
    )
    assert result.edges_dropped_crossing == 2, (
        f"Both crossing edges must be dropped; got {result.edges_dropped_crossing}"
    )
    assert result.edges_created == 0, (
        f"No flat edge should persist; got edges_created={result.edges_created}"
    )

    po = result.crossing_pinch_outs[0]
    assert po.source_investigation_id in {bh_a.id, bh_b.id}
    assert po.neighbour_investigation_id in {bh_a.id, bh_b.id}
    assert po.source_investigation_id != po.neighbour_investigation_id

    # The DB carries no auto edge for this model.
    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == litho.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert [r for r in rows if r.source == "auto"] == [], (
        f"No auto edges should persist for a pure crossing; got {len(rows)} row(s)"
    )


# ---------------------------------------------------------------------------
# Test 5: a non-litho (geological) model is rejected with ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rejects_non_litho_model(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Auto-correlate on a geological model must raise ``ValueError``.

    Auto-correlate groups contacts by their formation's ``litho_main_soil_code``,
    which only lithostratigraphic models carry. Running it on a geological
    model would otherwise produce nonsense edges (or 500 downstream), so the
    use case rejects the wrong kind up front. The API layer maps this
    ``ValueError`` to HTTP 422.
    """
    geo = _geo_model(project)
    db_session.add(geo)
    await db_session.commit()

    with pytest.raises(ValueError, match="lithostratigraphic"):
        await AutoCorrelateContactEdges(db_session).execute(
            project_id=project.id,
            model_id=geo.id,
        )
