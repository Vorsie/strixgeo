"""ReportSounding: one sounding of a report as the import dialog lists it."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.cpt.pdf.cpt_origin import CptOrigin
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding_note import ReportSoundingNote


@dataclass(frozen=True)
class ReportSounding:
    """A digitised sounding of a report plus what its sheet header said.

    Parameters
    ----------
    key : str
        Stable handle for the API: the printed id, made unique within the
        report (``"page-184"`` for a sheet whose id was not read).
    sounding_id : str or None
        The id printed on the sheet.
    origin : CptOrigin
        Campaign or unknown (desk-study sheets never become a ReportSounding).
    page_numbers : tuple of int
        1-based pages of the sounding (first sheet + continuations).
    graph_kind : GraphKind
        Vector (drawing commands) or raster (a scan / pasted image).
    profile_name : str
        The layout profile of the first sheet.
    ground_level_m, z_epsg : float, int or None
        The printed ground level and the datum it is on (5710 TAW).
    x, y, epsg : float, float, int or None
        The printed position and its coordinate system; None when not printed.
    test_date : str or None
        The printed date, as printed.
    curves : tuple of str
        The quantities read ("qc", "fs", "rf", "u2").
    clipped_points : int
        Points drawn on an axis maximum (the true value is higher).
    digitised : bool
        False when no curve could be read (a raster page whose axes need the
        user's tick values).
    warnings : tuple of str
        What the user should look at before importing, in English words.
        Kept for clients that predate ``notes``.
    notes : tuple of ReportSoundingNote
        The same notes as stable codes + params, one per warning and in the
        same order; the desktop renders them in the app language.
    """

    key: str
    sounding_id: str | None
    origin: CptOrigin
    page_numbers: tuple[int, ...]
    graph_kind: GraphKind
    profile_name: str = "generic"
    ground_level_m: float | None = None
    z_epsg: int | None = None
    x: float | None = None
    y: float | None = None
    epsg: int | None = None
    test_date: str | None = None
    curves: tuple[str, ...] = field(default_factory=tuple)
    clipped_points: int = 0
    digitised: bool = True
    warnings: tuple[str, ...] = field(default_factory=tuple)
    notes: tuple[ReportSoundingNote, ...] = field(default_factory=tuple)

    @property
    def sheet_count(self) -> int:
        """Return how many sheets the sounding was printed on."""
        return len(self.page_numbers)

    def to_dict(self) -> dict[str, Any]:
        """Return the sounding as a JSON-ready dict for the UI."""
        return {
            "key": self.key,
            "sounding_id": self.sounding_id,
            "origin": self.origin.value,
            "page_numbers": list(self.page_numbers),
            "sheet_count": self.sheet_count,
            "graph_kind": self.graph_kind.value,
            "profile_name": self.profile_name,
            "ground_level_m": self.ground_level_m,
            "z_epsg": self.z_epsg,
            "x": self.x,
            "y": self.y,
            "epsg": self.epsg,
            "test_date": self.test_date,
            "curves": list(self.curves),
            "clipped_points": self.clipped_points,
            "digitised": self.digitised,
            "warnings": list(self.warnings),
            "notes": [n.to_dict() for n in self.notes],
        }
