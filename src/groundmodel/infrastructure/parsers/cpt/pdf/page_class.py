"""PageClass enum."""

from __future__ import annotations

from enum import StrEnum


class PageClass(StrEnum):
    """What a report page is, as far as the digitiser cares.

    Members
    -------
    COVER
        The report's cover / title page.
    DIVIDER
        A near-empty annex divider page (a title and the running header).
    TEXT
        Prose: the report body.
    TABLE
        A ruled table (coordinates, checklists, zero-point checks).
    PHOTO
        Dominated by a photograph or a pasted image.
    MAP
        A plan, map or technical drawing (many vector strokes, no data curve).
    CPT_GRAPH
        A CPT depth-series graph: the pages the digitiser reads.
    DISSIPATION
        A dissipation test (pore pressure against log time).
    BOREHOLE_LOG
        A borehole log (boorstaat).
    SCANNED
        An image-only page without a text layer that shows no graph grid.
    BLANK
        No text, no image, no drawing.
    OTHER
        None of the above.
    """

    COVER = "cover"
    DIVIDER = "divider"
    TEXT = "text"
    TABLE = "table"
    PHOTO = "photo"
    MAP = "map"
    CPT_GRAPH = "cpt-graph"
    DISSIPATION = "dissipation"
    BOREHOLE_LOG = "borehole-log"
    SCANNED = "scanned"
    BLANK = "blank"
    OTHER = "other"
