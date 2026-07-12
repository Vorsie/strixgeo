"""Shared readers for per-project ``view_state`` JSON knobs.

The project row carries a free-form ``view_state`` JSON bag whose
sections (``litho_segmenter``, ``geotech_subdivision``, ...) hold
numeric tuning knobs.  Every builder that read one copy-pasted the same
guarded float parse (default when absent, non-positive, or non-numeric)
— the "view-state float-knob reader family" of debt #224.  The parse
and the project-row load live here once; callers keep their own
defaults and section/key names.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository


async def load_project_view_state(
    session: AsyncSession,
    project_id: UUID,
) -> dict[str, Any] | None:
    """Load a project's ``view_state`` JSON bag.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Owning project id.

    Returns
    -------
    dict[str, Any] | None
        The stored view-state, or ``None`` when the project does not
        exist or has no view-state.
    """
    project = await ProjectRepository(session).get_by_id(project_id)
    return project.view_state if project is not None else None


def read_view_state_float(
    view_state: dict[str, Any] | None,
    section: str,
    key: str,
    default: float,
) -> float:
    """Read a positive float knob from a view-state section, guarded.

    Falls back to ``default`` when the section or key is absent, the
    value is non-numeric, or the parsed value is not strictly positive
    — the guard every reader in the family applied.

    Parameters
    ----------
    view_state : dict[str, Any] | None
        The project's view-state bag (``None`` tolerated).
    section : str
        Top-level section name (e.g. ``"geotech_subdivision"``).
    key : str
        Knob name inside the section.
    default : float
        Value returned on any absent / malformed / non-positive read.

    Returns
    -------
    float
        The configured knob value, or ``default``.
    """
    bag = (view_state or {}).get(section) or {}
    try:
        value = float(bag.get(key, default))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default
