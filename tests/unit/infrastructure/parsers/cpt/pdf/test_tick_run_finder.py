"""Tick runs: axis tick labels are text objects with positions in PDF space.

A row of numbers that step evenly in value AND in position is an axis. Two
panels on one row (qc 0..32 then fs 0..0.4) are two axes, not one.
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.tick_orientation import TickOrientation
from groundmodel.infrastructure.parsers.cpt.pdf.tick_run_finder import TickRunFinder


def _row(values: list[str], x0: float, pitch: float, y: float) -> list[PageWord]:
    return [
        PageWord(x0 + i * pitch - 3, y, x0 + i * pitch + 3, y + 7, v) for i, v in enumerate(values)
    ]


def test_one_row_holding_two_panels_splits_into_two_axes() -> None:
    """One row holding two panels splits into two axes."""
    qc = _row(["0", "2", "4", "6", "8", "10"], 44.0, 18.3, 86.6)
    fs = _row(["0", "0.1", "0.2", "0.3", "0.4"], 354.0, 18.3, 86.6)
    runs = TickRunFinder().find(qc + fs)
    horizontal = [r for r in runs if r.orientation is TickOrientation.HORIZONTAL]
    assert [r.values for r in horizontal] == [
        (0.0, 2.0, 4.0, 6.0, 8.0, 10.0),
        (0.0, 0.1, 0.2, 0.3, 0.4),
    ]


def test_a_column_of_elevations_is_a_vertical_axis() -> None:
    """A column of elevations is a vertical axis."""
    words = [PageWord(30, 100 + 18.3 * i, 36, 107 + 18.3 * i, str(7 - i)) for i in range(12)]
    runs = TickRunFinder().find(words)
    assert len(runs) == 1
    assert runs[0].orientation is TickOrientation.VERTICAL
    assert runs[0].values[:3] == (7.0, 6.0, 5.0)


def test_scattered_numbers_are_not_an_axis() -> None:
    """Scattered numbers are not an axis."""
    # A date, a coordinate and a ground level sitting on one line.
    words = [
        PageWord(270, 739, 300, 745, "28-2-2024"),
        PageWord(276, 782, 303, 789, "66980.21"),
        PageWord(330, 782, 345, 789, "6.02"),
    ]
    assert TickRunFinder().find(words) == []


def test_a_reversed_axis_is_still_one_run() -> None:
    """A reversed axis is still one run."""
    # u2 axis printed 1400 .. -200 left to right.
    values = [str(v) for v in range(1400, -300, -100)]
    runs = TickRunFinder().find(_row(values, 44.0, 18.4, 715.5))
    assert len(runs) == 1
    assert runs[0].values[0] == 1400.0
    assert runs[0].values[-1] == -200.0
