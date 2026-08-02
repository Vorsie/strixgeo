"""HTTP-integration tests for the stratigraphy-lumping persistence surface.

The lumping map (built by "Fill from boreholes → Apply") had no database
home: it lived only in renderer ``useState`` and reached disk exclusively
through ``buildProjectFile`` at File → Save time, so a crash before the
save lost it permanently.

These tests pin the two-stage save model the columns implement:

* ``PUT .../stratigraphy-lumping/staged`` writes ``staged`` IMMEDIATELY
  and must NOT touch ``saved`` — staged ≠ saved is precisely the dirty
  signal the renderer already derives in memory.
* ``POST .../stratigraphy-lumping/promote`` is what File → Save calls;
  it copies ``staged`` onto ``saved`` and leaves ``staged`` alone.

Both slots ride on ``GET /projects/{id}`` so the renderer can seed its
two in-memory slots on open.

Two further contracts are pinned here:

* ``stratigraphy_lumping_revision`` — the renderer-owned monotonic counter
  crash recovery compares instead of wall-clocks (see
  ``docs/design/autosave-recovery.md`` §3). Lower than stored ⇒ 409; equal
  ⇒ accepted (idempotent retry); absent ⇒ the stored counter is untouched.
* The lumping slots are **pass-through** on read. ``GET /projects/`` is a
  list, so a validated response type would let one poisoned row 500 the
  whole start screen — the last test in this module pins that it does not.
"""

from __future__ import annotations

from typing import Any

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# A realistic (if small) map — the owner's live project carries 13 entries.
LUMPING_A: dict[str, Any] = {
    "schema_version": 1,
    "applied_at": "2026-08-02T09:15:00Z",
    "map": {"zand van brasschaat": "Lid van Brasschaat", "klei van boom": "Formatie van Boom"},
}

LUMPING_B: dict[str, Any] = {
    "schema_version": 1,
    "applied_at": "2026-08-02T11:42:00Z",
    "map": {"zand van brasschaat": "Lid van Brasschaat"},
}

# "The user ran Fill from boreholes and grouped nothing" — a real applied
# snapshot that happens to be empty. NOT the same state as NULL.
LUMPING_EMPTY: dict[str, Any] = {
    "schema_version": 1,
    "applied_at": "2026-08-02T12:00:00Z",
    "map": {},
}


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """Create one bare project to hang the lumping slots off."""
    row = ProjectOrm(id=uuid7(), name="Lumping project", status="active")
    db_session.add(row)
    await db_session.commit()
    return row


# ---------------------------------------------------------------------------
# GET /projects/{id} — both slots exposed
# ---------------------------------------------------------------------------


