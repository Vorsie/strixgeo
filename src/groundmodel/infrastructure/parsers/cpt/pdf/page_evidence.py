"""PageEvidence: what the triage saw on one page and what it concluded."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_class import PageClass


@dataclass(frozen=True)
class PageEvidence:
    """The triage verdict for one page, with the measurements behind it.

    Parameters
    ----------
    page_number : int
        1-based page number.
    page_class : PageClass
        The verdict.
    origin : CptOrigin or None
        Campaign / desk-study / unknown for a CPT graph page; None otherwise.
    graph_kind : GraphKind or None
        Vector or raster for a CPT graph page; None otherwise.
    text_chars : int
        Characters in the text layer (0 = no text layer: a scan).
    word_count, numeric_words : int
        Words, and words that are bare numbers.
    image_count : int
        Images placed on the page.
    image_coverage : float
        Share of the page covered by the largest image (0..1).
    max_image_dpi : float
        Highest effective resolution of a placed image.
    segment_count : int
        Stroked line segments of the drawing commands.
    curve_segments : int
        Largest number of non-axis-aligned segments of one stroke style: a
        data curve has hundreds; grids and tables have none.
    tick_runs : int
        Evenly stepped numeric label runs (axes).
    cpt_score : float
        Weighted CPT keyword score of the text layer.
    profile_name : str
        The layout profile that matched.
    sounding_id, project, location : str or None
        Sounding-block fields.
    dov_id : str or None
        A DOV sounding id found on the page ("GEO-22/040-S2").
    raster_panels : int
        Graph panels found by the raster grid detector (image pages only).
    reasons : tuple of str
        The evidence for the verdict, in words.
    ground_level_m : float or None
        The printed ground level ("HOOGTE MAAIVELD 6.02").
    z_epsg : int or None
        The vertical datum the sheet names (5710 TAW, 5709 NAP).
    x, y : float or None
        The printed coordinates of the sounding; None when not printed.
    epsg : int or None
        The coordinate system the sheet names for ``x`` / ``y`` (31370
        Lambert72, 28992 RD); None when it names none (never guessed).
    test_date : str or None
        The printed test date, as printed ("28-2-2024").
    """

    page_number: int
    page_class: PageClass
    origin: CptOrigin | None = None
    graph_kind: GraphKind | None = None
    text_chars: int = 0
    word_count: int = 0
    numeric_words: int = 0
    image_count: int = 0
    image_coverage: float = 0.0
    max_image_dpi: float = 0.0
    segment_count: int = 0
    curve_segments: int = 0
    tick_runs: int = 0
    cpt_score: float = 0.0
    profile_name: str = "generic"
    sounding_id: str | None = None
    project: str | None = None
    location: str | None = None
    dov_id: str | None = None
    raster_panels: int = 0
    reasons: tuple[str, ...] = field(default_factory=tuple)
    ground_level_m: float | None = None
    z_epsg: int | None = None
    x: float | None = None
    y: float | None = None
    epsg: int | None = None
    test_date: str | None = None
