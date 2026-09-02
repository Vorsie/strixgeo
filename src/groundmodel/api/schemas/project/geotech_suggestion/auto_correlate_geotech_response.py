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
    investigations_off_section : int
        Columns that appeared as a litho-tie endpoint on a section that does
        not draw them, and were therefore excluded from the derivation (owner
        ruling 2026-08-25).  The backend log names them.
    offsection_ties_deleted : int
        Mis-scoped machine PROPOSALS removed — unapproved ``source='auto'``
        rows tying a column their section does not draw.  The pair itself is
        re-proposed by the run of the section that DOES draw both columns.
    offsection_ties_retained : int
        Mis-scoped ties left standing because they are ACCEPTED or hand-drawn.
        Non-zero means the engineer has a decision to make; the backend log
        names each one.
    frame_flagged_count : int
        New machine ties born with the violet ``frame_mismatch`` review badge
        because they exceed the litho frame (owner order 2026-08-21) — a
        restatement two bands can never become one mass.  The tie is still
        proposed; the badge asks the engineer to review it, exactly as the hand
        path flags the same tie.
    """

    edges_proposed: int
    edges_accepted: int = 0
    edges_skipped_existing: int
    sections_processed: int
    skipped_no_lcs: int = 0
    skipped_empty_stack: int = 0
    investigations_off_section: int = 0
    offsection_ties_deleted: int = 0
    offsection_ties_retained: int = 0
    frame_flagged_count: int = 0
