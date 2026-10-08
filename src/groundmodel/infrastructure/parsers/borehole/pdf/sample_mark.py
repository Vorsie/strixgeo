"""SampleMark: one sample bar of a borehole-log sheet and the id printed next to it."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SampleMark:
    """A sample bar in page coordinates (depths are assigned through the axis).

    Parameters
    ----------
    sample_id : str
        The id printed right of the bar ("S1-0550471477").
    y0, y1 : float
        Top and bottom of the bar (page y).
    x0, x1 : float
        Left and right of the bar.
    mark : str
        ``"open"`` (white fill) or ``"filled"`` (black fill), as drawn.
    """

    sample_id: str
    y0: float
    y1: float
    x0: float
    x1: float
    mark: str
