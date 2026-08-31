"""Integration tests — the "Separate" verb (debt #278 R5).

Owner ruling 2026-08-31: a "Separate" verb, the counterpart to Dissolve, so the
engineer can state *"these two are NOT the same body"* and have the resolver
honour it PERMANENTLY. His standing rule: *"a body is only a body if it is
geometrically connected, OR if the user says this body is the same as that
body"* — only the positive half (Dissolve / ties / geometry facts) existed
before; a separation is the subtractive half.

Scene
-----
Two CPTs 500 m apart, each with a two-zone qc log, litho-correlated so their
sands land in ONE litho body (identical to the ``test_geotech_body_mass`` scene).
``SubdivideAllBodies`` then bands both columns (a LOOSE zone over a DENSE zone).

Test assertions
---------------
SEP-1  A separation splits the two correlated sand layers into different bodies
       even though an accepted correlation edge connects them.
SEP-2  A geometry fact posted between the two layers CANNOT rejoin them while the
       separation stands — the resolver honours the user over the geometry.
SEP-3  Deleting the separation (Rejoin) re-unions the two layers on the next
       resolve.
SEP-4  A separation on two correlated GEOTECH bands survives a full re-subdivide,
       re-anchored onto the rebuilt bands: they stay split and the Rejoin listing
       still names both sides.

⚠ NOT RUN by the author — the integration suite must go through the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_body_separations.py
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

from .geotech_scene_helpers import accept_cpt_litho, two_layer_qc


@pytest_asyncio.fixture
async def sep_project(db_session: AsyncSession) -> ProjectOrm:
    """A project for this module's scene."""
    project = ProjectOrm(id=uuid7(), name="SEP-Project", status="active")
    db_session.add(project)
    await db_session.commit()
    return project


