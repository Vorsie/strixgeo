"""T-A integration: prove RecomputeLithoSolids._handle_flag_all writes is_flagged=True.

The voxel-path ``is_flagged=False`` is structurally zero (hardcoded in
``extract_body_solids`` line 822 — no runtime detector exists).  The flag CAN
fire on the strat-builder path: ``RecomputeLithoSolids._handle_flag_all`` writes
empty placeholder rows with ``is_flagged=True`` when ``NonConformableError`` or
another domain error prevents building real geometry.

Test FA-1 calls ``_handle_flag_all`` directly and verifies:

* every row written to ``litho_body_solid`` for the model has ``is_flagged=True``
* the geometry arrays are empty (no triangles / vertices)
* the method column matches ``RecomputeLithoSolids._solid_method``
* the outcome's ``bodies_flagged`` count equals the body count
* project B's rows are untouched (scope guard sanity)

How to verify this test has teeth: comment out the ``is_flagged=True`` line
(recompute_litho_solids.py:680) → the assertion on line 70 of this file fails.

Run via:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_flagged_bodies.py
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.recompute_litho_solids import RecomputeLithoSolids
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def flagged_scene(db_session: AsyncSession) -> dict:
    """Minimal project + litho model + 2 formations (no picks, no boreholes).

    FA-1 only needs the model_id and the formation rows; there is no real
    geometry to build, so calling _handle_flag_all is the whole test.
    """
    proj = ProjectOrm(id=uuid7(), name="FA test", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo = GeologicalModelOrm(id=uuid7(), app_project_id=proj.id, name="Geo", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    klei = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="KLEI",
        color="#a0785a",
        display_order=1,
        litho_main_soil_code="KLEI",
    )
    db_session.add_all([zand, klei])
    await db_session.flush()

    # Two synthetic body ids (UUID strings, as the resolver would produce).
    body_a = str(uuid7())
    body_b = str(uuid7())

    return {
        "proj": proj,
        "litho": litho,
        "zand": zand,
        "klei": klei,
        "body_a": body_a,
        "body_b": body_b,
        # formation_by_body map — exactly what execute() would pass to _handle_flag_all
        "formation_by_body": {body_a: str(zand.id), body_b: str(klei.id)},
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flag_all_writes_is_flagged_true_rows(
    db_session: AsyncSession,
    flagged_scene: dict,
) -> None:
    """FA-1: _handle_flag_all stores is_flagged=True for every body.

    This proves the flag detector CAN fire — directly exercising the code path
    that ``test_extract_body_solids_flag.py`` (the structural-zero unit tests)
    cannot reach (that unit test covers the voxel mesher; this covers the
    persistence fall-back used when the strat builder encounters a domain error).
    """
    scene = flagged_scene
    model_id: UUID = scene["litho"].id
    formation_by_body: dict[str, str] = scene["formation_by_body"]

    use_case = RecomputeLithoSolids(db_session)
    # Call the private flag-all path directly — simulates a NonConformableError
    # on the execute() flow without needing to seed a cyclic pick graph.
    outcome = await use_case._handle_flag_all(model_id, formation_by_body)

    # --- outcome fields ---
    assert outcome.bodies_flagged == len(formation_by_body), (
        f"bodies_flagged={outcome.bodies_flagged} must equal body count {len(formation_by_body)}"
    )
    assert outcome.bodies_built == 0, "no geometry should be built on the flag-all path"

    # --- DB rows ---
    rows = list(
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == len(formation_by_body), (
        f"expected {len(formation_by_body)} solid rows, got {len(rows)}"
    )
    for row in rows:
        # The central assertion: the detector fires and is persisted.
        assert row.is_flagged is True, (
            f"body {row.body_id}: is_flagged must be True on the flag-all path — "
            "this is the code path the voxel structural-zero unit test cannot cover"
        )
        assert row.vertices == [], f"body {row.body_id}: flagged row must have no geometry"
        assert row.triangles == [], f"body {row.body_id}: flagged row must have no triangles"
        assert row.method == "strat", f"body {row.body_id}: method stamp must be 'strat'"
        assert row.is_stale is False, f"body {row.body_id}: flagged rows start non-stale"


@pytest.mark.asyncio
async def test_flag_all_does_not_touch_other_model_rows(
    db_session: AsyncSession,
    flagged_scene: dict,
) -> None:
    """FA-2: _handle_flag_all is scoped to the target model only.

    A second (empty) litho model in the same project must NOT get any flagged
    rows.  This pins the model-scope guard in _handle_flag_all (the wanted_ids
    prune + orphan-delete only touches model_id = the target).
    """
    scene = flagged_scene
    proj = scene["proj"]
    zand = scene["zand"]

    # A sibling model that we never flag.
    sibling_geo = GeologicalModelOrm(
        id=uuid7(), app_project_id=proj.id, name="SibGeo", kind="geological"
    )
    sibling_litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="SibLitho",
        kind="lithostratigraphic",
        parent_geological_model_id=sibling_geo.id,
    )
    db_session.add_all([sibling_geo, sibling_litho])
    await db_session.flush()

    use_case = RecomputeLithoSolids(db_session)
    await use_case._handle_flag_all(
        scene["litho"].id,
        scene["formation_by_body"],
    )

    # Sibling model must have zero solid rows.
    sibling_rows = list(
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == sibling_litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert sibling_rows == [], (
        "_handle_flag_all wrote rows for the wrong model — scope guard broken"
    )
