"""One CPT's stored depth series, reduced to what a section export draws."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class SectionCptTrace:
    """The qc and Rf channels of one CPT column on a section.

    Holds data only — no behaviour — so it does not inherit
    ``GroundModelLogger`` (CLAUDE.md "Logging via inheritance").

    Attributes
    ----------
    investigation_id : UUID
        The CPT row id; matches ``SectionInvestigationProjection.investigation_id``.
    depths_m : tuple[float, ...]
        Sample depths below the collar, ascending.
    qc_mpa : tuple[float | None, ...]
        Cone resistance per sample; ``None`` is a gap the curve breaks at.
    rf_pct : tuple[float | None, ...] | None
        Friction ratio per sample, or ``None`` when the source recorded none
        (a CPTM has no sleeve).
    """

    investigation_id: UUID
    depths_m: tuple[float, ...]
    qc_mpa: tuple[float | None, ...]
    rf_pct: tuple[float | None, ...] | None