@pytest_asyncio.fixture
async def sep_scene(
    db_session: AsyncSession,
    sep_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Two CPTs, one litho sand body, two packing zones per column.

    Returns
    -------
    dict
        ``project``, ``litho_model_id``, ``geotech_model_id``, ``section_id``,
        ``cpt_a_id``, ``cpt_b_id``.
    """
    pid = str(sep_project.id)

    geo = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "SEP-Geo", "kind": "geological"},
    )
    assert geo.status_code == 201, geo.text
    litho = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "SEP-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo.json()["id"],
        },
    )
    assert litho.status_code == 201, litho.text
    litho_model_id = litho.json()["id"]

    section = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "SEP-Section",
            "start_x": 148_700.0,
            "start_y": 200_000.0,
            "end_x": 149_400.0,
            "end_y": 200_000.0,
            "epsg": 31370,
            "projection_buffer_m": 60.0,
        },
    )
    assert section.status_code == 201, section.text
    section_id = section.json()["id"]

    depths, qc = two_layer_qc(150, 150, 4.0, 25.0)
    cpt_ids: list[str] = []
    for index, x in enumerate((148_800.0, 149_300.0)):
        cpt = CptOrm(
            id=uuid7(),
            name=f"SEP-{index}",
            cpt_type="CPTU",
            project_id="SEP",
            test_id=f"SEP/{index}",
            app_project_id=sep_project.id,
            location_x=x,
            location_y=200_000.0,
            elevation_m=5.0,
            z_epsg=5710,
            epsg=31370,
            max_depth_m=15.0,
        )
        cpt.series = CptSeriesOrm(
            depths_m=depths,
            qc_mpa=qc,
            fs_mpa=[0.05] * len(depths),
            u2_mpa=None,
        )
        db_session.add(cpt)
        await db_session.flush()
        cpt_ids.append(str(cpt.id))
    await db_session.commit()

    contacts = [
        await accept_cpt_litho(
            async_client, pid, litho_model_id, cpt_id=cpt_id, top=0.0, base=6.0, soil="ZAND"
        )
        for cpt_id in cpt_ids
    ]
    correlate = await async_client.post(
        f"/projects/{pid}/geology/models/{litho_model_id}/contact-correlations",
        json={
            "layer_a_id": contacts[0],
            "layer_b_id": contacts[1],
            "request_section_id": section_id,
        },
    )
    assert correlate.status_code in (200, 201), correlate.text

    subdivide = await SubdivideAllBodies(db_session).execute(
        project_id=sep_project.id, litho_model_id=litho.json()["id"]
    )
    await db_session.commit()
    return {
        "project": sep_project,
        "section_id": section_id,
        "litho_model_id": litho_model_id,
        "geotech_model_id": str(subdivide.geotech_model_id),
        "cpt_a_id": cpt_ids[0],
        "cpt_b_id": cpt_ids[1],
    }


async def _bands(session: AsyncSession, model_id: str, cpt_id: str) -> list:
    """Every accepted band of one column as ``(id, body_id)`` rows, shallowest first.

    A COLUMN select, not ORM instances: the app commits its ``body_id`` changes in
    a separate session, and a cached ORM instance in ``db_session``'s identity map
    would read stale. A fresh column select under Postgres READ COMMITTED reads
    the committed values every call (and never lazy-loads, so no MissingGreenlet).
    """
    rows = (
        await session.execute(
            select(LithoLayerOrm.id, LithoLayerOrm.body_id, LithoLayerOrm.depth_top_m)
            .where(
                LithoLayerOrm.model_id == model_id,
                LithoLayerOrm.cpt_id == cpt_id,
                LithoLayerOrm.status == "accepted",
            )
            .order_by(LithoLayerOrm.depth_top_m)
        )
    ).all()
    return list(rows)


@pytest.mark.asyncio
async def test_sep1_separate_splits_a_correlated_body(
    db_session: AsyncSession, sep_scene: dict, async_client: AsyncClient
) -> None:
    """SEP-1 — the user says these two are NOT the same body; the resolver splits.

    The two sand layers share one litho body via an accepted correlation edge.
    A separation overrules that union, so they land in different bodies.
    """
    pid = str(sep_scene["project"].id)
    lm = sep_scene["litho_model_id"]
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    assert left and right
    assert left[0].body_id is not None
    assert left[0].body_id == right[0].body_id, "the scene should start as ONE body"

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["was_created"] is True

    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id != right[0].body_id, "the separation must split the body"


@pytest.mark.asyncio
async def test_sep2_a_geometry_fact_cannot_rejoin_a_separated_body(
    db_session: AsyncSession, sep_scene: dict, async_client: AsyncClient
) -> None:
    """SEP-2 — a geometry fact connecting the two layers cannot re-union them.

    The recompute writes geometry facts that union like ties. With a separation
    standing, a fact between the two anchors is honoured as a cannot-link: the
    resolver keeps them split.
    """
    pid = str(sep_scene["project"].id)
    lm = sep_scene["litho_model_id"]
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    a_id, b_id = left[0].id, right[0].id

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": str(a_id), "layer_b_id": str(b_id)},
    )
    assert resp.status_code == 201, resp.text

    # A geometry fact directly connecting the two anchors — exactly the edge a
    # bodies/recompute persists — canonicalised a < b.
    fa, fb = (a_id, b_id) if a_id < b_id else (b_id, a_id)
    db_session.add(BodyGeometryFactOrm(id=uuid7(), model_id=lm, layer_a_id=fa, layer_b_id=fb))
    await db_session.commit()

    # Re-resolve as the recompute would.
    await ResolveLithoInstances(db_session).execute(model_id=lm, commit=True)

    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    assert left[0].body_id != right[0].body_id, "the fact must not overrule the separation"


@pytest.mark.asyncio
async def test_sep3_rejoin_reunites_the_two_bodies(
    db_session: AsyncSession, sep_scene: dict, async_client: AsyncClient
) -> None:
    """SEP-3 — deleting the separation (Rejoin) re-unions the two layers.

    Lifting the cannot-link lets the accepted correlation edge merge the two
    layers back into one body on the next resolve.
    """
    pid = str(sep_scene["project"].id)
    lm = sep_scene["litho_model_id"]
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])

    created = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert created.status_code == 201, created.text
    sep_id = created.json()["separation_id"]

    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    assert left[0].body_id != right[0].body_id, "precondition: separated"

    rejoin = await async_client.delete(
        f"/projects/{pid}/geology/models/{lm}/body-separations/{sep_id}"
    )
    assert rejoin.status_code == 200, rejoin.text

    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    assert left[0].body_id is not None
    assert left[0].body_id == right[0].body_id, "Rejoin must re-unite the two bodies"


@pytest.mark.asyncio
async def test_sep4_a_separation_survives_a_re_subdivide(
    db_session: AsyncSession, sep_scene: dict, async_client: AsyncClient
) -> None:
    """SEP-4 — a geotech separation is re-anchored across a full re-subdivide.

    On the geotech model the two LOOSE bands are correlated into one body, then
    separated. A re-subdivide wipes every geotech band (fresh ids) and its
    CASCADE would eat the separation — but the re-anchor captures it before the
    wipe and re-creates it against the rebuilt bands, so the two loose bands stay
    split and the Rejoin listing still names both sides.
    """
    pid = str(sep_scene["project"].id)
    gm = sep_scene["geotech_model_id"]
    left = await _bands(db_session, gm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, gm, sep_scene["cpt_b_id"])
    assert left and right, "the subdivide produced no geotech bands"

    # Correlate the two LOOSE (shallow) bands into ONE geotech body.
    tie = await async_client.post(
        f"/projects/{pid}/geology/models/{gm}/contact-correlations",
        json={
            "layer_a_id": str(left[0].id),
            "layer_b_id": str(right[0].id),
            "request_section_id": sep_scene["section_id"],
        },
    )
    assert tie.status_code in (200, 201), tie.text
    left = await _bands(db_session, gm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, gm, sep_scene["cpt_b_id"])
    assert left[0].body_id == right[0].body_id, "the tie should union the loose bands"

    # Separate them.
    sep = await async_client.post(
        f"/projects/{pid}/geology/models/{gm}/body-separations",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert sep.status_code == 201, sep.text
    left = await _bands(db_session, gm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, gm, sep_scene["cpt_b_id"])
    assert left[0].body_id != right[0].body_id, "precondition: separated on the geotech model"

    # Full re-subdivide — wipes and rebuilds every geotech band with fresh ids.
    await SubdivideAllBodies(db_session).execute(
        project_id=sep_scene["project"].id, litho_model_id=sep_scene["litho_model_id"]
    )
    await db_session.commit()

    # The separation survived, re-anchored onto the rebuilt loose bands.
    listing = await async_client.get(f"/projects/{pid}/geology/models/{gm}/body-separations")
    assert listing.status_code == 200, listing.text
    items = listing.json()
    assert len(items) == 1, f"the separation should survive the re-subdivide: {items}"
    item = items[0]
    assert item["anchor_a"]["body_id"] is not None
    assert item["anchor_b"]["body_id"] is not None
    assert item["anchor_a"]["body_id"] != item["anchor_b"]["body_id"]

    # And the rebuilt loose bands are genuinely in different bodies.
    left = await _bands(db_session, gm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, gm, sep_scene["cpt_b_id"])
    assert left[0].body_id != right[0].body_id, "the rebuilt loose bands must stay split"


@pytest.mark.asyncio
async def test_sep5_a_separation_survives_a_bundle_save_restore_reconcile(
    db_session: AsyncSession, sep_scene: dict, async_client: AsyncClient
) -> None:
    """SEP-5 — a separation survives a bundle save → restore → reconcile round trip.

    "Permanent" means across a reopen too: save the bundle, wipe the project,
    restore it (the /restore route reconciles). The separation row comes back and
    the post-restore resolver honours it, so the two bodies stay TWO — a restore
    that lost the separation would silently rejoin the bodies the engineer split.
    """
    pid = str(sep_scene["project"].id)
    lm = sep_scene["litho_model_id"]
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])

    created = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert created.status_code == 201, created.text
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    assert left[0].body_id != right[0].body_id, "precondition: separated in the source project"

    # Save the bundle — it must carry the separation.
    bundle_resp = await async_client.get(f"/projects/{pid}/bundle")
    assert bundle_resp.status_code == 200, bundle_resp.text
    bundle = bundle_resp.json()
    assert len(bundle["body_separations"]) == 1, "the bundle must carry the separation"

    # Wipe the project (cascade), then restore from the bundle — the route
    # runs reconcile_bodies_after_restore, which re-resolves every model.
    project = await db_session.get(ProjectOrm, sep_scene["project"].id)
    assert project is not None
    await db_session.delete(project)
    await db_session.commit()

    restore_resp = await async_client.post(f"/projects/{pid}/restore", json=bundle)
    assert restore_resp.status_code == 200, restore_resp.text

    # The separation restored ...
    sep_count = (
        await db_session.execute(
            select(func.count())
            .select_from(BodySeparationOrm)
            .where(BodySeparationOrm.model_id == lm)
        )
    ).scalar_one()
    assert sep_count == 1, "the separation must restore with the bundle"

    # ... and the post-restore resolver honoured it: the two bodies stay TWO.
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id != right[0].body_id, (
        "the restored separation must keep the two bodies split — the ruling is permanent"
    )


@pytest.mark.asyncio
async def test_sep6_create_is_idempotent_and_order_independent(
    db_session: AsyncSession, sep_scene: dict, async_client: AsyncClient
) -> None:
    """SEP-6 — re-asserting a separation returns the existing row, 200 not 409.

    The verb is reversible, so a duplicate create is not a conflict: the first
    POST is 201 ``was_created=True``, and re-POSTing the same pair — in EITHER
    order, since the endpoint canonicalises — is 200 ``was_created=False`` with
    the SAME separation id, and only one row exists.
    """
    pid = str(sep_scene["project"].id)
    lm = sep_scene["litho_model_id"]
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    a, b = str(left[0].id), str(right[0].id)
    url = f"/projects/{pid}/geology/models/{lm}/body-separations"

    first = await async_client.post(url, json={"layer_a_id": a, "layer_b_id": b})
    assert first.status_code == 201, first.text
    assert first.json()["was_created"] is True
    sep_id = first.json()["separation_id"]

    again = await async_client.post(url, json={"layer_a_id": a, "layer_b_id": b})
    assert again.status_code == 200, again.text
    assert again.json()["was_created"] is False
    assert again.json()["separation_id"] == sep_id, "the existing row must be returned"

    # Reversed order hits the SAME canonical row — still existing, still 200.
    reversed_order = await async_client.post(url, json={"layer_a_id": b, "layer_b_id": a})
    assert reversed_order.status_code == 200, reversed_order.text
    assert reversed_order.json()["separation_id"] == sep_id

    listing = await async_client.get(url)
    assert listing.status_code == 200, listing.text
    assert len(listing.json()) == 1, "an idempotent re-create must not add a second row"


@pytest.mark.asyncio
async def test_sep7_endpoints_are_scoped_to_the_project_and_model(
    db_session: AsyncSession, sep_scene: dict, async_client: AsyncClient
) -> None:
    """SEP-7 — a caller cannot reach a model / separation outside its scope.

    The by-id IDOR shape: putting a valid model id under the WRONG project id
    404s (POST and DELETE), an anchor from another MODEL is rejected 422, and a
    separation id addressed via the wrong model 404s on DELETE.
    """
    pid = str(sep_scene["project"].id)
    lm = sep_scene["litho_model_id"]
    gm = sep_scene["geotech_model_id"]
    left = await _bands(db_session, lm, sep_scene["cpt_a_id"])
    right = await _bands(db_session, lm, sep_scene["cpt_b_id"])
    a, b = str(left[0].id), str(right[0].id)

    # Cross-project: the litho model belongs to sep_scene's project, not this
    # attacker-supplied id → 404 on both POST and DELETE.
    other_pid = str(uuid7())
    cross_post = await async_client.post(
        f"/projects/{other_pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": a, "layer_b_id": b},
    )
    assert cross_post.status_code == 404, cross_post.text
    cross_delete = await async_client.delete(
        f"/projects/{other_pid}/geology/models/{lm}/body-separations/{uuid7()}"
    )
    assert cross_delete.status_code == 404, cross_delete.text

    # Cross-model on POST: geotech-band anchors are not accepted layers of the
    # LITHO model → 422 (the anchor-validation guard).
    geo = await _bands(db_session, gm, sep_scene["cpt_a_id"])
    geo_b = await _bands(db_session, gm, sep_scene["cpt_b_id"])
    cross_model_post = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": str(geo[0].id), "layer_b_id": str(geo_b[0].id)},
    )
    assert cross_model_post.status_code == 422, cross_model_post.text

    # Cross-model on DELETE: a separation created on the litho model cannot be
    # deleted through the geotech model's URL → 404 (scope mismatch).
    created = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": a, "layer_b_id": b},
    )
    assert created.status_code == 201, created.text
    sep_id = created.json()["separation_id"]
    wrong_model_delete = await async_client.delete(
        f"/projects/{pid}/geology/models/{gm}/body-separations/{sep_id}"
    )
    assert wrong_model_delete.status_code == 404, wrong_model_delete.text
