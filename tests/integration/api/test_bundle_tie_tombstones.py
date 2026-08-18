"""TS4 — tombstone coordinates in a restored bundle must be FINITE.

The tombstone matcher compares places numerically, so an ``Infinity``
coordinate is as corrupt as a NaN one: it can never match a real place, and a
half-infinite tombstone could sit in the table forever pretending to be
judgement. The restore validation rejected NaN (``v == v``) but let
``Infinity`` through (audit P3-10) — and Python's ``json`` module ACCEPTS the
non-standard ``Infinity`` token, so a hand-corrupted ``.strix`` genuinely
reaches this code with the value intact.

Run via ``scripts\\run-integration-tests.ps1`` ONLY.
"""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geotech_tie_tombstone_orm import (
    GeotechTieTombstoneOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration.api.test_recompute_bodies import _build_scene


def _tombstone_row(scene: object, **coords: float) -> dict[str, object]:
    """A bundle tombstone payload row with overridable coordinates."""
    base: dict[str, object] = {
        "id": str(uuid7()),
        "model_id": str(scene.model_id),  # type: ignore[attr-defined]
        "section_id": str(scene.section_id),  # type: ignore[attr-defined]
        "a_x": 1.0,
        "a_y": 2.0,
        "a_z": 3.0,
        "b_x": 4.0,
        "b_y": 5.0,
        "b_z": 6.0,
    }
    base.update(coords)
    return base


@pytest.mark.asyncio
async def test_ts4_an_infinite_coordinate_drops_the_tombstone_at_restore(
    db_session: AsyncSession, async_client: AsyncClient
) -> None:
    """TS4 — ±Infinity is corrupt like NaN; the finite sibling survives."""
    scene = await _build_scene(db_session)

    bundle_resp = await async_client.get(f"/projects/{scene.project_id}/bundle")
    assert bundle_resp.status_code == 200, bundle_resp.text
    bundle = bundle_resp.json()
    keeper = _tombstone_row(scene)
    bundle["geotech_tie_tombstones"] = [
        keeper,
        _tombstone_row(scene, a_x=float("inf")),
        _tombstone_row(scene, b_z=float("-inf")),
    ]

    project = await db_session.get(ProjectOrm, scene.project_id)
    assert project is not None
    await db_session.delete(project)
    await db_session.commit()

    # httpx's own encoder refuses non-finite floats, so serialise with the
    # stdlib (which happily emits the non-standard ``Infinity`` token — the
    # same permissiveness that lets a corrupt file reach the server, since
    # the stdlib parser on the receiving side accepts the token right back).
    body = json.dumps(bundle)
    restore_resp = await async_client.post(
        f"/projects/{scene.project_id}/restore",
        content=body,
        headers={"content-type": "application/json"},
    )
    assert restore_resp.status_code == 200, restore_resp.text

    db_session.expire_all()
    rows = list(
        (
            await db_session.execute(
                select(GeotechTieTombstoneOrm).where(
                    GeotechTieTombstoneOrm.model_id == scene.model_id
                )
            )
        ).scalars()
    )
    assert {str(r.id) for r in rows} == {keeper["id"]}, (
        "only the finite tombstone may survive the restore"
    )
