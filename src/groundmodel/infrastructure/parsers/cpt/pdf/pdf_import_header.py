"""PdfImportHeader: the header a digitised sounding is imported under."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class PdfImportHeader:
    """What the stored CPT is called and where it stands.

    Built from the sheet's own header (the triage evidence); any field the
    user typed in the import dialog replaces the sheet's, and ``sources``
    records which one each field came from.

    Parameters
    ----------
    test_id : str
        The sounding id (the CPT's name and GEF-style test id).
    project_id : str
        The GEF-style project id: the report's campaign code ("CAMZ-001"),
        or "PDF" when the report names none. With ``test_id`` it is the
        duplicate key a re-import is matched on.
    x, y : float or None
        Position; None when neither printed nor typed.
    epsg : int or None
        Coordinate system of ``x`` / ``y``.
    ground_level_m : float or None
        Ground level (the CPT's Z).
    z_epsg : int or None
        Vertical datum of ``ground_level_m``.
    test_date : str or None
        The test date as printed (or typed).
    sources : dict
        Field name -> ``"sheet"`` or ``"user"``, for the provenance.
    """

    test_id: str
    project_id: str
    x: float | None = None
    y: float | None = None
    epsg: int | None = None
    ground_level_m: float | None = None
    z_epsg: int | None = None
    test_date: str | None = None
    sources: dict[str, str] = field(default_factory=dict)
