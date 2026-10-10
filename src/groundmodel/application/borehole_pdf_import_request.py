"""BoreholePdfImportRequest: one ticked borehole of a triaged PDF report, with its confirmations."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BoreholePdfImportRequest:
    """What the user decided for one borehole of the import dialog.

    Parameters
    ----------
    key : str
        The borehole's triage key (``"<name>@p<first page>"``).
    crs_epsg : int or None
        The coordinate system the user confirmed for X/Y printed without one
        (owner ruling 2026-10-08, 3): 31370 for "this test is Lambert 72",
        another supported code for "another CRS"; None when not confirmed.
    crs_scope : str or None
        ``"this"`` (this borehole) or ``"report"`` (every borehole of the
        report in this import); None with ``crs_epsg`` None.
    water_unit_confirmed : bool
        The user confirmed the water level reads as cm below ground (ruling 4).
    """

    key: str
    crs_epsg: int | None = None
    crs_scope: str | None = None
    water_unit_confirmed: bool = False
