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

    Attributes
    ----------
    bodies_created : int
        Number of ``BodyOrm`` rows inserted this pass.
    bodies_removed : int
        Number of stale ``BodyOrm`` rows deleted this pass.
    bodies_skipped_unresolved_ordinal : int
        Candidate bodies skipped because their formation has no
        ``instance_ordinal`` yet (the resolver has not visited them).
    """

    bodies_created: int
    bodies_removed: int
    bodies_skipped_unresolved_ordinal: int
