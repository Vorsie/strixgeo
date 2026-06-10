"""Pydantic schema: :class:`RebuildLithoSolidsResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from groundmodel.api.schemas.project.litho_body_solid_response import LithoBodySolidResponse


class RebuildLithoSolidsResponse(BaseModel):
    """Result of ``POST .../litho-solids/rebuild``.

    Mirrors the shape of :class:`RebuildSurfacesResponse` for the
    geological TIN pipeline, extended with the freshly rebuilt solid
    list so the frontend can update its cache in a single round-trip.

    Attributes
    ----------
    bodies_considered : int
        Total bodies found in the resolved model — the ones the rebuild
        loop visited.
    bodies_built : int
        Bodies whose solid was freshly (re-)triangulated and upserted.
    bodies_skipped_checksum : int
        Bodies skipped because the pick-set checksum matched the cached
        row (geometry unchanged, explicit ``force=True`` not set).
    bodies_flagged : int
        Bodies built but emitted as flagged slabs (fewer than 3
        non-collinear picks).
    orphans_deleted : int
        ``litho_body_solid`` rows removed because their ``body_id`` was
        no longer among the resolved bodies.
    solids : list[LithoBodySolidResponse]
        The full solid list after the rebuild, ordered by body creation
        time.  Equivalent to calling ``GET .../litho-solids`` immediately
        after — bundled here to avoid a second round-trip.
    """

    bodies_considered: int
    bodies_built: int
    bodies_skipped_checksum: int
    bodies_flagged: int
    orphans_deleted: int
    solids: list[LithoBodySolidResponse]
