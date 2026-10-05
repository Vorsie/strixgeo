"""SoundingBlockReader: read "LABEL : value" fields of a sheet's title block."""

from __future__ import annotations

import re
from collections.abc import Sequence

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    FIELD_ROW_OVERLAP_PT,
    FIELD_SEPARATORS,
    FIELD_VALUE_REACH_PT,
    FIELD_VALUE_WORD_GAP_PT,
    GLUED_VALUE_STRIP,
    LEADING_NUMBER_PATTERN,
    LINE_TOLERANCE_PT,
)
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import group_lines
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class SoundingBlockReader(GroundModelLogger):
    """Find labelled fields by geometry, not by text-layer order.

    Text extraction order on these sheets is unreliable (the Van der Straaten
    block lists all labels, then all values), so a field's value is taken as
    the words right of its label on the same printed row.

    The row is measured against the LABEL, not against the line the words were
    grouped into: OCR boxes of one printed row do not share a centre line (a
    value sits a point or more above its label), and a tall stray word at the
    page edge can anchor a grouped line so the label and its value fall into
    two lines. OCR also glues a label to its value
    ("X-COORDINAAT(Lambert72):66980.21"); the rest of the label word is then
    the start of the value.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def read(self, words: Sequence[PageWord], labels: dict[str, re.Pattern[str]]) -> dict[str, str]:
        """Return the value text of every label found.

        Parameters
        ----------
        words : sequence of PageWord
            The page's words.
        labels : dict
            Field name -> pattern of its printed label.

        Returns
        -------
        dict
            Field name -> value text, for the fields found (first hit wins).
        """
        lines = group_lines(words)
        found: dict[str, str] = {}
        for name, pattern in labels.items():
            for line in lines:
                value = _value_after(line, pattern, words)
                if value:
                    found[name] = value
                    break
        self.debug("sounding block: %s", found)
        return found

    @staticmethod
    def number(text: str | None) -> float | None:
        """Return the leading number of a field value ("6.02 m1" -> 6.02).

        Parameters
        ----------
        text : str or None
            A field value.

        Returns
        -------
        float or None
            The number, or None when the value does not start with one.
        """
        if not text:
            return None
        match = LEADING_NUMBER_PATTERN.match(text.strip())
        if match is None:
            return None
        return float(match.group(0).replace("−", "-").replace(",", "."))


def _value_after(
    line: list[PageWord], pattern: re.Pattern[str], words: Sequence[PageWord]
) -> str | None:
    """Return the value right of the label ``pattern`` on one printed row, if any.

    ``line`` is the grouped line the label is searched in; the value words are
    taken from all ``words`` whose centre lies within ``LINE_TOLERANCE_PT`` of
    the label word's own centre (see the class docstring for why).
    """
    text = ""
    starts: list[int] = []
    for w in line:
        if text:
            text += " "
        starts.append(len(text))
        text += w.text
    match = pattern.search(text)
    if match is None:
        return None
    # First word starting at / after the label's end; a trailing ":" glued to
    # the label ("Proefnummer:") is part of the label word itself.
    idx = next((i for i, s in enumerate(starts) if s >= match.end()), len(line))
    label = line[idx - 1] if idx > 0 else line[0]
    label_end = label.x1 if idx > 0 else line[0].x0
    value: list[PageWord] = []
    # OCR glue: the label word runs on past the label ("...(Lambert72):66980.21").
    glued = text[match.end() : starts[idx - 1] + len(label.text)] if idx > 0 else ""
    glued = glued.lstrip(GLUED_VALUE_STRIP)
    if glued:
        value.append(PageWord(label.x0, label.y0, label.x1, label.y1, glued))
    row = sorted(
        (
            w
            for w in words
            if w is not label
            and w.x0 >= label.x1 - FIELD_ROW_OVERLAP_PT
            and abs(w.cy - label.cy) <= LINE_TOLERANCE_PT
        ),
        key=lambda w: w.x0,
    )
    for w in row:
        if not value:
            if w.text in FIELD_SEPARATORS:
                continue
            if w.x0 - label_end > FIELD_VALUE_REACH_PT:
                return None
            value.append(w)
        elif w.x0 - value[-1].x1 <= FIELD_VALUE_WORD_GAP_PT:
            value.append(w)
        else:
            break
    return " ".join(w.text for w in value) if value else None
