"""Pydantic schema: :class:`ClearLithoModelResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class ClearLithoModelResponse(BaseModel):
    """Result of ``DELETE /projects/{pid}/geology/models/{mid}/contacts``.

    Returns per-table deletion counts so the frontend toast is meaningful.
    The operation is irreversible — no id list is returned because there is
    nothing to undo via the API.

    Attributes
    ----------
    contacts : int
        Number of ``FormationContact`` rows removed. Zero when the model had
        no contacts (idempotent no-op).
    edges : int
        Number of ``LithoCorrelationEdge`` rows removed.
    surfaces : int
        Number of ``FormationSurface`` rows removed.
    formations : int
        Number of litho ``GeologicalFormation`` rows removed (orphan-safe:
        formations shared with another litho model are excluded).
    """

    contacts: int
    edges: int
    surfaces: int
    formations: int
