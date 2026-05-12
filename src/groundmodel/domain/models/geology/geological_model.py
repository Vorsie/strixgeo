"""GeologicalModel — one interpretation variant for a project.

A project can have multiple geological models — engineering
sensitivity studies, alternative correlations, or simply a
working model + a baseline. Each model holds its own set of
formation contacts; only one model can be flagged ``is_active``
at a time (the API layer enforces).

This is the domain-layer dataclass; ORM mapping lives in
``infrastructure/db/models/geological_model_orm.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class GeologicalModel:
    """One geological interpretation variant.

    Attributes
    ----------
    id : UUID
        Primary key.
    app_project_id : UUID
        Project this model belongs to.
    name : str
        Display label.
    description : str | None
        Free-text engineer note.
    is_active : bool
        Whether this is the project's currently-active model. The
        editor edits the active model; the API enforces "at most
        one active per project" via dedicated activate / deactivate
        endpoints, not via raw PATCH.
    excluded_borehole_ids : list[UUID]
        Per-model exclusion set — boreholes the engineer chose to
        ignore for THIS interpretation while keeping them in the
        project (a different model may include them). Empty when
        the model uses every investigation in scope.
    created_at, updated_at : datetime
        Audit timestamps.
    """

    id: UUID
    app_project_id: UUID
    name: str
    description: str | None = None
    is_active: bool = False
    excluded_borehole_ids: list[UUID] = field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
