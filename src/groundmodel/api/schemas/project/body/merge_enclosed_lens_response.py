"""Pydantic schema: :class:`MergeEnclosedLensResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class MergeEnclosedLensResponse(BaseModel):
    """Response body of ``POST .../geology/models/{model_id}/bodies/merge-enclosed-lenses``.

    Reports the Fill-bands sand-merge: a lithology split on one column only by a
    local lens is fused into one body by correlating its bracketing host halves
    to the neighbour's continuous host (owner directive 2026-06-05).

    Attributes
    ----------
    edges_created : int
        Net-new correlation edges inserted (each joins a host half to the
        neighbour's continuous host unit).
    edges_skipped_existing : int
        Planned edges that already existed (idempotent re-run).
    """

    edges_created: int
    edges_skipped_existing: int
