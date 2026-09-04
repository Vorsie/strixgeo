"""HTTP-level tests for the geology router (debt #22).

Focus: the new application-layer wiring + the scope guards on
contact endpoints. CRUD semantics are already pinned by the
repository tests in ``tests/integration/db/test_geology_repository.py``;
these tests only assert what the API layer adds — status codes,
JSON shape, cross-project tampering rejection, and the use-case
side effects observable through the response.
"""

from __future__ import annotations

from datetime import UTC
from uuid import UUID

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project_with_borehole(
    db_session: AsyncSession,
) -> tuple[ProjectOrm, BoreholeOrm]:
    """Set up a project + one 10 m borehole for contact-anchoring tests."""
    project = ProjectOrm(id=uuid7(), name="API geology test", status="active")
    db_session.add(project)
    await db_session.flush()
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(borehole)
    await db_session.commit()
    return project, borehole


# ---------------------------------------------------------------------------
# Contact create — CreateFormationContact use case
# ---------------------------------------------------------------------------


async def test_create_contact_returns_201_and_persisted_row(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """POST through the use case returns 201 + the full response shape."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
        json={
            "formation_id": formation["id"],
            "borehole_id": str(borehole.id),
            "depth_top_m": 0.0,
            "source": "manual_pick",
            "confidence": "high",
        },
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["formation_id"] == formation["id"]
    assert body["borehole_id"] == str(borehole.id)
    assert body["cpt_id"] is None
    assert body["depth_top_m"] == 0.0
    assert body["confidence"] == "high"
    # Server-generated fields populated.
    assert body["id"]
    assert body["created_at"]
    assert body["updated_at"]


async def test_create_contact_rejects_both_anchors(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Pydantic XOR rejection lands at the 422 boundary, never reaches the use case."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
        json={
            "formation_id": formation["id"],
            "borehole_id": str(borehole.id),
            "cpt_id": str(uuid7()),
            "depth_top_m": 1.0,
        },
    )

    # Pydantic's ``model_validator`` raises before the route body runs.
    assert resp.status_code == 422


async def test_create_contact_rejects_wrong_project_model(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Posting a contact under a model from another project returns 404."""
    project_a, borehole = project_with_borehole
    formation = await _create_formation(async_client, project_a.id)

    # Build a second project and a model that lives under it.
    project_b = ProjectOrm(id=uuid7(), name="Other project", status="active")
    db_session.add(project_b)
    await db_session.commit()
    model_b = await _create_model(async_client, project_b.id)

    # URL says project_a, but model belongs to project_b — scope guard kicks in.
    resp = await async_client.post(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/contacts",
        json={
            "formation_id": formation["id"],
            "borehole_id": str(borehole.id),
            "depth_top_m": 0.0,
        },
    )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Contact update — UpdateFormationContact use case
# ---------------------------------------------------------------------------


async def test_update_contact_applies_patch(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """PATCH updates only the supplied fields; others stay as the create set them."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={"depth_top_m": 3.0, "notes": "Re-picked"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["depth_top_m"] == 3.0
    assert body["notes"] == "Re-picked"
    # Confidence unchanged from create-time default.
    assert body["confidence"] == "medium"


async def test_update_contact_re_anchors_borehole_to_cpt(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Anchor PATCH carries both fields (one null) — drag-re-anchor flow."""
    project, borehole = project_with_borehole
    cpt = CptOrm(
        id=uuid7(),
        name="CPT-1",
        cpt_type="CPTU",
        app_project_id=project.id,
        location_x=150100.0,
        location_y=200100.0,
        epsg=31370,
        max_depth_m=12.0,
    )
    db_session.add(cpt)
    await db_session.commit()
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={
            "depth_top_m": 4.5,
            "borehole_id": None,
            "cpt_id": str(cpt.id),
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["borehole_id"] is None
    assert body["cpt_id"] == str(cpt.id)
    assert body["depth_top_m"] == 4.5


async def test_update_contact_rejects_partial_anchor_update(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Sending only one of the anchor fields is a 422 (XOR safety)."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={"cpt_id": str(uuid7())},
    )
    assert resp.status_code == 422


async def test_update_contact_rejects_both_anchors_set(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Both anchor fields non-null violates the XOR — 422 at the schema."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={
            "borehole_id": str(borehole.id),
            "cpt_id": str(uuid7()),
        },
    )
    assert resp.status_code == 422


async def test_update_contact_rejects_both_anchors_null(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Both anchor fields null violates the XOR — 422 at the schema."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={"borehole_id": None, "cpt_id": None},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Batch update — UpdateFormationContactsBatch use case (multi-drag flow)
# ---------------------------------------------------------------------------


async def test_batch_update_applies_all_in_one_commit(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Happy path — PUT /batch updates N contacts in one call."""
    project, borehole = project_with_borehole
    # Two distinct formations — one contact per (borehole, formation)
    # is the geological invariant the API now enforces (409 on
    # duplicates), so a multi-contact batch needs distinct formations.
    formation_a = await _create_formation(async_client, project.id, name="A")
    formation_b = await _create_formation(async_client, project.id, name="B")
    model = await _create_model(async_client, project.id)
    c1 = await _create_contact(
        async_client, project.id, model["id"], formation_a["id"], borehole.id, depth=2.0
    )
    c2 = await _create_contact(
        async_client, project.id, model["id"], formation_b["id"], borehole.id, depth=5.0
    )

    resp = await async_client.put(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/batch",
        json={
            "updates": [
                {"contact_id": c1["id"], "depth_top_m": 2.5},
                {"contact_id": c2["id"], "depth_top_m": 5.5},
            ]
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["contacts"]) == 2
    # Return order matches input order so the client can patch by index.
    assert body["contacts"][0]["id"] == c1["id"]
    assert body["contacts"][0]["depth_top_m"] == 2.5
    assert body["contacts"][1]["id"] == c2["id"]
    assert body["contacts"][1]["depth_top_m"] == 5.5


async def test_batch_update_rolls_back_when_one_contact_out_of_scope(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """One id from another model → 404, the in-scope one stays unchanged."""
    project_a, borehole = project_with_borehole
    formation = await _create_formation(async_client, project_a.id)
    model_a = await _create_model(async_client, project_a.id)
    legit = await _create_contact(
        async_client,
        project_a.id,
        model_a["id"],
        formation["id"],
        borehole.id,
        depth=2.0,
    )

    # Build a contact under a separate project + model — out of scope
    # for the URL we're about to PUT against.
    project_b = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(project_b)
    await db_session.commit()
    formation_b = await _create_formation(async_client, project_b.id)
    model_b = await _create_model(async_client, project_b.id)
    borehole_b = BoreholeOrm(
        id=uuid7(),
        name="BH-B",
        app_project_id=project_b.id,
        project_id="DOV",
        test_id="BH-B-001",
        location_x=160000.0,
        location_y=210000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(borehole_b)
    await db_session.commit()
    foreign = await _create_contact(
        async_client,
        project_b.id,
        model_b["id"],
        formation_b["id"],
        borehole_b.id,
        depth=4.0,
    )

    # URL targets model_a; the second entry's contact lives under model_b.
    resp = await async_client.put(
        f"/projects/{project_a.id}/geology/models/{model_a['id']}/contacts/batch",
        json={
            "updates": [
                {"contact_id": legit["id"], "depth_top_m": 99.0},
                {"contact_id": foreign["id"], "depth_top_m": 99.0},
            ]
        },
    )

    assert resp.status_code == 404
    # The legit row's depth is unchanged — the batch never committed.
    check = await async_client.get(
        f"/projects/{project_a.id}/geology/models/{model_a['id']}/contacts",
    )
    rows = check.json()
    assert len(rows) == 1
    assert rows[0]["depth_top_m"] == 2.0


async def test_batch_update_rejects_empty_payload(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """min_length=1 — no-op batch calls are 422 at the schema layer."""
    project, _ = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.put(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/batch",
        json={"updates": []},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Auto-populate from stratigraphy — AutoPopulateContactsFromStratigraphy
# ---------------------------------------------------------------------------


async def test_auto_populate_creates_contacts_from_formal_stratigraphy(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Happy path: formal-only borehole → one contact PER layer, including
    the topmost (top_m == 0). Formation gets the formal description in
    BOTH name + regional_ref since there's no informal counterpart.
    """
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    # FORMAL_STRATIGRAPHY observation with two layers — the topmost
    # at top_m == 0 (surface) MUST be included now; it represents
    # the top of the topmost formation.
    observation = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    db_session.add(observation)
    await db_session.flush()
    layer_surface = ObservationLayerOrm(
        id=uuid7(),
        observation_id=observation.id,
        top_m=0.0,
        base_m=3.0,
        description="Quartair",
        layer_index=0,
    )
    layer_deep = ObservationLayerOrm(
        id=uuid7(),
        observation_id=observation.id,
        top_m=3.0,
        base_m=10.0,
        description="Boom Formation",
        layer_index=1,
    )
    db_session.add_all([layer_surface, layer_deep])
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # BOTH layers now seed a contact (top_m == 0 included). Two
    # formations auto-created — one per layer description.
    assert len(body["created_contact_ids"]) == 2
    assert len(body["created_formation_ids"]) == 2
    assert body["skipped_no_stratigraphy"] == 0


async def test_auto_populate_assigns_display_order_by_depth_descending(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """The deepest formation (oldest) gets the LOWEST display_order.

    Borehole has three layers: 'Antropogeen' at 0–1 m (youngest),
    'Quartair' at 1–5 m, 'Ieper' at 5–15 m (oldest). Auto-populate
    walks top-down so without the depth-sort fix the first-encountered
    'Antropogeen' would end up with display_order=0 — inverted from
    the "Modelling hierarchy" convention. Pin: deepest mean top wins.
    """
    from sqlalchemy import select

    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    obs = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    db_session.add(obs)
    await db_session.flush()
    layers = [
        ObservationLayerOrm(
            id=uuid7(),
            observation_id=obs.id,
            top_m=0.0,
            base_m=1.0,
            description="Antropogeen",
            layer_index=0,
        ),
        ObservationLayerOrm(
            id=uuid7(),
            observation_id=obs.id,
            top_m=1.0,
            base_m=5.0,
            description="Quartair",
            layer_index=1,
        ),
        ObservationLayerOrm(
            id=uuid7(),
            observation_id=obs.id,
            top_m=5.0,
            base_m=15.0,
            description="Ieper",
            layer_index=2,
        ),
    ]
    db_session.add_all(layers)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    assert resp.status_code == 200, resp.text

    rows = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .order_by(GeologicalFormationOrm.display_order)
            )
        )
        .scalars()
        .all()
    )
    names_in_order = [f.name for f in rows]
    # Deepest top first (Ieper at top=5m), then Quartair (top=1m),
    # then Antropogeen (top=0m). Lower display_order = older.
    assert names_in_order == ["Ieper", "Quartair", "Antropogeen"]


async def test_auto_populate_display_order_uses_g3dv3_age_when_all_known(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """When every newly-created formation resolves in the G3Dv3
    catalog, display_order follows authoritative age — not depth.

    Setup: a borehole where the depth order DISAGREES with the
    G3Dv3 age order. Layer at 0–1 m is "Boom" (Oligocene, age_rank
    43 — old) and layer at 5–15 m is "Antropogeen" (Holocene,
    age_rank 0 — young). On a real site this would be a faulted /
    inverted sequence; here we engineer it on purpose to prove
    that G3Dv3 age wins over depth when all names resolve.

    With today's depth-only heuristic the deepest layer would be
    sorted as "oldest" — but that's wrong: Antropogeen is by
    definition younger than Boom regardless of where it sits in
    this hole. The G3Dv3 path catches that and orders by age.
    """
    from sqlalchemy import select

    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    obs = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    db_session.add(obs)
    await db_session.flush()
    db_session.add_all(
        [
            # Deliberate inversion: Boom (older) sits ABOVE Antropogeen
            # (younger) in this hole. Depth heuristic alone would call
            # Antropogeen oldest. G3Dv3 must override.
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=obs.id,
                top_m=0.0,
                base_m=1.0,
                description="Boom",
                layer_index=0,
            ),
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=obs.id,
                top_m=1.0,
                base_m=5.0,
                description="Diest",
                layer_index=1,
            ),
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=obs.id,
                top_m=5.0,
                base_m=15.0,
                description="Antropogeen",
                layer_index=2,
            ),
        ]
    )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    assert resp.status_code == 200, resp.text

    rows = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .order_by(GeologicalFormationOrm.display_order)
            )
        )
        .scalars()
        .all()
    )
    names_in_order = [f.name for f in rows]
    # G3Dv3 age order (oldest first → lowest display_order):
    # Boom (age_rank 43) > Diest (age_rank 30) > Antropogeen (age_rank 0).
    # Depth order would have put Antropogeen first; G3Dv3 wins.
    assert names_in_order == ["Boom", "Diest", "Antropogeen"]


