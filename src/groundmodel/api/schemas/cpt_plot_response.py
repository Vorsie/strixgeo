"""Pydantic schema for the CPT plot data endpoint response."""

from uuid import UUID

from pydantic import BaseModel


class CptPlotResponse(BaseModel):
    """Depth-series arrays returned by GET /cpt/{id}/plot.

    All arrays are parallel: index i corresponds to the same measurement row
    across every column.  Arrays are ordered from shallow to deep (ascending
    depth), which matches the raw GEF storage order.

    The frontend is expected to invert the depth axis when rendering qc/fs vs
    depth charts (geotechnical convention: depth increases downward).

    Parameters
    ----------
    cpt_id:
        Primary key of the CPT record.
    depths_m:
        Measurement depths in metres.
    qc_mpa:
        Cone resistance in MPa.
    fs_mpa:
        Sleeve friction in MPa; None for CPTM (no friction sleeve).
    u2_mpa:
        Pore pressure at the shoulder in MPa; None for CPTE and CPTM.
    rf_pct:
        Friction ratio (fs/qc × 100) in percent; None when fs is absent.
    qt_mpa:
        CPTU corrected cone resistance (Robertson qt = qc + u2(1-a)) in MPa.
        Populated only for piezocone CPTs that ship qt directly. None for
        CPTE, CPTM, or CPTUs whose source omitted qt.
    q_total_mpa:
        CPTM totaalweerstand in MPa — the mechanical cone's combined tip +
        sleeve force read in one go. Populated only for CPTM. Mutually
        exclusive with ``qt_mpa`` in practice.
    rf_source:
        Provenance of ``rf_pct``: ``"measured"`` if the source file provided
        Rf directly, ``"computed"`` if our parser derived it from qc and fs.
        ``None`` when ``rf_pct`` is absent or the row predates this flag.
    """

    cpt_id: UUID
    depths_m: list[float]
    qc_mpa: list[float]
    # Inner None: PostgreSQL FLOAT[] can contain NULL elements (void-masked rows).
    fs_mpa: list[float | None] | None
    u2_mpa: list[float | None] | None
    rf_pct: list[float | None] | None
    qt_mpa: list[float | None] | None
    q_total_mpa: list[float | None] | None
    ic: list[float | None] | None
    rf_source: str | None = None
