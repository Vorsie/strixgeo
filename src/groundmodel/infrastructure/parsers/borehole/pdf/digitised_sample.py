"""DigitisedSample: one sample mark of a borehole read from a PDF."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DigitisedSample:
    """A sample bar: its id and its depth range, parallel to ``DovFileSample``.

    Parameters
    ----------
    sample_id : str
        The id printed next to the bar (phase 2: ``sample_number``).
    depth_top_m, depth_base_m : float or None
        Depth range of the bar through the sheet's depth axis; None when the
        axis could not be fitted. A bar a sheet cut is merged over sheets.
    mark : str
        ``"open"`` or ``"filled"``, as drawn.
    sample_type : str or None
        What the layout's printed legend calls that mark ("geroerd" /
        "ongeroerd"); None when the profile has no checked legend.
    pages : tuple of int
        Sheets the bar is drawn on.
    """

    sample_id: str
    depth_top_m: float | None
    depth_base_m: float | None
    mark: str
    sample_type: str | None
    pages: tuple[int, ...]

    def to_dict(self) -> dict[str, Any]:
        """Return the sample as a JSON-ready dict."""
        return {
            "sample_id": self.sample_id,
            "depth_top_m": self.depth_top_m,
            "depth_base_m": self.depth_base_m,
            "mark": self.mark,
            "sample_type": self.sample_type,
            "pages": list(self.pages),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DigitisedSample:
        """Return the sample a :meth:`to_dict` dict describes.

        Parameters
        ----------
        data : dict
            From :meth:`to_dict`.

        Returns
        -------
        DigitisedSample
            The sample.
        """
        return cls(
            sample_id=data["sample_id"],
            depth_top_m=data["depth_top_m"],
            depth_base_m=data["depth_base_m"],
            mark=data["mark"],
            sample_type=data["sample_type"],
            pages=tuple(data["pages"]),
        )
