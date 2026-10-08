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
    TOTAL_FORCE
        Total resistance of a mechanical cone (kN): measured, a force, never
        converted to a stress, not stored.
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
    TOTAL_FORCE = "total-force"
    DERIVED = "derived"
