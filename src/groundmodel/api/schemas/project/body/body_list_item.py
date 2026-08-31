"""Pydantic schema: :class:`BodyListItem` (response shape for ``GET /bodies``)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BodyListItem(BaseModel):
    """One row returned by ``GET /projects/{pid}/geology/models/{mid}/lenses``.

    Carries the body identity metadata.  The ``source_investigation_id``
    anchors the body to its defining investigation; the body's lateral shape
    is owned by the partition-fill model (the per-side ``extent_*`` markers
    were retired 2026-06-06).

    Attributes
    ----------
    id : UUID
        ``BodyOrm`` primary key.
    app_project_id : UUID
        Project scope.
    model_id : UUID
        The lithostratigraphic model this body belongs to.
    formation_id : UUID
        The geological formation this body is a segment of.
    body_ordinal : int
        Zero-based ordinal assigned by the correlation resolver; distinguishes
        multiple separate bodies of the same formation within a model.
    source_investigation_id : UUID
        The investigation whose correlation defines this body.
    name : str | None
        Optional human-readable label; ``None`` when the user has not yet
        named this body.
    primary_section_id : UUID | None
        The cross-section from which the naming gesture was invoked.

    parent_litho_body_id : UUID | None
        The litho parent BODY this geotech body subdivides (debt #278, R1) —
        a resolver-maintained stored FK, mapped straight off the ORM row.
        ``None`` on litho-model bodies and on a geotech body with no derivable
        litho parent.

    geo_formation_id : UUID | None
        A2-derived geological-formation label: the geological formation owning
        the majority (by thickness) of this body's member layers. Computed fresh
        on read, never stored. ``None`` when no geological model is defined at
        the body's member investigations.
    geo_formation_name : str | None
        Display name of ``geo_formation_id`` (e.g. ``"Quartair: Pleistoceen"``),
        or ``None`` when unresolved.

    created_at : datetime
        Row creation timestamp.
    updated_at : datetime
        Row last-modified timestamp.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    model_id: UUID
    formation_id: UUID
    body_ordinal: int
    source_investigation_id: UUID
    name: str | None
    primary_section_id: UUID | None

    # The litho parent BODY this geotech body subdivides (debt #278, R1). Stored
    # FK, resolver-maintained; mapped straight off the ORM row via from_attributes.
    parent_litho_body_id: UUID | None = None

    # A2: derived (not stored) geological-formation label — the geological
    # formation owning the majority of this body's member-layer thickness,
    # recomputed on every read. ``None`` when no geological model is defined at
    # the body's investigations.
    geo_formation_id: UUID | None = None
    geo_formation_name: str | None = None

    created_at: datetime
    updated_at: datetime
