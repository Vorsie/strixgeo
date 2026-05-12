"""GeologicalFormation — a project's substrate vocabulary entry.

A formation is the primary geological modelling unit (Boom Klei,
Diest Zand, Quaternary deposits, ...). Formations live at the
project level: a single formation entry is shared by every
geological model variant in the project and can host any number
of formation contacts across the project's investigations.

This is the domain-layer dataclass — the application + API layers
work against this type, not the ORM. ORM mapping lives in
``infrastructure/db/models/geological_formation_orm.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class GeologicalFormation:
    """One formation entry in a project's vocabulary.

    Attributes
    ----------
    id : UUID
        Primary key.
    app_project_id : UUID
        Project this formation belongs to.
    name : str
        Display label shown in the editor and in exports.
    code : str | None
        Stable short code (e.g. ``"BmK"`` for Boom Klei).
        Optional — display name is the user-facing identifier.
    color : str
        Hex colour (``"#aabbcc"``) used in the cross-section
        viewer + DXF/Plaxis layer naming.
    display_order : int
        Stratigraphic ordering hint — lower values are typically
        shallower / younger. The editor uses this for sidebar
        sort; it carries no semantic constraint.
    regional_ref : str | None
        Optional pointer to a regional formation library
        (G3Dv3 code, BRO formatie naam, etc.). Free text in v1.
    description : str | None
        Free-text engineer note.
    created_at, updated_at : datetime
        Audit timestamps; populated by the ORM on insert/update.
    """

    id: UUID
    app_project_id: UUID
    name: str
    code: str | None
    color: str
    display_order: int = 0
    regional_ref: str | None = None
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
