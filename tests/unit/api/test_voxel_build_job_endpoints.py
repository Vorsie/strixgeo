"""The voxel-build background-job endpoints (debt #282), TestClient + a fake build.

Three routes are pinned here without a database, by replacing the DB-touching
build coroutine (``_run_voxel_build_job``) with a fake that emits scripted SSE
events and honours the cancel flag:

* ``POST .../litho-solids/build-voxel/jobs`` answers ``202 {job_id}`` immediately
  and refuses a second concurrent build for the same model with ``409``.
* ``GET  .../litho-solids/build-voxel/jobs/{job_id}`` streams the job's events as
  SSE (progress ticks, then the terminal ``done``).
* ``POST .../litho-solids/build-voxel/jobs/{job_id}/cancel`` sets the cancel flag,
  and the fake build then emits the terminal ``{"type":"error","code":
  "build_cancelled"}``.

The event ENVELOPE is asserted here — the shape the renderer's shared stream hook
consumes — not the real labelling (that is an integration test).

``TestClient`` is used as a CONTEXT MANAGER on purpose: the background build task
runs on the client's blocking portal loop, which only persists across several
requests while the client is entered. Without ``with`` each request spins up and
tears down its own portal, killing the task between the spawn and the stream.
The mounted app is a bare router (no lifespan), so entering the client does not
touch a database.
"""

from __future__ import annotations

import asyncio
import json
import threading
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from groundmodel.api.routers.geology import litho_solids
from groundmodel.application.job_registry import JobRegistry, get_job_registry
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.constants.model_kind import MODEL_KIND_GEOTECHNICAL

_PROJECT_ID = uuid4()
_MODEL_ID = uuid4()
_BASE = f"/projects/{_PROJECT_ID}/geology/models/{_MODEL_ID}/litho-solids/build-voxel"


def _payload() -> dict[str, Any]:
    """A minimal but valid VoxelBuildRequest body."""
    return {
        "sections": [
            {
                "start_x": 0.0,
                "start_y": 0.0,
                "end_x": 10.0,
                "end_y": 0.0,
                "columns": [
                    {"investigation_id": "A", "along_m": 0.0, "world_x": 0.0, "world_y": 0.0},
                    {"investigation_id": "B", "along_m": 10.0, "world_x": 10.0, "world_y": 0.0},
                ],
                "regions": [
                    {
                        "formation_id": "KLEI",
                        "body_id": "b1",
                        "polygon": [[0.0, 5.0], [1.0, 5.0], [1.0, 0.0], [0.0, 0.0]],
                        "gap_index": 0,
                    }
                ],
            }
        ],
        "grid_spacing_m": 2.0,
    }


def _fake_session() -> Any:
    """A session whose ``.get`` returns a model belonging to ``_PROJECT_ID``."""

    class _S:
        async def get(self, _cls: Any, _id: Any) -> Any:
            return SimpleNamespace(app_project_id=_PROJECT_ID, kind=MODEL_KIND_GEOTECHNICAL)

    return _S()


def _app(monkeypatch: pytest.MonkeyPatch, fake_job: Any) -> tuple[FastAPI, JobRegistry]:
    """Mount the litho-solids router with the DB + build coroutine faked out."""
    monkeypatch.setattr(litho_solids, "_run_voxel_build_job", fake_job)
    registry = JobRegistry()

    app = FastAPI()
    app.include_router(litho_solids.router, prefix="/projects/{project_id}/geology")
    app.dependency_overrides[get_session] = _fake_session
    app.dependency_overrides[get_job_registry] = lambda: registry
    return app, registry


def _sse_events(text: str) -> list[dict[str, Any]]:
    """Parse ``data: <json>`` SSE frames from a buffered stream body."""
    out: list[dict[str, Any]] = []
    for frame in text.split("\n\n"):
        for line in frame.split("\n"):
            if line.startswith("data: "):
                out.append(json.loads(line[len("data: ") :]))
    return out


def _release_all(registry: JobRegistry) -> None:
    """Set every registered job's cancel flag so a blocking fake finishes cleanly."""
    for entry in list(registry._jobs.values()):  # noqa: SLF001
        if entry.cancel_event is not None:
            entry.cancel_event.set()


# ---------------------------------------------------------------------------
# Spawn
# ---------------------------------------------------------------------------


