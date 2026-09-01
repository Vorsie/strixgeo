"""Integration tests — the "Join with…" verb (debt #278).

Owner ruling 2026-08-31: a "Join with…" verb, the POSITIVE half of the
body-identity rule and the counterpart to Separate, so the engineer can state
*"this body IS the same as that body"* and have the resolver honour it. His
standing rule: *"a body is only a body if it is geometrically connected, OR if
the user says this body is the same as that body"* — a union is that second half,
the must-link only the user writes.

Scene
-----
Two CPTs 500 m apart, each with a two-zone qc log and an accepted ZAND layer,
DELIBERATELY LEFT UNCORRELATED so their sands are TWO separate litho bodies (the
mirror of the separation scene, which starts them as one). ``SubdivideAllBodies``
then bands both columns (a LOOSE zone over a DENSE zone), giving two untied loose
bodies + two untied dense bodies on the geotech model.

Test assertions
---------------
UNI1  A join merges two untied same-class bodies into one.
UNI2  The join survives a re-resolve (recompute) — no edge holds it, only the union.
UNI3  Disjoin (DELETE) restores the two bodies.
UNI4  Create is idempotent and order-independent (200, same id, one row).
UNI5  A cross-class join is refused 422, naming both classes.
UNI6  A join contradicting a standing separation is refused 422, naming the separation.
UNI7  A contradicting union arriving via restore is suppressed — the separation
      wins and the restore still succeeds.
UNI8  A join survives a full re-subdivide, re-anchored onto the rebuilt bands.
UNI9  A join survives a bundle save/restore round trip.
UNI10 The endpoints are scoped to the project + model (IDOR shape).
UNI12 A Join does NOT stale the 3-D solids (identity, not geometry) — but the
      SAME body re-stamp run through the DEFAULT resolve path still stales (D3).

⚠ NOT RUN by the author — the integration suite must go through the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_body_unions.py
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

from .geotech_scene_helpers import accept_cpt_litho, two_layer_qc


@pytest_asyncio.fixture
async def uni_project(db_session: AsyncSession) -> ProjectOrm:
    """A project for this module's scene."""
    project = ProjectOrm(id=uuid7(), name="UNI-Project", status="active")
    db_session.add(project)
    await db_session.commit()
    return project


