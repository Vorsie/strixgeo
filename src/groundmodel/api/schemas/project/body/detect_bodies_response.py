"""Pydantic schema: :class:`DetectBodiesResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class DetectBodiesResponse(BaseModel):
    """Response body of ``POST .../geology/models/{model_id}/lenses/detect``.

    Reports what the explicit "Detect bodies" pass did so the toolbar can
    render an informative toast.

    Detection fires only when the user explicitly invokes it from the
    Sections toolbar (owner directive 2026-05-31 removed the auto-fires
    that used to run from every edge mutation and every destructive op).

    Detect manages ``to_target`` EXTENTS on resolver-owned bodies; it no
    longer creates or deletes body rows (the resolver owns body lifecycle).
    The field NAMES are kept for frontend compatibility but their meaning is
    repurposed accordingly.

    Attributes
    ----------
    bodies_created : int
        Number of bodies that GAINED a ``to_target`` extent on a previously
        empty side this pass.
    bodies_removed : int
        Number of bodies whose stale ``to_target`` extent(s) were CLEARED
        this pass (the closure disappeared from the latest detection).
    bodies_skipped_unresolved_ordinal : int
        Detected closures skipped because the framed layer has no
        resolver-stamped body (the resolver has not run, or the framed
        layer is not an accepted layer).
    """

    bodies_created: int
    bodies_removed: int
    bodies_skipped_unresolved_ordinal: int