def test_starting_a_build_answers_202_with_a_job_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """Starting a build returns immediately with a job id (the build runs in the background)."""

    async def fake_job(queue: Any, **_kwargs: Any) -> None:
        await queue.put({"type": "done", "bodies_built": 1, "solids": []})
        await queue.put(None)

    app, _registry = _app(monkeypatch, fake_job)
    with TestClient(app) as client:
        res = client.post(f"{_BASE}/jobs", json=_payload())
    assert res.status_code == 202
    body = res.json()
    assert "job_id" in body and body["job_id"]


def test_a_second_build_for_the_same_model_is_refused_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """While a build runs, a second build of the same model is refused with the running id."""

    async def blocking_job(queue: Any, *, cancel_event: threading.Event, **_kwargs: Any) -> None:
        await queue.put({"type": "progress", "phase": "label", "done": 0, "total": 1})
        while not cancel_event.is_set():
            await asyncio.sleep(0.005)
        await queue.put(None)

    app, registry = _app(monkeypatch, blocking_job)
    with TestClient(app) as client:
        first = client.post(f"{_BASE}/jobs", json=_payload())
        assert first.status_code == 202
        running_id = first.json()["job_id"]

        second = client.post(f"{_BASE}/jobs", json=_payload())
        assert second.status_code == 409
        detail = second.json()["detail"]
        assert detail["code"] == "voxel_build_already_running"
        assert detail["job_id"] == running_id

        _release_all(registry)  # let the blocking job finish before teardown


# ---------------------------------------------------------------------------
# Stream
# ---------------------------------------------------------------------------


def test_stream_delivers_progress_then_done(monkeypatch: pytest.MonkeyPatch) -> None:
    """The SSE stream carries progress ticks and the terminal done event."""

    async def fake_job(queue: Any, **_kwargs: Any) -> None:
        await queue.put({"type": "progress", "phase": "label", "done": 0, "total": 4})
        await queue.put({"type": "progress", "phase": "label", "done": 4, "total": 4})
        await queue.put({"type": "done", "bodies_built": 2, "solids": []})
        await queue.put(None)

    app, _registry = _app(monkeypatch, fake_job)
    with TestClient(app) as client:
        job_id = client.post(f"{_BASE}/jobs", json=_payload()).json()["job_id"]
        res = client.get(f"{_BASE}/jobs/{job_id}")
    assert res.status_code == 200
    events = _sse_events(res.text)
    assert {"type": "progress", "phase": "label", "done": 0, "total": 4} in events
    assert events[-1]["type"] == "done"
    assert events[-1]["bodies_built"] == 2


def test_stream_unknown_job_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """Streaming a job id that was never registered answers 404, not a hang."""

    async def fake_job(queue: Any, **_kwargs: Any) -> None:
        await queue.put(None)

    app, _registry = _app(monkeypatch, fake_job)
    with TestClient(app) as client:
        res = client.get(f"{_BASE}/jobs/{uuid4()}")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


def test_cancel_sets_the_flag_and_the_build_ends_cancelled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cancelling a running build makes it end with a build_cancelled error event."""

    async def cancellable_job(queue: Any, *, cancel_event: threading.Event, **_kwargs: Any) -> None:
        await queue.put({"type": "progress", "phase": "label", "done": 0, "total": 10})
        while not cancel_event.is_set():
            await asyncio.sleep(0.005)
        await queue.put({"type": "error", "code": "build_cancelled", "message": "Build cancelled"})
        await queue.put(None)

    app, _registry = _app(monkeypatch, cancellable_job)
    with TestClient(app) as client:
        job_id = client.post(f"{_BASE}/jobs", json=_payload()).json()["job_id"]

        cancel = client.post(f"{_BASE}/jobs/{job_id}/cancel")
        assert cancel.status_code == 202
        assert cancel.json()["cancelling"] is True

        events = _sse_events(client.get(f"{_BASE}/jobs/{job_id}").text)
    assert events[-1]["type"] == "error"
    assert events[-1]["code"] == "build_cancelled"


def test_cancel_unknown_job_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cancelling a job that does not exist answers 404 (best-effort, no crash)."""

    async def fake_job(queue: Any, **_kwargs: Any) -> None:
        await queue.put(None)

    app, _registry = _app(monkeypatch, fake_job)
    with TestClient(app) as client:
        res = client.post(f"{_BASE}/jobs/{uuid4()}/cancel")
    assert res.status_code == 404