@pytest_asyncio.fixture
async def uni_scene(
    db_session: AsyncSession,
    uni_project: ProjectOrm,
    async_client: AsyncClient,
) -> dict:
    """Two CPTs, two UNCORRELATED sand bodies, two packing zones per column.

    Returns
    -------
    dict
        ``project``, ``litho_model_id``, ``geotech_model_id``, ``section_id``,
        ``cpt_a_id``, ``cpt_b_id``.
    """
    pid = str(uni_project.id)

    geo = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={"name": "UNI-Geo", "kind": "geological"},
    )
    assert geo.status_code == 201, geo.text
    litho = await async_client.post(
        f"/projects/{pid}/geology/models",
        json={
            "name": "UNI-Litho",
            "kind": "lithostratigraphic",
            "parent_model_id": geo.json()["id"],
        },
    )
    assert litho.status_code == 201, litho.text
    litho_model_id = litho.json()["id"]

    section = await async_client.post(
        f"/projects/{pid}/sections",
        json={
            "name": "UNI-Section",
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
            name=f"UNI-{index}",
            cpt_type="CPTU",
            project_id="UNI",
            test_id=f"UNI/{index}",
            app_project_id=uni_project.id,
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

    # Accept ONE ZAND layer per column — and deliberately DO NOT correlate them,
    # so the two sands are two separate litho bodies for a join to merge.
    for cpt_id in cpt_ids:
        await accept_cpt_litho(
            async_client, pid, litho_model_id, cpt_id=cpt_id, top=0.0, base=6.0, soil="ZAND"
        )

    subdivide = await SubdivideAllBodies(db_session).execute(
        project_id=uni_project.id, litho_model_id=litho.json()["id"]
    )
    await db_session.commit()
    return {
        "project": uni_project,
        "section_id": section_id,
        "litho_model_id": litho_model_id,
        "geotech_model_id": str(subdivide.geotech_model_id),
        "cpt_a_id": cpt_ids[0],
        "cpt_b_id": cpt_ids[1],
    }


async def _bands(session: AsyncSession, model_id: str, cpt_id: str) -> list:
    """Every accepted band of one column as ``(id, body_id, depth_top_m)`` rows.

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
async def test_uni1_join_merges_two_untied_bodies(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI1 — the user says these two ARE the same body; the resolver merges.

    The two sand layers are two separate litho bodies — no correlation edge joins
    them. A union alone merges them into one body, exactly as the ruling promises.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left and right
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id != right[0].body_id, "the scene should start as TWO bodies"

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["was_created"] is True

    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id == right[0].body_id, "the join must merge the two bodies"


@pytest.mark.asyncio
async def test_uni2_join_survives_recompute(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI2 — the join holds across a re-resolve; only the union connects them.

    No correlation edge or geometry fact ties the two sands, so a re-resolve
    (what a bodies/recompute runs) keeps them one body ONLY because it reads the
    union again. A union that did not survive re-resolve would silently un-merge.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert resp.status_code == 201, resp.text

    # Re-resolve as the recompute would, then confirm the merge persists.
    await ResolveLithoInstances(db_session).execute(model_id=lm, commit=True)
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id == right[0].body_id, "the union must survive a re-resolve"


@pytest.mark.asyncio
async def test_uni3_disjoin_restores_two_bodies(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI3 — deleting the union (Disjoin) splits the merged body back into two.

    Lifting the must-link lets the resolver fall back to geometry/edges — and
    there are none between the two sands — so they return to two bodies.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])

    created = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert created.status_code == 201, created.text
    union_id = created.json()["union_id"]

    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id == right[0].body_id, "precondition: joined"

    disjoin = await async_client.delete(
        f"/projects/{pid}/geology/models/{lm}/body-unions/{union_id}"
    )
    assert disjoin.status_code == 200, disjoin.text

    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id != right[0].body_id, "Disjoin must split the two bodies again"


@pytest.mark.asyncio
async def test_uni4_create_is_idempotent_and_order_independent(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI4 — re-asserting a union returns the existing row, 200 not 409.

    The verb is reversible, so a duplicate create is not a conflict: the first
    POST is 201 ``was_created=True``, and re-POSTing the same pair — in EITHER
    order, since the endpoint canonicalises — is 200 ``was_created=False`` with
    the SAME union id, and only one row exists.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    a, b = str(left[0].id), str(right[0].id)
    url = f"/projects/{pid}/geology/models/{lm}/body-unions"

    first = await async_client.post(url, json={"layer_a_id": a, "layer_b_id": b})
    assert first.status_code == 201, first.text
    assert first.json()["was_created"] is True
    union_id = first.json()["union_id"]

    again = await async_client.post(url, json={"layer_a_id": a, "layer_b_id": b})
    assert again.status_code == 200, again.text
    assert again.json()["was_created"] is False
    assert again.json()["union_id"] == union_id, "the existing row must be returned"

    reversed_order = await async_client.post(url, json={"layer_a_id": b, "layer_b_id": a})
    assert reversed_order.status_code == 200, reversed_order.text
    assert reversed_order.json()["union_id"] == union_id

    listing = await async_client.get(url)
    assert listing.status_code == 200, listing.text
    assert len(listing.json()) == 1, "an idempotent re-create must not add a second row"


@pytest.mark.asyncio
async def test_uni5_cross_class_join_is_refused_naming_both_classes(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI5 — a join across two packing classes is refused 422, never a mixed body.

    On the geotech model each column is a LOOSE band over a DENSE band. Joining
    the loose and the dense band of one column is a cross-class merge — refused
    422 with ``body_union_cross_class`` naming both NAD classes, so the router
    never writes a union the resolver would only mark inert.
    """
    pid = str(uni_scene["project"].id)
    gm = uni_scene["geotech_model_id"]
    col = await _bands(db_session, gm, uni_scene["cpt_a_id"])
    assert len(col) >= 2, "the subdivide should give a loose band over a dense band"
    loose, dense = col[0], col[1]

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{gm}/body-unions",
        json={"layer_a_id": str(loose.id), "layer_b_id": str(dense.id)},
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "body_union_cross_class"


@pytest.mark.skip(
    reason="separations dormant (owner 2026-09-01) — a join of a separated pair now "
    "MERGES; pins removed cannot-link behaviour. Live merge covered by UNI1-5. "
    "Delete in the body_separation-removal slice."
)
@pytest.mark.asyncio
async def test_uni6_join_contradicting_a_separation_is_refused(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI6 — cannot-link wins: a join of a separated pair is refused 422.

    First separate the two sand bodies (a standing "these are NOT the same body"),
    then ask to join the same pair. The router refuses 422 with
    ``body_union_contradicts_separation``, naming the separation — the engineer's
    subtractive ruling is never silently overruled by an additive one.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    a, b = str(left[0].id), str(right[0].id)

    sep = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": a, "layer_b_id": b},
    )
    assert sep.status_code == 201, sep.text
    sep_id = sep.json()["separation_id"]

    join = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": a, "layer_b_id": b},
    )
    assert join.status_code == 422, join.text
    detail = join.json()["detail"]
    assert detail["code"] == "body_union_contradicts_separation"
    assert sep_id in str(detail), "the 422 must name the standing separation"

    # And no union row was written.
    count = (
        await db_session.execute(
            select(func.count()).select_from(BodyUnionOrm).where(BodyUnionOrm.model_id == lm)
        )
    ).scalar_one()
    assert count == 0, "a refused contradiction must not persist a union"


@pytest.mark.skip(
    reason="separations dormant (owner 2026-09-01) — a restored union no longer "
    "suppresses; pins removed cannot-link behaviour. Delete in the "
    "body_separation-removal slice."
)
@pytest.mark.asyncio
async def test_uni7_a_contradicting_union_via_restore_is_suppressed(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI7 — a union that contradicts a separation, arriving in a bundle, is suppressed.

    The API refuses a contradicting join at write time, but a hand-crafted /
    older bundle could still carry one. Restore must NOT fail over it: the
    resolver keeps the separation intact (cannot-link wins) and the two bodies
    stay split, the union silently suppressed.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    a_id, b_id = left[0].id, right[0].id

    # Separate the two bodies, so a restore must honour the separation.
    sep = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": str(a_id), "layer_b_id": str(b_id)},
    )
    assert sep.status_code == 201, sep.text

    bundle_resp = await async_client.get(f"/projects/{pid}/bundle")
    assert bundle_resp.status_code == 200, bundle_resp.text
    bundle = bundle_resp.json()
    assert len(bundle["body_separations"]) == 1

    # Inject a CONTRADICTING union on the same canonical pair (an artefact the
    # write path would refuse but a bundle can still carry).
    ca, cb = (a_id, b_id) if str(a_id) < str(b_id) else (b_id, a_id)
    bundle["body_unions"].append(
        {"id": str(uuid7()), "model_id": lm, "layer_a_id": str(ca), "layer_b_id": str(cb)}
    )

    project = await db_session.get(ProjectOrm, uni_scene["project"].id)
    assert project is not None
    await db_session.delete(project)
    await db_session.commit()

    restore_resp = await async_client.post(f"/projects/{pid}/restore", json=bundle)
    assert restore_resp.status_code == 200, f"restore must not fail over it: {restore_resp.text}"

    # The separation stands and the two bodies stay split — cannot-link won.
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id != right[0].body_id, (
        "the restored separation must win over the contradicting union"
    )


@pytest.mark.asyncio
async def test_uni8_join_survives_a_re_subdivide(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI8 — a geotech join is re-anchored across a full re-subdivide.

    On the geotech model the two LOOSE bands are joined into one body. A
    re-subdivide wipes every geotech band (fresh ids) and its CASCADE would eat
    the union — but the re-anchor captures it before the wipe and re-creates it
    against the rebuilt bands, so the two loose bands stay merged and the Disjoin
    listing still names both sides.
    """
    pid = str(uni_scene["project"].id)
    gm = uni_scene["geotech_model_id"]
    left = await _bands(db_session, gm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, gm, uni_scene["cpt_b_id"])
    assert left and right, "the subdivide produced no geotech bands"
    assert left[0].body_id != right[0].body_id, "the loose bands should start untied"

    join = await async_client.post(
        f"/projects/{pid}/geology/models/{gm}/body-unions",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert join.status_code == 201, join.text
    left = await _bands(db_session, gm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, gm, uni_scene["cpt_b_id"])
    assert left[0].body_id == right[0].body_id, "the union should merge the loose bands"

    # Full re-subdivide — wipes and rebuilds every geotech band with fresh ids.
    await SubdivideAllBodies(db_session).execute(
        project_id=uni_scene["project"].id, litho_model_id=uni_scene["litho_model_id"]
    )
    await db_session.commit()

    listing = await async_client.get(f"/projects/{pid}/geology/models/{gm}/body-unions")
    assert listing.status_code == 200, listing.text
    items = listing.json()
    assert len(items) == 1, f"the union should survive the re-subdivide: {items}"

    left = await _bands(db_session, gm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, gm, uni_scene["cpt_b_id"])
    assert left[0].body_id is not None
    assert left[0].body_id == right[0].body_id, "the rebuilt loose bands must stay merged"


@pytest.mark.asyncio
async def test_uni9_join_survives_a_bundle_save_restore(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI9 — a union survives a bundle save → restore → reconcile round trip.

    "Permanent" means across a reopen: save the bundle, wipe the project, restore
    it (the /restore route reconciles). The union row comes back and the
    post-restore resolver honours it, so the two bodies stay ONE — a restore that
    lost the union would silently split the bodies the engineer joined.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])

    created = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert created.status_code == 201, created.text
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id == right[0].body_id, "precondition: joined in the source project"

    bundle_resp = await async_client.get(f"/projects/{pid}/bundle")
    assert bundle_resp.status_code == 200, bundle_resp.text
    bundle = bundle_resp.json()
    assert len(bundle["body_unions"]) == 1, "the bundle must carry the union"

    project = await db_session.get(ProjectOrm, uni_scene["project"].id)
    assert project is not None
    await db_session.delete(project)
    await db_session.commit()

    restore_resp = await async_client.post(f"/projects/{pid}/restore", json=bundle)
    assert restore_resp.status_code == 200, restore_resp.text

    union_count = (
        await db_session.execute(
            select(func.count()).select_from(BodyUnionOrm).where(BodyUnionOrm.model_id == lm)
        )
    ).scalar_one()
    assert union_count == 1, "the union must restore with the bundle"

    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id == right[0].body_id, (
        "the restored union must keep the two bodies merged — the ruling is permanent"
    )


@pytest.mark.asyncio
async def test_uni10_endpoints_are_scoped_to_the_project_and_model(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI10 — a caller cannot reach a model / union outside its scope.

    The by-id IDOR shape: putting a valid model id under the WRONG project id
    404s (POST and DELETE), an anchor from another MODEL is rejected 422, and a
    union id addressed via the wrong model 404s on DELETE.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    gm = uni_scene["geotech_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    a, b = str(left[0].id), str(right[0].id)

    other_pid = str(uuid7())
    cross_post = await async_client.post(
        f"/projects/{other_pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": a, "layer_b_id": b},
    )
    assert cross_post.status_code == 404, cross_post.text
    cross_delete = await async_client.delete(
        f"/projects/{other_pid}/geology/models/{lm}/body-unions/{uuid7()}"
    )
    assert cross_delete.status_code == 404, cross_delete.text

    # Cross-model on POST: geotech-band anchors are not accepted layers of the
    # LITHO model → 422 (the anchor-validation guard).
    geo = await _bands(db_session, gm, uni_scene["cpt_a_id"])
    geo_b = await _bands(db_session, gm, uni_scene["cpt_b_id"])
    cross_model_post = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": str(geo[0].id), "layer_b_id": str(geo_b[0].id)},
    )
    assert cross_model_post.status_code == 422, cross_model_post.text

    # Cross-model on DELETE: a union created on the litho model cannot be deleted
    # through the geotech model's URL → 404 (scope mismatch).
    created = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": a, "layer_b_id": b},
    )
    assert created.status_code == 201, created.text
    union_id = created.json()["union_id"]
    wrong_model_delete = await async_client.delete(
        f"/projects/{pid}/geology/models/{gm}/body-unions/{union_id}"
    )
    assert wrong_model_delete.status_code == 404, wrong_model_delete.text


@pytest.mark.skip(
    reason="separations dormant (owner 2026-09-01) — the resolver no longer "
    "suppresses a union, so `suppressed` is permanently False. Delete in the "
    "body_separation-removal slice."
)
@pytest.mark.asyncio
async def test_uni11_a_suppressed_join_says_so_in_the_response(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI11 — a join the resolver SUPPRESSES is reported, not silently no-op'd.

    The write-time contradiction guard normally refuses a join of a separated
    pair 422 (UNI6), because it reads the two anchors' current bodies. Its ONE
    blind spot is an anchor whose ``body_id`` is not stamped when the guard runs
    (freshly accepted, or mid-rebuild): the guard skips, the row is written, and
    the in-request resolve is the only thing that catches the standing separation.

    This pins the backstop: with a separation standing and one anchor's body_id
    NULL, the POST is 201 ``was_created: true`` but the resolver suppresses the
    join (cannot-link wins), and the response says ``suppressed: true`` instead of
    a misleading ``bodies_changed: 0`` with only a server-side WARNING. The two
    bodies stay split.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    a_id, b_id = left[0].id, right[0].id

    # Stand a separation between the two sand bodies (they are already two bodies,
    # so this is a no-op split — but the ruling row now exists and stands).
    sep = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-separations",
        json={"layer_a_id": str(a_id), "layer_b_id": str(b_id)},
    )
    assert sep.status_code == 201, sep.text

    # Blind the write-time contradiction guard: NULL one anchor's body_id, as a
    # freshly-accepted / mid-rebuild layer would read. The separation row is
    # unaffected (it keys on the layer ids, not body_id), so the resolve still
    # honours it.
    await db_session.execute(
        update(LithoLayerOrm).where(LithoLayerOrm.id == a_id).values(body_id=None)
    )
    await db_session.commit()

    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": str(a_id), "layer_b_id": str(b_id)},
    )
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["was_created"] is True
    assert payload["suppressed"] is True, "a join a separation overruled must say suppressed"
    assert payload["inert"] is False
    assert payload["bodies_changed"] == 0

    # And the resolver honoured the separation: the two bodies stayed apart.
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left[0].body_id is not None and right[0].body_id is not None
    assert left[0].body_id != right[0].body_id, "cannot-link won — the join did nothing"


async def _seed_solid(session: AsyncSession, model_id: str, formation_id) -> object:
    """Insert a fresh, NON-stale cached solid for a model and return its id.

    ``body_id`` is deliberately a synthesized uuid (the column is NOT an FK — the
    voxel build stores geology-split bodies under ids with no ``body`` row), so a
    solid can be seeded without a matching body. Everything else is a minimal valid
    cache row: empty geometry, zero pick count, empty checksum, ``is_stale=False``.
    """
    solid_id = uuid7()
    session.add(
        LithoBodySolidOrm(
            id=solid_id,
            model_id=model_id,
            body_id=uuid7(),
            formation_id=formation_id,
            vertices=[],
            triangles=[],
            source_pick_count=0,
            source_pick_checksum=b"",
            is_stale=False,
        )
    )
    await session.commit()
    return solid_id


async def _solid_is_stale(session: AsyncSession, solid_id) -> bool:
    """Read one cached solid's ``is_stale`` with a fresh column select.

    A COLUMN select (not a cached ORM instance) so the value reflects whatever the
    app's separate session committed, under READ COMMITTED.
    """
    return (
        await session.execute(
            select(LithoBodySolidOrm.is_stale).where(LithoBodySolidOrm.id == solid_id)
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_uni12_a_join_does_not_stale_the_solids_but_the_default_resolve_does(
    db_session: AsyncSession, uni_scene: dict, async_client: AsyncClient
) -> None:
    """UNI12 — a Join leaves the 3-D solids CURRENT; the default resolve still stales.

    D3 (owner 2026-09-01: *"the geotech model is stale but it doesn't have to be
    stale ... we only grouped two units together"*). A Join changes body IDENTITY,
    not the voxel geometry or any voxel's packing class, so the cached solids stay
    valid and forcing a rebuild is wrong. The endpoint therefore resolves with
    ``stale_solids=False``.

    The pin holds the OPERATION constant — a body-membership re-stamp — and varies
    only the flag: the Join (endpoint, ``stale_solids=False``) does NOT stale, while
    the SAME re-stamp through the default resolve path (what a subdivide / litho
    edit runs) DOES. That proves the flag is what suppresses the stale, not that
    staling has been removed.
    """
    pid = str(uni_scene["project"].id)
    lm = uni_scene["litho_model_id"]
    left = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    formation_id = (
        await db_session.execute(
            select(LithoLayerOrm.formation_id).where(LithoLayerOrm.id == left[0].id)
        )
    ).scalar_one()

    # A current cached solid for this model — the state the owner sees before a Join.
    solid_id = await _seed_solid(db_session, lm, formation_id)
    assert await _solid_is_stale(db_session, solid_id) is False

    # The Join re-stamps body_id (a real membership change → n_stamped > 0), but the
    # endpoint resolves with stale_solids=False, so the solid stays CURRENT.
    resp = await async_client.post(
        f"/projects/{pid}/geology/models/{lm}/body-unions",
        json={"layer_a_id": str(left[0].id), "layer_b_id": str(right[0].id)},
    )
    assert resp.status_code == 201, resp.text
    left2 = await _bands(db_session, lm, uni_scene["cpt_a_id"])
    right2 = await _bands(db_session, lm, uni_scene["cpt_b_id"])
    assert left2[0].body_id == right2[0].body_id, "the join must merge (a real re-stamp)"
    assert await _solid_is_stale(db_session, solid_id) is False, (
        "a Join is identity-only — it must NOT stale the 3-D solids"
    )

    # Now the SAME kind of re-stamp through the DEFAULT resolve path: delete the
    # union and re-resolve with stale_solids left at its True default (what a
    # subdivide / litho edit runs). The re-split re-stamps body_id again — and this
    # time the solid MUST stale.
    union = (
        await db_session.execute(select(BodyUnionOrm).where(BodyUnionOrm.model_id == lm))
    ).scalar_one()
    await db_session.delete(union)
    await db_session.flush()
    await ResolveLithoInstances(db_session).execute(model_id=lm, commit=True)
    assert await _solid_is_stale(db_session, solid_id) is True, (
        "the default resolve path (subdivide / litho edit) must still stale the solids"
    )
