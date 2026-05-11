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
from typing import TypeVar
from uuid import UUID

from fastapi import HTTPException, status

T = TypeVar("T")


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
