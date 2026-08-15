"""Pydantic schema: :class:`SubdivideAllBodiesRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class SubdivideAllBodiesRequest(BaseModel):
    """Body of ``POST .../geotech/subdivide-all-bodies`` and ``.../subdivide-cpts``.

    Geotech layers are written once per investigation (section-independent);
    correlation edges are derived per-section from the litho model's approved
    edges.  Which investigations take part is decided by SECTION MEMBERSHIP —
    see ``section_id`` below.

    Parameters
    ----------
    litho_model_id : UUID
        The lithostratigraphic model whose picks drive the subdivision.
        (The litho model id also appears in the URL as ``model_id``; this
        field is the canonical source used by the use case.)
    section_id : UUID | None
        Restrict the subdivision to the investigations that project onto ONE
        section (owner ruling 2026-08-15: *"i want subdivide cpt's also to be
        section scoped"*).  ``None`` (the default) takes every investigation
        that projects onto ANY section of the project — the historic breadth
        MINUS the ones that appear on no section at all, which the same ruling
        excludes from the model in both modes.
    """

    litho_model_id: UUID
    section_id: UUID | None = Field(default=None)
