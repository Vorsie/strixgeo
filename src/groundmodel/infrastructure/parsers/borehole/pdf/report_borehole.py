"""ReportBorehole: one borehole the triage found in a report."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ReportBorehole:
    """A borehole as the triage lists it: its sheets and its printed header.

    Parameters
    ----------
    key : str
        ``"<name>@p<first page>"``: unique in the report even when a name is
        printed twice.
    name : str
        The name after "Boring:" (raw).
    profile : str
        The layout profile its sheets matched.
    pages : tuple of int
        Its sheets, 1-based, in report order.
    text_verdict : str
        ``"text"`` when every sheet has a text layer, ``"ocr"`` when a sheet
        was read by OCR.
    parses_rows : bool
        Whether the profile reads its rows (False for the triage-only
        generic profile).
    x, y : float or None
        Printed position.
    epsg : int or None
        The coordinate system the labels name; None when not named.
    ground_level_m : float or None
        Printed ground level (header), else the first printed level.
    z_epsg : int or None
        Vertical datum the header names.
    date_text, date_iso : str or None
        Printed date and its ISO form when it is a real date.
    driller : str or None
        "Uitvoering door" / "Boormeester".
    project_code, project_name : str or None
        As printed.
    depth_top_m, depth_base_m : float or None
        Depth covered by the printed levels (below the ground level).
    repeat_of : str or None
        The key of an earlier borehole of the same name whose depth range
        this one lies in (a sheet printed again, e.g. an overview at another
        scale); None for a borehole listed once.
    """

    key: str
    name: str
    profile: str
    pages: tuple[int, ...]
    text_verdict: str
    parses_rows: bool
    x: float | None = None
    y: float | None = None
    epsg: int | None = None
    ground_level_m: float | None = None
    z_epsg: int | None = None
    date_text: str | None = None
    date_iso: str | None = None
    driller: str | None = None
    project_code: str | None = None
    project_name: str | None = None
    depth_top_m: float | None = None
    depth_base_m: float | None = None
    repeat_of: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return the listing as a JSON-ready dict."""
        return {
            "key": self.key,
            "name": self.name,
            "profile": self.profile,
            "pages": list(self.pages),
            "text_verdict": self.text_verdict,
            "parses_rows": self.parses_rows,
            "x": self.x,
            "y": self.y,
            "epsg": self.epsg,
            "ground_level_m": self.ground_level_m,
            "z_epsg": self.z_epsg,
            "date_text": self.date_text,
            "date_iso": self.date_iso,
            "driller": self.driller,
            "project_code": self.project_code,
            "project_name": self.project_name,
            "depth_top_m": self.depth_top_m,
            "depth_base_m": self.depth_base_m,
            "repeat_of": self.repeat_of,
        }
