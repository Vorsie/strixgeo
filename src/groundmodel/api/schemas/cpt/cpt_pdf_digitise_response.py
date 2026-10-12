"""Pydantic schema for the ``POST /cpt/pdf/digitise`` answer."""

from typing import Any

from pydantic import BaseModel

from groundmodel.api.schemas.cpt.cpt_pdf_overlay import CptPdfOverlay


class CptPdfDigitiseResponse(BaseModel):
    """One sounding as the calibration overlay shows it.

    Parameters
    ----------
    sounding_id:
        The listed sounding's key.
    page_numbers:
        The sounding's pages.
    series:
        The rows a CPT would store: ``depth_m``, ``qc_mpa`` and whichever of
        ``fs_mpa`` / ``rf_pct`` / ``u2_mpa`` were read, plus a
        ``<name>_clipped`` flag list per curve. Empty while no qc is read.
    sampling:
        "vector vertices (no resampling)" / "raster trace resampled to 0.02 m".
    calibrations:
        The ``PageCalibration`` dict of every page (what the overlay edits).
    assumptions:
        Every assumption the calibration made, in words.
    clipped_count:
        Points on an axis maximum (the true value is higher).
    printed_values:
        ``[depth, text]`` of values printed inside the frame (arrow labels).
    header:
        The sheet's header: ``x``, ``y``, ``epsg``, ``ground_level_m``,
        ``z_epsg``, ``test_date``.
    warnings:
        What to check before importing, in English (kept for older clients).
    notes:
        The same notes as ``{"code", "params"}`` dicts, one per warning and in
        the same order; the desktop renders them in the app language. Empty
        by default, so an answer built without them still validates.
    overlays:
        One overlay PNG per page (a printed-table sounding: per graph sheet).
    graph_series:
        A printed-table sounding only: the rows its graph sheet's reading
        would store (same shape as ``series``); None while no qc is read off
        the picture and for every other sounding. ``series`` stays the
        printed table, the default source (owner 2026-10-12).
    graph_comparison:
        A printed-table sounding whose graph sheet has a qc reading: picture
        qc vs printed qc, ``{"n", "median_abs_qc_mpa", "rms_qc_mpa"}``.
    series_source_default:
        ``"table"`` for a printed-table sounding (what the import stores
        unless told otherwise); None for every other sounding.
    """

    sounding_id: str
    page_numbers: list[int]
    series: dict[str, list[Any]]
    sampling: str | None
    calibrations: list[dict[str, Any]]
    assumptions: list[str]
    clipped_count: int
    printed_values: list[list[Any]]
    header: dict[str, Any]
    warnings: list[str]
    notes: list[dict[str, Any]] = []
    overlays: list[CptPdfOverlay]
    graph_series: dict[str, list[Any]] | None = None
    graph_comparison: dict[str, Any] | None = None
    series_source_default: str | None = None
