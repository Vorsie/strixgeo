"""Pure helpers: group text-layer words into printed lines and phrases."""

from __future__ import annotations

from collections.abc import Sequence

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    GARBLED_MIN_CHARS,
    LINE_TOLERANCE_PT,
    PHRASE_WORD_GAP_PT,
)


def group_lines(
    words: Sequence[PageWord], tolerance: float = LINE_TOLERANCE_PT
) -> list[list[PageWord]]:
    """Group words into printed lines, each sorted left to right.

    Parameters
    ----------
    words : sequence of PageWord
        The words.
    tolerance : float
        Words whose vertical centres differ by at most this share a line.

    Returns
    -------
    list of list of PageWord
        Lines top to bottom.
    """
    lines: list[list[PageWord]] = []
    for word in sorted(words, key=lambda w: w.cy):
        if lines and abs(word.cy - lines[-1][0].cy) <= tolerance:
            lines[-1].append(word)
        else:
            lines.append([word])
    for line in lines:
        line.sort(key=lambda w: w.x0)
    return lines


def phrases(words: Sequence[PageWord], gap: float = PHRASE_WORD_GAP_PT) -> list[PageWord]:
    """Merge words a normal space apart on one line into phrase boxes.

    "Hellingshoek in graden" becomes one box, so an axis is named by the end
    of its label phrase, not by the first word alone.

    Parameters
    ----------
    words : sequence of PageWord
        The words.
    gap : float
        Largest horizontal gap (pt) inside a phrase.

    Returns
    -------
    list of PageWord
        One merged box per phrase, its text the words joined by spaces.
    """
    out: list[PageWord] = []
    for line in group_lines(words):
        current: list[PageWord] = []
        for word in line:
            if current and word.x0 - current[-1].x1 > gap:
                out.append(_merge(current))
                current = []
            current.append(word)
        if current:
            out.append(_merge(current))
    return out


def text_layer_quality(words: Sequence[PageWord]) -> float:
    """Return the share of letters among the characters of the non-numeric words.

    A subset font without a Unicode map extracts as symbol soup
    (";<=>7<?", "&>;9=@") while its digits may still come through; real text
    scores ~0.8-0.9, such a layer ~0.2.

    Parameters
    ----------
    words : sequence of PageWord
        The page's words.

    Returns
    -------
    float
        0..1; 1.0 when there are too few words to judge.
    """
    chars = "".join(
        w.text for w in words if len(w.text) >= 2 and not any(c.isdigit() for c in w.text)
    )
    if len(chars) < GARBLED_MIN_CHARS:
        return 1.0
    return sum(1 for c in chars if c.isalpha()) / len(chars)


def _merge(words: list[PageWord]) -> PageWord:
    """Return one box around ``words`` with their joined text."""
    return PageWord(
        min(w.x0 for w in words),
        min(w.y0 for w in words),
        max(w.x1 for w in words),
        max(w.y1 for w in words),
        " ".join(w.text for w in words),
    )