async def test_auto_populate_falls_back_to_depth_when_any_formation_is_g3dv3_unknown(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Mixing G3Dv3-known and unknown formations falls back to
    depth-derived ordering for the whole batch.

    The G3Dv3 age axis and the depth axis live in different
    coordinate systems, so mixing them produces inconsistent
    results when they disagree. All-or-nothing keeps the batch
    consistent: if any formation isn't in the catalog, we use
    depth for everyone — same as today's behaviour for
    non-Belgian or informal projects.
    """
    from sqlalchemy import select

    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    obs = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    db_session.add(obs)
    await db_session.flush()
    db_session.add_all(
        [
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=obs.id,
                top_m=0.0,
                base_m=1.0,
                description="Antropogeen",
                layer_index=0,
            ),
            # "MyCustomFill" is not a G3Dv3 unit — this triggers the
            # fallback for the whole batch.
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=obs.id,
                top_m=1.0,
                base_m=5.0,
                description="MyCustomFill",
                layer_index=1,
            ),
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=obs.id,
                top_m=5.0,
                base_m=15.0,
                description="Boom",
                layer_index=2,
            ),
        ]
    )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    assert resp.status_code == 200, resp.text

    rows = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .order_by(GeologicalFormationOrm.display_order)
            )
        )
        .scalars()
        .all()
    )
    names_in_order = [f.name for f in rows]
    # Depth-derived: deepest first → Boom, MyCustomFill, Antropogeen.
    assert names_in_order == ["Boom", "MyCustomFill", "Antropogeen"]


async def test_auto_populate_display_order_aggregates_across_boreholes(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Real-project shape: many formations, multiple boreholes, mean
    top-depth aggregated across all observations of each formation.

    Mirrors the testeroni dogfooding case (2026-05-14) — DOV imports
    typically yield 5-9 formations per project, observed across 10+
    boreholes with depth variations. The mean-aggregation must put
    Antropogeen at the YOUNGEST end (highest display_order) regardless
    of how many boreholes encountered it first.

    Setup: 2 boreholes, 5 formations spanning Antropogeen → Ieper.
    BH-1 has slightly shallower depths than BH-2 — simulates real
    site variability.
    """
    from sqlalchemy import select

    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, bh1 = project_with_borehole
    bh2 = BoreholeOrm(
        id=uuid7(),
        name="BH-2",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-002",
        location_x=150100.0,
        location_y=200100.0,
        epsg=31370,
        total_depth_m=20.0,
    )
    db_session.add(bh2)
    await db_session.commit()
    model = await _create_model(async_client, project.id)

    # Stratigraphy used in both boreholes — top depths differ slightly
    # to exercise the mean aggregation. Order in source matches a real
    # top-down DOV stratigraphy walk (youngest first).
    stratigraphy_bh1 = [
        ("Antropogeen", 0.0, 0.8),
        ("Quartair", 0.8, 4.5),
        ("Pleistoceen", 4.5, 8.0),
        ("Paleogeen: Kortrijk", 8.0, 14.0),
        ("Ieper", 14.0, 20.0),
    ]
    stratigraphy_bh2 = [
        ("Antropogeen", 0.0, 1.2),
        ("Quartair", 1.2, 5.8),
        ("Pleistoceen", 5.8, 9.5),
        ("Paleogeen: Kortrijk", 9.5, 16.0),
        ("Ieper", 16.0, 20.0),
    ]

    for borehole, layers in ((bh1, stratigraphy_bh1), (bh2, stratigraphy_bh2)):
        obs = ObservationOrm(
            id=uuid7(),
            borehole_id=borehole.id,
            observation_type="formal_stratigraphy",
        )
        db_session.add(obs)
        await db_session.flush()
        db_session.add_all(
            [
                ObservationLayerOrm(
                    id=uuid7(),
                    observation_id=obs.id,
                    top_m=top,
                    base_m=base,
                    description=name,
                    layer_index=idx,
                )
                for idx, (name, top, base) in enumerate(layers)
            ]
        )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(bh1.id), str(bh2.id)]},
    )
    assert resp.status_code == 200, resp.text

    rows = list(
        (
            await db_session.execute(
                select(GeologicalFormationOrm)
                .where(GeologicalFormationOrm.app_project_id == project.id)
                .order_by(GeologicalFormationOrm.display_order)
            )
        )
        .scalars()
        .all()
    )
    names_in_order = [f.name for f in rows]
    # Deepest mean top → oldest → lowest display_order:
    # - Ieper:    mean top = (14.0 + 16.0)/2 = 15.0
    # - Kortrijk: mean top = (8.0 + 9.5)/2 = 8.75
    # - Pleistoceen: mean top = (4.5 + 5.8)/2 = 5.15
    # - Quartair: mean top = (0.8 + 1.2)/2 = 1.0
    # - Antropogeen: mean top = (0.0 + 0.0)/2 = 0.0
    # Antropogeen ends up YOUNGEST (highest display_order) — the
    # whole point of the depth-sort fix. The dogfooding bug had the
    # ordering inverted.
    assert names_in_order == [
        "Ieper",
        "Paleogeen: Kortrijk",
        "Pleistoceen",
        "Quartair",
        "Antropogeen",
    ]
    # Display orders are contiguous 0..4 (compact assignment).
    assert [f.display_order for f in rows] == [0, 1, 2, 3, 4]


