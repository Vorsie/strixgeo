"""DigitisedInterval: one described layer of a borehole read from a PDF."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DigitisedInterval:
    """A layer: its depth range and its description, verbatim.

    Parallel to an ``ObservationLayer`` of a lithological description
    (top_m, base_m, description); no DOV code is set here: the track
    editor's rule parser is the only description -> codes path.

    Parameters
    ----------
    depth_top_m, depth_base_m : float or None
        Depth below ground (m); None for a boundary whose printed level could
        not be read (never interpolated).
    top_level_m, base_level_m : float or None
        The printed levels (m of the sheet's datum) the depths come from.
    top_label, base_label : str or None
        The level labels as printed.
    description : str
        The printed lines joined by single spaces (raw, untranslated).
    description_lines : tuple of str
        The printed lines (of the first sheet that printed the row).
    pages : tuple of int
        The sheets the row is printed on (two for a row a sheet cut).
    """

    depth_top_m: float | None
    depth_base_m: float | None
    top_level_m: float | None
    base_level_m: float | None
    top_label: str | None
    base_label: str | None
    description: str
    description_lines: tuple[str, ...]
    pages: tuple[int, ...]

    def to_dict(self) -> dict[str, Any]:
        """Return the interval as a JSON-ready dict."""
        return {
            "depth_top_m": self.depth_top_m,
            "depth_base_m": self.depth_base_m,
            "top_level_m": self.top_level_m,
            "base_level_m": self.base_level_m,
            "top_label": self.top_label,
            "base_label": self.base_label,
            "description": self.description,
            "description_lines": list(self.description_lines),
            "pages": list(self.pages),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DigitisedInterval:
        """Return the interval a :meth:`to_dict` dict describes.

        Parameters
        ----------
        data : dict
            From :meth:`to_dict`.

        Returns
        -------
        DigitisedInterval
            The interval.
        """
        return cls(
            depth_top_m=data["depth_top_m"],
            depth_base_m=data["depth_base_m"],
            top_level_m=data["top_level_m"],
            base_level_m=data["base_level_m"],
            top_label=data["top_label"],
            base_label=data["base_label"],
            description=data["description"],
            description_lines=tuple(data["description_lines"]),
            pages=tuple(data["pages"]),
        )
