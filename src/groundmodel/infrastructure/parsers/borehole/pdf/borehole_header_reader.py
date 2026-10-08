"""BoreholeHeaderReader: read a sheet's "label: value" header fields by its profile."""

from __future__ import annotations

from collections.abc import Sequence

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile import (
    BoreholeLayoutProfile,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet_header import (
    BoreholeSheetHeader,
)
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import group_lines
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BoreholeHeaderReader(GroundModelLogger):
    """Read the header fields a layout profile names from a page's words.

    Every printed line is searched for each field's label; the value is the
    rest of that line up to the next label (another field's label, or any word
    ending in a colon, which is how both layouts end a label). The first (top
    most) occurrence of a label wins. Nothing is converted here: the values
    stay text, the labels stay as printed (they carry the units).
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def read(
        self, words: Sequence[PageWord], profile: BoreholeLayoutProfile
    ) -> BoreholeSheetHeader:
        """Return the header fields of one page.

        Parameters
        ----------
        words : sequence of PageWord
            The page's words (text layer or OCR).
        profile : BoreholeLayoutProfile
            The layout whose labels to look for.

        Returns
        -------
        BoreholeSheetHeader
            The fields found; a field the page does not print is absent.
        """
        fields: dict[str, tuple[str, str]] = {}
        boxes: dict[str, PageWord] = {}
        identification: str | None = None
        for line in group_lines(words):
            text, starts = _joined(line)
            matches = [
                (name, m) for name, pattern in profile.header_fields if (m := pattern.search(text))
            ]
            other_labels = {m.start() for _, m in matches}
            for name, m in matches:
                if name in fields:
                    continue
                value_words: list[str] = []
                for word, start in zip(line, starts, strict=True):
                    if start < m.end():
                        continue
                    # The value ends where the next label starts.
                    if start in other_labels or word.text.endswith(":"):
                        break
                    value_words.append(word.text)
                fields[name] = (text[m.start() : m.end()], " ".join(value_words))
                boxes[name] = next(
                    w for w, s in zip(line, starts, strict=True) if s + len(w.text) > m.start()
                )
            if identification is None and profile.identification_pattern is not None:
                found = profile.identification_pattern.search(text)
                if found:
                    identification = " ".join(found.group(1).split())
        self.debug("header (%s): %d field(s) %s", profile.name, len(fields), sorted(fields))
        return BoreholeSheetHeader(
            fields=fields, label_boxes=boxes, identification_standard=identification
        )


def _joined(line: list[PageWord]) -> tuple[str, list[int]]:
    """Return a line's words joined by single spaces and each word's start offset."""
    starts: list[int] = []
    parts: list[str] = []
    offset = 0
    for word in line:
        starts.append(offset)
        parts.append(word.text)
        offset += len(word.text) + 1
    return " ".join(parts), starts