async def test_auto_populate_pairs_formal_with_informal_split_into_name_regional_ref(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Borehole with BOTH streams: formal description goes into
    regional_ref, informal description goes into name. Pairing is
    by max-overlap of the depth intervals.
    """
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    formal_obs = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    informal_obs = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="informal_stratigraphy",
    )
    db_session.add_all([formal_obs, informal_obs])
    await db_session.flush()
    formal_layer = ObservationLayerOrm(
        id=uuid7(),
        observation_id=formal_obs.id,
        top_m=2.0,
        base_m=8.0,
        description="HyEg - Lid van Egem",
        layer_index=0,
    )
    informal_layer = ObservationLayerOrm(
        id=uuid7(),
        observation_id=informal_obs.id,
        top_m=2.5,  # boundary differs slightly — the helper still pairs them by overlap
        base_m=7.5,
        description="Boom Klei",
        layer_index=0,
    )
    db_session.add_all([formal_layer, informal_layer])
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    body = resp.json()
    assert len(body["created_contact_ids"]) == 1
    assert len(body["created_formation_ids"]) == 1

    # Re-fetch the formation row to inspect the split fields.
    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/formations",
    )
    formations = list_resp.json()
    assert len(formations) == 1
    f = formations[0]
    assert f["name"] == "Boom Klei"  # informal → name
    assert f["regional_ref"] == "HyEg - Lid van Egem"  # formal → regional_ref


async def test_auto_populate_reuses_formation_across_boreholes_by_regional_ref(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Two boreholes with the same formal stratigraphy code must
    resolve to the SAME formation — regional_ref is the
    cross-borehole stable key.
    """
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole_a = project_with_borehole
    # Build a second borehole on the same project.
    borehole_b = BoreholeOrm(
        id=uuid7(),
        name="BH-2",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-002",
        location_x=150100.0,
        location_y=200100.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(borehole_b)
    await db_session.flush()
    for bh in (borehole_a, borehole_b):
        obs = ObservationOrm(id=uuid7(), borehole_id=bh.id, observation_type="formal_stratigraphy")
        db_session.add(obs)
        await db_session.flush()
        db_session.add(
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=obs.id,
                top_m=0.0,
                base_m=5.0,
                description="HyEg - Lid van Egem",
                layer_index=0,
            )
        )
    await db_session.commit()

    model = await _create_model(async_client, project.id)
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole_a.id), str(borehole_b.id)]},
    )
    body = resp.json()
    # Two contacts (one per borehole), but ONE formation — both
    # boreholes pointed at the same regional reference.
    assert len(body["created_contact_ids"]) == 2
    assert len(body["created_formation_ids"]) == 1


async def test_auto_populate_is_idempotent_on_second_call(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Re-running with the same scope = 0 new rows (layer-id dedup)."""
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    observation = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    db_session.add(observation)
    await db_session.flush()
    layer = ObservationLayerOrm(
        id=uuid7(),
        observation_id=observation.id,
        top_m=4.0,
        base_m=8.0,
        description="Diest Formation",
        layer_index=0,
    )
    db_session.add(layer)
    await db_session.commit()

    first = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    assert first.json()["created_contact_ids"]

    second = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    body = second.json()
    assert body["created_contact_ids"] == []
    assert body["created_formation_ids"] == []
    assert body["skipped_existing"] == 1


async def test_auto_populate_falls_through_to_informal_when_no_formal(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Borehole with only INFORMAL_STRATIGRAPHY still gets seeded."""
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)
    observation = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="informal_stratigraphy",
    )
    db_session.add(observation)
    await db_session.flush()
    layer = ObservationLayerOrm(
        id=uuid7(),
        observation_id=observation.id,
        top_m=2.5,
        base_m=6.0,
        description="Klei zandig",
        layer_index=0,
    )
    db_session.add(layer)
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    body = resp.json()
    assert len(body["created_contact_ids"]) == 1
    assert body["skipped_no_stratigraphy"] == 0


async def test_auto_populate_skips_borehole_without_stratigraphy(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """No formal OR informal observation → reports in skipped_no_stratigraphy."""
    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    body = resp.json()
    assert body["created_contact_ids"] == []
    assert body["skipped_no_stratigraphy"] == 1


async def test_auto_populate_rejects_empty_borehole_ids(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """min_length=1 — empty list is a 422 at the schema."""
    project, _ = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": []},
    )
    assert resp.status_code == 422


async def test_auto_populate_respects_existing_user_pick(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """USER OVERRIDES ARE ABSOLUTE — auto-populate must not overwrite
    or duplicate an existing contact for the same (borehole, formation)
    pair, regardless of where the existing contact came from.
    """
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import (
        ObservationOrm,
    )

    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)
    # Manually pre-create a formation + contact mimicking a user's
    # hand-pick — at depth 4.0m, source 'manual_pick'.
    formation = await _create_formation(async_client, project.id, name="Boom Klei")
    manual_contact = await _create_contact(
        async_client,
        project.id,
        model["id"],
        formation["id"],
        borehole.id,
        depth=4.0,
    )

    # Now attach a formal stratigraphy observation that, if auto-
    # populated naively, WOULD create a second contact for the same
    # (borehole, formation) at a different depth.
    observation = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    db_session.add(observation)
    await db_session.flush()
    db_session.add(
        ObservationLayerOrm(
            id=uuid7(),
            observation_id=observation.id,
            top_m=2.5,  # different depth from the manual pick
            base_m=8.0,
            description="Boom Klei",
            layer_index=0,
        )
    )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    body = resp.json()
    # Auto-populate honoured the existing user pick — no new contact
    # for the (borehole, Boom Klei) pair was created.
    assert body["created_contact_ids"] == []
    assert body["skipped_existing"] == 1

    # The manual pick is still where the user put it.
    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    rows = list_resp.json()
    assert len(rows) == 1
    assert rows[0]["id"] == manual_contact["id"]
    assert rows[0]["depth_top_m"] == 4.0


# ---------------------------------------------------------------------------
# Auto-populate add / overwrite mode (2026-08-03 data-loss ruling)
#
# The owner opened "Fill from boreholes" to add ONE unit and lost four saved
# geological units: sending ``selected_keys`` was, by itself, consent to
# delete everything else.  The ruling — Apply asks "add to existing model or
# overwrite model" — needs a server that can actually decline the delete.
# ---------------------------------------------------------------------------


async def _seed_two_formal_layers(
    db_session: AsyncSession,
    borehole: BoreholeOrm,
) -> None:
    """Give *borehole* a two-layer formal stratigraphy stream.

    Layers: ``Quartair`` 0–3 m and ``Boom Formation`` 3–10 m — the same shape
    the happy-path auto-populate test uses, so one Fill run mints exactly two
    formations.

    Parameters
    ----------
    db_session : AsyncSession
        Session used to insert the observation + its layers (committed).
    borehole : BoreholeOrm
        Borehole that receives the observation.
    """
    from groundmodel.infrastructure.db.models.observation_layer_orm import (
        ObservationLayerOrm,
    )
    from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm

    observation = ObservationOrm(
        id=uuid7(),
        borehole_id=borehole.id,
        observation_type="formal_stratigraphy",
    )
    db_session.add(observation)
    await db_session.flush()
    db_session.add_all(
        [
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=observation.id,
                top_m=0.0,
                base_m=3.0,
                description="Quartair",
                layer_index=0,
            ),
            ObservationLayerOrm(
                id=uuid7(),
                observation_id=observation.id,
                top_m=3.0,
                base_m=10.0,
                description="Boom Formation",
                layer_index=1,
            ),
        ]
    )
    await db_session.commit()


