"""Pydantic schema: :class:`AutoCorrelateGeotechResponse`."""

from __future__ import annotations

from pydantic import BaseModel


class AutoCorrelateGeotechResponse(BaseModel):
    """Response of ``POST .../geotech/auto-correlate``.

    Attributes
    ----------
    edges_proposed : int
        Net-new UNAPPROVED geotech edges inserted.  They render as suggestions
        until the engineer promotes them with the accept verb.
    edges_accepted : int
        Net-new edges born ACCEPTED because they restate an approved litho tie
        (owner refinement 2026-08-06) — the top sub-band pair of a direct
        litho edge; the litho approval already vouches for that connection.
    edges_skipped_existing : int
        Candidate ties left exactly as they were because an edge already joined
        those two bands on that section — hand-drawn, previously accepted, or
        written by a build pass.  The verb adds; it never reconciles.
    sections_processed : int
        Sections that carried at least one approved litho correlation and were
        therefore examined.
    skipped_no_lcs : int
        Correlated litho units whose two packing stacks share no NAD class, so
        nothing could be tied automatically.
    skipped_empty_stack : int
        Correlated litho units where one column carries no geotech bands at all.
    """

    edges_proposed: int
    edges_accepted: int = 0
    edges_skipped_existing: int
    sections_processed: int
    skipped_no_lcs: int = 0
    skipped_empty_stack: int = 0
