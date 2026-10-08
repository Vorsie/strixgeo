"""ReportSounding: one sounding of a report as the import dialog lists it."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.domain.services.cpt_display_name import cpt_display_name
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
    project_number : str or None
        The project number printed in the sheet's sounding block
        ("23.15-002"), the project id a GEF of the same sounding carries.
    campaign_code : str or None
        The report's campaign code ("CAMZ-001"), the stand-in project id when
        the sheet prints no project number.
    ground_level_source : str or None
        Where ``ground_level_m`` comes from when the sheet does not print it
        as such: ``"printed-table"`` = the table's printed level + depth.
        None = printed on the sheet.
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
    project_number: str | None = None
    campaign_code: str | None = None
    ground_level_source: str | None = None

    @property
    def sheet_count(self) -> int:
        """Return how many sheets the sounding was printed on."""
        return len(self.page_numbers)

    @property
    def project_id(self) -> str | None:
        """Return the project id the sounding is stored under, if any.

        The sheet's project number, else the report's campaign code.
        """
        return self.project_number or self.campaign_code

    @property
    def display_name(self) -> str:
        """Return the name the imported CPT is shown under ("23.15-002-S110")."""
        return cpt_display_name(self.project_id or "", self.sounding_id or self.key)

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
            "project_number": self.project_number,
            "campaign_code": self.campaign_code,
            "display_name": self.display_name,
            # Only a sounding whose ground level is derived says so; the dict
            # of every other sounding stays as it was (additive wire field).
            **(
                {"ground_level_source": self.ground_level_source}
                if self.ground_level_source is not None
                else {}
            ),
        }
