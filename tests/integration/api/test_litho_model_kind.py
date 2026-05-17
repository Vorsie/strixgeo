"""HTTP-level tests for the three-level model `kind` (litho slice 1).

Pins the slice-1 correctness landmines the system-architect flagged:
the creation parent-invariant (422), the per-kind ``is_active``
scoping (activating a litho model must NOT deactivate the geological
model the section editor references), the crossing-validator skip for
non-geological kinds, and the parent-delete 409. CRUD basics are
covered elsewhere; this only asserts what `kind` adds.
"""

from __future__ import annotations

from uuid import uuid4

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for model-kind tests."""
    proj = ProjectOrm(id=uuid7(), name="litho kind test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


async def _create_model(
    client: AsyncClient,
    project_id,  # noqa: ANN001
    *,
    name: str = "M",
    kind: str = "geological",
    parent_id: str | None = None,
    is_active: bool = False,
) -> dict:
    """POST a model; return the JSON body (asserts 201)."""
    body: dict = {"name": name, "kind": kind, "is_active": is_active}
    if parent_id is not None:
        body["parent_geological_model_id"] = parent_id
    resp = await client.post(f"/projects/{project_id}/geology/models", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_litho_model_requires_a_parent(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """A lithostratigraphic model without a parent is a 422."""
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={"name": "L", "kind": "lithostratigraphic"},
    )
    assert resp.status_code == 422
    assert "parent_geological_model_id" in resp.text


async def test_geological_model_rejects_a_parent(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """A geological model given a parent is a 422 (it is the backbone)."""
    geo = await _create_model(async_client, project.id)
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "G2",
            "kind": "geological",
            "parent_geological_model_id": geo["id"],
        },
    )
    assert resp.status_code == 422


async def test_litho_model_with_geological_parent_ok(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Litho with a valid geological parent → 201 and echoes kind/parent."""
    geo = await _create_model(async_client, project.id)
    litho = await _create_model(
        async_client,
        project.id,
        name="L",
        kind="lithostratigraphic",
        parent_id=geo["id"],
    )
    assert litho["kind"] == "lithostratigraphic"
    assert litho["parent_geological_model_id"] == geo["id"]


async def test_litho_parent_must_be_geological_kind(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Litho whose parent is itself a litho model → 422 (wrong parent kind)."""
    geo = await _create_model(async_client, project.id)
    litho = await _create_model(
        async_client, project.id, kind="lithostratigraphic", parent_id=geo["id"]
    )
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "L2",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": litho["id"],
        },
    )
    assert resp.status_code == 422


async def test_geotechnical_requires_lithostratigraphic_parent(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Geotech parent must be a litho model, not a geological one."""
    geo = await _create_model(async_client, project.id)
    bad = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "GT",
            "kind": "geotechnical",
            "parent_geological_model_id": geo["id"],
        },
    )
    assert bad.status_code == 422

    litho = await _create_model(
        async_client, project.id, kind="lithostratigraphic", parent_id=geo["id"]
    )
    gt = await _create_model(
        async_client,
        project.id,
        name="GT",
        kind="geotechnical",
        parent_id=litho["id"],
    )
    assert gt["kind"] == "geotechnical"


async def test_unknown_parent_id_is_422(async_client: AsyncClient, project: ProjectOrm) -> None:
    """A litho model pointing at a non-existent parent → 422."""
    resp = await async_client.post(
        f"/projects/{project.id}/geology/models",
        json={
            "name": "L",
            "kind": "lithostratigraphic",
            "parent_geological_model_id": str(uuid4()),
        },
    )
    assert resp.status_code == 422


async def test_activate_is_scoped_per_kind(async_client: AsyncClient, project: ProjectOrm) -> None:
    """THE LANDMINE: activating a litho model must NOT deactivate the
    geological model the section editor references. Each kind keeps its
    own active pointer."""
    geo = await _create_model(async_client, project.id, name="G", is_active=True)
    litho = await _create_model(
        async_client,
        project.id,
        name="L",
        kind="lithostratigraphic",
        parent_id=geo["id"],
    )
    # Activate the litho model.
    act = await async_client.post(f"/projects/{project.id}/geology/models/{litho['id']}/activate")
    assert act.status_code == 200

    models = (await async_client.get(f"/projects/{project.id}/geology/models")).json()
    by_id = {m["id"]: m for m in models}
    # Both stay active — different kinds, independent active pointers.
    assert by_id[geo["id"]]["is_active"] is True
    assert by_id[litho["id"]]["is_active"] is True


