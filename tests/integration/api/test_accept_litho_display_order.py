"""Integration tests: display_order correctness after accept-litho-suggestions.

Verifies that ``_recompute_litho_display_orders`` assigns stratigraphically
correct ``display_order`` values to litho formations committed by
``AcceptLithoSuggestions.execute``.

Convention (CLAUDE.md "Stratigraphic order"):
    lower display_order = older = deeper
    older paints first so younger renders on top

Test cases
----------
L1  Two litho units at different depths → deeper gets lower display_order.
L2  Re-accept with unchanged suggestions is a display_order no-op.
L3  ``build_section_snapshot`` returns formations in stratigraphic (depth)
    order (lower display_order first), not alphabetical order.
L4  Geological parent formations are NOT mutated by accept.
L5  A NEW shallower contact for an EXISTING formation (no new formation row)
    still recomputes display_order — single-accept path.
L6  Same, via the batch-accept path.
"""

from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for display_order tests."""
    proj = ProjectOrm(id=uuid7(), name="litho display_order test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def stack(db_session: AsyncSession, project: ProjectOrm, async_client: AsyncClient) -> dict:
    """Create the full geo/litho stack + a borehole.

    Returns a dict with keys:
        geo_model, litho_model, geo_formation, borehole
    """
    # Geological model + one formation (display_order=0, i.e. the oldest).
    geo_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Geo", "kind": "geological"},
    )
    assert geo_resp.status_code == 201, geo_resp.text
    geo_model = geo_resp.json()

    geo_f_resp = await async_client.post(
        f"/projects/{project.id}/geology/formations",
        json={"name": "Boom Klei", "color": "#888", "display_order": 0},
    )
    assert geo_f_resp.status_code == 201, geo_f_resp.text
    geo_formation = geo_f_resp.json()

    # Litho model — child of the geological model.
    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model = litho_resp.json()

    # Borehole used as the contact anchor.
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-display-order",
        app_project_id=project.id,
        project_id="TEST",
        test_id="DO-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=30.0,
    )
    db_session.add(bh)
    await db_session.commit()

    return {
        "geo_model": geo_model,
        "litho_model": litho_model,
        "geo_formation": geo_formation,
        "borehole": bh,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _suggestion(top: float, base: float, lithology: str = "ZAND", *, borehole_id: str) -> dict:
    """Build an accept-litho-suggestions request body for one suggestion."""
    return {
        "borehole_id": borehole_id,
        "suggestions": [
            {
                "depth_top_m": top,
                "depth_base_m": base,
                "suggested_lithology": lithology,
                "confidence": "high",
                "source": "borehole_observation",
                "suggested_admixtures": [],
            }
        ],
    }


async def _accept(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    litho_model_id: str,
    *,
    top: float,
    base: float,
    lithology: str,
    borehole_id: str,
) -> dict:
    """POST accept-litho-suggestions for a single layer; assert 200."""
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{litho_model_id}/layers/accept-litho-suggestions",
        json=_suggestion(top, base, lithology, borehole_id=borehole_id),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# L1 — depth ordering: deeper unit gets lower display_order
# ---------------------------------------------------------------------------


async def test_l1_deeper_unit_gets_lower_display_order(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """Two litho units accepted in sequence: the deeper one must have a
    lower ``display_order`` than the shallower one.

    Setup (top → bottom):
        KLEI  0–5 m  (shallower = younger)
        ZAND  5–15 m (deeper = older)

    Expected: ZAND.display_order < KLEI.display_order
    """
    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]

    # Accept shallower unit first, then deeper — order should not matter.
    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=0.0,
        base=5.0,
        lithology="KLEI",
        borehole_id=bh_id,
    )
    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=5.0,
        base=15.0,
        lithology="ZAND",
        borehole_id=bh_id,
    )

    # Read the litho formation rows directly.
    rows = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .where(GeologicalFormationOrm.litho_main_soil_code.isnot(None))
                .order_by(GeologicalFormationOrm.display_order)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2, f"Expected 2 litho formations, got {len(rows)}"

    by_name = {r.name: r for r in rows}
    assert "ZAND" in by_name, f"ZAND not found; rows: {[r.name for r in rows]}"
    assert "KLEI" in by_name, f"KLEI not found; rows: {[r.name for r in rows]}"

    zand = by_name["ZAND"]
    klei = by_name["KLEI"]
    assert zand.display_order < klei.display_order, (
        f"ZAND (depth 5–15 m, older) must have lower display_order than "
        f"KLEI (depth 0–5 m, younger); "
        f"got ZAND={zand.display_order}, KLEI={klei.display_order}"
    )


# ---------------------------------------------------------------------------
# L2 — idempotency: re-accept does not churn display_order
# ---------------------------------------------------------------------------


async def test_l2_reaccept_does_not_change_display_order(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """Re-accepting the same suggestion a second time must not change
    ``display_order`` — both calls must produce the same rank assignment.
    """
    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]

    # First accept.
    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=0.0,
        base=10.0,
        lithology="KLEI",
        borehole_id=bh_id,
    )

    rows_after_first = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm.display_order)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .where(GeologicalFormationOrm.litho_main_soil_code.isnot(None))
            )
        ).all()
    )
    assert len(rows_after_first) == 1
    order_after_first = rows_after_first[0].display_order

    # Second accept — identical suggestion, no new formation created.
    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=0.0,
        base=10.0,
        lithology="KLEI",
        borehole_id=bh_id,
    )

    # Re-query after the second accept.  The test db_session and the API
    # session are separate engines; committed state is visible without any
    # cache-expiry dance — a fresh SELECT is sufficient.
    rows_after_second = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm.display_order)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .where(GeologicalFormationOrm.litho_main_soil_code.isnot(None))
            )
        ).all()
    )
    assert len(rows_after_second) == 1, "Re-accept must not create a duplicate formation"
    order_after_second = rows_after_second[0].display_order

    assert order_after_first == order_after_second, (
        f"display_order changed on re-accept: "
        f"{order_after_first} → {order_after_second} (must be a no-op)"
    )


# ---------------------------------------------------------------------------
# L3 — DB display_order is stratigraphically correct (build_section_snapshot
# sorts by it, so correct DB values ⇒ correct snapshot order by construction)
# ---------------------------------------------------------------------------


async def test_l3_db_display_order_is_stratigraphically_correct(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """After accepting three litho units at different depths, the formations
    table must have ``display_order`` values that — when sorted ascending —
    produce the correct stratigraphic order: deeper = lower display_order.

    ``build_section_snapshot`` sorts by ``(display_order, name)``; the
    section/3D render path reads this order directly.  Testing the DB state
    is the authoritative check: if display_order is correct here, the snapshot
    and 3D viewer are correct by construction.

    Acceptance order is intentionally shuffled (middle depth first) so the
    test would fail if display_order were assigned by creation time.
    """
    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]

    # Accept in shuffled order: middle first, then deepest, then shallowest.
    for top, base, litho in [
        (5.0, 15.0, "ZAND"),  # middle depth
        (15.0, 28.0, "GRIND"),  # deepest = oldest
        (0.0, 5.0, "SILT"),  # shallowest = youngest
    ]:
        await _accept(
            async_client,
            project.id,
            litho_mid,
            top=top,
            base=base,
            lithology=litho,
            borehole_id=bh_id,
        )

    # Read formations sorted by display_order ASC — must match depth order.
    rows = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm.name, GeologicalFormationOrm.display_order)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .where(GeologicalFormationOrm.litho_main_soil_code.isnot(None))
                .order_by(GeologicalFormationOrm.display_order)
            )
        ).all()
    )
    assert len(rows) == 3, f"Expected 3 litho formations, got {len(rows)}: {rows}"

    names_in_order = [r.name for r in rows]
    # Expected stratigraphic order (lower display_order = older = deeper):
    # GRIND (15–28 m, deepest/oldest) → ZAND (5–15 m) → SILT (0–5 m, shallowest/youngest)
    assert names_in_order[0] == "GRIND", (
        f"GRIND (15–28 m, deepest = oldest) must be first in display_order-ascending "
        f"order; got {names_in_order}"
    )
    assert names_in_order[1] == "ZAND", (
        f"ZAND (5–15 m, middle depth) must be second; got {names_in_order}"
    )
    assert names_in_order[2] == "SILT", (
        f"SILT (0–5 m, shallowest = youngest) must be last; got {names_in_order}"
    )


# ---------------------------------------------------------------------------
# L4 — geological parent formations are NOT mutated by accept
# ---------------------------------------------------------------------------


async def test_l4_geological_parent_display_order_unchanged(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """Accepting litho suggestions must not change the ``display_order`` of the
    geological parent formation.  Only litho formations with contacts in the
    litho model are in scope for the recompute.
    """
    geo_fid = stack["geo_formation"]["id"]
    geo_display_order_before = stack["geo_formation"]["display_order"]

    bh_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]

    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=0.0,
        base=20.0,
        lithology="VEEN",
        borehole_id=bh_id,
    )

    # Re-fetch the geological formation via a fresh SELECT so the test session
    # does not return a stale cached row.
    geo_row = (
        await db_session.execute(
            select(GeologicalFormationOrm.display_order).where(GeologicalFormationOrm.id == geo_fid)
        )
    ).one_or_none()
    assert geo_row is not None

    assert geo_row.display_order == geo_display_order_before, (
        f"Geological parent formation display_order changed from "
        f"{geo_display_order_before} to {geo_row.display_order} — "
        "accept-litho-suggestions must only touch litho formations "
        "with contacts in the litho model"
    )


# ---------------------------------------------------------------------------
# L5 — a new shallower contact for an EXISTING formation re-ranks (single accept)
# ---------------------------------------------------------------------------


async def _second_borehole(db_session: AsyncSession, project: ProjectOrm) -> BoreholeOrm:
    """Create + commit a second borehole for the re-rank scenario."""
    bh = BoreholeOrm(
        id=uuid7(),
        name="BH-display-order-2",
        app_project_id=project.id,
        project_id="TEST",
        test_id="DO-002",
        location_x=150100.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=30.0,
    )
    db_session.add(bh)
    await db_session.commit()
    return bh


async def _ranks_by_name(db_session: AsyncSession, project: ProjectOrm) -> dict[str, int]:
    """Return ``{formation_name: display_order}`` for the project's litho formations."""
    rows = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm.name, GeologicalFormationOrm.display_order)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .where(GeologicalFormationOrm.litho_main_soil_code.isnot(None))
            )
        ).all()
    )
    return {r.name: r.display_order for r in rows}


