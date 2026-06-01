"""Pydantic schema: :class:`ClearDetectedBodiesResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class ClearDetectedBodiesResponse(BaseModel):
    """Response body of ``DELETE .../geology/models/{model_id}/bodies``.

    Reports what the bulk "Delete all detected lenses" pass did so the
    toolbar can render an informative toast.

    Only purely-detected bodies are deleted; user-named and user-claimed
    ("accepted") bodies are preserved (spec §5.2 provenance rule).

    Attributes
    ----------
    bodies_deleted : int
        Number of purely-detected ``BodyOrm`` rows hard-deleted this pass.
    bodies_preserved : int
        Number of bodies left intact because they are user-named or carry a
        user-claimed extent kind.
    """

    bodies_deleted: int
    bodies_preserved: int
