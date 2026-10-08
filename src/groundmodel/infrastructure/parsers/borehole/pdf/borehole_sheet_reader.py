"""BoreholeSheetReader: read one borehole-log sheet into levels, rows, samples and axis."""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Sequence
from typing import Any

import pymupdf

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_header_reader import (
    BoreholeHeaderReader,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_layout_profile import (
    BoreholeLayoutProfile,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    ABOVE_FIRST_RULE_PT,
    DESCRIPTION_LEFT_SLACK_PT,
    DESCRIPTION_LINE_TOLERANCE_PT,
    DESCRIPTION_RIGHT_SLACK_PT,
    ISSUE_EMPTY_DESCRIPTION,
    ISSUE_LEVEL_COUNT_MISMATCH,
    ISSUE_LEVEL_UNREADABLE,
    ISSUE_LEVELS_NOT_FALLING,
    LABEL_COLUMN_TOLERANCE_PT,
    LABEL_DIGIT_PATTERN,
    LABEL_MIN_NUMBER_SHARE,
    LABEL_REACH_LEFT_PT,
    LABEL_REACH_RIGHT_PT,
    LEVEL_CHARACTERS,
    SAMPLE_BAR_MAX_WIDTH_PT,
    SAMPLE_BAR_MIN_HEIGHT_PT,
    SAMPLE_FILLED_MAX_CHANNEL,
    SAMPLE_ID_TIGHT_GAP_PT,
    SAMPLE_ID_WORD_GAP_PT,
    SAMPLE_LABEL_REACH_PT,
    SAMPLE_OPEN_MIN_CHANNEL,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_sheet import BoreholeSheet
from groundmodel.infrastructure.parsers.borehole.pdf.level_column_helpers import (
    RuleFamily,
    anchor_depth_axis,
    columns_by_left_edge,
    fit_depth_axis,
    non_increasing,
    rule_families,
)
from groundmodel.infrastructure.parsers.borehole.pdf.level_label import LevelLabel
from groundmodel.infrastructure.parsers.borehole.pdf.page_word_helpers import without_overprint
from groundmodel.infrastructure.parsers.borehole.pdf.sample_mark import SampleMark
from groundmodel.infrastructure.parsers.borehole.pdf.sheet_row import SheetRow
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.vector_page_reader import VectorPageReader
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import group_lines
from groundmodel.infrastructure.parsers.validation.validation_issue import make_issue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

#: The chosen level column: ``(score, family, label words)``.
_Choice = tuple[tuple[int, int, int], RuleFamily, list[PageWord]]


class BoreholeSheetReader(GroundModelLogger):
    """Read a sheet by its layout profile.

    1. The description rules: the largest family of long horizontal lines
       sharing one right end.
    2. The level column: the left-aligned column of labels at the rules' left
       end whose readable levels fall down the sheet; it must hold one label
       per rule (labels and rules pair in order; a leader line may push a
       rule away from its label, the order never changes).
    3. The rows: the words under each rule, down to the next rule.
    4. The surface cover: words just above the first rule.
    5. The sample bars (thin filled rectangles left of the level column) and
       the id printed next to each; the depth axis (the leftmost evenly
       stepped column of numbers).
    """

    def __init__(self) -> None:
        super().__init__(__name__)
        self._vector = VectorPageReader()
        self._header = BoreholeHeaderReader()

    def read(
        self,
        page: pymupdf.Page,
        profile: BoreholeLayoutProfile,
        words: Sequence[PageWord] | None = None,
        text_source: str = "text",
        reference: BoreholeSheet | None = None,
    ) -> BoreholeSheet:
        """Return what the sheet prints.

        Parameters
        ----------
        page : pymupdf.Page
            The page.
        profile : BoreholeLayoutProfile
            The layout to read it with.
        words : sequence of PageWord or None
            The words to use (OCR words for a page without a text layer); the
            text layer when None.
        text_source : str
            ``"text"`` or ``"ocr"``, stored on the sheet.
        reference : BoreholeSheet or None
            The sheet on the page before; when it prints the same borehole and
            this sheet prints a single axis label, its axis slope places it.

        Returns
        -------
        BoreholeSheet
            The sheet; ``rows`` empty when no level column was found or the
            profile reads no rows.
        """
        number = page.number + 1
        content = self._vector.read(page)
        words = without_overprint(content.words if words is None else words)
        header = self._header.read(words, profile)
        sheet = BoreholeSheet(
            page_number=number, profile=profile.name, text_source=text_source, header=header
        )
        if not profile.parses_rows or profile.level_pattern is None:
            return sheet
        choice = self._level_column(words, rule_families(content.segments), profile, sheet)
        if choice is None:
            self.debug("page %d: no level column next to a rule family", number)
            return sheet
        _, (rule_x0, rule_x1, ys), label_words = choice
        sheet.rule_ys = ys
        sheet.labels = [self._label(w, profile) for w in label_words]
        for label in sheet.labels:
            if label.level_m is None:
                sheet.issues.append(
                    make_issue(
                        ValidationLevel.ERROR,
                        ISSUE_LEVEL_UNREADABLE,
                        f"page {number}: the level label {label.text!r} is not a number; "
                        "that boundary has no depth",
                        {"page": number, "text": label.text},
                    )
                )
        paired = len(sheet.labels) == len(ys)
        if not paired:
            sheet.issues.append(
                make_issue(
                    ValidationLevel.ERROR,
                    ISSUE_LEVEL_COUNT_MISMATCH,
                    f"page {number}: {len(sheet.labels)} level labels for {len(ys)} rules; "
                    "the rows of this sheet get no depth",
                    {"page": number, "labels": len(sheet.labels), "rules": len(ys)},
                )
            )
        bottom = self._bottom_y(header.label_boxes, ys, float(page.rect.height))
        label_ids = {id(w) for w in label_words}
        label_x0 = min(w.x0 for w in label_words)
        described = [
            w
            for w in words
            if id(w) not in label_ids
            and rule_x0 - DESCRIPTION_LEFT_SLACK_PT <= w.x0 < rule_x1 + DESCRIPTION_RIGHT_SLACK_PT
            and ys[0] - ABOVE_FIRST_RULE_PT <= w.cy < bottom
            and not _stray_number(w, rule_x0)
            # Left-aligned with the levels = printed in the level column
            # (sample codes "TR1"), never description text.
            and abs(w.x0 - label_x0) > LABEL_COLUMN_TOLERANCE_PT
        ]
        blocks: list[list[PageWord]] = [[] for _ in range(len(ys) + 1)]
        for w in described:
            blocks[bisect_right(ys, w.cy)].append(w)
        sheet.surface_text = " ".join(_lines(blocks[0]))
        for i, y in enumerate(ys):
            block = blocks[i + 1]
            last = i == len(ys) - 1
            if last and not block:
                break
            top = sheet.labels[i] if paired else None
            base = sheet.labels[i + 1] if paired and not last else None
            lines = tuple(_lines(block))
            box = _box(block)
            sheet.rows.append(SheetRow(top=top, base=base, lines=lines, box=box, rule_y=y))
            if not lines:
                sheet.issues.append(
                    make_issue(
                        ValidationLevel.WARNING,
                        ISSUE_EMPTY_DESCRIPTION,
                        f"page {number}: the row under the rule at y={y:.1f} carries no text",
                        {"page": number},
                    )
                )
        graph_words = [w for w in words if ys[0] - 2 * ABOVE_FIRST_RULE_PT <= w.cy < bottom]
        sheet.axis = fit_depth_axis(graph_words, label_x0 - 2.0, profile.axis_unit_m)
        if (
            sheet.axis is None
            and reference is not None
            and reference.axis is not None
            and reference.name == sheet.name
        ):
            sheet.axis = anchor_depth_axis(
                graph_words, label_x0 - 2.0, reference.axis, reference.page_number
            )
        sheet.samples = self._samples(page, words, label_x0)
        sheet.columns = {
            "label_x0": label_x0,
            "rule_x0": rule_x0,
            "rule_x1": rule_x1,
            "description_x0": min((w.x0 for w in described), default=rule_x0),
            "top_y": ys[0],
            "bottom_y": bottom,
        }
        self.debug(
            "page %d (%s): %d rules, %d labels, %d rows, %d samples, axis %s",
            number,
            profile.name,
            len(ys),
            len(sheet.labels),
            len(sheet.rows),
            len(sheet.samples),
            "fitted" if sheet.axis else "none",
        )
        return sheet

    def _level_column(
        self,
        words: Sequence[PageWord],
        families: list[RuleFamily],
        profile: BoreholeLayoutProfile,
        sheet: BoreholeSheet,
    ) -> _Choice | None:
        """Return the rule family and the level column that labels it, or None.

        Prefers a column whose readable levels fall down the sheet and whose
        label count equals the rule count; a column that rises somewhere is
        taken only when no falling one exists (and reported).
        """
        best: _Choice | None = None
        rising: _Choice | None = None
        for family in families:
            x0, _, ys = family
            candidates = [
                w
                for w in words
                if x0 - LABEL_REACH_LEFT_PT <= w.x0 <= x0 + LABEL_REACH_RIGHT_PT
                and ys[0] - ABOVE_FIRST_RULE_PT <= w.cy <= ys[-1] + 3.0
                and _number_like(w.text)
            ]
            for column in columns_by_left_edge(candidates):
                values = [self._label(w, profile).level_m for w in column]
                if not any(v is not None for v in values):
                    continue
                score = (abs(len(column) - len(ys)), -len(ys), -len(column))
                choice: _Choice = (score, family, column)
                if non_increasing(values):
                    if best is None or score < best[0]:
                        best = choice
                elif rising is None or score < rising[0]:
                    rising = choice
        if best is None and rising is not None:
            sheet.issues.append(
                make_issue(
                    ValidationLevel.WARNING,
                    ISSUE_LEVELS_NOT_FALLING,
                    f"page {sheet.page_number}: the printed levels rise somewhere down the sheet",
                    {"page": sheet.page_number},
                )
            )
            return rising
        return best

    @staticmethod
    def _label(word: PageWord, profile: BoreholeLayoutProfile) -> LevelLabel:
        """Return the level a label word prints (None when it is not a level)."""
        text = word.text.replace("−", "-")
        level: float | None = None
        if profile.level_pattern is not None and profile.level_pattern.match(text):
            level = round(float(text.replace(",", ".")) * profile.level_unit_m, 4)
        return LevelLabel(text=word.text, level_m=level, box=word)

    @staticmethod
    def _bottom_y(boxes: dict[str, PageWord], ys: list[float], page_height: float) -> float:
        """Return where the description column ends: the first footer label below the rules."""
        below = [b.y0 for b in boxes.values() if b.y0 > ys[-1]]
        return min(below, default=page_height)

    def _samples(
        self, page: pymupdf.Page, words: Sequence[PageWord], label_x0: float
    ) -> list[SampleMark]:
        """Return the sample bars left of the level column that carry an id."""
        marks: dict[tuple[int, int, int, int], SampleMark] = {}
        for path in page.get_drawings():
            fill = path.get("fill")
            if fill is None:
                continue
            mark = _bar_mark(fill)
            if mark is None:
                continue
            for item in path["items"]:
                rect = _item_rect(item)
                if rect is None or rect.x1 >= label_x0:
                    continue
                if rect.width > SAMPLE_BAR_MAX_WIDTH_PT or rect.height < SAMPLE_BAR_MIN_HEIGHT_PT:
                    continue
                sample_id = _id_right_of(rect, words)
                if sample_id is None:
                    continue
                key = (round(rect.x0), round(rect.y0), round(rect.x1), round(rect.y1))
                marks[key] = SampleMark(
                    sample_id=sample_id,
                    y0=float(rect.y0),
                    y1=float(rect.y1),
                    x0=float(rect.x0),
                    x1=float(rect.x1),
                    mark=mark,
                )
        return sorted(marks.values(), key=lambda m: m.y0)


def _lines(words: list[PageWord]) -> list[str]:
    """Return the printed lines of a block, verbatim, top to bottom."""
    return [
        " ".join(w.text for w in line)
        for line in group_lines(words, tolerance=DESCRIPTION_LINE_TOLERANCE_PT)
    ]


def _box(words: list[PageWord]) -> tuple[float, float, float, float] | None:
    """Return the box around a block's words, None for an empty block."""
    if not words:
        return None
    return (
        min(w.x0 for w in words),
        min(w.y0 for w in words),
        max(w.x1 for w in words),
        max(w.y1 for w in words),
    )


def _number_like(text: str) -> bool:
    """Return whether a word is mostly number characters (a level, or an unreadable one)."""
    if not LABEL_DIGIT_PATTERN.search(text):
        return False
    share = sum(1 for ch in text if ch in LEVEL_CHARACTERS) / len(text)
    return share > LABEL_MIN_NUMBER_SHARE


def _stray_number(word: PageWord, rule_x0: float) -> bool:
    """Return whether a bare number sits in the label window but outside the level column.

    Filter numbers and leader marks printed next to the level column are not
    description text.
    """
    in_window = rule_x0 - LABEL_REACH_LEFT_PT <= word.x0 <= rule_x0 + LABEL_REACH_RIGHT_PT
    return in_window and word.text.replace("-", "").replace(".", "").replace(",", "").isdigit()


def _bar_mark(colour: Any) -> str | None:
    """Return "filled" for a black fill, "open" for a white one, None for any colour.

    Judged per channel: a yellow or green lithology patch is bright but not
    white, and is no sample bar.
    """
    c = [float(v) for v in colour]
    if len(c) == 1:
        c = [c[0], c[0], c[0]]
    elif len(c) == 4:
        k = c[3]
        c = [(1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k)]
    if max(c) <= SAMPLE_FILLED_MAX_CHANNEL:
        return "filled"
    if min(c) >= SAMPLE_OPEN_MIN_CHANNEL:
        return "open"
    return None


def _item_rect(item: tuple[Any, ...]) -> pymupdf.Rect | None:
    """Return the rectangle a drawing item draws, None when it draws none."""
    if item[0] == "re":
        return pymupdf.Rect(item[1])
    if item[0] == "qu":
        return pymupdf.Rect(item[1].rect)
    return None


def _id_right_of(rect: pymupdf.Rect, words: Sequence[PageWord]) -> str | None:
    """Return the text printed just right of a bar, on the line nearest its centre."""
    near = [
        w
        for w in words
        if rect.x1 - 0.5 <= w.x0 <= rect.x1 + SAMPLE_LABEL_REACH_PT
        and rect.y0 - 2.0 <= w.cy <= rect.y1 + 2.0
    ]
    if not near:
        return None
    centre = (rect.y0 + rect.y1) / 2.0
    first = min(near, key=lambda w: abs(w.cy - centre))
    line = sorted(
        (
            w
            for w in words
            if abs(w.cy - first.cy) <= DESCRIPTION_LINE_TOLERANCE_PT and w.x0 >= first.x0
        ),
        key=lambda w: w.x0,
    )
    out = [line[0]]
    text = line[0].text
    for w in line[1:]:
        gap = w.x0 - out[-1].x1
        if gap > SAMPLE_ID_WORD_GAP_PT:
            break
        # "1-0550471478" is printed tight but extracts as three words.
        text += ("" if gap < SAMPLE_ID_TIGHT_GAP_PT else " ") + w.text
        out.append(w)
    return text