async def test_second_geological_activate_clears_first(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Same-kind scoping still works: a 2nd geological activate clears the 1st."""
    g1 = await _create_model(async_client, project.id, name="G1", is_active=True)
    g2 = await _create_model(async_client, project.id, name="G2")
    await async_client.post(f"/projects/{project.id}/geology/models/{g2['id']}/activate")
    models = (await async_client.get(f"/projects/{project.id}/geology/models")).json()
    by_id = {m["id"]: m for m in models}
    assert by_id[g1["id"]]["is_active"] is False
    assert by_id[g2["id"]]["is_active"] is True


async def test_crossings_skipped_for_lithostratigraphic(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """The crossing validator returns an empty list for a litho model
    (interfingering is real geology, not a superposition error)."""
    geo = await _create_model(async_client, project.id)
    litho = await _create_model(
        async_client,
        project.id,
        kind="lithostratigraphic",
        parent_id=geo["id"],
    )
    resp = await async_client.get(
        f"/projects/{project.id}/geology/models/{litho['id']}/validate/crossings"
    )
    assert resp.status_code == 200
    assert resp.json()["issues"] == []


async def test_delete_parent_blocked_by_child_then_allowed(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Deleting a geological model with a litho child → 409; deleting
    the child first then the parent → 204."""
    geo = await _create_model(async_client, project.id)
    litho = await _create_model(
        async_client,
        project.id,
        kind="lithostratigraphic",
        parent_id=geo["id"],
    )
    blocked = await async_client.delete(f"/projects/{project.id}/geology/models/{geo['id']}")
    assert blocked.status_code == 409

    ok_child = await async_client.delete(f"/projects/{project.id}/geology/models/{litho['id']}")
    assert ok_child.status_code == 204

    ok_parent = await async_client.delete(f"/projects/{project.id}/geology/models/{geo['id']}")
    assert ok_parent.status_code == 204


async def test_formation_carries_lithology_and_nad_class(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Formation create/response round-trips the new litho/geotech fields."""
    resp = await async_client.post(
        f"/projects/{project.id}/geology/formations",
        json={"name": "Sand unit", "lithology": "ZAND", "nad_class": 7},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["lithology"] == "ZAND"
    assert body["nad_class"] == 7

    # Default-null when omitted (geological-model formation).
    bare = await async_client.post(
        f"/projects/{project.id}/geology/formations",
        json={"name": "Boom Klei"},
    )
    assert bare.status_code == 201
    assert bare.json()["lithology"] is None
    assert bare.json()["nad_class"] is None


async def test_codelist_lithostratigraphic(async_client: AsyncClient, project: ProjectOrm) -> None:
    """Litho codelist → 5 base lithologies + admixtures, no NAD classes."""
    resp = await async_client.get(
        f"/projects/{project.id}/geology/formations/codelist",
        params={"kind": "lithostratigraphic"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body["lithologies"]) == {"GRIND", "ZAND", "SILT", "KLEI", "VEEN"}
    assert body["lithology_labels"]["ZAND"] == "Sand"
    assert body["admixtures"]
    assert body["nad_classes"] == []


async def test_codelist_geotechnical_has_31_nad_classes(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """Geotech codelist → all 31 NAD classes, keyed 1..31."""
    resp = await async_client.get(
        f"/projects/{project.id}/geology/formations/codelist",
        params={"kind": "geotechnical"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["nad_classes"]) == 31
    nums = sorted(c["nad_class"] for c in body["nad_classes"])
    assert nums == list(range(1, 32))
    sand7 = next(c for c in body["nad_classes"] if c["nad_class"] == 7)
    assert sand7["base_lithology"] == "ZAND"
    assert body["admixtures"] == []


async def test_codelist_geological_is_empty(async_client: AsyncClient, project: ProjectOrm) -> None:
    """Geological codelist → empty (free / G3Dv3-seeded names)."""
    resp = await async_client.get(
        f"/projects/{project.id}/geology/formations/codelist",
        params={"kind": "geological"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["lithologies"] == []
    assert body["nad_classes"] == []


async def test_codelist_rejects_unknown_kind(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """An unknown kind is a 422 (Literal-validated query param)."""
    resp = await async_client.get(
        f"/projects/{project.id}/geology/formations/codelist",
        params={"kind": "nonsense"},
    )
    assert resp.status_code == 422


async def test_codelist_route_not_shadowed_by_dynamic_formation_route(
    async_client: AsyncClient, project: ProjectOrm
) -> None:
    """`/formations/codelist` resolves to the codelist, not a
    `/formations/{id}` lookup (static-before-dynamic ordering)."""
    resp = await async_client.get(
        f"/projects/{project.id}/geology/formations/codelist",
        params={"kind": "lithostratigraphic"},
    )
    assert resp.status_code == 200
    assert "lithologies" in resp.json()
