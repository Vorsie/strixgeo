"""TickRunFinder: find axes as evenly stepped runs of numeric labels."""

from __future__ import annotations

from collections.abc import Callable, Sequence

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    MIN_TICKS_PER_RUN,
    NUMBER_PATTERN,
    TICK_COLUMN_TOLERANCE_PT,
    TICK_PITCH_RELATIVE_TOLERANCE,
    TICK_ROW_TOLERANCE_PT,
)
from groundmodel.infrastructure.parsers.cpt.pdf.tick_orientation import TickOrientation
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run import TickRun
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# A leading / trailing label may sit off its tick (left-aligned "0" on the
# frame edge); it re-joins its run with this looser pitch tolerance because
# the later grid snap corrects its position.
_EDGE_LABEL_PITCH_TOLERANCE = 0.35


def parse_number(text: str) -> float | None:
    """Return the numeric value of a tick label, or None when it is not one.

    Parameters
    ----------
    text : str
        The label ("32", "-1", "+5.00", "0,4", "−2").

    Returns
    -------
    float or None
        The value, or None for anything that is not a bare number.
    """
    cleaned = text.strip().replace("−", "-")
    if not NUMBER_PATTERN.match(cleaned):
        return None
    return float(cleaned.replace(",", "."))


class TickRunFinder(GroundModelLogger):
    """Group numeric words into axes.

    A row (or column) of numbers is an axis when consecutive labels step by the
    same value AND the same distance. One printed row can hold several axes
    side by side (the qc, fs and Rf panels of a Van der Straaten sheet share
    one baseline); the run breaks wherever the step changes.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def find(self, words: Sequence[PageWord]) -> list[TickRun]:
        """Return every horizontal and vertical tick run among ``words``.

        Parameters
        ----------
        words : sequence of PageWord
            A page's words (text layer or OCR).

        Returns
        -------
        list of TickRun
            Horizontal runs top to bottom then left to right, followed by
            vertical runs left to right then top to bottom.
        """
        numeric = [(w, v) for w in words if (v := parse_number(w.text)) is not None]
        self.debug("tick runs: %d numeric of %d words", len(numeric), len(words))
        runs: list[TickRun] = []
        for row in _cluster(numeric, key=lambda w: w.cy, tolerance=TICK_ROW_TOLERANCE_PT):
            row.sort(key=lambda wv: wv[0].cx)
            runs.extend(_split(row, TickOrientation.HORIZONTAL, lambda w: w.cx))
        for column in _cluster(numeric, key=lambda w: w.x1, tolerance=TICK_COLUMN_TOLERANCE_PT):
            column.sort(key=lambda wv: wv[0].cy)
            runs.extend(_split(column, TickOrientation.VERTICAL, lambda w: w.cy))
        self.debug("tick runs: found %d", len(runs))
        return runs


def _cluster(
    items: list[tuple[PageWord, float]],
    key: Callable[[PageWord], float],
    tolerance: float,
) -> list[list[tuple[PageWord, float]]]:
    """Group items whose key lies within ``tolerance`` of the group's first."""
    groups: list[list[tuple[PageWord, float]]] = []
    for item in sorted(items, key=lambda wv: key(wv[0])):
        if groups and abs(key(item[0]) - key(groups[-1][0][0])) <= tolerance:
            groups[-1].append(item)
        else:
            groups.append([item])
    return [g for g in groups if len(g) >= MIN_TICKS_PER_RUN]


def _consistent(
    a: tuple[float, float],
    b: tuple[float, float],
    pitch: float,
    step: float,
    tolerance: float,
) -> bool:
    """Return whether the step a -> b repeats the run's pitch and value step."""
    d_pos = b[0] - a[0]
    d_val = b[1] - a[1]
    same_pitch = abs(d_pos - pitch) <= tolerance * abs(pitch)
    same_step = abs(d_val - step) <= 1e-6 + 1e-3 * abs(step)
    return same_pitch and same_step


def _split(
    items: list[tuple[PageWord, float]],
    orientation: TickOrientation,
    pos: Callable[[PageWord], float],
) -> list[TickRun]:
    """Split an ordered row/column into maximal evenly stepped runs."""
    points = [(pos(w), v) for w, v in items]
    runs: list[TickRun] = []
    i = 0
    floor = 0  # first index not claimed by an earlier run
    n = len(points)
    while i < n - 1:
        pitch = points[i + 1][0] - points[i][0]
        step = points[i + 1][1] - points[i][1]
        if pitch <= 0 or step == 0:
            i += 1
            continue
        j = i + 1
        while j + 1 < n and _consistent(
            points[j], points[j + 1], pitch, step, TICK_PITCH_RELATIVE_TOLERANCE
        ):
            j += 1
        if j - i + 1 < MIN_TICKS_PER_RUN:
            # The first step may be the odd one (an off-tick edge label): drop
            # the first label and try again from the next.
            i += 1
            continue
        lo, hi = i, j
        if lo - 1 >= floor and _consistent(
            points[lo - 1], points[lo], pitch, step, _EDGE_LABEL_PITCH_TOLERANCE
        ):
            lo -= 1
        if hi + 1 < n and _consistent(
            points[hi], points[hi + 1], pitch, step, _EDGE_LABEL_PITCH_TOLERANCE
        ):
            hi += 1
        chosen = items[lo : hi + 1]
        runs.append(
            TickRun(
                orientation=orientation,
                coords=tuple(p[0] for p in points[lo : hi + 1]),
                values=tuple(v for _, v in chosen),
                words=tuple(w for w, _ in chosen),
            )
        )
        i = hi + 1
        floor = i
    return runs
