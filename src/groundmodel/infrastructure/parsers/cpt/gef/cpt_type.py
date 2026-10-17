"""CPT classification by available measurement channels."""

from enum import Enum


class CPTType(Enum):
    """GEF CPT classification by available measurement channels."""

    CPTU = "CPTU"  # piezocone: qc + fs + u2
    CPTE = "CPTE"  # electric: qc + fs, no u2
    CPTM = "CPTM"  # mechanical: qc only
    UNKNOWN = "UNKNOWN"
