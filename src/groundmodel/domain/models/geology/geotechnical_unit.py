"""GeotechnicalUnit — a subdivision of a geological formation.

A geological formation often contains multiple geotechnical units with
different parameter sets (weathered crust of Boom Klei vs the
undisturbed clay below). v1.0 stores *structure only* — no parameter
values; engineers prefer to set those manually in the downstream
design tool anyway. Per-unit parameter values (γ, c', φ', ...) land
in Phase 5 as additive fields on this same dataclass + ORM.

This is the domain-layer dataclass — application + API layers work
against this type, not the ORM. ORM mapping lives in
``infrastructure/db/models/geotechnical_unit_orm.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class GeotechnicalUnit:
    """One geotechnical-unit row, hanging off a geological formation.

    Attributes
    ----------
    id : UUID
        Primary key.
    app_project_id : UUID
        Project this unit belongs to. Denormalised onto the row for
        cheap list / filter queries.
    geological_formation_id : UUID
        Parent formation. CASCADE: removing the formation removes
        every unit beneath it.
    name : str
        Display label shown in the editor and exports.
    code : str | None
        Stable short code (e.g. ``"BmK-wc"`` for Boom Klei weathered
        crust). Optional — display name is the user-facing identifier.
    color : str
        Hex colour (``"#aabbcc"``). Defaulted at the API layer so the
        DB column stays NOT NULL while fixtures omit it.
    display_order : int
        Top-to-bottom hint within the formation. Ties are tolerated
        and broken by name in the UI.
    description : str | None
        Free-text engineer note.
    created_at, updated_at : datetime
        Audit timestamps; populated by the ORM on insert / update.
    """

    id: UUID
    app_project_id: UUID
    geological_formation_id: UUID
    name: str
    code: str | None
    color: str
    display_order: int = 0
    description: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
