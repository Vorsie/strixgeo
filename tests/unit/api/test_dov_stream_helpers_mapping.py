"""The DOV import router glue maps the new refusals to stable codes.

These pin the ``detail.code`` values (and the running-job echo) the renderer
keys its EN/NL copy on, so a future refactor cannot silently rename them:

* ``dov_import_too_large`` — 422 (sync) / terminal SSE error event (stream).
* ``dov_import_already_running`` — 409 carrying the running ``job_id``.
"""

from __future__ import annotations

from uuid import uuid4

from groundmodel.api.routers._dov_stream_helpers import (
    DOV_IMPORT_ALREADY_RUNNING_CODE,
    DOV_IMPORT_TOO_LARGE_CODE,
    dov_import_job_key,
    dov_too_large_event,
    map_dov_too_large_error,
    map_duplicate_import_job,
)
from groundmodel.shared.exceptions import DovImportTooLargeError, DuplicateImportJobError


def test_too_large_maps_to_422_with_code() -> None:
    """The synchronous path answers 422 with the too-large code + message."""
    http_exc = map_dov_too_large_error(DovImportTooLargeError(discovered=3000, limit=2000))
    assert http_exc.status_code == 422
    assert http_exc.detail["code"] == DOV_IMPORT_TOO_LARGE_CODE
    assert "3000" in http_exc.detail["message"]
    assert "2000" in http_exc.detail["message"]


def test_too_large_event_is_terminal_error_with_code() -> None:
    """The stream path emits an error event carrying the same code."""
    event = dov_too_large_event(DovImportTooLargeError(discovered=3000, limit=2000))
    assert event["type"] == "error"
    assert event["code"] == DOV_IMPORT_TOO_LARGE_CODE
    assert "3000" in event["message"]


def test_duplicate_job_maps_to_409_echoing_job_id() -> None:
    """A duplicate scope answers 409 and echoes the running job's id."""
    running = uuid4()
    http_exc = map_duplicate_import_job(DuplicateImportJobError(running))
    assert http_exc.status_code == 409
    assert http_exc.detail["code"] == DOV_IMPORT_ALREADY_RUNNING_CODE
    assert http_exc.detail["job_id"] == str(running)


def test_job_key_folds_kind_bbox_project_and_collides_on_redraw() -> None:
    """The key distinguishes kind/project and collides on a sub-0.1 m redraw."""
    pid = uuid4()
    key_cpt = dov_import_job_key(
        "cpt", west=4.30, south=50.80, east=4.50, north=51.00, project_id=pid
    )
    key_borehole = dov_import_job_key(
        "borehole", west=4.30, south=50.80, east=4.50, north=51.00, project_id=pid
    )
    # Same box, different resource kind -> different scopes.
    assert key_cpt != key_borehole
    # A redraw with noise below the 6-dp rounding collides with the first.
    key_redraw = dov_import_job_key(
        "cpt", west=4.3000004, south=50.80, east=4.50, north=51.00, project_id=pid
    )
    assert key_redraw == key_cpt
