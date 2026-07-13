"""Shared route-handler helpers.

Module is private (``_``-prefixed) to mark "only routers import from
here" — the helpers shouldn't leak into application or domain layers.

The dominant pattern these helpers replace is the project-scope
guard: fetch a row, confirm it belongs to the project named in the
URL, 404 otherwise. Before this module the same four-line block lived
verbatim in 14 places across the geology / cross-section / review
routers (per the Maintenance Rules: "extract on the second copy" —
14 copies was well past that trigger).
"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Any, TypeVar
from uuid import UUID

from fastapi import HTTPException, status

T = TypeVar("T")


def merge_view_state(
    existing: dict[str, Any] | None,
    patch: dict[str, Any],
) -> dict[str, Any]:
    """Shallow-merge ``patch`` into ``existing`` for a JSONB view-state bag.

    The merge semantics are deliberately consistent across every
    view-state surface (project-level, section-level, future
    investigation-level):

    * Each top-level key in ``patch`` overwrites the same key in
      ``existing``; siblings are left untouched.
    * A ``patch`` value of ``None`` removes the key from the bag.
    * The returned dict is a NEW object — required so SQLAlchemy
      notices the change on a JSONB column.

    Nested values are intentionally NOT deep-merged. Deep merge has
    surprising semantics around array fields (replace? append?
    dedup?) that the API can't decide for callers. To change a
    nested field, the caller patches the whole subtree.

    Parameters
    ----------
    existing : dict[str, Any] | None
        Current value of the JSONB column. ``None`` is treated as an
        empty bag — the merge proceeds against ``{}``.
    patch : dict[str, Any]
        Top-level keys to merge. An empty dict is a no-op (returns a
        copy of ``existing``); the caller decides whether to skip
        the write entirely on empty patches.

    Returns
    -------
    dict[str, Any]
        Fresh dict ready to assign back to the JSONB column.
    """
    merged: dict[str, Any] = dict(existing or {})
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def safe_filename_stem(name: str, fallback: str) -> str:
    """Sanitise a user-supplied name into a safe filename stem.

    Strips characters that cause problems in filenames or
    ``Content-Disposition`` headers (forward slashes, control chars,
    double-quotes, etc.), replacing them with underscores. Falls back
    to ``fallback`` when nothing safe remains. Single source of truth
    for download-filename safety across the export endpoints.

    Parameters
    ----------
    name : str
        Raw name (project name, section name, ...).
    fallback : str
        Stem to use when the sanitised result is empty (e.g.
        ``"project"`` or ``"section"``).

    Returns
    -------
    str
        Alphanumeric + ``-_`` + space filename stem, stripped of
        leading/trailing spaces.
    """
    return (
        "".join(c if c.isalnum() or c in ("-", "_", " ") else "_" for c in name).strip() or fallback
    )


def require_model_kind(model: Any, expected_kind: str, verb: str) -> None:
    """Raise HTTP 422 unless ``model.kind`` matches ``expected_kind``.

    Wraps the model-kind guard that every litho/geotech verb runs right
    after ``get_in_project_or_404``: reject a model of the wrong kind
    with a structured 422 so callers that accidentally pass e.g. a
    geological ``model_id`` to a litho-only verb get a clear error
    instead of a silent no-op. Before extraction the same block lived
    in 5 places with drifting error codes (``wrong_model_kind``, a
    bare-string detail); the canonical shape is the 4-of-5 majority:
    ``{"code": "invalid_model_kind", "message": ...}``.

    Parameters
    ----------
    model
        Fetched model row; must expose ``id`` and ``kind`` attributes.
    expected_kind
        Required ``kind`` token (e.g. ``"lithostratigraphic"``).
    verb
        Short verb name interpolated into the message so the caller can
        see WHICH operation rejected the model (e.g.
        ``"accept-litho-suggestions"``).

    Raises
    ------
    fastapi.HTTPException
        Status 422 with ``detail={"code": "invalid_model_kind", ...}``
        when the kind does not match.
    """
    if model.kind != expected_kind:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_model_kind",
                "message": (
                    f"Model {model.id} has kind='{model.kind}'; "
                    f"{verb} requires kind='{expected_kind}'"
                ),
            },
        )


async def get_in_project_or_404(
    fetch: Awaitable[T | None],
    project_id: UUID,
    *,
    detail: str,
    project_attr: str = "app_project_id",
) -> T:
    """Resolve a project-scoped row or raise an HTTP 404.

    Wraps the "fetch + verify scope + 404" trio that every project-
    scoped router uses. The caller passes the repository coroutine
    that fetches the row by id (already constructed, not awaited) and
    the URL's ``project_id``; the helper awaits, scope-checks against
    ``project_attr`` on the row, and either returns the row or raises
    HTTP 404 with the supplied detail.

    Parameters
    ----------
    fetch
        An awaitable that returns the row or ``None`` (typically a
        ``repo.get(some_id)`` call).
    project_id
        UUID from the request URL — every row must claim this id under
        ``project_attr``.
    detail
        Human-readable 404 message (e.g. ``"Cross-section not found"``).
        Surfaced to the API caller verbatim.
    project_attr
        Name of the project-id column on the row. Defaults to the
        codebase-wide convention ``app_project_id``. Override only if
        a specific table breaks the convention.

    Returns
    -------
    T
        The fetched row, guaranteed non-None and scope-matched.

    Raises
    ------
    fastapi.HTTPException
        Status 404 when the row is missing or belongs to a different
        project.
    """
    row = await fetch
    if row is None or getattr(row, project_attr) != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    return row
