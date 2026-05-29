"""Project-scope guard for the application layer (#166).

The router layer has ``get_in_project_or_404`` (``api/routers/_helpers.py``),
but the application layer re-hand-rolled the same load-and-check at 25+ sites::

    obj = await session.get(OrmClass, obj_id)
    if obj is None or obj.app_project_id != project_id:
        raise ValueError(f"... not found in project {project_id}")

That check is the cross-project data-leak boundary: a future tightening (e.g.
also reject ``archived_at``, or a soft-delete column) must touch every copy, and
one miss leaks another project's rows.  This module is the single source of
truth for the load-and-scope step so the tightening happens in one place.

Pure async helper — no logger, no FastAPI, no HTTP.  Raises ``ValueError`` (the
application-layer convention; routers map it to a 404/422).
"""

from __future__ import annotations

from typing import TypeVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


async def load_scoped_or_raise(
    session: AsyncSession,
    orm_class: type[T],
    entity_id: UUID,
    project_id: UUID,
    *,
    label: str,
    attr: str = "app_project_id",
) -> T:
    """Load ``orm_class[entity_id]`` and assert it belongs to ``project_id``.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    orm_class : type[T]
        The ORM model class to load by primary key.
    entity_id : UUID
        Primary key of the row to load.
    project_id : UUID
        The project the row must belong to.
    label : str
        Human label for the entity in the error message (e.g. ``"Geological
        model"``, ``"Contact"``), so the raised message matches the per-site
        wording it replaces.
    attr : str
        Name of the project-id attribute on the loaded row.  Defaults to
        ``"app_project_id"``.

    Returns
    -------
    T
        The loaded row, guaranteed non-None and in ``project_id``.

    Raises
    ------
    ValueError
        When the row does not exist or does not belong to ``project_id``.  The
        same message is used for both cases so a caller (or attacker) cannot
        distinguish "wrong project" from "does not exist".
    """
    obj = await session.get(orm_class, entity_id)
    if obj is None or getattr(obj, attr) != project_id:
        raise ValueError(f"{label} {entity_id} not found in project {project_id}")
    return obj