async def test_project_response_exposes_both_lumping_slots_null_by_default(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """A fresh project reports NULL for both slots.

    NULL means "no lumping map at all", which is distinct from an empty
    map (a map the user applied that happens to group nothing).
    """
    resp = await async_client.get(f"/projects/{project.id}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["stratigraphy_lumping_staged"] is None
    assert body["stratigraphy_lumping_saved"] is None


# ---------------------------------------------------------------------------
# PUT staged — durable on Apply, saved untouched
# ---------------------------------------------------------------------------


async def test_put_staged_persists_immediately_and_leaves_saved_null(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """Apply writes staged now; saved stays NULL until File → Save runs.

    This is the crash-safety guarantee: the map survives a kill between
    Apply and Save, and the project still reads as dirty.
    """
    put = await async_client.put(
        f"/projects/{project.id}/stratigraphy-lumping/staged",
        json={"lumping": LUMPING_A},
    )
    assert put.status_code == 200
    assert put.json()["stratigraphy_lumping_staged"]["map"] == LUMPING_A["map"]
    assert put.json()["stratigraphy_lumping_saved"] is None

    # Read back through a separate request — proves it is in the DB, not
    # just echoed from the request body.
    read_back = await async_client.get(f"/projects/{project.id}")
    assert read_back.status_code == 200
    assert read_back.json()["stratigraphy_lumping_staged"] == LUMPING_A
    assert read_back.json()["stratigraphy_lumping_saved"] is None


async def test_put_staged_replaces_the_whole_snapshot(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """A second Apply replaces the map wholesale — no merge of old keys.

    The lumping map is one atomic snapshot stamped with its own
    ``applied_at``; merging two Applies would produce a map that was
    never applied at any single moment.
    """
    url = f"/projects/{project.id}/stratigraphy-lumping/staged"
    await async_client.put(url, json={"lumping": LUMPING_A})
    second = await async_client.put(url, json={"lumping": LUMPING_B})

    assert second.status_code == 200
    staged = second.json()["stratigraphy_lumping_staged"]
    assert staged == LUMPING_B
    assert "klei van boom" not in staged["map"]


async def test_put_staged_null_clears_the_slot(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """Sending ``null`` returns the slot to "no lumping map"."""
    url = f"/projects/{project.id}/stratigraphy-lumping/staged"
    await async_client.put(url, json={"lumping": LUMPING_A})

    cleared = await async_client.put(url, json={"lumping": None})
    assert cleared.status_code == 200
    assert cleared.json()["stratigraphy_lumping_staged"] is None


async def test_put_staged_empty_map_is_not_null_and_still_clearable(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """An applied-but-empty map round-trips as a dict, never as NULL.

    "The user ran Fill from boreholes and grouped nothing" is a real,
    deliberate state; "this project has no lumping map" is a different
    one. Collapsing the first into the second would make the renderer
    re-offer Fill as if it had never run. Clearing afterwards is the only
    way back to NULL.
    """
    url = f"/projects/{project.id}/stratigraphy-lumping/staged"
    put = await async_client.put(url, json={"lumping": LUMPING_EMPTY})
    assert put.status_code == 200

    read_back = (await async_client.get(f"/projects/{project.id}")).json()
    staged = read_back["stratigraphy_lumping_staged"]
    assert staged is not None
    assert isinstance(staged, dict)
    assert staged["map"] == {}
    assert staged == LUMPING_EMPTY

    cleared = await async_client.put(url, json={"lumping": None})
    assert cleared.status_code == 200
    assert cleared.json()["stratigraphy_lumping_staged"] is None
    after = (await async_client.get(f"/projects/{project.id}")).json()
    assert after["stratigraphy_lumping_staged"] is None


# ---------------------------------------------------------------------------
# Revision — the crash-recovery reconciliation counter
# ---------------------------------------------------------------------------


async def test_put_staged_round_trips_the_revision(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """The staged revision is stored and exposed on every project read.

    Crash recovery compares this number against the one in the recovery
    file (docs/design/autosave-recovery.md §3 — revision wins, never the
    clock), so it has to survive the round-trip verbatim.
    """
    put = await async_client.put(
        f"/projects/{project.id}/stratigraphy-lumping/staged",
        json={"lumping": LUMPING_A, "revision": 5},
    )
    assert put.status_code == 200
    assert put.json()["stratigraphy_lumping_revision"] == 5

    read_back = (await async_client.get(f"/projects/{project.id}")).json()
    assert read_back["stratigraphy_lumping_revision"] == 5


async def test_put_staged_rejects_an_older_revision_and_keeps_the_map(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """A stale writer is refused with 409 and changes nothing.

    Only a stale writer can send a lower revision — a resurrected debounce
    timer, or a recovered session replaying a snapshot the user has since
    moved past. Accepting it would silently roll the map back.
    """
    url = f"/projects/{project.id}/stratigraphy-lumping/staged"
    await async_client.put(url, json={"lumping": LUMPING_A, "revision": 5})

    stale = await async_client.put(url, json={"lumping": LUMPING_B, "revision": 3})
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert "3" in detail and "5" in detail

    read_back = (await async_client.get(f"/projects/{project.id}")).json()
    assert read_back["stratigraphy_lumping_staged"] == LUMPING_A
    assert read_back["stratigraphy_lumping_revision"] == 5


async def test_put_staged_accepts_the_same_revision_again(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """Equal revisions are allowed — that is an idempotent retry.

    The renderer retries a failed PUT without incrementing; rejecting an
    equal revision would turn a dropped connection into a permanently
    unstaged map.
    """
    url = f"/projects/{project.id}/stratigraphy-lumping/staged"
    await async_client.put(url, json={"lumping": LUMPING_A, "revision": 5})

    retry = await async_client.put(url, json={"lumping": LUMPING_B, "revision": 5})
    assert retry.status_code == 200
    assert retry.json()["stratigraphy_lumping_staged"] == LUMPING_B
    assert retry.json()["stratigraphy_lumping_revision"] == 5


async def test_put_staged_without_revision_leaves_the_stored_counter_alone(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """A revision-less client still writes the map, counter untouched.

    ``revision`` is additive-optional: an older client that does not track
    it must not reset a counter a revision-aware client established.
    """
    url = f"/projects/{project.id}/stratigraphy-lumping/staged"
    await async_client.put(url, json={"lumping": LUMPING_A, "revision": 5})

    no_rev = await async_client.put(url, json={"lumping": LUMPING_B})
    assert no_rev.status_code == 200
    assert no_rev.json()["stratigraphy_lumping_staged"] == LUMPING_B
    assert no_rev.json()["stratigraphy_lumping_revision"] == 5


async def test_put_staged_unknown_project_returns_404(
    async_client: AsyncClient,
) -> None:
    """An unknown project id surfaces as 404, not 500."""
    resp = await async_client.put(
        f"/projects/{uuid7()}/stratigraphy-lumping/staged",
        json={"lumping": LUMPING_A},
    )
    assert resp.status_code == 404
    # Assert the body too: a status-only check passes just as happily on a
    # 404 raised somewhere else entirely (a mis-registered route prefix).
    assert resp.json()["detail"] == "Project not found"


# ---------------------------------------------------------------------------
# POST promote — File → Save
# ---------------------------------------------------------------------------


async def test_promote_copies_staged_onto_saved_and_leaves_staged_untouched(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """File → Save makes saved equal staged; staged keeps its value.

    Keeping staged means the next Apply still diffs against the same
    slot the renderer edits, so the dirty computation stays symmetric.
    """
    await async_client.put(
        f"/projects/{project.id}/stratigraphy-lumping/staged",
        json={"lumping": LUMPING_A},
    )

    promoted = await async_client.post(f"/projects/{project.id}/stratigraphy-lumping/promote")
    assert promoted.status_code == 200
    body = promoted.json()
    assert body["stratigraphy_lumping_saved"] == LUMPING_A
    assert body["stratigraphy_lumping_staged"] == LUMPING_A

    read_back = (await async_client.get(f"/projects/{project.id}")).json()
    assert read_back["stratigraphy_lumping_saved"] == LUMPING_A
    assert read_back["stratigraphy_lumping_staged"] == LUMPING_A


async def test_apply_after_save_makes_staged_diverge_from_saved(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """The dirty signal: a post-save Apply moves staged away from saved."""
    url = f"/projects/{project.id}/stratigraphy-lumping/staged"
    await async_client.put(url, json={"lumping": LUMPING_A})
    await async_client.post(f"/projects/{project.id}/stratigraphy-lumping/promote")

    await async_client.put(url, json={"lumping": LUMPING_B})

    body = (await async_client.get(f"/projects/{project.id}")).json()
    assert body["stratigraphy_lumping_staged"] == LUMPING_B
    assert body["stratigraphy_lumping_saved"] == LUMPING_A


async def test_promote_with_nothing_staged_is_a_no_op(
    async_client: AsyncClient,
    project: ProjectOrm,
) -> None:
    """Saving a project that never lumped leaves both slots NULL."""
    resp = await async_client.post(f"/projects/{project.id}/stratigraphy-lumping/promote")
    assert resp.status_code == 200
    assert resp.json()["stratigraphy_lumping_staged"] is None
    assert resp.json()["stratigraphy_lumping_saved"] is None


async def test_promote_unknown_project_returns_404(
    async_client: AsyncClient,
) -> None:
    """An unknown project id surfaces as 404, not 500."""
    resp = await async_client.post(f"/projects/{uuid7()}/stratigraphy-lumping/promote")
    assert resp.status_code == 404
    # Body asserted for the same reason as the PUT twin above.
    assert resp.json()["detail"] == "Project not found"


# ---------------------------------------------------------------------------
# The read path is pass-through — one bad row must not 500 the start screen
# ---------------------------------------------------------------------------


async def test_malformed_stored_lumping_does_not_break_the_project_list(
    async_client: AsyncClient,
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A poisoned lumping column passes through instead of 500ing the list.

    ``GET /projects/`` is a ``list[ProjectResponse]``, so if the response
    schema validated the stored snapshot, ONE row carrying a shape the
    schema rejects (an older `.strix` restore, a hand-edited column, a
    future schema_version) would raise ResponseValidationError and take
    down the whole start screen — every project, not just the bad one.

    Validation belongs on the write path; the read path is pass-through,
    exactly like ``view_state``. This test goes RED the moment the field is
    retyped back to ``StratigraphyLumping``.
    """
    # Deliberately missing every required field of the snapshot schema.
    poison: dict[str, Any] = {"garbage": True}
    project.stratigraphy_lumping_staged = poison
    db_session.add(project)
    await db_session.commit()

    listing = await async_client.get("/projects/")
    assert listing.status_code == 200

    rows = listing.json()
    match = [row for row in rows if row["id"] == str(project.id)]
    assert len(match) == 1
    # Verbatim pass-through — the API neither validates nor rewrites it.
    assert match[0]["stratigraphy_lumping_staged"] == poison
