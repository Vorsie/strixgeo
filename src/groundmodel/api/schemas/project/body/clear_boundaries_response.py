"""Pydantic schema: :class:`ClearBoundariesResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class ClearBoundariesResponse(BaseModel):
    """Response body of ``DELETE .../geology/models/{model_id}/boundaries``.

    Reports the bulk "Reset manual points" clear: every user-authored
    ``body_boundary_shape`` (+ its cascade-deleted control nodes) for the model
    is removed, so each body returns to its engine-computed shape.

    Attributes
    ----------
    shapes_deleted : int
        Number of hand-drawn boundary shapes removed (one per hand-shaped
        body). Their control nodes are dropped by the DB CASCADE and are not
        counted separately.
    """

    shapes_deleted: int
