"""DigitisedWaterLevel: one groundwater level a borehole PDF prints."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class DigitisedWaterLevel:
    """A printed water level, with the text it was read from.

    Parameters
    ----------
    depth_m : float or None
        Depth below ground (m); None when the label names no unit or no
        below-ground reference (the raw text stays).
    raw_text : str
        The printed value ("200").
    label : str
        The printed label ("Grondwaterstand [cm-mv]:").
    source : str
        Where it was read: ``"header"`` (the header field). The water symbol
        drawn in the log is not read in phase 1.
    page : int
        The sheet it was read from.
    """

    depth_m: float | None
    raw_text: str
    label: str
    source: str
    page: int

    def to_dict(self) -> dict[str, Any]:
        """Return the water level as a JSON-ready dict."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DigitisedWaterLevel:
        """Return the water level a :meth:`to_dict` dict describes.

        Parameters
        ----------
        data : dict
            From :meth:`to_dict`.

        Returns
        -------
        DigitisedWaterLevel
            The water level.
        """
        return cls(**data)
