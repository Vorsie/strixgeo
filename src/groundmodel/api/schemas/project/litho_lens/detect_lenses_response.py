"""Pydantic schema: :class:`DetectLensesResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class DetectLensesResponse(BaseModel):
    """Response body of ``POST .../geology/models/{model_id}/lenses/detect``.

    The explicit "Detect lenses" verb runs
    :class:`groundmodel.application.detect_litho_lenses.DetectLithoLenses`
    and reports what the pass did so the toolbar can render a toast.

    Lens detection used to fire implicitly inside every edge mutation
    (correlate / uncorrelate / accept) and every destructive operation
    (delete contact, delete layer, cross-merge).  Owner directive
    2026-05-31 removed those auto-fires — a single manual correlate
    that incidentally closed a #135 topology was silently spawning a
    ``LithoLensOrm`` row, which violated the "no side-effects beyond
    the gesture" invariant.  Detection now runs only when the user
    explicitly invokes it from the Sections toolbar.

    Attributes
    ----------
    lenses_created : int
        Number of ``LithoLensOrm`` rows inserted this pass.
    lenses_removed : int
        Number of stale ``LithoLensOrm`` rows deleted this pass.
    lenses_skipped_unresolved_ordinal : int
        Candidate bodies skipped because their formation has no
        ``instance_ordinal`` yet (the resolver hasn't visited them).
    """

    lenses_created: int
    lenses_removed: int
    lenses_skipped_unresolved_ordinal: int
