"""BP-5 — a replace-restore and a bodies/recompute must not deadlock.

The e2e sweep of 2026-09-03 (17:32) lost ``flow_boot_open`` and, downstream,
two accept specs to ``DeadlockDetectedError`` on ``POST .../restore?replace=true``
and ``POST .../bodies/recompute``:

    Process A waits for ShareLock on transaction B  (A = recompute: DELETE FROM
        body_geometry_fact WHERE model_id = …, blocked by B's freshly inserted
        rows)
    Process B waits for ExclusiveLock on advisory lock […]  (B = the restore,
        which inserted bodies + facts FIRST and only then, in
        ``reconcile_bodies_after_restore``, asked for the body-partition lock A
        already holds)

The rule every litho-row writer follows since BP-4 — take the body-partition
lock BEFORE the first write — was missing on the restore transaction. This test
runs (replace-restore ‖ recompute) for many rounds and fails on any 5xx.
"""

from __future__ import annotations

import asyncio

import pytest
from httpx import AsyncClient, Response

# The BP-2 scene (12 columns, SAND-over-CLAY) and its recompute payload are
# exactly what a restore ‖ recompute race needs; reuse them rather than copy.
from tests.integration.api.test_body_partition_litho_write_recompute_race import (  # noqa: F401
    _recompute_payload,
    _Scene,
    bp2_scene,
)

# Rounds of (replace-restore ‖ recompute). The sweep hit the deadlock on the
# first restore; a handful of rounds is ample and ~3 s of wall clock.
BP5_ROUNDS = 8


def _check(label: str, outcome: Response | BaseException, errors: list[str]) -> None:
    """Record a 5xx or a raised exception for ``label``."""
    if isinstance(outcome, BaseException):
        errors.append(f"{label}: raised {type(outcome).__name__}: {outcome}")
        return
    if outcome.status_code >= 500:
        errors.append(f"{label}: {outcome.status_code} {outcome.text[:300]}")


@pytest.mark.asyncio
async def test_bp5_a_replace_restore_and_a_recompute_never_500_on_the_same_project(
    async_client: AsyncClient,
    bp2_scene: _Scene,  # noqa: F811 — the imported fixture is injected by name
) -> None:
    """BP-5 — revert-to-last-save while the app's own recompute runs is never a 5xx.

    Either order is fine — the restore may wait for the recompute or the
    recompute may wait for the restore (a 409 from the lock's contention path
    is acceptable) — but a deadlock (500) means one of them wrote before it
    locked.
    """
    bundle = await async_client.get(f"/projects/{bp2_scene.project_id}/bundle")
    assert bundle.status_code == 200, bundle.text
    payload = bundle.json()

    restore_url = f"/projects/{bp2_scene.project_id}/restore?replace=true"
    recompute_url = (
        f"/projects/{bp2_scene.project_id}/geology/models/{bp2_scene.model_id}/bodies/recompute"
    )
    server_errors: list[str] = []
    for round_index in range(BP5_ROUNDS):
        group_size = 2 + (round_index % 3)
        restore_outcome, recompute_outcome = await asyncio.gather(
            async_client.post(restore_url, json=payload),
            async_client.post(recompute_url, json=_recompute_payload(bp2_scene, group_size)),
            return_exceptions=True,
        )
        _check(f"round {round_index} restore", restore_outcome, server_errors)
        _check(f"round {round_index} bodies/recompute", recompute_outcome, server_errors)

    assert not server_errors, (
        "BP-5 FAIL: a replace-restore and a bodies/recompute on the same project "
        "deadlocked — the restore wrote body rows before taking the body-partition "
        "lock the recompute already held:\n" + "\n".join(server_errors)
    )
