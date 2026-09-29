"""PanelKind enum."""

from __future__ import annotations

from enum import StrEnum


class PanelKind(StrEnum):
    """Which quantity a graph panel (or an axis inside a panel) plots.

    Members
    -------
    QC
        Cone resistance qc (MPa).
    FS
        Sleeve friction fs (MPa).
    RF
        Friction ratio Rf (%).
    U2
        Pore pressure u2 (stored in MPa; sheets often print kPa).
    INCLINATION
        Cone inclination (degrees); read, not stored.
    UNKNOWN
        An axis whose quantity no label names.
    """

    QC = "qc"
    FS = "fs"
    RF = "rf"
    U2 = "u2"
    INCLINATION = "inclination"
    UNKNOWN = "unknown"
