"""Integration tests: investigation_reviews + view_state round-trip via bundle.

The .gmproj v3 file format embeds every per-project engineering
decision so opening the file on a wiped DB rehydrates the complete
state. These tests assert both the polymorphic per-investigation
review rows and the JSONB view_state bag on the project survive a
wipe + restore cycle byte-for-byte.

Requires the Docker DB on localhost:5433.
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import (
    InvestigationReviewOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
    restore_project_bundle,
)


async def _make_project_with_view_state(
    db_session: AsyncSession,
    *,
    view_state: dict[str, object] | None = None,
) -> ProjectOrm:
    """Insert a minimal project with an optional view_state bag."""
    project = ProjectOrm(
        id=uuid7(),
        name="Reviews bundle test",
        status="active",
        view_state=view_state or {},
    )
    db_session.add(project)
    await db_session.commit()
    return project


async def test_bundle_emits_v4_with_reviews_array(db_session: AsyncSession) -> None:
    """``build_project_bundle`` returns format_version=4 + the new array."""
    project = await _make_project_with_view_state(db_session)
    bundle = await build_project_bundle(db_session, project)

    assert bundle["format_version"] == 4
    assert "investigation_reviews" in bundle
    # No reviews written → empty list, not missing.
    assert bundle["investigation_reviews"] == []


async def test_bundle_round_trips_investigation_reviews(
    db_session: AsyncSession,
) -> None:
    """Reviews survive a full wipe + restore from the bundle."""
    project = await _make_project_with_view_state(db_session)

    # Two reviews: one CPT-anchored (reviewed), one borehole-anchored
    # (hidden). The polymorphic shape is the load-bearing thing to
    # round-trip; vary both kinds so a missing branch on either path
    # would fail the assertion.
    #
    # The restore path validates that each review's target_id resolves
    # to a real CPT/borehole in the project (orphan-drop guard), so
    # we have to plant real targets before the review rows.
    cpt = CptOrm(
        id=uuid7(),
        name="cpt-anchor",
        cpt_type="CPTU",
        app_project_id=project.id,
        project_id="MANUAL",
        test_id="cpt-anchor",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
    )
    bh = BoreholeOrm(
        id=uuid7(),
        name="bh-anchor",
        app_project_id=project.id,
        project_id="MANUAL",
        test_id="bh-anchor",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
    )
    db_session.add_all([cpt, bh])
    await db_session.commit()
    cpt_target = cpt.id
    bh_target = bh.id
    review_a = InvestigationReviewOrm(
        id=uuid7(),
        app_project_id=project.id,
        target_kind="cpt",
        target_id=cpt_target,
        review_status="reviewed",
        review_notes="Approved after re-running Ic plot",
        is_hidden=False,
    )
    review_b = InvestigationReviewOrm(
        id=uuid7(),
        app_project_id=project.id,
        target_kind="borehole",
        target_id=bh_target,
        review_status="in_progress",
        review_notes=None,
        is_hidden=True,
    )
    db_session.add_all([review_a, review_b])
    await db_session.commit()
    original_ids = {review_a.id, review_b.id}

    bundle = await build_project_bundle(db_session, project)
    assert len(bundle["investigation_reviews"]) == 2

    # Wipe everything that lives on this project (CPTs/boreholes don't
    # exist for this minimal project, but match the pattern of the
    # other bundle tests so the test reads as a real "wiped DB" cycle).
    await db_session.execute(
        delete(InvestigationReviewOrm).where(InvestigationReviewOrm.app_project_id == project.id)
    )
    await db_session.execute(delete(CptOrm).where(CptOrm.app_project_id == project.id))
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project.id))
    await db_session.delete(project)
    await db_session.commit()
    db_session.expunge_all()

    # Restore from the bundle.
    await restore_project_bundle(
        db_session,
        project.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bundle["investigation_reviews"],
    )
    await db_session.commit()

    restored = list(
        (
            await db_session.execute(
                select(InvestigationReviewOrm).where(
                    InvestigationReviewOrm.app_project_id == project.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert {r.id for r in restored} == original_ids
    by_target_kind = {r.target_kind: r for r in restored}
    assert by_target_kind["cpt"].target_id == cpt_target
    assert by_target_kind["cpt"].review_status == "reviewed"
    assert by_target_kind["cpt"].review_notes == "Approved after re-running Ic plot"
    assert by_target_kind["cpt"].is_hidden is False
    assert by_target_kind["borehole"].target_id == bh_target
    assert by_target_kind["borehole"].review_status == "in_progress"
    assert by_target_kind["borehole"].is_hidden is True


async def test_bundle_round_trips_view_state(db_session: AsyncSession) -> None:
    """JSONB view_state survives the wipe + restore cycle untouched."""
    view_state = {
        "dem_overlay": {"enabled": True, "opacity": 0.45},
        "hidden_cpt_types": ["CPTM"],
        "hidden_borehole_methods": [],
    }
    project = await _make_project_with_view_state(db_session, view_state=view_state)

    bundle = await build_project_bundle(db_session, project)
    assert bundle["project"]["view_state"] == view_state

    await db_session.delete(project)
    await db_session.commit()
    db_session.expunge_all()

    await restore_project_bundle(
        db_session,
        project.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bundle["investigation_reviews"],
    )
    await db_session.commit()
    db_session.expunge_all()

    restored = (
        await db_session.execute(select(ProjectOrm).where(ProjectOrm.id == project.id))
    ).scalar_one()
    assert restored.view_state == view_state


async def test_restore_drops_orphan_review_rows(db_session: AsyncSession) -> None:
    """Bundle reviews whose target_id resolves to nothing in this project are dropped.

    The polymorphic anchor has no DB-side FK, so a malformed or hand-
    edited bundle can otherwise plant decisions pointing at nothing.
    The PUT router validates target-existence per write; restore must
    mirror it. Drop-with-warning beats raise — one bad row shouldn't
    sabotage an otherwise valid restore.
    """
    project = await _make_project_with_view_state(db_session)
    bundle = await build_project_bundle(db_session, project)

    # Craft a synthetic reviews array with one good (still orphan since
    # this project has no CPTs/boreholes) and one explicitly malformed
    # (no target_id) entry. With no real targets in the project, both
    # should be dropped on restore.
    bundle["investigation_reviews"] = [
        {
            "id": str(uuid7()),
            "app_project_id": str(project.id),
            "target_kind": "cpt",
            "target_id": str(uuid7()),  # references no real CPT
            "review_status": "reviewed",
            "review_notes": None,
            "reviewed_at": None,
            "is_hidden": False,
        },
        {
            "id": str(uuid7()),
            "app_project_id": str(project.id),
            "target_kind": "borehole",
            "target_id": None,  # malformed — no target id at all
            "review_status": "in_progress",
            "review_notes": None,
            "reviewed_at": None,
            "is_hidden": False,
        },
    ]

    await db_session.delete(project)
    await db_session.commit()
    db_session.expunge_all()

    await restore_project_bundle(
        db_session,
        project.id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bundle["investigation_reviews"],
    )
    await db_session.commit()

    # No review rows persisted — the project shell came back, but the
    # orphan + malformed entries were silently dropped.
    rows = list(
        (
            await db_session.execute(
                select(InvestigationReviewOrm).where(
                    InvestigationReviewOrm.app_project_id == project.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == []


async def test_restore_is_idempotent_on_reviews(db_session: AsyncSession) -> None:
    """Restoring the same bundle twice doesn't duplicate review rows."""
    project = await _make_project_with_view_state(db_session)
    db_session.add(
        InvestigationReviewOrm(
            id=uuid7(),
            app_project_id=project.id,
            target_kind="cpt",
            target_id=uuid7(),
            review_status="reviewed",
            is_hidden=False,
        )
    )
    await db_session.commit()

    bundle = await build_project_bundle(db_session, project)

    # Two restore calls back-to-back on the live (un-wiped) DB. Each is
    # a no-op for the existing review (id already in the DB). If the
    # restore weren't id-keyed-idempotent we'd get a UNIQUE violation
    # on the (target_kind, target_id) constraint.
    for _ in range(2):
        await restore_project_bundle(
            db_session,
            project.id,
            bundle["project"],
            bundle["cpts"],
            bundle["boreholes"],
            bundle["geological_formations"],
            bundle["geological_models"],
            bundle["cross_sections"],
            bundle["investigation_reviews"],
        )
        await db_session.commit()

    count = (
        (
            await db_session.execute(
                select(InvestigationReviewOrm).where(
                    InvestigationReviewOrm.app_project_id == project.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(count) == 1
