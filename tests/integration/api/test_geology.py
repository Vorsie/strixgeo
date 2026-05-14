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
    from datetime import datetime, timedelta, timezone

    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm as FCO,
    )

    project, borehole = project_with_borehole
    formation = await _create_formation(async_client, project.id)
    model = await _create_model(async_client, project.id)
    # Insert 3 duplicates directly (bypasses the new uniqueness check
    # at the API layer; this mirrors the legacy data shape we want
    # to clean up).
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

    # Survivor must be the manual_pick (priority 1 wins over the two
    # borehole_observation rows regardless of timestamp).
    list_resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{model['id']}/contacts",
    )
    rows = list_resp.json()
    assert len(rows) == 1
    assert rows[0]["id"] == str(manual.id)
    assert rows[0]["source"] == "manual_pick"


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
