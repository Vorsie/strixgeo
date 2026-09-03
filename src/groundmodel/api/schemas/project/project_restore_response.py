"""Pydantic schema for the ``POST /projects/{id}/restore`` response."""

from __future__ import annotations

from groundmodel.api.schemas.project.project_response import ProjectResponse


class ProjectRestoreResponse(ProjectResponse):
    """A restored project plus the counts of rows the restore size caps dropped.

    Restore enforces size caps (``_MAX_CPT_SERIES_ROWS`` and the per-borehole
    child-array caps) by silently TRUNCATING oversized arrays. Before this
    schema those drops left only a backend log line (production-readiness audit
    L6); now the counts ride back on the restore response so the desktop can
    toast "N depth-series / M child rows were too large and were capped".

    Subclasses ``ProjectResponse`` (rather than adding the fields to it) on
    purpose: ``ProjectResponse`` is serialised straight into the ``.gmproj``
    file and reused by the project LIST endpoint, so a restore-only field must
    NOT leak into either. Both fields default to 0, so an unchanged restore
    reports "nothing dropped".
    """

    dropped_series: int = 0
    dropped_child_rows: int = 0