async def test_auto_populate_add_mode_keeps_the_units_the_user_did_not_select(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Add mode: the units left out of the selection are still in the model.

    This is the incident, reduced: a Fill run whose selection names one unit
    must not remove the other one.
    """
    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)
    await _seed_two_formal_layers(db_session, borehole)

    first = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )
    assert first.status_code == 200, first.text
    assert len(first.json()["created_formation_ids"]) == 2

    # Second run names ONLY Quartair, and asks to add.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={
            "borehole_ids": [str(borehole.id)],
            "selected_keys": ["quartair"],
            "mode": "add",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "add"
    assert body["deleted_formation_ids"] == []
    assert body["deleted_formation_names"] == []

    names = {
        f["name"]
        for f in (await async_client.get(f"/projects/{project.id}/geology/formations")).json()
    }
    assert names == {"Quartair", "Boom Formation"}


async def test_auto_populate_without_a_mode_field_deletes_nothing(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """A request that never mentions the mode behaves as "add".

    Guards the reason the default is what it is: a client build that pre-dates
    the field must not be able to mass-delete a model by omission.
    """
    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)
    await _seed_two_formal_layers(db_session, borehole)

    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        # selected_keys but NO mode — the exact shape the old client sent.
        json={"borehole_ids": [str(borehole.id)], "selected_keys": ["quartair"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted_formation_ids"] == []

    names = {
        f["name"]
        for f in (await async_client.get(f"/projects/{project.id}/geology/formations")).json()
    }
    assert names == {"Quartair", "Boom Formation"}


async def test_auto_populate_overwrite_mode_removes_and_names_the_unselected_units(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Overwrite mode still makes the model exactly the selection.

    And it reports the removed units by NAME, because that is what the
    confirmation the user just accepted promised to show them.
    """
    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)
    await _seed_two_formal_layers(db_session, borehole)

    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={"borehole_ids": [str(borehole.id)]},
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/auto-populate",
        json={
            "borehole_ids": [str(borehole.id)],
            "selected_keys": ["quartair"],
            "mode": "overwrite",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "overwrite"
    assert body["deleted_formation_names"] == ["Boom Formation"]
    assert len(body["deleted_formation_ids"]) == 1

    names = {
        f["name"]
        for f in (await async_client.get(f"/projects/{project.id}/geology/formations")).json()
    }
    assert names == {"Quartair"}


# ---------------------------------------------------------------------------
# Per-(model, anchor, formation) uniqueness — the duplicate-contact rule
# ---------------------------------------------------------------------------


async def test_create_contact_rejects_duplicate_anchor_formation(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """A second contact for the same (model, anchor, formation) → 409
    with the existing contact id in the response body so the frontend
    can route to a 'move existing' flow.
    """
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    first = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=3.0
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
        json={
            "formation_id": formation["id"],
            "borehole_id": str(borehole.id),
            "depth_top_m": 5.0,
        },
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "duplicate_contact"
    assert detail["existing_contact_id"] == first["id"]


async def test_dedupe_removes_legacy_duplicates_keeps_one_survivor(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Three pre-existing duplicates for the same (anchor, formation) →
    dedupe keeps one, deletes the other two. Survivor = manual_pick
    when present (beats borehole_observation), else most recent.
    """
    # `timezone` is deliberately not imported — the body uses the module-level
    # `UTC` alias for tz-aware timestamps.
    from datetime import datetime, timedelta

    from sqlalchemy import text as _sql

    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm as FCO,
    )

    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    # Insert 3 duplicates directly. The dedupe endpoint exists to
    # clean up legacy pre-migration data — fresh DBs running migration
    # c9f4e72a3811 (later widened by c3d7e982f146 to include depth)
    # cannot create this shape anymore (partial unique index rejects
    # it). Temporarily drop the index(es) to stage the legacy-shape
    # fixture, then restore them so the assertion runs against the
    # same constraint set production code sees. Drop both the old and
    # the new (depth-widened) index names because the DB may have
    # either depending on its migration history.
    await db_session.execute(
        _sql("DROP INDEX IF EXISTS uq_formation_contact_model_formation_borehole")
    )
    await db_session.execute(
        _sql("DROP INDEX IF EXISTS uq_formation_contact_model_formation_borehole_depth")
    )
    now = datetime.now(UTC)
    auto_old = FCO(
        id=uuid7(),
        model_id=UUID(model["id"]),
        formation_id=UUID(formation["id"]),
        borehole_id=borehole.id,
        depth_top_m=2.0,
        source="borehole_observation",
        confidence="high",
        observation_layer_id=None,
        created_at=now - timedelta(hours=2),
    )
    auto_recent = FCO(
        id=uuid7(),
        model_id=UUID(model["id"]),
        formation_id=UUID(formation["id"]),
        borehole_id=borehole.id,
        depth_top_m=2.0,
        source="borehole_observation",
        confidence="high",
        observation_layer_id=None,
        created_at=now,
    )
    manual = FCO(
        id=uuid7(),
        model_id=UUID(model["id"]),
        formation_id=UUID(formation["id"]),
        borehole_id=borehole.id,
        depth_top_m=2.5,
        source="manual_pick",
        confidence="medium",
        created_at=now - timedelta(hours=1),
    )
    db_session.add_all([auto_old, auto_recent, manual])
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/dedupe",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["inspected_groups"] == 1
    assert body["duplicates_removed"] == 2
    # Restore the unique index for the rest of the session. Dedupe
    # has left one survivor per (model, formation, anchor, depth_top_m),
    # so the CREATE INDEX no longer collides. Uses the depth-widened
    # index shape (migration c3d7e982f146) so the post-test state
    # matches production.
    await db_session.execute(
        _sql(
            "CREATE UNIQUE INDEX uq_formation_contact_model_formation_borehole_depth "
            "ON formation_contact (model_id, formation_id, borehole_id, depth_top_m) "
            "WHERE borehole_id IS NOT NULL"
        )
    )

    # Survivor must be the manual_pick (priority 1 wins over the two
    # borehole_observation rows regardless of timestamp).
    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    rows = list_resp.json()
    assert len(rows) == 1
    assert rows[0]["id"] == str(manual.id)
    assert rows[0]["source"] == "manual_pick"


async def test_create_contact_does_not_auto_build_surface(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """On-click build pivot: per-contact mutations no longer recompute.

    Creating a contact flips ``is_stale=True`` on any existing surface
    row but does NOT create a new surface row. ``GET /surfaces`` still
    returns the empty list because no Build has run.
    """
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)

    # Empty model — no surfaces yet.
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
    )
    assert resp.status_code == 200
    assert resp.json() == []

    # Create one contact → no auto-build → still no surface rows.
    await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_build_after_contact_create_materialises_surface(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Click Build → ``GET /surfaces`` returns the cached TIN row.

    With <3 contacts the TIN has no triangles (geological minimum
    not met), but the row exists with is_stale=False so the section
    consumer knows the cache is fresh.
    """
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )
    # Build.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    surface = rows[0]
    assert surface["formation_id"] == formation["id"]
    assert surface["model_id"] == model["id"]
    assert surface["method"] == "tin"
    assert surface["triangles"] == []
    # Fixture borehole has no elevation_m → TIN drops the contact.
    # The row exists; that's what proves Build wrote the cache.
    assert surface["vertices"] == []
    assert surface["source_contact_count"] == 0
    assert surface["is_stale"] is False


async def test_contact_mutation_flips_existing_surface_to_stale(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """After a Build, the next contact mutation marks the surface stale.

    Build creates the surface row with is_stale=False. A subsequent
    contact PATCH on the same formation MUST flip is_stale=True (no
    recompute). ``GET /surfaces`` reflects the flag so the frontend
    can demote-render the slice.
    """
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )
    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    # Sanity: just-built surface is fresh.
    rows = (
        await async_client.get(
            f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
        )
    ).json()
    assert rows[0]["is_stale"] is False

    # PATCH the contact's depth → mutation handler flips stale.
    resp = await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={"depth_top_m": 3.5},
    )
    assert resp.status_code == 200, resp.text

    rows = (
        await async_client.get(
            f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
        )
    ).json()
    assert len(rows) == 1
    assert rows[0]["is_stale"] is True


async def test_rebuild_clears_is_stale_flag(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Click Build → previously-stale surface flips back to is_stale=False."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )
    # First build → fresh surface row.
    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    # Mutate via PATCH (CREATE would 409 on duplicate).
    await async_client.patch(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
        json={"depth_top_m": 3.5},
    )
    # Pre-rebuild assertion: stale.
    rows = (
        await async_client.get(
            f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
        )
    ).json()
    assert rows[0]["is_stale"] is True

    # Build clears it.
    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    rows = (
        await async_client.get(
            f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
        )
    ).json()
    assert rows[0]["is_stale"] is False


async def test_rebuild_clears_is_stale_on_orphan_surface_with_no_contacts(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Deleting the last contact leaves an orphan stale surface that
    Build must still clear — otherwise the 'N unbuilt edits' badge
    sticks forever.

    Flow:
    1. Create one contact → Build → surface row, is_stale=False.
    2. Delete the contact (mark_surfaces_stale flips is_stale=True
       but the contact-only formation_ids query in the next Build
       would skip this formation since it has 0 contacts left).
    3. Click Build again → the orphan-stale path picks the formation
       up, recompute produces an empty TIN, is_stale flips back to
       False.
    """
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )
    # First build materialises the surface.
    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    # Delete the only contact — surface goes stale, contact count = 0.
    del_resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
    )
    assert del_resp.status_code in (200, 204)
    rows = (
        await async_client.get(
            f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
        )
    ).json()
    assert len(rows) == 1
    assert rows[0]["is_stale"] is True

    # Build the orphan stale formation → is_stale clears even though
    # the formation has zero contacts now.
    rebuild = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert rebuild.status_code == 200
    rows = (
        await async_client.get(
            f"/projects/{project.id}/geology/models/{model['id']}/surfaces",
        )
    ).json()
    assert rows[0]["is_stale"] is False


async def test_rebuild_method_param_rejects_unknown_method(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """``?method=kriging`` returns 422 today — only TIN is wired in v1.

    Pins the contract: the param exists for forward-compat, but the
    pattern enforcement keeps unknown methods out of the dispatch
    path. The day kriging lands, this test updates to allow it.
    """
    project, _ = project_with_borehole
    model = await _create_model(async_client, project.id)
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild?method=kriging",
    )
    assert resp.status_code == 422


async def test_list_surfaces_404_when_model_belongs_to_another_project(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Scope guard — cross-project model id returns 404 without
    leaking which boundary triggered."""
    project_a, _ = project_with_borehole
    # Build a separate project + model.
    project_b = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(project_b)
    await db_session.commit()
    model_b = await _create_model(async_client, project_b.id)

    resp = await async_client.get(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/surfaces",
    )
    assert resp.status_code == 404


async def test_geological_surfaces_fetchable_when_litho_sibling_exists(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Geological model surfaces are fetchable via the standard endpoint
    even when a lithostratigraphic sibling model exists.

    This is the backend assertion for the geological surface backdrop
    feature (#60): ``GET /projects/{pid}/geology/models/{geo_mid}/surfaces``
    returns a list (possibly empty, possibly with TIN rows) regardless of
    whether a lithostratigraphic model is active.  The endpoint has no
    special awareness of the litho sibling — this test confirms the
    project-scoped scope guard accepts the GEOLOGICAL model id when called
    from the litho axis context.
    """
    project, _borehole = project_with_borehole
    # Create the geological model (auto-created on project open in the
    # real app; here we create one explicitly via the API).
    geo_model = await _create_model(async_client, project.id)
    assert geo_model["kind"] in ("geological", None)

    # Create a lithostratigraphic sibling (mirrors the real-world state
    # when the user has opened the Lithology stage and created a model).
    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho model",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model = litho_resp.json()
    assert litho_model["kind"] == "lithostratigraphic"
    assert litho_model["parent_model_id"] == geo_model["id"]

    # The geological model's surfaces endpoint must return a valid list
    # (empty here — no contacts yet, so no TIN rows).
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{geo_model['id']}/surfaces",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list)
    # No contacts have been placed, so no TIN surfaces exist yet.
    assert body == []


async def test_dedupe_is_a_no_op_when_no_duplicates(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Clean model → 0 duplicates removed, idempotent."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/dedupe",
    )
    body = resp.json()
    assert body["inspected_groups"] == 1
    assert body["duplicates_removed"] == 0
    assert body["removed_contact_ids"] == []


async def test_rebuild_auto_reorders_display_order_by_per_anchor_depth(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Build auto-derives display_order from contact depths.

    CLAUDE.md "display_order is the age axis": lower display_order =
    OLDER (deeper in the stratigraphic column). Three formations are
    created via the API which defaults display_order=0 for all of them
    (no explicit ordering passed). Contacts place them at depths 15 m /
    3 m / 0.5 m — Aalbeke deepest (oldest), Antropogeen shallowest
    (youngest). Build infers the age order from contact depths and
    assigns display_orders so oldest = lowest, youngest = highest.
    """
    project, borehole = project_with_borehole
    # All three created with default display_order=0; Build must
    # disambiguate from contact depths and assign 0/1/2 by age.
    aalbeke = await _create_formation(async_client, project.id, name="Aalbeke")
    quartair = await _create_formation(async_client, project.id, name="Quartair")
    antropogeen = await _create_formation(async_client, project.id, name="Antropogeen")
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], antropogeen["id"], borehole.id, depth=0.5
    )
    await _create_contact(
        async_client, project.id, model["id"], quartair["id"], borehole.id, depth=3.0
    )
    await _create_contact(
        async_client, project.id, model["id"], aalbeke["id"], borehole.id, depth=15.0
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # All started at 0; after assignment Aalbeke stays at 0, the other
    # two move (Quartair→1, Antropogeen→2) → reordered=2.
    assert body["formations_reordered"] == 2

    # Verify display_orders: oldest=0, youngest=2 per CLAUDE.md convention.
    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/formations",
    )
    rows = {f["name"]: f for f in list_resp.json()}
    assert rows["Aalbeke"]["display_order"] == 0  # oldest
    assert rows["Quartair"]["display_order"] == 1
    assert rows["Antropogeen"]["display_order"] == 2  # youngest


async def test_geo_rebuild_does_not_renumber_litho_unit_display_orders(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Debt #69: building the GEOLOGICAL model must not rewrite the
    display_order of litho units that belong to a sibling
    lithostratigraphic model.

    Before the fix, ``_reorder_by_age`` loaded EVERY project formation
    regardless of kind, treated the litho units as orphans (they have
    no contacts in the geological model), and compacted display_orders
    0..N-1 across the whole set — silently renumbering the litho rows
    that AcceptLithoSuggestions._recompute_litho_display_orders had
    just set. The fix scopes the reorder pool to formations with
    ``parent_formation_id IS NULL AND nad_class IS NULL`` (geological
    vocabulary only).
    """
    from groundmodel.infrastructure.db.models.geological_formation_orm import (
        GeologicalFormationOrm,
    )

    project, borehole = project_with_borehole
    # Two geological formations + one geological model + contacts so
    # the rebuild reorder has something to do.
    aalbeke = await _create_formation(async_client, project.id, name="Aalbeke")
    antropogeen = await _create_formation(async_client, project.id, name="Antropogeen")
    geo_model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, geo_model["id"], antropogeen["id"], borehole.id, depth=0.5
    )
    await _create_contact(
        async_client, project.id, geo_model["id"], aalbeke["id"], borehole.id, depth=15.0
    )

    # Insert two litho units directly via the ORM with hand-picked
    # display_orders we expect to survive the geo rebuild. They share
    # Antropogeen as parent; their litho_main_soil_codes differ.
    litho_zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Antropogeen — Zand",
        color="#deb887",
        display_order=100,  # arbitrary high value Build would otherwise compact
        pinned_order=False,
        parent_formation_id=UUID(antropogeen["id"]),
        litho_main_soil_code="ZAND",
    )
    litho_klei = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Antropogeen — Klei",
        color="#a0522d",
        display_order=101,
        pinned_order=False,
        parent_formation_id=UUID(antropogeen["id"]),
        litho_main_soil_code="KLEI",
    )
    db_session.add(litho_zand)
    db_session.add(litho_klei)
    await db_session.commit()

    # Now run the geological model rebuild. Pre-fix this renumbered
    # every project formation 0..3 by treating litho rows as orphans.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{geo_model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text

    # Re-fetch the litho rows directly — the API list endpoint also
    # returns them but the ORM read is the authoritative check.
    await db_session.refresh(litho_zand)
    await db_session.refresh(litho_klei)
    assert litho_zand.display_order == 100, (
        f"litho display_order was renumbered by geo rebuild "
        f"(expected 100, got {litho_zand.display_order})"
    )
    assert litho_klei.display_order == 101, (
        f"litho display_order was renumbered by geo rebuild "
        f"(expected 101, got {litho_klei.display_order})"
    )


async def test_litho_rebuild_skips_age_reorder(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Debt #69: building a NON-STRATIGRAPHIC model (lithostratigraphic
    or geotechnical) short-circuits the age-reorder pass — these
    kinds explicitly do NOT obey strict superposition (the
    interfingering-sand-clay rule encoded in NON_STRATIGRAPHIC_KINDS).
    The response's ``formations_reordered`` field must be 0 regardless
    of how many formations live in the project.
    """
    project, _borehole = project_with_borehole
    # Need a geological parent model for the litho-create to be valid.
    geo_model = await _create_model(async_client, project.id)
    litho_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "Litho model",
            "kind": "lithostratigraphic",
            "parent_model_id": geo_model["id"],
        },
    )
    assert litho_resp.status_code == 201, litho_resp.text
    litho_model = litho_resp.json()

    # Build the litho model — with no contacts of its own the rebuild
    # is a no-op at the surface-rebuild layer; what we care about is
    # that the kind short-circuit fired and formations_reordered == 0.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{litho_model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["formations_reordered"] == 0


async def test_rebuild_keeps_pinned_formation_order(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Build must NOT re-order a formation the user pinned (debt #35).

    CLAUDE.md: lower display_order = OLDER. Engineer creates Antropogeen /
    Quartair / Aalbeke (creation order → display_order 0 / 1 / 2). Contacts
    say Antropogeen is youngest (0.5 m), Quartair 3 m, Aalbeke deepest
    (15 m), so unconstrained age inference would want display_order 0 / 1
    / 2 = Aalbeke (oldest) / Quartair / Antropogeen (youngest) — the
    OPPOSITE of creation order. But the engineer pins Aalbeke at the
    youngest end (display_order 2) — an unusual-stratigraphy call the
    data can't see. Build must leave Aalbeke at 2 and flow only the
    non-pinned formations into the remaining slots.
    """
    project, borehole = project_with_borehole
    # Creation order: Antropogeen=0, Quartair=1, Aalbeke=2 (inverted vs age).
    antropogeen = await _create_formation(async_client, project.id, name="Antropogeen")
    quartair = await _create_formation(async_client, project.id, name="Quartair")
    aalbeke = await _create_formation(async_client, project.id, name="Aalbeke")
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], antropogeen["id"], borehole.id, depth=0.5
    )
    await _create_contact(
        async_client, project.id, model["id"], quartair["id"], borehole.id, depth=3.0
    )
    await _create_contact(
        async_client, project.id, model["id"], aalbeke["id"], borehole.id, depth=15.0
    )

    # Engineer pins Aalbeke at the youngest slot (display_order=2,
    # which is its CURRENT creation-order value), declaring "yes I
    # know this is the deepest/oldest formation, but I want it at the
    # top of the inspector for this project". pinned_order=True freezes
    # display_order at its current value.
    pin_resp = await async_client.patch(
        f"/projects/{project.id}/geology/formations/{aalbeke['id']}",
        json={"display_order": 2, "pinned_order": True},
    )
    assert pin_resp.status_code == 200, pin_resp.text
    assert pin_resp.json()["pinned_order"] is True

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text
    # Aalbeke is skipped (pinned at 2). Free slots = {0, 1}.
    # Non-pinned age-ordered oldest-first: [Quartair, Antropogeen] — but
    # Antropogeen is YOUNGER than Quartair, so oldest-first puts Quartair
    # first. Assigns Quartair→0 (was 1, no change), Antropogeen→1 (was 0,
    # changed). Only Antropogeen moves → reordered=1.
    assert resp.json()["formations_reordered"] == 1

    rows = {
        f["name"]: f
        for f in (await async_client.get(f"/projects/{project.id}/geology/formations")).json()
    }
    # Pinned formation untouched — order AND flag preserved.
    assert rows["Aalbeke"]["display_order"] == 2
    assert rows["Aalbeke"]["pinned_order"] is True
    # Non-pinned re-flowed by age into the slots Aalbeke didn't hold,
    # oldest-first: Quartair (older) → 0, Antropogeen (younger) → 1.
    assert rows["Quartair"]["display_order"] == 0
    assert rows["Antropogeen"]["display_order"] == 1
    # A second Build re-triangulates (force) but the REORDER is a no-op
    # — order now matches and the pin holds.
    resp2 = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp2.json()["formations_reordered"] == 0


async def test_rebuild_second_pass_no_op_when_order_already_matches(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """A second Build right after the first reports reordered=0 —
    the auto-sort is idempotent once the order matches the data.
    """
    project, borehole = project_with_borehole
    aalbeke = await _create_formation(async_client, project.id, name="Aalbeke")
    antropogeen = await _create_formation(async_client, project.id, name="Antropogeen")
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], antropogeen["id"], borehole.id, depth=0.5
    )
    await _create_contact(
        async_client, project.id, model["id"], aalbeke["id"], borehole.id, depth=15.0
    )

    # First Build aligns display_order.
    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    # Second Build — already aligned, nothing should move.
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    body = resp.json()
    assert body["formations_reordered"] == 0


async def test_rebuild_surfaces_no_op_on_empty_model(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Model with zero contacts → considered=0 rebuilt=0, no error."""
    project, _ = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["formations_considered"] == 0
    assert body["formations_rebuilt"] == 0


async def test_rebuild_surfaces_after_first_create_writes_one_row(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """First Build after a contact create materialises the cache.

    On-click build pivot: the create handler doesn't auto-recompute,
    so the first Build sees a formation with no cached row and writes
    one. ``formations_rebuilt == 1``.
    """
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["formations_considered"] == 1
    assert body["formations_rebuilt"] == 1


async def test_rebuild_surfaces_always_recomputes(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """A second Build with no intervening contact mutation still
    recomputes.

    The manual Build path forces re-triangulation (``force=True``),
    bypassing the contact checksum — so a code change that alters the
    TIN from the *same* contacts is reflected without the user having
    to mutate a contact to bust the cache. ``formations_rebuilt``
    therefore stays == ``formations_considered`` on a repeat Build (it
    is no longer an idempotent no-op), and the surface is still present.
    """
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )
    # First build materialises.
    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    # Second build, no intervening change → still recomputes (force).
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["formations_considered"] == 1
    assert body["formations_rebuilt"] == 1


async def test_rebuild_surfaces_recomputes_when_cache_is_stale(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Corrupt the cached checksum → manual rebuild detects drift and writes.

    The user-facing trigger condition is the same: an anchor's
    elevation changed without a corresponding contact mutation, or
    the cache somehow drifted. Here we simulate by blanking the
    checksum directly so the next recompute sees a mismatch.
    """
    from sqlalchemy import select, update

    from groundmodel.infrastructure.db.models.formation_surface_orm import (
        FormationSurfaceOrm,
    )

    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=2.0
    )

    # Force a cache mismatch by clobbering the stored checksum. The
    # recompute path treats anything that doesn't equal the freshly-
    # computed hash as stale, so the upsert will fire.
    await db_session.execute(
        update(FormationSurfaceOrm)
        .where(FormationSurfaceOrm.formation_id == UUID(formation["id"]))
        .values(source_contact_checksum=b"stale")
    )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["formations_considered"] == 1
    assert body["formations_rebuilt"] == 1

    # Confirm the new checksum landed (no longer == b"stale").
    row = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(
                FormationSurfaceOrm.formation_id == UUID(formation["id"])
            )
        )
    ).scalar_one()
    assert row.source_contact_checksum != b"stale"


async def test_rebuild_surfaces_404_when_model_belongs_to_another_project(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Scope guard — cross-project model id returns 404."""
    project_a, _ = project_with_borehole
    project_b = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(project_b)
    await db_session.commit()
    model_b = await _create_model(async_client, project_b.id)

    resp = await async_client.post(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/surfaces/rebuild",
    )
    assert resp.status_code == 404


async def test_create_contact_allows_same_formation_on_different_anchors(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Same formation on TWO different boreholes is fine — the
    uniqueness is per (model, anchor, formation), not per
    (model, formation).
    """
    project, borehole_a = project_with_borehole
    borehole_b = BoreholeOrm(
        id=uuid7(),
        name="BH-2",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-002",
        location_x=150100.0,
        location_y=200100.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(borehole_b)
    await db_session.commit()
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)

    # Same formation, different boreholes → both succeed.
    a = await _create_contact(
        async_client,
        project.id,
        model["id"],
        formation["id"],
        borehole_a.id,
        depth=3.0,
    )
    b = await _create_contact(
        async_client,
        project.id,
        model["id"],
        formation["id"],
        borehole_b.id,
        depth=4.5,
    )
    assert a["id"] != b["id"]


# ---------------------------------------------------------------------------
# Contact delete — DeleteFormationContact use case
# ---------------------------------------------------------------------------


async def test_delete_contact_returns_204_and_drops_row(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """DELETE returns 204 and a follow-up list does not see the row."""
    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    contact = await _create_contact(
        async_client, project.id, model["id"], formation["id"], borehole.id, depth=0.0
    )

    del_resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts/{contact['id']}",
    )
    assert del_resp.status_code == 204

    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []


# ---------------------------------------------------------------------------
# Validate-no-gaps — ValidateBoreholeStratigraphy use case
# ---------------------------------------------------------------------------


async def test_validate_no_gaps_empty_model_reports_no_contacts(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """The 'no model picked yet' edge case surfaces as a single ``no_contacts`` issue."""
    project, borehole = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/boreholes/{borehole.id}/validate",
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["model_id"] == model["id"]
    assert body["borehole_id"] == str(borehole.id)
    assert [i["kind"] for i in body["issues"]] == ["no_contacts"]


async def test_validate_no_gaps_happy_path_empty_issues(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Surface + 2 m contact on a 10 m borehole reports no issues."""
    project, borehole = project_with_borehole
    quaternary = await _create_formation(async_client, project.id, name="Quaternary")
    boom = await _create_formation(async_client, project.id, name="Boom Klei")
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], quaternary["id"], borehole.id, depth=0.0
    )
    await _create_contact(async_client, project.id, model["id"], boom["id"], borehole.id, depth=2.0)

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/boreholes/{borehole.id}/validate",
    )

    assert resp.status_code == 200
    assert resp.json()["issues"] == []


async def test_validate_no_gaps_wrong_project_returns_404(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Asking project A to validate a model that lives in project B is rejected."""
    project_a, borehole = project_with_borehole

    project_b = ProjectOrm(id=uuid7(), name="Other project", status="active")
    db_session.add(project_b)
    await db_session.commit()
    model_b = await _create_model(async_client, project_b.id)

    resp = await async_client.get(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/boreholes/{borehole.id}/validate",
    )

    assert resp.status_code == 404


async def test_validate_crossings_empty_model_returns_no_issues(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Model with no contacts has no surfaces → no crossings to flag."""
    project, _ = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/validate/crossings",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["model_id"] == model["id"]
    assert body["issues"] == []


async def test_validate_crossings_flags_younger_below_older(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Younger formation's TIN dips below older's at a shared (x, y) →
    one ``formation_crossing`` issue.

    Setup:
    * 3 boreholes at (0,0), (10,0), (5,10) — all with surface elevation 10 m.
    * 'Older' formation (display_order=0): contacts at depth 5 m on all three
      → TIN sits at z=5 across the triangle.
    * 'Younger' formation (display_order=10): contacts at depth 1, 1, 9 m
      → TIN at z=9, 9, 1 — middle vertex 4 m BELOW older.
    """
    project, _ = project_with_borehole

    bh_b = BoreholeOrm(
        id=uuid7(),
        name="BH-B",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-B",
        location_x=10.0,
        location_y=0.0,
        epsg=31370,
        elevation_m=10.0,
        total_depth_m=20.0,
    )
    bh_c = BoreholeOrm(
        id=uuid7(),
        name="BH-C",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-C",
        location_x=5.0,
        location_y=10.0,
        epsg=31370,
        elevation_m=10.0,
        total_depth_m=20.0,
    )
    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-A",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-A",
        location_x=0.0,
        location_y=0.0,
        epsg=31370,
        elevation_m=10.0,
        total_depth_m=20.0,
    )
    db_session.add_all([bh_a, bh_b, bh_c])
    await db_session.commit()

    older = await _create_formation(async_client, project.id, name="Older")
    younger = await _create_formation(async_client, project.id, name="Younger")
    # Bump younger's display_order so the validator orients pairs.
    await async_client.patch(
        f"/projects/{project.id}/geology/formations/{younger['id']}",
        json={"display_order": 10},
    )
    model = await _create_model(async_client, project.id)

    # Older sits at z = 10 - 5 = 5 m across all three anchors.
    for bh in (bh_a, bh_b, bh_c):
        await _create_contact(async_client, project.id, model["id"], older["id"], bh.id, depth=5.0)
    # Younger: BH-A and BH-B at depth 1 (z=9); BH-C at depth 9 (z=1).
    # Older z=5 at BH-C → younger 4 m below older = clear crossing.
    await _create_contact(async_client, project.id, model["id"], younger["id"], bh_a.id, depth=1.0)
    await _create_contact(async_client, project.id, model["id"], younger["id"], bh_b.id, depth=1.0)
    await _create_contact(async_client, project.id, model["id"], younger["id"], bh_c.id, depth=9.0)

    # On-click build pivot: contacts don't auto-build the cache. Run
    # Build explicitly so the validator has TINs to compare.
    await async_client.post(
        f"/projects/{project.id}/geology/models/{model['id']}/surfaces/rebuild",
    )

    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/validate/crossings",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    issues = body["issues"]
    assert len(issues) == 1
    issue = issues[0]
    assert issue["kind"] == "formation_crossing"
    assert issue["formation_ids"] == [older["id"], younger["id"]]
    assert issue["depth_m"] is not None
    assert issue["depth_m"] >= 3.0  # at least 3 m of "wrong way" overlap


async def test_validate_crossings_404_when_model_belongs_to_another_project(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Scope guard — cross-project model id returns 404."""
    project_a, _ = project_with_borehole
    project_b = ProjectOrm(id=uuid7(), name="Other", status="active")
    db_session.add(project_b)
    await db_session.commit()
    model_b = await _create_model(async_client, project_b.id)

    resp = await async_client.get(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/validate/crossings",
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Clear litho model — DELETE /models/{model_id}/contacts (debt #94 fix)
# ---------------------------------------------------------------------------


async def test_clear_litho_model_removes_contacts_and_litho_formations(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
    db_session: AsyncSession,
) -> None:
    """Happy path — clear removes contacts AND litho formations; returns per-table counts.

    Creates two litho formations (``litho_main_soil_code`` set) and two
    contacts, then calls the clear endpoint.  Asserts the per-table counts,
    that the contacts list is empty, and that the litho formations are gone.
    """
    project, borehole = project_with_borehole
    # Litho formations carry ``litho_main_soil_code`` — the public
    # formation-create endpoint does not accept that field, so insert them
    # directly via the ORM (same pattern as the litho-rebuild test above).
    litho_a = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-A",
        color="#aaaaaa",
        display_order=0,
        pinned_order=False,
        litho_main_soil_code="ZAND",
    )
    litho_b = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-B",
        color="#bbbbbb",
        display_order=1,
        pinned_order=False,
        litho_main_soil_code="KLEI",
    )
    db_session.add_all([litho_a, litho_b])
    await db_session.commit()

    model = await _create_model(async_client, project.id)

    await _create_contact(
        async_client, project.id, model["id"], str(litho_a.id), borehole.id, depth=1.0
    )
    await _create_contact(
        async_client, project.id, model["id"], str(litho_b.id), borehole.id, depth=3.0
    )

    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # New response shape: per-table counts.
    assert "contacts" in body
    assert "edges" in body
    assert "surfaces" in body
    assert "formations" in body
    assert body["contacts"] == 2
    assert body["formations"] == 2  # both litho formations were orphaned + deleted

    # Contacts list must be empty.
    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    assert list_resp.status_code == 200
    assert list_resp.json() == []

    # Litho formations must be gone from the project formation list.
    formations_resp = await async_client.get(
        f"/projects/{project.id}/geology/formations",
    )
    assert formations_resp.status_code == 200
    formation_ids = {f["id"] for f in formations_resp.json()}
    assert str(litho_a.id) not in formation_ids
    assert str(litho_b.id) not in formation_ids


async def test_clear_litho_model_removes_orphan_formations_with_no_contacts(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
    db_session: AsyncSession,
) -> None:
    """Litho units left contactless by a prior wipe are still cleared.

    The real dogfeed state: a litho model with 0 contacts but N orphan
    litho formations from an earlier session.  The clear must find and
    delete them project-wide — there is no contact left to reach them
    through.
    """
    project, _ = project_with_borehole
    # Two orphan litho units — raw-inserted, never given a contact.
    orphan_a = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Orphan-A",
        color="#aaaaaa",
        display_order=0,
        pinned_order=False,
        litho_main_soil_code="ZAND",
    )
    orphan_b = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Orphan-B",
        color="#bbbbbb",
        display_order=1,
        pinned_order=False,
        litho_main_soil_code="KLEI",
    )
    db_session.add_all([orphan_a, orphan_b])
    await db_session.commit()

    model = await _create_model(async_client, project.id)

    # Clear — the model has 0 contacts but the two orphan units linger.
    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["contacts"] == 0
    assert body["formations"] == 2  # both orphan litho units removed

    formations_resp = await async_client.get(
        f"/projects/{project.id}/geology/formations",
    )
    assert formations_resp.status_code == 200
    formation_ids = {f["id"] for f in formations_resp.json()}
    assert str(orphan_a.id) not in formation_ids
    assert str(orphan_b.id) not in formation_ids


async def test_clear_litho_model_preserves_geological_formation(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Geological formations (litho_main_soil_code IS NULL) must survive the clear.

    Creates one geological formation (no litho_main_soil_code) and a contact
    in the model, then clears the model.  The geological formation must remain
    in the project's formation list — only litho formations get the orphan-
    deletion treatment.
    """
    project, borehole = project_with_borehole
    geo_formation = await _create_formation(async_client, project.id, name="Geo-F")
    model = await _create_model(async_client, project.id)
    await _create_contact(
        async_client, project.id, model["id"], geo_formation["id"], borehole.id, depth=2.0
    )

    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["contacts"] == 1
    assert body["formations"] == 0  # geological formation must NOT be deleted

    # Geological formation still in the project list.
    formations_resp = await async_client.get(
        f"/projects/{project.id}/geology/formations",
    )
    assert formations_resp.status_code == 200
    formation_ids = {f["id"] for f in formations_resp.json()}
    assert geo_formation["id"] in formation_ids


async def test_clear_litho_model_zero_when_model_is_empty(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Idempotent no-op when the model has no content — all counts are 0."""
    project, _ = project_with_borehole
    model = await _create_model(async_client, project.id)

    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["contacts"] == 0
    assert body["edges"] == 0
    assert body["surfaces"] == 0
    assert body["formations"] == 0


async def test_clear_litho_model_rejects_wrong_project(
    async_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Cross-project tampering returns 404 — model does not belong to project_a."""
    project_a = ProjectOrm(id=uuid7(), name="P-A", status="active")
    project_b = ProjectOrm(id=uuid7(), name="P-B", status="active")
    db_session.add_all([project_a, project_b])
    await db_session.commit()

    model_b_resp = await async_client.post(
        f"/projects/{project_b.id}/geology/models",
        json={"name": "Model-B"},
    )
    assert model_b_resp.status_code == 201
    model_b = model_b_resp.json()

    resp = await async_client.delete(
        f"/projects/{project_a.id}/geology/models/{model_b['id']}/contacts",
    )

    assert resp.status_code == 404


async def test_clear_litho_model_shared_formation_survives(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
    db_session: AsyncSession,
) -> None:
    """A litho formation shared by a second model must NOT be deleted.

    Model A and Model B both have a contact pointing at the same litho
    formation (F-shared).  Clearing Model A must delete only Model A's
    contacts, not the shared formation (Model B still references it).
    """
    project, borehole = project_with_borehole

    # Shared litho formation + a second borehole — both raw-inserted via the
    # ORM (the create endpoint takes no litho_main_soil_code; boreholes are
    # not created over the API in these tests).
    shared_f = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Shared-Litho",
        color="#cccccc",
        display_order=0,
        pinned_order=False,
        litho_main_soil_code="ZAND",
    )
    # Second borehole so Model B's contact does not collide with Model A's
    # on the (model, anchor, formation) uniqueness guard.
    borehole_b = BoreholeOrm(
        id=uuid7(),
        name="BH-B",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-B-001",
        location_x=160000.0,
        location_y=210000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add_all([shared_f, borehole_b])
    await db_session.commit()

    model_a = await _create_model(async_client, project.id)
    model_b_resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "Model-B"},
    )
    assert model_b_resp.status_code == 201, model_b_resp.text
    model_b = model_b_resp.json()

    # Contact in Model A.
    await _create_contact(
        async_client, project.id, model_a["id"], str(shared_f.id), borehole.id, depth=1.0
    )
    # Contact in Model B (different borehole, same formation).
    await _create_contact(
        async_client, project.id, model_b["id"], str(shared_f.id), borehole_b.id, depth=1.0
    )

    # Clear Model A.
    resp = await async_client.delete(
        f"/projects/{project.id}/geology/models/{model_a['id']}/contacts",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["contacts"] == 1
    # formation NOT deleted — Model B still references it.
    assert body["formations"] == 0

    # Shared formation still in the project list.
    formations_resp = await async_client.get(
        f"/projects/{project.id}/geology/formations",
    )
    assert formations_resp.status_code == 200
    formation_ids = {f["id"] for f in formations_resp.json()}
    assert str(shared_f.id) in formation_ids


# ---------------------------------------------------------------------------
# Small helpers — wrap repetitive POSTs that every test needs.
# ---------------------------------------------------------------------------


async def _create_formation(
    client: AsyncClient,
    project_id,  # noqa: ANN001 — UUID-or-str, both serialise the same in URLs
    *,
    name: str = "F",
    color: str = "#aaa",
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/geology/formations",
        json={"name": name, "color": color},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_model(client: AsyncClient, project_id) -> dict:  # noqa: ANN001
    resp = await client.post(
        f"/projects/{project_id}/geology/models",
        json={"name": "Model"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_contact(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    model_id: str,
    formation_id: str,
    borehole_id,  # noqa: ANN001
    *,
    depth: float,
) -> dict:
    resp = await client.post(
        f"/projects/{project_id}/geology/models/{model_id}/contacts",
        json={
            "formation_id": formation_id,
            "borehole_id": str(borehole_id),
            "depth_top_m": depth,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_patch_persists_nad_admixture_choice_round_trip(
    async_client: AsyncClient,
    project_with_borehole: tuple[ProjectOrm, BoreholeOrm],
) -> None:
    """Owner ruling 2026-09-04: the geotech admixture prompt PATCHes the engineer's
    'pure' / 'with_admixture' answer onto the litho unit, and it is read back on
    the formation — so a re-divide does not re-ask.

    Also covers the change-my-answer path (PATCH null clears it) and the
    validator (an unknown answer is refused 422).
    """
    project, _borehole = project_with_borehole
    # A litho unit whose silt/clay admixture the NAD table can classify either way.
    create = await async_client.post(
        f"/projects/{project.id}/geology/formations",
        json={
            "name": "Antropogeen — silty Zand",
            "litho_main_soil_code": "ZAND",
            "litho_admixtures": [{"soil_code": "KL", "amount": "M", "locally": False}],
        },
    )
    assert create.status_code == 201, create.text
    fid = create.json()["id"]
    # Default: no answer yet.
    assert create.json()["nad_admixture_choice"] is None

    # The prompt persists 'with_admixture'.
    patched = await async_client.patch(
        f"/projects/{project.id}/geology/formations/{fid}",
        json={"nad_admixture_choice": "with_admixture"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["nad_admixture_choice"] == "with_admixture"

    # Read back on the formation list — it persisted.
    listed = await async_client.get(f"/projects/{project.id}/geology/formations")
    by_id = {f["id"]: f for f in listed.json()}
    assert by_id[fid]["nad_admixture_choice"] == "with_admixture"

    # Change-my-answer: null clears it back to auto.
    cleared = await async_client.patch(
        f"/projects/{project.id}/geology/formations/{fid}",
        json={"nad_admixture_choice": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["nad_admixture_choice"] is None

    # An unknown answer is refused, not stored.
    bad = await async_client.patch(
        f"/projects/{project.id}/geology/formations/{fid}",
        json={"nad_admixture_choice": "sandy"},
    )
    assert bad.status_code == 422, bad.text
