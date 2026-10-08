"""SheetRow: one description row of a borehole-log sheet, between two rules."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.infrastructure.parsers.borehole.pdf.level_label import LevelLabel


@dataclass(frozen=True)
class SheetRow:
    """The text printed under one rule, with the levels that bound it.

    Parameters
    ----------
    top : LevelLabel or None
        The label of the rule above the text (None when the sheet's labels
        could not be paired with its rules).
    base : LevelLabel or None
        The label of the next rule; None for a row the sheet does not close
        (its text runs on to the next sheet).
    lines : tuple of str
        The printed lines, verbatim, top to bottom.
    box : tuple of float or None
        ``(x0, y0, x1, y1)`` of the text, None for a row with no text.
    rule_y : float
        The page y of the rule above the text.
    """

    top: LevelLabel | None
    base: LevelLabel | None
    lines: tuple[str, ...]
    box: tuple[float, float, float, float] | None
    rule_y: float

    @property
    def text(self) -> str:
        """Return the description: the printed lines joined by single spaces."""
        return " ".join(" ".join(self.lines).split())
