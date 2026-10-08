"""Pure helpers: read a page's text-layer words once, overprinted copies removed."""

from __future__ import annotations

from collections.abc import Sequence

import pymupdf

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    OVERPRINT_TOLERANCE_PT,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord


def text_layer_words(page: pymupdf.Page) -> list[PageWord]:
    """Return the page's text-layer words, each overprinted copy dropped.

    Parameters
    ----------
    page : pymupdf.Page
        The page.

    Returns
    -------
    list of PageWord
        The words, in text-layer order.
    """
    return without_overprint(
        [
            PageWord(float(w[0]), float(w[1]), float(w[2]), float(w[3]), str(w[4]))
            for w in page.get_text("words")
        ]
    )


def without_overprint(words: Sequence[PageWord]) -> list[PageWord]:
    """Drop the copies of a word printed again on top of itself.

    Some drawing software makes text bold by printing each word two or three
    times a fraction of a point apart (the 21.04 report's header): the text
    layer then holds every word three times, and "Boring: B45d" reads as
    "Boring: Boring: Boring: B45d B45d B45d".

    Parameters
    ----------
    words : sequence of PageWord
        The page's words.

    Returns
    -------
    list of PageWord
        The first copy of each overprinted word, order kept.
    """
    kept: list[PageWord] = []
    by_text: dict[str, list[PageWord]] = {}
    for word in words:
        twins = by_text.setdefault(word.text, [])
        if any(
            abs(t.x0 - word.x0) <= OVERPRINT_TOLERANCE_PT
            and abs(t.y0 - word.y0) <= OVERPRINT_TOLERANCE_PT
            for t in twins
        ):
            continue
        twins.append(word)
        kept.append(word)
    return kept
