"""LevelLabel: one printed boundary level of a borehole-log sheet."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord


@dataclass(frozen=True)
class LevelLabel:
    """A level label as printed above its boundary rule.

    Parameters
    ----------
    text : str
        The label as printed ("650", "-22.49", or an unreadable "15O").
    level_m : float or None
        The level in metres of the sheet's datum (cm labels divided by 100);
        None when the text is not a number (never guessed).
    box : PageWord
        Where it is printed.
    """

    text: str
    level_m: float | None
    box: PageWord