async def test_l5_new_shallower_contact_for_existing_formation_reranks_single(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """A new SHALLOWER contact for an EXISTING formation must recompute ranks,
    even though no new formation row is created.

    Rule (the finding): ``_recompute_litho_display_orders`` ranks each
    formation by its shallowest (min-depth) contact — deeper = lower
    display_order.  A later, shallower contact for a formation that already
    exists lowers that formation's min-depth, which can flip its rank against
    its neighbours.  The accept gate must therefore fire the recompute whenever
    a new CONTACT was created, not only when a new FORMATION row was created.

    Scenario (single-accept path):
        BH1: ZAND 10–20 m  (creates formation ZAND, min-depth 10)
        BH1: KLEI  5–8 m   (creates formation KLEI, min-depth 5)
          → ranks: ZAND deeper → 0, KLEI shallower → 1
        BH2: ZAND  2–4 m   (EXISTING formation ZAND, NO new formation;
                             ZAND min-depth drops 10 → 2, now shallower than KLEI)
          → ranks MUST become: KLEI (min 5, now deeper) → 0, ZAND (min 2) → 1
    """
    bh1_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]
    bh2 = await _second_borehole(db_session, project)
    bh2_id = str(bh2.id)

    # Both create a new formation → recompute fires; baseline ranks correct.
    await _accept(
        async_client,
        project.id,
        litho_mid,
        top=10.0,
        base=20.0,
        lithology="ZAND",
        borehole_id=bh1_id,
    )
    await _accept(
        async_client, project.id, litho_mid, top=5.0, base=8.0, lithology="KLEI", borehole_id=bh1_id
    )
    baseline = await _ranks_by_name(db_session, project)
    assert baseline["ZAND"] < baseline["KLEI"], f"baseline expected ZAND<KLEI, got {baseline}"

    # New SHALLOWER contact for EXISTING formation ZAND — no new formation row.
    await _accept(
        async_client, project.id, litho_mid, top=2.0, base=4.0, lithology="ZAND", borehole_id=bh2_id
    )

    ranks = await _ranks_by_name(db_session, project)
    # ZAND is now the shallowest formation (min-depth 2 < KLEI's 5), so KLEI is
    # the deeper/older unit → KLEI must now rank below ZAND.
    assert ranks["KLEI"] < ranks["ZAND"], (
        f"display_order stale: a shallower contact for existing formation ZAND "
        f"dropped its min-depth to 2 m (< KLEI's 5 m), so KLEI is now the deeper "
        f"unit and must have the lower display_order. Got {ranks}"
    )


