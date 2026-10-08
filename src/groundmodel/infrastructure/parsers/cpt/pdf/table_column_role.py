"""TableColumnRole enum."""

from __future__ import annotations

from enum import StrEnum


class TableColumnRole(StrEnum):
    """What one column of a printed CPT table holds.

    Members
    -------
    DEPTH
        Depth below ground level (m), the row key.
    LEVEL
        The row's level against the vertical datum (m TAW): a check on the
        depth, not stored.
    QC
        Cone resistance (MPa), stored.
    FS
        Sleeve friction (MPa), stored.
    RF
        Friction ratio (%), stored as printed.
    INCLINATION
        Cone inclination (degrees): measured, but the CPT has no column for it.
    TOTAL_RESISTANCE
        Total resistance Qt of a mechanical cone (kN, GEF quantity 128
        totaalweerstand): on a CPT-M sheet stored as ``q_total_mpa`` with the
        kN value kept as-is, like the GEF importer (the standard 10 cm² cone
        makes kN == MPa; owner 2026-10-09). Never stored for another cone.
    TOTAL_FORCE
        Another force column of a mechanical cone (Qst, total sleeve friction
        in kN): measured, no stored column, not stored.
    DERIVED
        A value the report CALCULATED (friction angle, compressibility
        constant, bearing capacity): never imported.
    """

    DEPTH = "depth"
    LEVEL = "level"
    QC = "qc"
    FS = "fs"
    RF = "rf"
    INCLINATION = "inclination"
    TOTAL_RESISTANCE = "total-resistance"
    TOTAL_FORCE = "total-force"
    DERIVED = "derived"
