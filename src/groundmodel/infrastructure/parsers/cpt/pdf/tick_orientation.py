"""TickOrientation enum."""

from __future__ import annotations

from enum import StrEnum


class TickOrientation(StrEnum):
    """Whether a run of tick labels sits along a horizontal or a vertical axis.

    Members
    -------
    HORIZONTAL
        Labels on one row, value changing with x.
    VERTICAL
        Labels in one column, value changing with y.
    """

    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"