# ---------------------------------------------------------------------------
# L6 — same re-rank, via the batch-accept path
# ---------------------------------------------------------------------------


async def test_l6_new_shallower_contact_for_existing_formation_reranks_batch(
    async_client: AsyncClient,
    project: ProjectOrm,
    stack: dict,
    db_session: AsyncSession,
) -> None:
    """Batch-accept path of the L5 re-rank rule.

    The batch loop defers the per-anchor display-order recompute and runs it
    ONCE after the batch, gated on whether any anchor produced new state.  That
    gate must include "a new contact for an existing formation", not only "a new
    formation row" — otherwise a batch that only adds shallower contacts to
    existing formations leaves stale ranks.

    Scenario:
        First batch (creates ZAND + KLEI on BH1) — ranks ZAND<KLEI.
        Second batch (one anchor: ZAND 2–4 m on BH2, EXISTING formation) —
        no new formation row, but ZAND's min-depth drops → KLEI must re-rank
        below ZAND.
    """
    bh1_id = str(stack["borehole"].id)
    litho_mid = stack["litho_model"]["id"]
    bh2 = await _second_borehole(db_session, project)
    bh2_id = str(bh2.id)

    def _anchor(borehole_id: str, lithology: str, top: float, base: float) -> dict:
        return {
            "borehole_id": borehole_id,
            "suggestions": [
                {
                    "depth_top_m": top,
                    "depth_base_m": base,
                    "suggested_lithology": lithology,
                    "confidence": "high",
                    "source": "borehole_observation",
                    "suggested_admixtures": [],
                }
            ],
        }

    # First batch — both anchors create formations → recompute fires.
    resp1 = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_mid}/layers/batch-accept-litho-suggestions",
        json={
            "anchors": [
                _anchor(bh1_id, "ZAND", 10.0, 20.0),
                _anchor(bh1_id, "KLEI", 5.0, 8.0),
            ],
            "section_id": None,
            "run_inference": False,
        },
    )
    assert resp1.status_code == 200, resp1.text
    baseline = await _ranks_by_name(db_session, project)
    assert baseline["ZAND"] < baseline["KLEI"], f"baseline expected ZAND<KLEI, got {baseline}"

    # Second batch — one anchor, a SHALLOWER contact for EXISTING formation ZAND.
    resp2 = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_mid}/layers/batch-accept-litho-suggestions",
        json={
            "anchors": [_anchor(bh2_id, "ZAND", 2.0, 4.0)],
            "section_id": None,
            "run_inference": False,
        },
    )
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["total_created_formations"] == 0, (
        "guard: the second batch must create NO new formation (ZAND already "
        "exists) — that is the exact gap this test pins"
    )

    ranks = await _ranks_by_name(db_session, project)
    assert ranks["KLEI"] < ranks["ZAND"], (
        f"display_order stale after batch: a shallower contact for existing "
        f"formation ZAND dropped its min-depth to 2 m (< KLEI's 5 m); KLEI is "
        f"now deeper and must rank below ZAND. Got {ranks}"
    )
